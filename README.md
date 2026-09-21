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
**Format File** (also in the editor title bar) formats the current `.kly` document
using its registered formatter, preserving VS Code's undo and unsaved edits.

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
npx @vscode/vsce package
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
