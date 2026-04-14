# Deferred Work

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
