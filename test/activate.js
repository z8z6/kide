"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");

const subscriptions = [];
const commands = new Map();
const disposables = [];
const providers = [];
let openListener;
let configurationListener;
const starts = [];
const stops = [];

function disposable() {
  const item = { dispose: () => disposables.push(item) };
  return item;
}

const vscode = {
  languages: {
    registerDocumentFormattingEditProvider: () => disposable(),
    registerHoverProvider: () => disposable(),
    registerCompletionItemProvider: () => disposable(),
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
    registerTreeDataProvider: () => disposable(),
    showErrorMessage: async () => undefined,
    activeTextEditor: undefined,
  },
  commands: {
    registerCommand: (name, handler) => {
      commands.set(name, handler);
      return disposable();
    },
    executeCommand: async () => undefined,
  },
  workspace: {
    textDocuments: [],
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    onDidOpenTextDocument: (listener) => {
      openListener = listener;
      return disposable();
    },
    onDidSaveTextDocument: () => disposable(),
    onDidChangeConfiguration: (listener) => {
      configurationListener = listener;
      return disposable();
    },
  },
  TreeItem: class TreeItem {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0 },
  ThemeIcon: class ThemeIcon {
    constructor(id) {
      this.id = id;
    }
  },
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
  for (const command of ["kelp.format", "kelp.check", "kelp.build", "kelp.members"])
    assert.ok(commands.has(command), command);
  assert.deepEqual(providers, ["folding:kelyra", "inlay:kelyra"]);
  assert.equal(starts.length, 0); // No Kelyra document is open yet.

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
}

test().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
