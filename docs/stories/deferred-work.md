# Deferred Work

## Deferred from: code review of 10-1-register-and-bootstrap-notebook-cell-dap-session (2026-05-23)

- Two concurrent `vscode.DebugSession` instances against the same `ActiveBrowserConnection` race on `Debugger.enable`/`Debugger.disable` and emit two `connection-lost` terminations. Explicitly out of scope for Story 10.1; Story 10.5 (dual-client coexistence) is expected to address this with reference counting or session arbitration.
- `connectionStateListeners` set is iterated inside `setState` while listeners may add or remove subscriptions during dispatch. Pre-existing transport-module behavior, not introduced by Story 10.1; defer until a transport-layer cleanup story addresses listener-dispatch safety holistically.

## Deferred from: code review of 1-2-configure-browser-endpoint (2026-04-04)

- `isLoopbackHost` does not cover the `127.x.x.x` block or IPv6 variants (`::ffff:127.0.0.1`, `0:0:0:0:0:0:0:1`) — these are displayed as `[redacted-host]` instead of the raw loopback address. Expanded loopback display classification deferred to post-MVP.
- `watchAutoRefreshInterval` is missing `markdownDescription` and min/max schema constraints, unlike its sibling `cdpPort`. Deferred — outside Story 1.2 task scope.
- Generic `"{0} {1}"` l10n key is shared by all two-argument error compositions, limiting targeted translation and key-specific comments. Deferred — not a functional bug, translation quality concern.
- ~~`format` test helper re-implements `vscode.l10n.t` substitution logic.~~ Resolved: replaced with `@vscode/l10n` (the canonical standalone package) imported directly in `tests/unit/commands/connect-command.test.ts`.
- `config.get<string>("cdpHost", ...)` wrapping with `String()` means a corrupted config returning an object would produce `"[object Object]"`, which passes host validation and is used as a hostname. Deferred — VS Code settings infrastructure prevents configuration corruption in practice.

## Deferred from: code review of 1-3-connect-to-a-valid-browser-target (2026-04-08)

- `connectionStateStore.getState()` is unused interface surface — `getState()` is defined on `ConnectionStateStore` but never called in command or extension code. State is pushed via callbacks, not pulled. Benign unused API.
- `extensionKind` in `package.json` is set to `"ui"` and `"workspace"` instead of `"ui"` only to make the extention debuggable. When adding CI packaging (**story 1.7**), the `extentionKind` must be patch in the pipeline.

## Deferred from: code review of 1-4-disconnect-and-manual-reconnect-lifecycle (2026-04-11)

- No explicit 5-second timeout wrapper for reconnect (NFR2/NFR4). AC 2 requires "reports success or failure within 5 seconds." Implementation relies on CDP library default timeouts. No `Promise.race` timeout guard. CDP defaults are reasonable for MVP.

## Deferred from: code review of 1-6-surface-connection-state-and-recovery-actions (2026-04-13)

- Timestamp logging uses time-only format (`toLocaleTimeString`) — multi-day sessions produce ambiguous log entries without date context. Pre-existing pattern.
- `endpointSummary()` re-reads workspace configuration on every tooltip render and log line. Harmless at current event frequency but would be wasteful under rapid state changes. Pre-existing pattern.

## Deferred from: code review of 2-2-run-asynchronous-javascript-cells (2026-04-18)

- ~~`raceWithTimeout` never cancels the underlying CDP evaluation — when the timeout fires, the browser continues executing the expression. `Runtime.terminateExecution` could be used for cleanup. Acceptable for MVP scope.~~ Resolved in Story 2.2 by issuing `Runtime.terminateExecution` on timeout.
- Magic string coupling between transport timeout message (`"CDP evaluation timed out"`) and kernel regex (`TIMEOUT_ERROR_PATTERN`) — fragile contract via string matching instead of typed error. Requires design decision on shared error contract.
- ~~`replMode: true` was added to `Runtime.evaluate` params in Story 2.2 without spec authorization. It changes CDP evaluation semantics (top-level await, completion-value return). Flag for Story 2.4 planning to decide whether to keep or remove.~~ Resolved: addressed by Story 2.5 (validate `replMode` against breakpoint binding; switch evaluation strategy if incompatible).

## Deferred from: code review of 2-3-normalize-success-and-failure-output-contracts (2026-04-19)

- No test for Symbol/Function without `description` field — CDP can theoretically return symbols/functions where `description` is undefined, causing `serializeRemoteValue` fallthrough to `JSON.stringify(undefined)` → `"undefined"`. CDP always provides `description` for these types in practice.

## Deferred from: breakpoint compatibility discovery (2026-04-19)

- ~~`addSourceLabeling` uses a static `//# sourceURL=cell.js` for all cells. Must be replaced with per-cell identity reflecting notebook file name and cell index (e.g., `notebook-name.cell-3.js`). Deferred to Story 2.4 — sourceURL scheme should be designed alongside wrapping lambda and breakpoint-compatibility decisions.~~ Resolved: addressed by Story 2.4 per-cell sourceURL contract.
- ~~Breakpoint debugging was identified as an implicit MVP capability not covered by any existing FR or epic. Browser-level breakpoints require CDP `Debugger` domain integration and a stable source-name contract between VS Code notebook URIs and `sourceURL` directives. Run Correct Course (`bmad-correct-course`) before starting Story 2.4 to integrate this into PRD, architecture, and epic planning.~~ Resolved: Sprint Change Proposal 2026-04-19 added FR38, Story 2.5, and architecture coverage.

## Deferred from: Story 2.5 scope split (2026-04-25)

- ~~**Full VS Code Debug Adapter for cell debugging.** Planned under Epic 10 (Post-MVP Core): "Full VS Code Debugging Experience" via Sprint Change Proposal 2026-05-11. Story 2.5 (amended 2026-04-25) implements only the CDP-side mirror: VS Code-side notebook-cell breakpoints are forwarded to the page via `Debugger.setBreakpointByUrl` and pause execution in the browser, but pause inspection happens in the browser's DevTools. The VS Code editor does NOT show a solid "verified" gutter glyph, does NOT enter a `vscode.DebugSession`, does NOT highlight the paused line, and does NOT populate the Variables / Call Stack / Watch panels. Implementation validation also confirmed a Chromium/DevTools limitation: a breakpoint mirrored from the extension's separate CDP session can bind in V8 and trigger pauses without rendering a visible gutter marker in DevTools Sources. To deliver a real VS Code debug experience for notebook cells (solid gutter glyph, paused-line marker, Variables/Watch/Call Stack panels, step in/over/out, conditional breakpoints, exception breakpoints), the extension must register its own Debug Adapter Protocol (DAP) adapter that claims the `vscode-notebook-cell://` URI scheme and bridges DAP requests to the existing CDP Debugger/Runtime domains. vscode-js-debug cannot be reused because it has no extension point for foreign URI schemes (see decision history in this branch's chat record). This remains deferred until Epic 10 implementation begins because the DAP surface (`setBreakpoints`, `threads`, `stackTrace`, `scopes`, `variables`, `continue`, `next`/`stepIn`/`stepOut`, `evaluate`, `stopped`, exception breakpoints, conditional breakpoints, lifecycle, plus reconciliation with the existing extension connection and DevTools coexistence) is substantially larger than any current Epic 2 story.~~ Resolved: Sprint Change Proposal 2026-05-15 promoted Epic 10 to active and folded the Story 2.5 mirror decommission into Story 10.1; the DAP adapter is now scoped across Stories 10.1\u201310.5.
