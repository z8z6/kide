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
for (const file of [
  manifest.contributes.viewsContainers.activitybar[0].icon,
  ...manifest.contributes.grammars.map(({ path: grammarPath }) => grammarPath),
  ...manifest.contributes.themes.map(({ path: themePath }) => themePath),
  ...manifest.contributes.snippets.map(({ path: snippetPath }) => snippetPath),
  ...manifest.contributes.languages.map(({ configuration }) => configuration).filter(Boolean),
])
  assert.ok(fs.existsSync(path.join(root, file)), file);
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
        getConfiguration: (section) => ({
          get: (key, fallback) =>
            section === "kelyra" && key === "inlayHints.parameterNames" ? "all" : "/usr/bin/printf",
        }),
        findFiles: async () => [],
        fs: { readFile: async () => Buffer.from("") },
        textDocuments: [],
      },
      CompletionItem: class CompletionItem {
        constructor(label, kind) {
          this.label = label;
          this.kind = kind;
        }
      },
      CompletionItemKind: { Class: 1, Reference: 2, Keyword: 3, Property: 4, Module: 5 },
      SnippetString: class SnippetString {
        constructor(value) {
          this.value = value;
        }
      },
      Hover: class Hover {
        constructor(contents) {
          this.contents = contents;
        }
      },
      Range: class Range {
        constructor(startLine, startCharacter, endLine, endCharacter) {
          Object.assign(this, { startLine, startCharacter, endLine, endCharacter });
        }
      },
      TextEdit: { replace: (range, text) => ({ range, text }) },
      InlayHint: class InlayHint {
        constructor(position, label, kind) {
          Object.assign(this, { position, label, kind });
        }
      },
      InlayHintKind: { Type: 1, Parameter: 2 },
      FoldingRange: class FoldingRange {
        constructor(start, end, kind) {
          Object.assign(this, { start, end, kind });
        }
      },
      FoldingRangeKind: { Comment: 1, Imports: 2, Region: 3 },
    };
  }
  return originalLoad(request, parent, isMain);
};

const {
  buildKelyraIndex,
  documentAnnotations,
  format,
  kelpFieldAt,
  kelpFields,
  kelpSectionAt,
  kelyraParameterHints,
  kelyraSymbolAt,
  languageKeywords,
  parseKelyraModule,
  provideKelpCompletions,
  provideKelyraCompletions,
  provideKelyraFoldingRanges,
  provideKelyraHover,
  provideKelyraInlayHints,
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
assert.equal(manifest.version, "0.6.0");
assert.ok(manifest.contributes.commands.some(({ command }) => command === "kelp.members"));
assert.equal(manifest.contributes.problemMatchers[0].name, "kelyra");
assert.match(
  "src/main.kly:3:7: error: type mismatch",
  new RegExp(manifest.contributes.problemMatchers[0].pattern.regexp),
);
assert.ok(
  manifest.contributes.menus["view/title"].some(({ command }) => command === "kelp.members"),
);
// Types must be matched before keywords so `meta.string` is not scoped as the
// `meta` keyword.
const typesPattern = grammar.patterns.findIndex(({ include }) => include === "#types");
const keywordsPattern = grammar.patterns.findIndex(({ include }) => include === "#keywords");
assert.ok(typesPattern !== -1 && typesPattern < keywordsPattern);
assert.match("var", new RegExp(grammar.repository.keywords.patterns[1].match));
assert.match("c.longlong", new RegExp(language.wordPattern));
assert.match("math.vector", new RegExp(language.wordPattern));
for (const [section, field] of [
  ["build", "kind"],
  ["workspace", "members"],
  ["dependencies", "path"],
])
  assert.ok(kelpFields[section].some(([name]) => name === field), `${section}.${field}`);
assert.equal(kelpFieldAt('[build]\nkind = "library"\n', 1, 2)[0], "kind");
assert.equal(kelpFieldAt('[workspace]\nmembers = ["libs/math"]\n', 1, 3)[0], "members");
assert.equal(kelpFieldAt('[dependencies.math]\npath = "../math"\n', 1, 2)[0], "path");
assert.match(
  provideKelyraHover(
    { getText: () => "let size: usize;\n", lineAt: () => ({ text: "let size: usize;" }) },
    { line: 0, character: 1 },
  ).contents,
  /Declares a local/,
);
assert.ok(languageKeywords.when && languageKeywords.meta && languageKeywords.asm);
for (const keyword of ["let", "fn", "pub", "module", "import", "when", "meta", "asm"])
  assert.ok(completions.some(({ label, documentation }) => label === keyword && documentation));
// Field completion inside a section, and section completion after `[`.
const kelpDocument = {
  getText: () => "[build]\nsafe-level = 1\n",
  lineAt: (line) => ({ text: "[build]\nsafe-level = 1\n".split("\n")[line] }),
};
assert.ok(
  provideKelpCompletions(kelpDocument, { line: 1, character: 3 }).some(
    ({ label }) => label === "kind",
  ),
);
const sections = provideKelpCompletions(
  { getText: () => "[bui", lineAt: () => ({ text: "[bui" }) },
  { line: 0, character: 4 },
);
assert.equal(sections.find(({ label }) => label === "build").insertText.value, "build]");
assert.equal(
  sections.find(({ label }) => label === "dependencies.<name>").insertText.value,
  "dependencies.${1:name}]",
);

const snippetContributions = manifest.contributes.snippets.map((entry) => ({
  language: entry.language,
  contents: JSON.parse(fs.readFileSync(path.join(root, entry.path))),
}));
assert.deepEqual(snippetContributions.map(({ language }) => language), ["kelyra", "kelp"]);
assert.ok(snippetContributions[0].contents.Class.body.length > 0);
assert.ok(snippetContributions[1].contents.Build);
assert.equal(manifest.contributes.configurationDefaults["[kelyra]"]["editor.tabSize"], 2);
assert.equal(
  manifest.contributes.configuration.properties["kelyra.inlayHints.parameterNames"].default,
  "literals",
);

// Parameter-name hints resolve local, wildcard-imported, qualified, and
// constructor calls, and stay silent when the arity does not match.
const index = buildKelyraIndex([
  parseKelyraModule("module app;\n"),
  parseKelyraModule(
    "module math.int;\npub fn scale(value: i32, factor: i32) -> i32 { return 0; }\n",
  ),
  parseKelyraModule(
    "module shapes;\npub class Point { x: i32; y: i32; pub init(x: i32, y: i32) { this.x = x; this.y = y; } }\n",
  ),
  parseKelyraModule(
    "module local;\nfn add(left: i32, right: i32) -> i32 { return 0; }\n",
  ),
]);
const localCall = "module local;\nfn use(value: i32) -> i32 { return add(value, 2); }";
assert.deepEqual(
  kelyraParameterHints(localCall, index, "all").map(({ name }) => name),
  ["left", "right"],
);
assert.deepEqual(
  kelyraParameterHints(localCall, index, "literals").map(({ name }) => name),
  ["right"],
);
assert.deepEqual(kelyraParameterHints(localCall, index, "off"), []);
assert.deepEqual(
  kelyraParameterHints(
    "module local;\nfn use() -> i32 { let callback = add; return callback(1, 2); }",
    index,
    "all",
  ),
  [],
);
assert.deepEqual(
  kelyraParameterHints("module local;\nfn use() -> i32 { return add(1); }", index, "all"),
  [],
);
assert.deepEqual(
  kelyraParameterHints(
    "module app;\nimport math.int;\nfn use() -> i32 { return math.int.scale(3, 4); }",
    index,
    "all",
  ).map(({ name }) => name),
  ["value", "factor"],
);
assert.deepEqual(
  kelyraParameterHints(
    "module app;\nimport math.int.*;\nfn use() -> i32 { return scale(3, 4); }",
    index,
    "all",
  ).map(({ name }) => name),
  ["value", "factor"],
);
assert.deepEqual(
  kelyraParameterHints(
    "module app;\nimport shapes;\nfn use() -> i32 { let point = shapes.Point(1, 2); return 0; }",
    index,
    "all",
  ).map(({ name }) => name),
  ["x", "y"],
);

// Folding follows braces and block comments.
const folded = provideKelyraFoldingRanges({
  getText: () => "fn main() -> i32 {\n  if true {\n    return 0;\n  }\n  return 1;\n}\n",
});
assert.ok(folded.some(({ start, end }) => start === 0 && end === 5));
assert.ok(folded.some(({ start, end }) => start === 1 && end === 3));
assert.ok(
  provideKelyraFoldingRanges({ getText: () => "/*\n  block\n*/\nfn main() {}\n" }).some(
    ({ kind }) => kind === 1,
  ),
);
format(
  {
    getText: () => "fn main() {}\n",
    positionAt: () => ({ line: 0, character: 13 }),
  },
  { onCancellationRequested: () => {} },
)
  .then((edits) => assert.match(edits[0].text, /source\.kly$/))
  .then(() => {
    const inlayDocument = {
      getText: () =>
        "fn add(left: i32, right: i32) -> i32 { return 0; }\n" +
        "fn use() -> i32 { return add(1, 2); }\n",
    };
    const full = { start: { line: 0, character: 0 }, end: { line: 1, character: 60 } };
    return provideKelyraInlayHints(inlayDocument, full).then((hints) => {
      assert.deepEqual(hints.map(({ label }) => label), ["left:", "right:"]);
      const line = inlayDocument.getText().split("\n")[1];
      assert.deepEqual(
        hints.map(({ position }) => position.character),
        [line.indexOf("1,"), line.indexOf("2)")],
      );
      const firstLine = { start: { line: 0, character: 0 }, end: { line: 0, character: 60 } };
      return provideKelyraInlayHints(inlayDocument, firstLine).then((filtered) =>
        assert.deepEqual(filtered, []),
      );
    });
  });
