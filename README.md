# kide

Kelyra editor support for VS Code and JetBrains IDEs.

## VS Code

The extension provides `.kly` syntax highlighting, comments, brackets,
indentation, document formatting through `kelyra-format`, and hover,
completion, diagnostics, and definition navigation through `kelyra-ls`.
Highlighting covers annotations, compile-time `when`/`meta` reflection,
prefix pointers, inline assembly chains, and wildcard imports.
Built-in types and annotations have documented completion and hover support;
annotations declared in the current document are also suggested.
Classes use `class`, `init`, `deinit`, and the implicit `this` pointer. These
keywords have highlighting and inline help; `kelyra-ls` supplies class member
completion, hover, and definition navigation.
Choose **Kelyra Dark** or **Kelyra Light** with **Preferences: Color Theme**.
Both use VS Code's standard theme contribution, so users can override UI and
syntax colors with `workbench.colorCustomizations` and
`editor.tokenColorCustomizations`, including theme-specific `[Kelyra Dark]`
or `[Kelyra Light]` entries.
It also recognizes `kelp.toml`, provides field hover and completion, and adds
a Kelp activity-bar view with compile, debug, run, test, and package actions.
Debug builds the project and starts the workspace's configured VS Code native
debugger.

```sh
npm test
npx @vscode/vsce package
```

Build `kelyra-ls` and `kelyra-format`, install the generated VSIX, then set
`kelyra.languageServer.path` and `kelyra.formatter.path` if the executables
are not on `PATH`.

## JetBrains

The plugin provides `.kly` syntax highlighting, comments, and bracket support
through the IDE's bundled TextMate plugin.

```sh
cd jetbrains
gradle buildPlugin
```

Install the ZIP from `jetbrains/build/distributions` with **Install Plugin
from Disk**.
