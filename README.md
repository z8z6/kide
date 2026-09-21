# kide

Kelyra editor support for VS Code and JetBrains IDEs.

## VS Code

The extension provides `.kly` syntax highlighting, comments, brackets,
indentation, document formatting through `kelyra-format`, and hover,
completion, diagnostics, and definition navigation through `kelyra-ls`.
Highlighting covers annotations, compile-time `when`/`meta` reflection,
prefix pointers, inline assembly chains, and wildcard imports.
Built-in types and annotations have documented completion and hover support;
keywords and annotations declared in the current document are also suggested.
Classes use `class`, `init`, `deinit`, and the implicit `this` pointer. These
keywords have highlighting and inline help; `kelyra-ls` supplies class member
completion, hover, and definition navigation.
Snippets cover functions, classes, control flow, assembly, annotations, and
Kelp manifests, and `[kelyra]`/`[kelp]` default to two-space indentation.
Braces and block comments fold, and `kelp.toml` completes section headers.
Parameter-name inlay hints appear at call sites: set
`kelyra.inlayHints.parameterNames` to `literals` (default), `all`, or `off`.
Hints for other modules come from indexing the workspace `.kly` files. Hints are
styled like inline code: the bundled themes give them a distinct background and
`[kelyra]` defaults them to a smaller, padded font, which you can change with
`"[kelyra]": { "editor.inlayHints.fontSize": ... }`.
`.kly` and `kelp.toml` files have their own light and dark file icons, shown by
the default file icon theme and by any theme that leaves the language to VS Code.
Choose **Kelyra Dark** or **Kelyra Light** with **Preferences: Color Theme**.
Both use VS Code's standard theme contribution, so users can override UI and
syntax colors with `workbench.colorCustomizations` and
`editor.tokenColorCustomizations`, including theme-specific `[Kelyra Dark]`
or `[Kelyra Light]` entries.
It also recognizes `kelp.toml`, provides field hover and completion for
projects, `build.kind`, `[workspace]` members, and Git or local path
dependencies, and adds a Kelp activity-bar view with format, compile, debug,
run, test, package, and members actions. Compile and check tasks feed a
contributed problem matcher, so `kelyra` diagnostics also appear in the
Problems panel.
**Format Document** (in the editor title bar and the editor's right-click menu)
formats the current `.kly` document using its registered formatter, preserving
VS Code's undo and unsaved edits.
`[kelyra]` files default to this formatter and to format-on-save.

### Projects view

The **Kelp** activity bar has a **Projects** view listing the workspace and its
subprojects. Member data comes from `kelp members`, so the tree shows each
project's build kind and output artifact; when the executable is unavailable the
view falls back to scanning `kelp.toml` manifests, following `[workspace]
members` and nesting projects by directory. Right-click a project for check,
build, run, debug, test, and package, to reveal its output path, or to open and
reveal its manifest. The status bar shows the active project's artifact and
copies the path when clicked, and **Kelp: Show Output Path** prints it to the
Kelp output channel. Kelp also contributes `kelp` build tasks, so the commands
appear in **Tasks: Run Task** and can be bound to `launch.json` pre-launch
tasks. In `kelp.toml`, Go to Definition on a `[workspace] members` entry or a
dependency `path` jumps to the referenced project's manifest.

### Local GDB debugging

Install local **GDB** and the **Microsoft C/C++** extension (`ms-vscode.cpptools`).
Use a Kelp version supporting `output` and `build --debug`. Clicking **Debug**:

1. Selects the active editor's project (or asks for a workspace folder), saves
   files, and reads the executable path from Kelp, including custom build outputs.
2. Runs `kelp build --debug` at `-O0` without modifying `kelp.toml`.
3. Starts a `cppdbg` session using local GDB, stops at entry, and opens Run and
   Debug plus the Debug Console. No `launch.json` is required or overwritten.

Configure `kelp.debug.gdbPath` (default `gdb` on `PATH`) and `kelp.debug.args` as needed.
The Kelp sidebar links to **Variables**, **Functions / Call Stack**, **Watch
Expressions**, and **Evaluate / Debug Console**. Call Stack lists the active
function frames, not all functions in the project. Evaluation uses GDB's expression
syntax; it is not a Kelyra interpreter. You can use `-exec info functions` in the
Debug Console to list symbols.

Use the updated Kelyra compiler: `-O0` emits local/parameter names, types, storage
locations, and lexical scopes, including pointers, arrays, class fields and
destructured return values. Optimized builds currently omit this metadata.
Evaluation uses the selected stack frame. Imported C records remain opaque and
wide `f256`/`f512` values do not yet have native debug locations.
See the [VS Code GDB configuration reference](https://code.visualstudio.com/docs/cpp/launch-json-reference).

```sh
npm test
vsce package
```

Build `kelyra-ls` and `kelyra-format`, install the generated VSIX, then set
`kelyra.languageServer.path` and `kelyra.formatter.path` if the executables
are not on `PATH`.

## JetBrains

The plugin provides `.kly` syntax highlighting, comments, brackets, formatting,
hover, completion, diagnostics, and definition navigation. It also highlights
`kelp.toml`. Syntax support uses the bundled TextMate plugin; language features
use the IDE's native LSP client and `kelyra-ls` from `PATH`.

```sh
cd jetbrains
gradle buildPlugin
```

Install the ZIP from `jetbrains/build/distributions` with **Install Plugin
from Disk**. JetBrains IDE 2025.2 or newer is required.
