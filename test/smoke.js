"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json")));
const grammar = JSON.parse(
  fs.readFileSync(path.join(root, "syntaxes/kelyra.tmLanguage.json")),
);
const language = JSON.parse(
  fs.readFileSync(path.join(root, "language-configuration.json")),
);
const kelpGrammar = JSON.parse(
  fs.readFileSync(path.join(root, "syntaxes/kelp.tmLanguage.json")),
);
const extension = fs.readFileSync(path.join(root, "extension.js"), "utf8");

assert.equal(manifest.contributes.languages[0].extensions[0], ".kly");
assert.equal(manifest.contributes.languages[1].filenames[0], "kelp.toml");
assert.equal(kelpGrammar.scopeName, "source.kelp.toml");
assert.equal(manifest.contributes.viewsContainers.activitybar[0].id, "kelp");
assert.equal(manifest.contributes.views.kelp[0].id, "kelp.actions");
assert.ok(manifest.contributes.commands.some(({ command }) => command === "kelp.debug"));
assert.match(extension, /new vscode\.ShellExecution\(executable, \[command\]/);
assert.equal(manifest.dependencies["vscode-languageclient"], "^10.1.1");
assert.equal(
  manifest.contributes.configuration.properties["kelyra.languageServer.path"].default,
  "kelyra-ls",
);
assert.equal(grammar.scopeName, "source.kelyra");
assert.equal(language.comments.lineComment, "//");
assert.match("fn main", new RegExp(grammar.repository.declarations.patterns[0].match));
assert.match("c.longlong", new RegExp(grammar.repository.types.patterns[1].match));
assert.match("value != 42", new RegExp(grammar.repository.operators.match));

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") {
    return {
      workspace: {
        getConfiguration: () => ({ get: () => "/usr/bin/printf" }),
      },
      Range: class Range {},
      TextEdit: { replace: (range, text) => ({ range, text }) },
    };
  }
  return originalLoad(request, parent, isMain);
};

const { format, kelpFieldAt, kelpSectionAt } = require("../extension.js");
const kelp = "[build]\nsafe-level = 1\n\n[dependencies.kstd]\nrepository = \"git@example\"\n";
assert.equal(kelpSectionAt(kelp, 3), "dependencies");
assert.equal(kelpFieldAt(kelp, 1, 3)[2], "Kelyra runtime safety level.");
assert.equal(kelpFieldAt(kelp, 4, 4)[0], "repository");
format(
  {
    getText: () => "fn main() {}\n",
    positionAt: () => ({ line: 0, character: 13 }),
  },
  { onCancellationRequested: () => {} },
)
  .then((edits) => assert.match(edits[0].text, /source\.kly$/));
