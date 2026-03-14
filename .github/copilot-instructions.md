# Copilot Instructions

## Project Overview

`foundry-trueseeing` is a VS Code extension that connects to a running [FoundryVTT](https://foundryvtt.com/) instance via the [Chrome DevTools Protocol (CDP)](https://chromedevtools.github.io/devtools-protocol/). It provides three developer-tooling capabilities:

- **Variable watcher** – observe predefined or user-defined FoundryVTT JavaScript variables; refreshes manually, after JS execution, or on a configurable auto-refresh timer
- **Jupyter scratchpad** – run JavaScript cells from a `.ipynb` notebook directly in the FoundryVTT browser context using a custom VS Code `NotebookController`; optionally attach [vscode-edge-devtools](https://marketplace.visualstudio.com/items?itemName=ms-edgedevtools.vscode-edge-devtools) for full debugger support
- **Log viewer** – stream console log messages from the FoundryVTT tab

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: VS Code Extension API (`vscode`)
- **CDP client**: `chrome-remote-interface` (Node.js CDP library)
- **Notebook integration**: VS Code `vscode.NotebookController` API (registers a "FoundryVTT" kernel selectable in any `.ipynb` file); requires `ms-toolsai.jupyter` in `extensionDependencies`
- **Log/watcher UI**: VS Code WebviewPanel (lightweight HTML, no heavy framework)
- **Bundler**: esbuild (outputs single CJS file, required for VS Code extensions)
- **JS debugging integration**: `ms-edgedevtools.vscode-edge-devtools` — listed in `extensionDependencies`

## Architecture

```
src/
  extension.ts           # Activation entry point — registers commands and providers
  cdp/
    client.ts            # CDP connection lifecycle (connect/disconnect/reconnect)
    targets.ts           # CDP target discovery and FoundryVTT tab selection
    runtime.ts           # Runtime.evaluate wrapper (returnByValue, awaitPromise,
                         # exceptionDetails handling)
    console.ts           # Log domain + Runtime.consoleAPICalled → log panel
  notebook/
    controller.ts        # vscode.NotebookController — "FoundryVTT" kernel
                         # executeHandler sends cell source to CDP Runtime.evaluate
                         # and writes output back as NotebookCellOutput
    outputSerializer.ts  # Serializes/deserializes cell outputs for notebook persistence
  panels/
    watchPanel.ts        # WebviewPanel: variable watcher
    logPanel.ts          # WebviewPanel: log viewer
  watchers/
    variableWatcher.ts   # Holds watched expressions and last-known values;
                         # exposes refresh() triggered manually, post-cell-execution,
                         # or by an optional auto-refresh timer
  debug/
    launchConfig.ts      # Generates a pwa-msedge/pwa-chrome launch config reusing
                         # the already-connected CDP port for vscode-edge-devtools
  config/
    schema.ts            # Zod schema for extension settings (contributes.configuration)
  types/
    messages.ts          # Shared typed IPC message shapes (Extension ↔ WebviewPanel)
media/
  (WebviewPanel HTML/CSS/JS assets — bundled by esbuild)
```

### Data flow

1. User launches FoundryVTT in Chrome/Chromium/Edge with `--remote-debugging-port=9222`.
2. The extension connects to `ws://localhost:<port>` via CDP, filters targets for the FoundryVTT tab (`type === 'page'`, URL contains `/game`).
3. **Variable watching**: `variableWatcher.refresh()` evaluates all watched expressions and pushes diffs to the Watch WebviewPanel. Triggered by: (a) manual Refresh, (b) completion of a notebook cell execution, or (c) auto-refresh timer. Auto-refresh is **disabled by default** (`foundryTrueseeing.watchAutoRefreshInterval = 0`).
4. **Log streaming**: `Log` domain + `Runtime.consoleAPICalled` events are forwarded to the Log WebviewPanel.
5. **Notebook cell execution**: The `NotebookController.executeHandler` receives one or more cells, calls `Runtime.evaluate` for each cell's source, and writes results as `vscode.NotebookCellOutput`. On completion, `variableWatcher.refresh()` is called. Errors are surfaced as `NotebookCellOutput` with MIME type `application/vnd.code.notebook.error`.
6. **JS debugging**: `vscode.debug.startDebugging` with a `pwa-msedge`/`pwa-chrome` config targeting the same CDP port, handing control to vscode-edge-devtools. Adding `debugger;` at the top of a cell will pause execution in the DevTools debugger.

### Notebook controller registration

```ts
const controller = vscode.notebooks.createNotebookController(
  'foundry-trueseeing',   // unique ID
  'jupyter-notebook',      // notebookType — works with .ipynb files
  'FoundryVTT'             // label shown in the kernel picker
);
controller.supportedLanguages = ['javascript'];
controller.executeHandler = executeHandler;
```

### Extension ↔ WebviewPanel messaging

All IPC uses typed message objects via `panel.webview.postMessage` / `window.addEventListener('message')`. All shapes live in `src/types/messages.ts` — never inline ad-hoc message objects.

## Build & Dev Commands

```bash
npm install
npm run compile       # one-shot TypeScript compile
npm run watch         # incremental esbuild watch
npm run lint          # ESLint
npm run test          # extension integration tests via @vscode/test-electron
```

Press **F5** in VS Code to launch the Extension Development Host.

To run a single test file:
```bash
npx mocha --require ts-node/register src/test/suite/controller.test.ts
```

## Key Conventions

- **Target selection**: Filter CDP targets by `type === 'page'` and URL containing `/game`. Never attach to DevTools or background service-worker targets.
- **`Runtime.evaluate` safety**: Always pass `returnByValue: true` and `awaitPromise: true`. Always check `exceptionDetails` — never assume success.
- **Watcher refresh modes**: Auto-timer is disabled when `foundryTrueseeing.watchAutoRefreshInterval` is `0` (the default). The timer must be cleared and re-created whenever the setting changes.
- **Cell output**: Use the `text/plain` MIME type for primitive results; use `application/json` for objects; use `application/vnd.code.notebook.error` for exceptions.
- **Scratchpad debug shortcut**: Prepend `debugger;\n` to the cell source when launching the debugger so execution pauses immediately in the vscode-edge-devtools UI.
- **CDP port reuse**: `debug/launchConfig.ts` must read the port from the extension's existing connection state — do not prompt the user for it again.
- **Panel lifecycle**: All WebviewPanels are singletons — `reveal` if already open, create otherwise. Dispose the CDP client session when the last consumer is disposed.
- **Settings namespace**: All contributed settings use the prefix `foundryTrueseeing.*`. Key settings:
  - `foundryTrueseeing.cdpHost` — hostname/IP of the CDP endpoint (default: `localhost`; set to `host.docker.internal` when running inside a devcontainer)
  - `foundryTrueseeing.cdpPort` — CDP remote debugging port (default: `9222`)
  - `foundryTrueseeing.watchAutoRefreshInterval` — auto-refresh interval in ms, `0` = disabled (default: `0`)
- **Activation event**: Activate on `onCommand:foundryTrueseeing.connect` only — do not use `*` or `onStartupFinished`.
- **Error surfacing**: User-visible errors → `vscode.window.showErrorMessage`; verbose/diagnostic output → a dedicated `vscode.OutputChannel` (`FoundryVTT DevTools`).
- **Extension dependencies**: Both `ms-toolsai.jupyter` and `ms-edgedevtools.vscode-edge-devtools` must appear in `extensionDependencies` in `package.json`.
