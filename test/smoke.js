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
const themes = manifest.contributes.themes.map((theme) => ({
  ...theme,
  contents: JSON.parse(fs.readFileSync(path.join(root, theme.path))),
}));
const extension = fs.readFileSync(path.join(root, "extension.js"), "utf8");
const jetbrainsBundle = JSON.parse(
  fs.readFileSync(path.join(root, "jetbrains/textmate/package.json")),
);
const jetbrainsPlugin = fs.readFileSync(
  path.join(root, "jetbrains/src/main/resources/META-INF/plugin.xml"),
  "utf8",
);
const jetbrainsLsp = fs.readFileSync(
  path.join(
    root,
    "jetbrains/src/main/java/com/z8z6/kide/KelyraLspServerSupportProvider.java",
  ),
  "utf8",
);

assert.equal(manifest.contributes.languages[0].extensions[0], ".kly");
assert.equal(manifest.contributes.languages[1].filenames[0], "kelp.toml");
assert.equal(kelpGrammar.scopeName, "source.kelp.toml");
assert.equal(manifest.contributes.viewsContainers.activitybar[0].id, "kelp");
assert.equal(manifest.contributes.views.kelp[0].id, "kelp.actions");
assert.deepEqual(themes.map(({ label }) => label), ["Kelyra Dark", "Kelyra Light"]);
assert.deepEqual(themes.map(({ uiTheme }) => uiTheme), ["vs-dark", "vs"]);
for (const { contents } of themes) {
  assert.ok(contents.colors["editor.background"]);
  assert.ok(contents.tokenColors.some(({ scope }) => scope.includes("entity.name.tag")));
}
assert.ok(manifest.contributes.commands.some(({ command }) => command === "kelp.debug"));
assert.match(extension, /new vscode\.ProcessExecution\(executable, \[command, \.\.\.args\]/);
assert.equal(manifest.dependencies["vscode-languageclient"], "^10.1.1");
assert.equal(
  manifest.contributes.configuration.properties["kelyra.languageServer.path"].default,
  "kelyra-ls",
);
assert.equal(grammar.scopeName, "source.kelyra");
assert.equal(language.comments.lineComment, "//");
assert.equal(jetbrainsBundle.contributes.languages[1].filenames[0], "kelp.toml");
assert.equal(jetbrainsBundle.contributes.grammars[1].scopeName, "source.kelp.toml");
assert.match(jetbrainsPlugin, /platform\.lsp\.serverSupportProvider/);
assert.match(jetbrainsLsp, /GeneralCommandLine\("kelyra-ls", "--stdio"\)/);
assert.match("fn main", new RegExp(grammar.repository.declarations.patterns[0].match));
assert.ok(
  grammar.repository.declarations.patterns.some(({ match }) =>
    new RegExp(match).test("annotation route"),
  ),
);
assert.ok(
  grammar.repository.declarations.patterns.some(({ match }) =>
    new RegExp(match).test("import web.*"),
  ),
);
assert.match("c.longlong", new RegExp(grammar.repository.types.patterns[1].match));
assert.match("meta.symbol", new RegExp(grammar.repository.types.patterns[2].match));
assert.match("@web.route", new RegExp(grammar.repository.annotations.match));
assert.match("usize", new RegExp(grammar.repository.types.patterns[0].match));
const modifiers = new RegExp(grammar.repository.keywords.patterns[1].match);
assert.match("let", modifiers);
assert.doesNotMatch("mut", modifiers);
assert.ok(
  grammar.repository.keywords.patterns.some(({ match }) =>
    new RegExp(match).test("when") && new RegExp(match).test("asm"),
  ),
);
assert.ok(
  grammar.repository.builtinMembers.patterns.some(({ match }) =>
    new RegExp(match).test(".has_annotation"),
  ),
);
assert.ok(
  grammar.repository.builtinMembers.patterns.some(({ match }) =>
    new RegExp(match).test(".in"),
  ),
);
assert.match("value != 42", new RegExp(grammar.repository.operators.match));
assert.match("&value", new RegExp(grammar.repository.operators.match));

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") {
    return {
      workspace: {
        getConfiguration: () => ({ get: () => "/usr/bin/printf" }),
      },
      CompletionItem: class CompletionItem {
        constructor(label, kind) {
          this.label = label;
          this.kind = kind;
        }
      },
      CompletionItemKind: { Class: 1, Reference: 2, Keyword: 3 },
      Hover: class Hover {
        constructor(contents) {
          this.contents = contents;
        }
      },
      Range: class Range {},
      TextEdit: { replace: (range, text) => ({ range, text }) },
    };
  }
  return originalLoad(request, parent, isMain);
};

const {
  documentAnnotations,
  format,
  kelpFieldAt,
  kelpSectionAt,
  kelyraSymbolAt,
  provideKelyraCompletions,
  provideKelyraHover,
} = require("../extension.js");
const kelp = "[build]\nsafe-level = 1\n\n[dependencies.kstd]\nrepository = \"git@example\"\n";
assert.equal(kelpSectionAt(kelp, 3), "dependencies");
assert.equal(kelpFieldAt(kelp, 1, 3)[2], "Kelyra runtime safety level.");
assert.equal(kelpFieldAt(kelp, 4, 4)[0], "repository");
const kelyra = "// annotation ignored();\nannotation route(path: meta.string);\n@route\nlet size: usize;";
const document = {
  getText: () => kelyra,
  lineAt: (line) => ({ text: kelyra.split("\n")[line] }),
};
assert.deepEqual(documentAnnotations(kelyra), ["route"]);
assert.equal(kelyraSymbolAt("let size: c.longlong;", 14), "c.longlong");
const completions = provideKelyraCompletions(document, { line: 2, character: 1 });
for (const keyword of ["class", "this", "init", "deinit"])
  assert.ok(completions.some(({ label, documentation }) => label === keyword && documentation));
assert.ok(grammar.repository.declarations.patterns.some(({ match }) => new RegExp(match).test("class Counter")));
assert.equal(completions.find(({ label }) => label === "@route").insertText, "route");
for (const type of [
  "i8", "i16", "i32", "i64", "i128", "isize",
  "u8", "u16", "u32", "u64", "u128", "usize",
  "f32", "f64", "f128", "f256", "f512", "bool", "char", "void",
  "c.char", "c.schar", "c.uchar", "c.short", "c.int", "c.uint", "c.long",
  "c.longlong", "c.size", "c.ptrdiff", "c.bool", "c.wchar",
  "meta.string", "meta.symbol", "meta.type",
]) assert.ok(completions.some(({ label, documentation }) => label === type && documentation));
for (const annotation of ["@target", "@repeatable", "@retention", "@route"])
  assert.ok(completions.some(({ label, documentation }) => label === annotation && documentation));
assert.match(provideKelyraHover(document, { line: 2, character: 3 }).contents, /User-defined/);
assert.match(provideKelyraHover(document, { line: 3, character: 12 }).contents, /Pointer-sized/);
format(
  {
    getText: () => "fn main() {}\n",
    positionAt: () => ({ line: 0, character: 13 }),
  },
  { onCancellationRequested: () => {} },
)
  .then((edits) => assert.match(edits[0].text, /source\.kly$/));
