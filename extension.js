"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const vscode = require("vscode");
const execFile = promisify(childProcess.execFile);

let client;

const kelyraTypes = {
  i8: "8-bit signed integer.",
  i16: "16-bit signed integer.",
  i32: "32-bit signed integer.",
  i64: "64-bit signed integer.",
  i128: "128-bit signed integer.",
  isize: "Pointer-sized signed integer.",
  void: "No return value. Equivalent to omitting a function's return type; use return; or reach the end of its body.",
  u8: "8-bit unsigned integer.",
  u16: "16-bit unsigned integer.",
  u32: "32-bit unsigned integer.",
  u64: "64-bit unsigned integer.",
  u128: "128-bit unsigned integer.",
  usize: "Pointer-sized unsigned integer.",
  f32: "32-bit floating-point number.",
  f64: "64-bit floating-point number.",
  f128: "128-bit floating-point number.",
  f256: "256-bit floating-point type; currently limited to signatures and forwarding.",
  f512: "512-bit floating-point type; currently limited to signatures and forwarding.",
  bool: "Boolean value lowered to one bit.",
  char: "Unicode scalar value lowered to 32 bits.",
  "c.char": "C `char` with the target ABI width.",
  "c.schar": "C `signed char`.",
  "c.uchar": "C `unsigned char`.",
  "c.short": "C `short`.",
  "c.int": "C `int`.",
  "c.uint": "C `unsigned int`.",
  "c.long": "C `long` with the target ABI width.",
  "c.longlong": "C `long long`.",
  "c.size": "C `size_t` with the target ABI width.",
  "c.ptrdiff": "C `ptrdiff_t` with the target ABI width.",
  "c.bool": "C `_Bool`.",
  "c.wchar": "C `wchar_t` with the target ABI width.",
  "meta.string": "Compile-time string annotation value.",
  "meta.symbol": "Compile-time reference to a declared symbol.",
  "meta.type": "Compile-time reference to a Kelyra type.",
};

const builtinAnnotations = {
  target: "Restricts an annotation to the listed declaration kinds: `function`, `class`, `field`, `method`, `constructor`, `destructor`, or `annotation`.",
  repeatable: "Allows an annotation to appear more than once on the same declaration.",
  retention: "Sets annotation retention to `source` or `compile`; `compile` is the default.",
};

const classKeywords = {
  class: "Value type with fields, methods, direct construction and scope-based RAII destruction.",
  this: "Implicit pointer to the current class instance. Optional for unambiguous member access; use this.field when a parameter or local shadows a field.",
  init: "Constructor. Initializes each field once in declaration order before ordinary statements. A class without init gets a generated no-argument constructor.",
  deinit: "Destructor. Runs automatically on normal scope exits, followed by class fields in reverse order. Cannot be called explicitly.",
};

const languageKeywords = {
  let: "Declares a local with a type, an initial value, or both.",
  fn: "Declares a function.",
  pub: "Exports a declaration to importing modules.",
  module: "Declares this file's module.",
  import: "Loads a module. Add `.*` to call its public functions unqualified, or use `import c \"header.h\"` for C headers.",
  annotation: "Declares a compile-time annotation.",
  if: "Conditional branch; the braces are required.",
  else: "Alternative branch of an if.",
  while: "Repeats a block while the condition holds.",
  return: "Returns zero or more values and runs the pending scope cleanups.",
  break: "Leaves the innermost loop, destroying its locals first.",
  continue: "Jumps to the next iteration, destroying loop locals first.",
  when: "Compile-time conditional; only the selected branch is resolved.",
  meta: "Compile-time reflection operator, as in `meta(target)`.",
  asm: "Inline assembly block with `.in`, `.out`, and `.op` chains.",
  true: "Boolean true.",
  false: "Boolean false.",
};

function documentAnnotations(text) {
  return [...text.matchAll(/^\s*(?:pub\s+)?annotation\s+([A-Za-z_][A-Za-z0-9_]*)/gm)].map(
    (match) => match[1],
  );
}

function kelyraSymbolAt(line, character) {
  for (const match of line.matchAll(/@?[A-Za-z_][A-Za-z0-9_.]*/g)) {
    if (character >= match.index && character <= match.index + match[0].length)
      return match[0];
  }
  return undefined;
}

function provideKelyraHover(document, position) {
  const symbol = kelyraSymbolAt(document.lineAt(position.line).text, position.character);
  if (!symbol) return undefined;
  const name = symbol.startsWith("@") ? symbol.slice(1) : symbol;
  if (kelyraTypes[name]) return new vscode.Hover(`**${name}**\n\n${kelyraTypes[name]}`);
  if (classKeywords[name]) return new vscode.Hover(`**${name}**\n\n${classKeywords[name]}`);
  if (languageKeywords[name])
    return new vscode.Hover(`**${name}**\n\n${languageKeywords[name]}`);
  if (builtinAnnotations[name])
    return new vscode.Hover(`**@${name}**\n\n${builtinAnnotations[name]}`);
  if (documentAnnotations(document.getText()).includes(name))
    return new vscode.Hover(`**@${name}**\n\nUser-defined annotation in this document.`);
  return undefined;
}

function provideKelyraCompletions(document, position) {
  const prefix = document.lineAt(position.line).text.slice(0, position.character);
  const afterAt = /@[A-Za-z_][A-Za-z0-9_]*$|@$/.test(prefix);
  const annotations = [...Object.entries(builtinAnnotations), ...documentAnnotations(document.getText()).map(
    (name) => [name, "User-defined annotation in this document."],
  )];
  return [
    ...[...Object.entries(classKeywords), ...Object.entries(languageKeywords)].map(
      ([name, documentation]) => {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
        item.documentation = documentation;
        return item;
      },
    ),
    ...Object.entries(kelyraTypes).map(([name, documentation]) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
      item.documentation = documentation;
      return item;
    }),
    ...annotations.map(([name, documentation]) => {
      const item = new vscode.CompletionItem(`@${name}`, vscode.CompletionItemKind.Reference);
      item.insertText = afterAt ? name : `@${name}`;
      item.documentation = documentation;
      return item;
    }),
  ];
}

// Names that are never the callee of a call expression.
const kelyraControlNames = new Set([
  "if", "while", "when", "meta", "asm", "fn", "init", "deinit", "return", "let",
]);
// Declarations whose following name is not a call target.
const kelyraDeclarations = new Set(["fn", "annotation"]);

// Tokenizes Kelyra source, skipping comments, and records byte offsets.
function scanKelyra(text) {
  const lineStarts = [0];
  for (let index = 0; index < text.length; ++index)
    if (text[index] === "\n") lineStarts.push(index + 1);
  const positionAt = (offset) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (lineStarts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low, character: offset - lineStarts[low] };
  };
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    const next = text[index + 1];
    if (character === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") ++index;
      continue;
    }
    if (character === "/" && next === "*") {
      let depth = 1;
      index += 2;
      while (index < text.length && depth > 0) {
        if (text[index] === "/" && text[index + 1] === "*") {
          ++depth;
          index += 2;
        } else if (text[index] === "*" && text[index + 1] === "/") {
          --depth;
          index += 2;
        } else ++index;
      }
      continue;
    }
    if (character === '"') {
      const start = index++;
      while (index < text.length) {
        if (text[index] === "\\") index += 2;
        else if (text[index] === '"') { ++index; break; }
        else ++index;
      }
      tokens.push({ kind: "string", text: text.slice(start, index), offset: start });
      continue;
    }
    if (/[A-Za-z_]/.test(character)) {
      const start = index;
      while (index < text.length && /[A-Za-z0-9_]/.test(text[index])) ++index;
      tokens.push({ kind: "name", text: text.slice(start, index), offset: start });
      continue;
    }
    if (/[0-9]/.test(character)) {
      const start = index;
      while (index < text.length && /[0-9A-Za-z_.]/.test(text[index])) ++index;
      tokens.push({ kind: "number", text: text.slice(start, index), offset: start });
      continue;
    }
    if (/\s/.test(character)) { ++index; continue; }
    tokens.push({ kind: "punct", text: character, offset: index });
    ++index;
  }
  return { tokens, positionAt };
}

const kelyraParameterNames = (tokens, open) => {
  const names = [];
  let depth = 0;
  let expectName = true;
  for (let index = open; index < tokens.length; ++index) {
    const token = tokens[index];
    if (token.text === "(") { ++depth; continue; }
    if (token.text === ")") {
      --depth;
      if (depth === 0) return { names, end: index };
      continue;
    }
    if (token.text === "," && depth === 1) { expectName = true; continue; }
    if (token.kind === "punct") continue;
    if (depth === 1 && expectName && token.kind === "name") {
      names.push(token.text);
      expectName = false;
    }
  }
  return { names: [], end: -1 };
};

// Collects module name, imports, function signatures, and class members.
function parseKelyraTokens(tokens) {
  const parsed = { module: "", imports: [], functions: new Map(), classes: new Map() };
  for (let index = 0; index < tokens.length; ++index) {
    const token = tokens[index];
    if (token.kind !== "name") continue;
    if (token.text === "module") {
      const parts = [];
      let cursor = index + 1;
      while (cursor < tokens.length && tokens[cursor].kind === "name") {
        parts.push(tokens[cursor].text);
        if (tokens[cursor + 1]?.text !== ".") break;
        cursor += 2;
      }
      parsed.module = parts.join(".");
      continue;
    }
    if (token.text === "import") {
      const parts = [];
      let wildcard = false;
      let cursor = index + 1;
      while (cursor < tokens.length) {
        if (tokens[cursor].kind === "name") { parts.push(tokens[cursor].text); ++cursor; continue; }
        if (tokens[cursor].text === ".") {
          if (tokens[cursor + 1]?.text === "*") wildcard = true;
          cursor += 2;
          continue;
        }
        break;
      }
      if (parts.length) parsed.imports.push({ name: parts.join("."), wildcard });
      continue;
    }
    if (token.text === "class" && tokens[index + 1]?.kind === "name") {
      const name = tokens[index + 1].text;
      let open = index + 2;
      while (open < tokens.length && tokens[open].text !== "{") ++open;
      let depth = 0;
      let close = tokens.length;
      for (let cursor = open; cursor < tokens.length; ++cursor) {
        if (tokens[cursor].text === "{") ++depth;
        else if (tokens[cursor].text === "}" && --depth === 0) { close = cursor; break; }
      }
      const info = { init: undefined, methods: new Map() };
      // Nested classes are not part of the language, so the body can be skipped.
      for (let cursor = open + 1; cursor < close; ++cursor) {
        const member = tokens[cursor];
        if (member.text === "fn" && tokens[cursor + 1]?.kind === "name" &&
            tokens[cursor + 2]?.text === "(") {
          info.methods.set(tokens[cursor + 1].text, kelyraParameterNames(tokens, cursor + 2).names);
        } else if (member.text === "init" && tokens[cursor + 1]?.text === "(") {
          info.init = kelyraParameterNames(tokens, cursor + 1).names;
        }
      }
      parsed.classes.set(name, info);
      index = close;
      continue;
    }
    if (token.text === "fn" && tokens[index + 1]?.kind === "name" &&
        tokens[index + 2]?.text === "(") {
      parsed.functions.set(tokens[index + 1].text, kelyraParameterNames(tokens, index + 2).names);
    }
  }
  return parsed;
}

const parseKelyraModule = (text) => parseKelyraTokens(scanKelyra(text).tokens);

function collectKelyraLocals(tokens) {
  const locals = new Set();
  for (let index = 0; index < tokens.length; ++index) {
    if (tokens[index].text === "let") {
      if (tokens[index + 1]?.kind === "name") locals.add(tokens[index + 1].text);
      for (let cursor = index + 2; tokens[index + 1]?.text === "(" && cursor < tokens.length; ++cursor) {
        if (tokens[cursor].text === ")") break;
        if (tokens[cursor].kind === "name") locals.add(tokens[cursor].text);
      }
    }
    if (tokens[index].text === "fn" && tokens[index + 1]?.kind === "name" &&
        tokens[index + 2]?.text === "(")
      for (const name of kelyraParameterNames(tokens, index + 2).names) locals.add(name);
  }
  return locals;
}

function collectKelyraCalls(tokens) {
  const calls = [];
  for (let index = 0; index < tokens.length; ++index) {
    if (tokens[index].text !== "(") continue;
    let cursor = index - 1;
    if (cursor < 0 || tokens[cursor].kind !== "name") continue;
    const chain = [tokens[cursor].text];
    --cursor;
    while (cursor >= 1 && tokens[cursor].text === "." && tokens[cursor - 1].kind === "name") {
      chain.unshift(tokens[cursor - 1].text);
      cursor -= 2;
    }
    const lead = tokens[cursor];
    if (lead && kelyraDeclarations.has(lead.text)) continue;
    if (chain.length === 1 && kelyraControlNames.has(chain[0])) continue;
    const args = [];
    let depth = 0;
    let expectStart = false;
    for (let scan = index; scan < tokens.length; ++scan) {
      const token = tokens[scan];
      if (token.text === "(") {
        if (++depth === 1) expectStart = true;
        continue;
      }
      if (token.text === ")") {
        if (--depth === 0) break;
        continue;
      }
      if (token.text === "," && depth === 1) { expectStart = true; continue; }
      if (depth === 1 && expectStart) {
        args.push({
          offset: token.offset,
          literal: token.kind !== "name" || token.text === "true" || token.text === "false",
        });
        expectStart = false;
      }
    }
    calls.push({ chain, args });
  }
  return calls;
}

// Indexes every parsed module so calls can be resolved across the workspace.
function buildKelyraIndex(parsedModules) {
  const index = { modules: new Map(), functions: new Map(), methods: new Map(), classes: new Map() };
  const push = (map, key, value) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  };
  for (const parsed of parsedModules) {
    if (parsed.module && !index.modules.has(parsed.module)) index.modules.set(parsed.module, parsed);
    for (const [name, params] of parsed.functions)
      push(index.functions, name, { params, module: parsed.module });
    for (const [name, info] of parsed.classes) {
      push(index.classes, name, { info, module: parsed.module });
      for (const [method, params] of info.methods)
        push(index.methods, method, { params, module: parsed.module, owner: name });
    }
  }
  return index;
}

function resolveKelyraCall(call, current, index, locals) {
  const { chain } = call;
  if (chain.length === 1) {
    const name = chain[0];
    if (locals.has(name)) return undefined;
    const own = current.functions.get(name);
    if (own) return own;
    const ownClass = current.classes.get(name);
    if (ownClass && ownClass.init) return ownClass.init;
    for (const imported of current.imports) {
      if (!imported.wildcard) continue;
      const target = index.modules.get(imported.name);
      if (!target) continue;
      const fn = target.functions.get(name);
      if (fn) return fn;
      const cls = target.classes.get(name);
      if (cls && cls.init) return cls.init;
    }
    const functions = index.functions.get(name);
    if (functions && functions.length === 1) return functions[0].params;
    const classes = index.classes.get(name);
    if (classes && classes.length === 1 && classes[0].info.init) return classes[0].info.init;
    return undefined;
  }
  for (let length = chain.length - 1; length >= 1; --length) {
    const target = index.modules.get(chain.slice(0, length).join("."));
    if (!target) continue;
    const rest = chain.slice(length);
    if (rest.length === 1) {
      const fn = target.functions.get(rest[0]);
      if (fn) return fn;
      const cls = target.classes.get(rest[0]);
      if (cls && cls.init) return cls.init;
    } else if (rest.length === 2) {
      const cls = target.classes.get(rest[0]);
      if (cls) return rest[1] === "init" ? cls.init : cls.methods.get(rest[1]);
    }
    return undefined;
  }
  const method = chain[chain.length - 1];
  if (method === "init" || method === "deinit") return undefined;
  const methods = index.methods.get(method);
  return methods && methods.length === 1 ? methods[0].params : undefined;
}

// Returns `{ offset, name }` for every argument that should show its parameter
// name. Literal-only mode keeps hints on numbers, strings, and booleans.
function kelyraParameterHints(text, index, mode) {
  if (mode === "off") return [];
  const { tokens } = scanKelyra(text);
  const current = parseKelyraTokens(tokens);
  const locals = collectKelyraLocals(tokens);
  const hints = [];
  for (const call of collectKelyraCalls(tokens)) {
    const params = resolveKelyraCall(call, current, index, locals);
    if (!params || params.length !== call.args.length) continue;
    for (let position = 0; position < call.args.length; ++position) {
      const argument = call.args[position];
      if (mode === "literals" && !argument.literal) continue;
      hints.push({ offset: argument.offset, name: params[position] });
    }
  }
  return hints;
}

function provideKelyraFoldingRanges(document) {
  const text = document.getText();
  const { positionAt } = scanKelyra(text);
  const ranges = [];
  const braces = [];
  let blockStart = -1;
  let blockDepth = 0;
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  for (let index = 0; index < text.length; ++index) {
    const character = text[index];
    const next = text[index + 1];
    if (inLineComment) {
      if (character === "\n") inLineComment = false;
      continue;
    }
    if (blockDepth > 0) {
      if (character === "/" && next === "*") { ++blockDepth; ++index; continue; }
      if (character === "*" && next === "/") {
        if (--blockDepth === 0) {
          const start = positionAt(blockStart).line;
          const end = positionAt(index).line;
          if (end > start)
            ranges.push(new vscode.FoldingRange(start, end, vscode.FoldingRangeKind.Comment));
        }
        ++index;
        continue;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === "/" && next === "/") { inLineComment = true; ++index; continue; }
    if (character === "/" && next === "*") { blockDepth = 1; blockStart = index; ++index; continue; }
    if (character === '"') { inString = true; continue; }
    if (character === "{") braces.push(index);
    else if (character === "}" && braces.length) {
      const start = positionAt(braces.pop()).line;
      const end = positionAt(index).line;
      if (end > start) ranges.push(new vscode.FoldingRange(start, end));
    }
  }
  return ranges;
}

let kelyraIndexPromise;

function invalidateKelyraIndex() {
  kelyraIndexPromise = undefined;
}

// Indexes open documents first so unsaved edits win over the files on disk.
async function loadKelyraIndex() {
  const modules = new Map();
  const extras = [];
  const record = (text) => {
    const parsed = parseKelyraModule(text);
    if (parsed.module) {
      if (!modules.has(parsed.module)) modules.set(parsed.module, parsed);
    } else {
      extras.push(parsed);
    }
  };
  for (const document of vscode.workspace.textDocuments)
    if (document.languageId === "kelyra") record(document.getText());
  try {
    const files = await vscode.workspace.findFiles(
      "**/*.kly",
      "**/{node_modules,build,.kelp,.git}/**",
    );
    for (const file of files)
      record(Buffer.from(await vscode.workspace.fs.readFile(file)).toString("utf8"));
  } catch {
    // A missing workspace or unreadable file only limits cross-module hints.
  }
  return buildKelyraIndex([...modules.values(), ...extras]);
}

async function provideKelyraInlayHints(document, range) {
  const mode = vscode.workspace
    .getConfiguration("kelyra")
    .get("inlayHints.parameterNames", "literals");
  if (mode === "off") return [];
  if (!kelyraIndexPromise) kelyraIndexPromise = loadKelyraIndex();
  const index = await kelyraIndexPromise;
  const text = document.getText();
  const { positionAt } = scanKelyra(text);
  const hints = [];
  for (const hint of kelyraParameterHints(text, index, mode)) {
    const position = positionAt(hint.offset);
    if (
      position.line < range.start.line ||
      position.line > range.end.line ||
      (position.line === range.start.line && position.character < range.start.character) ||
      (position.line === range.end.line && position.character > range.end.character)
    )
      continue;
    const item = new vscode.InlayHint(
      position,
      `${hint.name}:`,
      vscode.InlayHintKind.Parameter,
    );
    item.paddingRight = true;
    hints.push(item);
  }
  return hints;
}

const kelpFields = {
  project: [
    ["name", '"${1:app}"', "Project name."],
    ["version", '"${1:0.1.0}"', "Project version."],
    ["entry", '"${1:src/main.kly}"', "Kelyra entry source."],
  ],
  build: [
    ["compiler", '"${1:kelyra}"', "Kelyra compiler executable."],
    ["kind", '"${1|executable,library|}"', "Build target: `executable` links a program, `library` compiles a linked object."],
    ["output", '"${1:build/app}"', "Artifact path: the executable or the library object."],
    ["optimization", "${1:0}", "Optimization level from 0 to 3."],
    ["safe-level", "${1:0}", "Kelyra runtime safety level."],
    ["c-sources", "[${1}]", "C source files compiled with the project."],
    ["c-args", "[${1}]", "Arguments forwarded to Clang."],
  ],
  workspace: [
    ["members", "[${1}]", "Subproject directories, each with its own `kelp.toml`. Commands accept a member name or relative path."],
  ],
  package: [["output", '"${1:build/app-0.1.0.tar.gz}"', "Package archive path."]],
  test: [["sources", "[${1}]", "Additional Kelyra test sources."]],
  dependencies: [
    ["repository", '"${1:git@github.com:owner/repo.git}"', "Dependency Git repository."],
    ["revision", '"${1:main}"', "Optional Git revision."],
    ["path", '"${1:../libs/math}"', "Local path dependency used in place; give either this or repository/revision."],
  ],
};

const kelpActions = [
  ["Format File", "kelp.format", "symbol-keyword"],
  ["Compile", "kelp.build", "tools"],
  ["Debug", "kelp.debug", "debug-alt"],
  ["Run", "kelp.run", "play"],
  ["Test", "kelp.test", "beaker"],
  ["Package", "kelp.package", "package"],
  ["Members", "kelp.members", "list-unordered"],
  ["Variables", "workbench.debug.action.focusVariablesView", "symbol-variable"],
  ["Functions / Call Stack", "workbench.debug.action.focusCallStackView", "callstack"],
  ["Watch Expressions", "workbench.debug.action.focusWatchView", "eye"],
  ["Evaluate / Debug Console", "workbench.debug.action.focusRepl", "debug-console"],
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

const kelpSections = [
  ["project", "Project name, version, and entry source."],
  ["build", "Compiler, target kind, output, optimization, and C options."],
  ["workspace", "Subproject member directories."],
  ["package", "Source archive output."],
  ["test", "Additional test sources."],
  ["dependencies.<name>", "Git or local path dependency."],
];

function provideKelpHover(document, position) {
  const field = kelpFieldAt(document.getText(), position.line, position.character);
  return field ? new vscode.Hover(`**${field[0]}**\n\n${field[2]}`) : undefined;
}

function provideKelpCompletions(document, position) {
  const prefix = document.lineAt(position.line).text.slice(0, position.character);
  const header = prefix.match(/^(\s*)\[([A-Za-z0-9_.]*)$/);
  if (header) {
    const range = new vscode.Range(
      position.line,
      header[1].length + 1,
      position.line,
      position.character,
    );
    return kelpSections.map(([name, documentation]) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
      item.insertText = new vscode.SnippetString(
        name === "dependencies.<name>" ? "dependencies.${1:name}]" : `${name}]`,
      );
      item.range = range;
      item.documentation = documentation;
      return item;
    });
  }
  return (kelpFields[kelpSectionAt(document.getText(), position.line)] || []).map(
    ([name, value, documentation]) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Property);
      item.insertText = new vscode.SnippetString(`${name} = ${value}`);
      item.documentation = documentation;
      return item;
    },
  );
}

async function projectContext() {
  if (!vscode.workspace.isTrusted) throw new Error("Trust this workspace before running Kelp.");
  const document = vscode.window.activeTextEditor?.document;
  let folder = document && vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder) {
    const folders = vscode.workspace.workspaceFolders || [];
    folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick();
  }
  if (!folder) throw new Error("Open or select a Kelp workspace folder first.");
  let cwd = document?.uri.scheme === "file" && vscode.workspace.getWorkspaceFolder(document.uri) === folder
    ? path.dirname(document.uri.fsPath) : folder.uri.fsPath;
  while (true) {
    try {
      await fs.access(path.join(cwd, "kelp.toml"));
      return { folder, cwd };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(cwd);
    if (parent === cwd) throw new Error("Cannot find kelp.toml in this project or its parent directories.");
    cwd = parent;
  }
}

async function runKelp(command, { wait = false, project, args = [] } = {}) {
  const { folder, cwd } = project || await projectContext();
  const executable = vscode.workspace.getConfiguration("kelp", folder.uri).get("path", "kelp");
  const executionOptions = new vscode.ProcessExecution(executable, [command, ...args], {
    cwd,
  });
  const task = new vscode.Task(
    { type: "kelp", command },
    folder || vscode.TaskScope.Workspace,
    command,
    "kelp",
    executionOptions,
    "$kelyra",
  );
  if (!wait) return vscode.tasks.executeTask(task);
  let execution;
  let subscription;
  const completed = new Promise((resolve, reject) => {
    subscription = vscode.tasks.onDidEndTaskProcess((event) => {
      if (event.execution !== execution) return;
      if (event.exitCode === 0) resolve();
      else reject(new Error(`kelp ${command} exited with code ${event.exitCode}`));
    });
  });
  try {
    execution = await vscode.tasks.executeTask(task);
    return await completed;
  } finally {
    subscription.dispose();
  }
}

async function debugKelp() {
  const project = await projectContext();
  if (!vscode.extensions.getExtension("ms-vscode.cpptools"))
    throw new Error("Install Microsoft's C/C++ extension (ms-vscode.cpptools) to connect VS Code to local GDB.");
  const settings = vscode.workspace.getConfiguration("kelp", project.folder.uri);
  const gdb = settings.get("debug.gdbPath", "gdb");
  try {
    await execFile(gdb, ["--version"], { timeout: 10000 });
  } catch (error) {
    throw new Error(`Cannot run local GDB (${gdb}). Install GDB or set kelp.debug.gdbPath. ${error.message}`);
  }
  if (!await vscode.workspace.saveAll(false)) throw new Error("Save project files before debugging.");
  const { stdout } = await execFile(settings.get("path", "kelp"), ["output"], {
    cwd: project.cwd, encoding: "utf8", timeout: 10000,
  });
  const program = stdout.replace(/\r?\n$/, "");
  if (!path.isAbsolute(program)) throw new Error("kelp output did not return an absolute executable path. Update Kelp.");
  await runKelp("build", { wait: true, project, args: ["--debug"] });
  const started = await vscode.debug.startDebugging(project.folder, {
    name: "Kelp: Local GDB", type: "cppdbg", request: "launch",
    program, cwd: project.cwd, args: settings.get("debug.args", []),
    MIMode: "gdb",
    ...(gdb === "gdb" ? {} : { miDebuggerPath: gdb }),
    stopAtEntry: true, externalConsole: false,
    internalConsoleOptions: "openOnSessionStart",
    setupCommands: [{ text: "-enable-pretty-printing", ignoreFailures: true }],
  });
  if (!started) throw new Error("GDB debugging did not start. See the Debug Console for details.");
  await vscode.commands.executeCommand("workbench.view.debug");
  await vscode.commands.executeCommand("workbench.debug.action.focusRepl");
  return started;
}

async function formatKelp() {
  if (vscode.window.activeTextEditor?.document.languageId !== "kelyra")
    throw new Error("Open a Kelyra (.kly) file to format it.");
  return vscode.commands.executeCommand("editor.action.formatDocument");
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
    vscode.languages.registerHoverProvider("kelyra", {
      provideHover: provideKelyraHover,
    }),
    vscode.languages.registerCompletionItemProvider(
      "kelyra",
      { provideCompletionItems: provideKelyraCompletions },
      "@",
    ),
    vscode.languages.registerFoldingRangeProvider("kelyra", {
      provideFoldingRanges: provideKelyraFoldingRanges,
    }),
    vscode.languages.registerInlayHintsProvider("kelyra", {
      provideInlayHints: provideKelyraInlayHints,
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
  for (const command of ["format", "check", "build", "debug", "run", "test", "package", "members"])
    context.subscriptions.push(
      vscode.commands.registerCommand(`kelp.${command}`, async () => {
        try {
          if (command === "format") return await formatKelp();
          if (command === "debug") return await debugKelp();
          return await runKelp(command);
        } catch (error) {
          await vscode.window.showErrorMessage(error.message);
        }
      }),
    );
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.languageId === "kelyra") void startLanguageServer();
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.languageId === "kelyra") invalidateKelyraIndex();
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration("kelyra.languageServer.path")) return;
      if (client) {
        await client.stop();
        client = undefined;
      }
      if (vscode.workspace.textDocuments.some(({ languageId }) => languageId === "kelyra"))
        await startLanguageServer();
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

module.exports = {
  activate,
  deactivate,
  debugKelp,
  formatKelp,
  kelpActions,
  kelpFields,
  languageKeywords,
  runKelp,
  documentAnnotations,
  format,
  kelpFieldAt,
  kelpSectionAt,
  buildKelyraIndex,
  kelyraParameterHints,
  kelyraSymbolAt,
  parseKelyraModule,
  provideKelpCompletions,
  provideKelyraCompletions,
  provideKelyraFoldingRanges,
  provideKelyraHover,
  provideKelyraInlayHints,
};
