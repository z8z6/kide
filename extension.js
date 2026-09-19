"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");

let client;

const kelpFields = {
  project: [
    ["name", '"${1:app}"', "Project name."],
    ["version", '"${1:0.1.0}"', "Project version."],
    ["entry", '"${1:src/main.kly}"', "Kelyra entry source."],
  ],
  build: [
    ["compiler", '"${1:kelyra}"', "Kelyra compiler executable."],
    ["output", '"${1:build/app}"', "Executable output path."],
    ["optimization", "${1:0}", "Optimization level from 0 to 3."],
    ["safe-level", "${1:0}", "Kelyra runtime safety level."],
    ["c-sources", "[${1}]", "C source files compiled with the project."],
    ["c-args", "[${1}]", "Arguments forwarded to Clang."],
  ],
  package: [["output", '"${1:build/app-0.1.0.tar.gz}"', "Package archive path."]],
  test: [["sources", "[${1}]", "Additional Kelyra test sources."]],
  dependencies: [
    ["repository", '"${1:git@github.com:owner/repo.git}"', "Dependency Git repository."],
    ["revision", '"${1:main}"', "Optional Git revision."],
  ],
};

const kelpActions = [
  ["Compile", "kelp.build", "tools"],
  ["Debug", "kelp.debug", "debug-alt"],
  ["Run", "kelp.run", "play"],
  ["Test", "kelp.test", "beaker"],
  ["Package", "kelp.package", "package"],
];

function kelpSectionAt(text, line) {
  let section = "";
  const lines = text.split(/\r?\n/);
  for (let index = 0; index <= line && index < lines.length; ++index) {
    const match = lines[index].match(/^\s*\[([^\]]+)\]/);
    if (match) section = match[1];
  }
  return section.startsWith("dependencies.") ? "dependencies" : section;
}

function kelpFieldAt(text, line, character) {
  const sourceLine = text.split(/\r?\n/)[line] || "";
  const match = sourceLine.match(/^\s*([A-Za-z][A-Za-z0-9-]*)\s*=/);
  if (!match) return undefined;
  const start = sourceLine.indexOf(match[1]);
  if (character < start || character > start + match[1].length) return undefined;
  return (kelpFields[kelpSectionAt(text, line)] || []).find(
    ([name]) => name === match[1],
  );
}

function provideKelpHover(document, position) {
  const field = kelpFieldAt(document.getText(), position.line, position.character);
  return field ? new vscode.Hover(`**${field[0]}**\n\n${field[2]}`) : undefined;
}

function provideKelpCompletions(document, position) {
  return (kelpFields[kelpSectionAt(document.getText(), position.line)] || []).map(
    ([name, value, documentation]) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Property);
      item.insertText = new vscode.SnippetString(`${name} = ${value}`);
      item.documentation = documentation;
      return item;
    },
  );
}

async function runKelp(command, wait = false) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const executable = vscode.workspace.getConfiguration("kelp").get("path", "kelp");
  const shellExecution = new vscode.ShellExecution(executable, [command], {
    cwd: folder?.uri.fsPath,
  });
  const task = new vscode.Task(
    { type: "kelp", command },
    folder || vscode.TaskScope.Workspace,
    command,
    "kelp",
    shellExecution,
  );
  if (!wait) return vscode.tasks.executeTask(task);
  let execution;
  const completed = new Promise((resolve, reject) => {
    const subscription = vscode.tasks.onDidEndTaskProcess((event) => {
      if (event.execution !== execution) return;
      subscription.dispose();
      if (event.exitCode === 0) resolve();
      else reject(new Error(`kelp ${command} exited with code ${event.exitCode}`));
    });
  });
  execution = await vscode.tasks.executeTask(task);
  return completed;
}

async function debugKelp() {
  await runKelp("build", true);
  return vscode.commands.executeCommand("workbench.action.debug.start");
}

async function format(document, token) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kelyra-format-"));
  const source = path.join(directory, "source.kly");
  try {
    await fs.writeFile(source, document.getText());
    const executable = vscode.workspace
      .getConfiguration("kelyra")
      .get("formatter.path", "kelyra-format");
    const formatted = await new Promise((resolve, reject) => {
      const process = childProcess.execFile(
        executable,
        [source],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr.trim() || error.message));
          } else {
            resolve(stdout);
          }
        },
      );
      token.onCancellationRequested(() => process.kill());
    });
    const end = document.positionAt(document.getText().length);
    return [vscode.TextEdit.replace(new vscode.Range(0, 0, end.line, end.character), formatted)];
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function startLanguageServer() {
  if (client) return;
  const { LanguageClient, TransportKind } = require("vscode-languageclient/node");
  const command = vscode.workspace
    .getConfiguration("kelyra")
    .get("languageServer.path", "kelyra-ls");
  client = new LanguageClient(
    "kelyra",
    "Kelyra Language Server",
    { command, transport: TransportKind.stdio },
    { documentSelector: [{ scheme: "file", language: "kelyra" }] },
  );
  await client.start();
}

async function activate(context) {
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider("kelyra", {
      provideDocumentFormattingEdits: format,
    }),
  );
  context.subscriptions.push(
    vscode.languages.registerHoverProvider("kelp", {
      provideHover: provideKelpHover,
    }),
    vscode.languages.registerCompletionItemProvider("kelp", {
      provideCompletionItems: provideKelpCompletions,
    }),
    vscode.window.registerTreeDataProvider("kelp.actions", {
      getChildren: () => kelpActions,
      getTreeItem: ([label, command, icon]) => {
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.command = { command, title: label };
        item.iconPath = new vscode.ThemeIcon(icon);
        return item;
      },
    }),
  );
  for (const command of ["check", "build", "debug", "run", "test", "package"])
    context.subscriptions.push(
      vscode.commands.registerCommand(`kelp.${command}`, () =>
        command === "debug" ? debugKelp() : runKelp(command),
      ),
    );
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.languageId === "kelyra") void startLanguageServer();
    }),
  );
  if (vscode.workspace.textDocuments.some(({ languageId }) => languageId === "kelyra"))
    await startLanguageServer();
}

async function deactivate() {
  if (client) {
    await client.stop();
    client = undefined;
  }
}

module.exports = { activate, deactivate, format, kelpFieldAt, kelpSectionAt };
