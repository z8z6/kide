# kide

Kelyra editor support for VS Code and JetBrains IDEs.

## VS Code

The extension provides `.kly` syntax highlighting, comments, brackets,
indentation, document formatting through `kelyra-format`, and hover,
completion, diagnostics, and definition navigation through `kelyra-ls`.
Highlighting covers annotations, compile-time `when`/`meta` reflection,
prefix pointers, inline assembly chains, and wildcard imports.
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
