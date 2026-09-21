"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

// A workspace with one declared member, scanned because the mock workspace is
// untrusted and no `kelp` executable is available.
const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kide-activate-"));
fs.mkdirSync(path.join(projectRoot, "libs/demo"), { recursive: true });
fs.writeFileSync(path.join(projectRoot, "kelp.toml"), '[workspace]\nmembers = ["libs/demo"]\n');
fs.writeFileSync(
  path.join(projectRoot, "libs/demo/kelp.toml"),
  '[project]\nname = "demo"\nentry = "src/main.kly"\n\n[build]\nkind = "library"\n',
);
const workspaceFolder = { name: "kest", uri: { scheme: "file", fsPath: projectRoot } };

const subscriptions = [];
const commands = new Map();
const disposables = [];
const providers = [];
const taskProviders = [];
const treeProviders = new Map();
let openListener;
let activeEditorListener;
let configurationListener;
const starts = [];
const stops = [];

function disposable() {
  const item = { dispose: () => disposables.push(item) };
  return item;
}

const statusItem = {
  text: "",
  tooltip: "",
  command: "",
  shown: false,
  show() {
    this.shown = true;
  },
  dispose() {
    disposables.push(this);
  },
};

const vscode = {
  languages: {
    registerDocumentFormattingEditProvider: () => disposable(),
    registerHoverProvider: () => disposable(),
    registerCompletionItemProvider: () => disposable(),
    registerDefinitionProvider: (language) => {
      providers.push(`definition:${language}`);
      return disposable();
    },
    registerFoldingRangeProvider: (language) => {
      providers.push(`folding:${language}`);
      return disposable();
    },
    registerInlayHintsProvider: (language) => {
      providers.push(`inlay:${language}`);
      return disposable();
    },
  },
  window: {
    registerTreeDataProvider: (id, provider) => {
      providers.push(`tree:${id}`);
      treeProviders.set(id, provider);
      return disposable();
    },
    createStatusBarItem: () => statusItem,
    showErrorMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    activeTextEditor: undefined,
  },
  commands: {
    registerCommand: (name, handler) => {
      commands.set(name, handler);
      return disposable();
    },
    executeCommand: async () => undefined,
  },
  tasks: {
    registerTaskProvider: (type, provider) => {
      taskProviders.push(`${type}:${provider.provideTasks ? "dynamic" : "static"}`);
      return disposable();
    },
  },
  workspace: {
    isTrusted: false,
    textDocuments: [],
    workspaceFolders: [workspaceFolder],
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    onDidOpenTextDocument: (listener) => {
      openListener = listener;
      return disposable();
    },
    onDidSaveTextDocument: () => disposable(),
    onDidChangeActiveTextEditor: (listener) => {
      activeEditorListener = listener;
      return disposable();
    },
    onDidChangeConfiguration: (listener) => {
      configurationListener = listener;
      return disposable();
    },
  },
  EventEmitter: class EventEmitter {
    constructor() {
      this.listeners = [];
      this.event = (listener) => {
        this.listeners.push(listener);
        return { dispose: () => {} };
      };
    }

    fire(value) {
      this.listeners.forEach((listener) => listener(value));
    }
  },
  TreeItem: class TreeItem {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Expanded: 1 },
  ThemeIcon: class ThemeIcon {
    constructor(id) {
      this.id = id;
    }
  },
  MarkdownString: class MarkdownString {
    constructor(value) {
      this.value = value;
    }
  },
  Uri: { file: (fsPath) => ({ scheme: "file", fsPath }) },
};

class LanguageClient {
  constructor(id, name, serverOptions, clientOptions) {
    this.id = id;
    this.name = name;
    this.serverOptions = serverOptions;
    this.clientOptions = clientOptions;
  }

  async start() {
    starts.push(this.serverOptions.command);
  }

  async stop() {
    stops.push(this.id);
  }
}

const load = Module._load;
Module._load = function (request, parent, main) {
  if (request === "vscode") return vscode;
  if (request === "vscode-languageclient/node")
    return { LanguageClient, TransportKind: { stdio: 0 } };
  return load(request, parent, main);
};

const { activate, deactivate } = require("../extension.js");
// The loader override stays installed: startLanguageServer requires the
// client lazily, after this module has loaded.

async function test() {
  await activate({ subscriptions: { push: (...items) => subscriptions.push(...items) } });
  for (const command of [
    "kelp.format",
    "kelp.check",
    "kelp.build",
    "kelp.members",
    "kelp.refreshProjects",
    "kelp.openManifest",
    "kelp.revealProject",
    "kelp.output",
  ])
    assert.ok(commands.has(command), command);
  assert.deepEqual(providers, [
    "folding:kelyra",
    "inlay:kelyra",
    "definition:kelp",
    "tree:kelp.projects",
    "tree:kelp.actions",
  ]);
  assert.deepEqual(taskProviders, ["kelp:dynamic"]);
  assert.equal(starts.length, 0); // No Kelyra document is open yet.

  // The Projects view scans manifests when `kelp` cannot be run, nests members
  // by directory, and points each project at its own working directory.
  const projects = treeProviders.get("kelp.projects");
  const nodes = await projects.getChildren();
  assert.deepEqual(
    nodes.map(({ type, label }) => [type, label]),
    [["directory", "libs"]],
  );
  assert.equal(projects.getTreeItem(nodes[0]).contextValue, "kelp.directory");
  const demo = projects.getTreeItem(nodes[0].children[0]);
  assert.equal(demo.label, "demo");
  assert.equal(demo.description, "library · build/demo.o");
  assert.equal(demo.contextValue, "kelp.project");
  assert.equal(demo.project.cwd, path.join(projectRoot, "libs/demo"));
  assert.equal(demo.command.command, "kelp.openManifest");
  projects.refresh();

  activeEditorListener(undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(statusItem.shown);

  openListener({ languageId: "kelyra" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(starts, ["kelyra-ls"]);
  assert.equal(stops.length, 0);

  // Changing the server path restarts it; unrelated settings do not.
  configurationListener({ affectsConfiguration: () => false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stops.length, 0);
  vscode.workspace.textDocuments.push({ languageId: "kelyra" });
  configurationListener({ affectsConfiguration: (section) => section === "kelyra.languageServer.path" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(stops, ["kelyra"]);
  assert.equal(starts.length, 2);

  await deactivate();
  assert.deepEqual(stops, ["kelyra", "kelyra"]);
  assert.ok(subscriptions.length > 0);
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

test().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
