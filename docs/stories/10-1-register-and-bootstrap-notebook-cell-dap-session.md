---
storyId: "10.1"
storyKey: "10-1-register-and-bootstrap-notebook-cell-dap-session"
title: "Register and Bootstrap Notebook-Cell DAP Session"
status: "backlog"
created: "2026-05-11"
epic: "10"
priority: "p0-blocker"
dependencies:
  [
    "1-6-surface-connection-state-and-recovery-actions",
    "2-4-support-fast-rerun-and-iteration-patterns",
  ]
---

# Story 10.1: Register and Bootstrap Notebook-Cell DAP Session

**Status:** backlog

## Story

As a developer,
I want notebook-cell execution to start an extension-owned debug session,
So that VS Code can treat notebook-cell code as a debuggable program surface.

## Acceptance Criteria

### AC 1: Debug Configuration Exists and Resolves

**Given** the extension is installed and active
**When** the user opens the Debug view
**Then** a `jupyter-browser-kernel` debug configuration appears in the configuration dropdown
**And** selecting it does not require external files to be manually configured.

### AC 2: Debug Adapter Activates When Debug Session Begins

**Given** a notebook is open with the Browser Kernel selected and the extension is connected to a browser target
**When** the user starts a debug run (F5 or Debug menu)
**Then** the extension provides a debug adapter via `vscode.DebugAdapterDescriptorFactory` (inline `DebugAdapterInlineImplementation` is preferred over a TCP server to avoid port management)
**And** VS Code initializes the session and the `initialize` + `launch` DAP handshake completes within 2 seconds.

### AC 3: Session Lifecycle Owns `Debugger.enable` / `Debugger.disable`

**Given** a DAP session starts
**When** `launch` is processed
**Then** the debug-session-manager calls `Debugger.enable` on the per-target session via `BrowserDebuggerSession`
**And** when the DAP session terminates, `Debugger.disable` is called and any `Debugger.paused` listener is disposed.

**Given** the browser connection is lost during a debug session
**When** the loss is detected
**Then** the DAP session terminates gracefully
**And** VS Code receives a `terminated` event with guidance to reconnect.

### AC 4: Story 2.5 Always-On Mirror Is Decommissioned

**Given** the Story 2.5 always-on breakpoint mirror and unconditional attach-time `Debugger.enable`
**When** Story 10.1 lands
**Then** `src/debugger/breakpoint-mirror.ts` is deleted, its wiring is removed from `src/extension.ts`, and `connectViaBrowserTargetAttach` no longer calls `Debugger.enable`
**And** outside an active DAP session the extension's per-target session does not receive `Debugger.paused` events
**And** Story 2.5's transitional auto-resume / pause-log code path is removed.

### AC 5: Session Startup Failures Surface Clear Diagnostics

**Given** the DAP session fails to start (no active browser connection, `Debugger.enable` rejection, etc.)
**When** startup completes
**Then** the adapter rejects the `launch` request with a localized message that names the root cause and the recovery action (e.g., "Browser connection unavailable; run the Connect command")
**And** no orphan listeners or partial CDP enablement remain.

### AC 6: Adapter Resources Are Disposed Deterministically

**Given** an active DAP session
**When** the session ends (user stops, connection drops, or VS Code closes)
**Then** all session state (breakpoint registry, variable handles, pause queue, `onPaused` subscription) is cleared
**And** `Debugger.disable` is issued before disposal
**And** subsequent debug starts succeed without VS Code reload.

## Tasks / Subtasks

### 1. Decommission Story 2.5 Always-On Mirror (AC: 4)

- [ ] Delete [src/debugger/breakpoint-mirror.ts](../../src/debugger/breakpoint-mirror.ts) and its `index.ts` re-export.
- [ ] Remove the mirror construction, `connectionStateStore` subscription, and `breakpointMirror.dispose()` push from [src/extension.ts](../../src/extension.ts).
- [ ] Remove the unconditional `Debugger.enable` call from `connectViaBrowserTargetAttach` in [src/transport/browser-connect.ts](../../src/transport/browser-connect.ts) and remove the post-attach categorization for that step. Keep `BrowserDebuggerSession` and the `debugger` field on `ActiveBrowserConnection` — those stay for the DAP adapter to consume.
- [ ] Delete the now-unused l10n keys for the mirror's auto-resume / mirror-failure log lines in [l10n/bundle.l10n.json](../../l10n/bundle.l10n.json). Keep the `Debugger.enable` failure key — Story 10.1 reuses it under the DAP path.
- [ ] Delete [tests/unit/debugger/breakpoint-mirror.test.ts](../../tests/unit/debugger/breakpoint-mirror.test.ts) and the integration test that exercised the mirror. Update [tests/unit/transport/browser-connect.test.ts](../../tests/unit/transport/browser-connect.test.ts) so attach no longer asserts a `Debugger.enable` call.
- [ ] Update [docs/stories/deferred-work.md](deferred-work.md): mark the "Full VS Code Debug Adapter for cell debugging" entry as resolved by Epic 10.

### 2. Create Debug Configuration Provider (AC: 1, 2, 5)

- [ ] Create `src/debugger/debug-config-provider.ts` implementing `vscode.DebugConfigurationProvider`:
  - `resolveDebugConfiguration(folder, config, token)` ensures `type === "jupyter-browser-kernel"`, `request` defaults to `"launch"`, and `name` defaults to a localized label.
  - Reject the configuration with a localized error if `getActiveBrowserConnection()` returns `undefined`.
- [ ] Register the provider in `activate(...)` via `vscode.debug.registerDebugConfigurationProvider("jupyter-browser-kernel", provider)` and push the disposable into `context.subscriptions`.

### 3. Create Debug Adapter Descriptor Factory (AC: 2, 3, 6)

- [ ] Create `src/debugger/debug-adapter-factory.ts` implementing `vscode.DebugAdapterDescriptorFactory`:
  - `createDebugAdapterDescriptor(session, executable)` returns `new vscode.DebugAdapterInlineImplementation(adapter)` where `adapter` is a `NotebookDebugAdapter` instance bound to the active `BrowserDebuggerSession`.
  - Reject startup if `getActiveBrowserConnection()?.debugger` is unavailable.
- [ ] Register via `vscode.debug.registerDebugAdapterDescriptorFactory("jupyter-browser-kernel", factory)`.

### 4. Create Debug Session Manager (AC: 3, 4, 5, 6)

- [ ] Create `src/debugger/debug-session-manager.ts` exporting `createDebugSessionManager({ getDebuggerSession, logger })`.
- [ ] Responsibilities:
  - On `launch` request: call `debuggerSession.enable()` (new method on `BrowserDebuggerSession` — see Task 5), subscribe to `onPaused`, transition to `running`.
  - On `terminate` / `disconnect`: dispose the `onPaused` subscription, call `debuggerSession.disable()`, clear all state.
  - Surface `Debugger.enable` failure as a localized DAP `launch` error response (AC 5) — reuse the failure key from the deleted mirror.
  - Subscribe to `connectionStateStore` so a transport-level disconnect during an active session emits a DAP `terminated` event with reason `connection-lost` (AC 3).

### 5. Extend `BrowserDebuggerSession` With `enable` / `disable` (AC: 3)

- [ ] In [src/transport/browser-connect.ts](../../src/transport/browser-connect.ts), add `enable(): Promise<void>` and `disable(): Promise<void>` to `BrowserDebuggerSession`, wrapping `client.send("Debugger.enable", undefined, sessionId)` / `client.send("Debugger.disable", undefined, sessionId)`.
- [ ] Update [tests/unit/transport/browser-connect.test.ts](../../tests/unit/transport/browser-connect.test.ts) with forwarding tests for both methods.

### 6. Create Notebook Debug Adapter Skeleton (AC: 2, 3, 6)

- [ ] Create `src/debugger/notebook-dap-adapter.ts` implementing `vscode.DebugAdapter`:
  - Internally use `@vscode/debugadapter` (`DebugSession` base class) so DAP request dispatch is provided.
  - Implement only the lifecycle handlers in this story: `initialize`, `launch`, `attach` (alias to `launch`), `disconnect`, `terminate`, `threads`. Frame, scope, variable, breakpoint, and stepping handlers are stubbed and ship in Stories 10.2–10.4.
  - `initialize` returns capabilities: `supportsBreakpointLocationsRequest: true`, `supportsConfigurationDoneRequest: true`, `supportsTerminateRequest: true`, `supportTerminateDebuggee: false`, `supportsEvaluateForHovers: true`. Other capabilities default to `false`.
  - `launch` delegates to the session manager (Task 4); on success emits `InitializedEvent`. On failure emits a localized `ErrorResponse`.
  - `threads` returns a single thread `{ id: 1, name: "Notebook cells" }`.
  - `disconnect` / `terminate` delegate to the session manager and resolve immediately; the manager handles `Debugger.disable`.

### 7. Wire Activation Event and Extension Bootstrap (AC: 2, 4)

- [ ] Add `"onDebug:jupyter-browser-kernel"` to `package.json` `activationEvents`.
- [ ] Update [.github/copilot-instructions.md](../../.github/copilot-instructions.md) "Stable Technical Constraints" to allow this activation event explicitly.
- [ ] In [src/extension.ts](../../src/extension.ts), construct the session manager, debug-config provider, and adapter descriptor factory, register them, and push their disposables into `context.subscriptions`.

### 8. Localization (AC: 5)

- [ ] Add localized strings to [l10n/bundle.l10n.json](../../l10n/bundle.l10n.json) for: `"Browser Kernel Debug"`, `"Cannot start debug session: connect to a browser target first."`, `"Failed to enable Debugger domain on browser session: {0}"` (reuse existing key), `"Browser connection lost; debug session terminated."`.
- [ ] No new `package.nls.json` entries.

### 9. Unit Tests (AC: 1, 2, 3, 4, 5, 6)

- [ ] `tests/unit/debugger/debug-config-provider.test.ts`: provider sets defaults; rejects with localized error when no active connection.
- [ ] `tests/unit/debugger/debug-session-manager.test.ts`: `launch` calls `enable()` then subscribes to `onPaused`; `terminate` disposes subscription then calls `disable()`; `enable()` rejection is surfaced via the registered logger and re-thrown for the DAP path; transport `disconnected` event during a session triggers a `terminated` callback exactly once.
- [ ] `tests/unit/debugger/notebook-dap-adapter.test.ts`: `initialize` capabilities snapshot; `launch` failure produces an `ErrorResponse` with the localized message; `threads` returns the single thread shape.
- [ ] `tests/unit/debugger/decommission.test.ts` (or update existing transport tests): assert that `connectViaBrowserTargetAttach` does NOT call `Debugger.enable` and that `ActiveBrowserConnection.debugger.enable` / `disable` exist and forward correctly.

### 10. Integration Test (AC: 2, 3, 6)

- [ ] `tests/integration/debugger/dap-session-lifecycle.integration.test.ts` (gated by `RUN_CDP_INTEGRATION=1`, reuses `tests/integration/helpers/headless-chromium.ts`):
  - Start headless Chromium, connect, then drive a synthetic DAP client through `initialize` → `launch` → `threads` → `disconnect`.
  - Assert that `Debugger.enable` is sent on `launch` and `Debugger.disable` is sent on `disconnect`, and that no `Debugger.paused` listener remains afterward.

### 11. Validation

- [ ] `npm run lint`.
- [ ] `npm run test`.
- [ ] `npm run compile`.
- [ ] `npm run test:integration:cdp`.
- [ ] Manual smoke: open a notebook with the Browser Kernel, connect, set a breakpoint, press F5, confirm the debug session reaches the DAP `initialized` state and disconnects cleanly. (Breakpoint _binding_ arrives in Story 10.2.)

## Dev Notes

### Story Context and Scope

This is the **first story in Epic 10**. It does three things:

1. Decommissions Story 2.5's always-on breakpoint mirror and unconditional attach-time `Debugger.enable` (the Epic 2 retro flagged this as low-product-value behavior whose retirement was a precondition for the real DAP adapter).
2. Stands up the DAP plumbing — debug-config provider, debug-adapter descriptor factory, session manager, and a skeleton `NotebookDebugAdapter` — so VS Code can reach the `initialize` / `launch` / `terminate` lifecycle.
3. Transfers ownership of `Debugger.enable` / `Debugger.disable` to the session manager, scoped to the lifetime of an active `vscode.DebugSession`.

Breakpoint binding, frame inspection, variable scoping, and stepping are Stories 10.2–10.4. Dual-client testing is Story 10.5.

**Epic 10 dependencies:**

- **Epic 1 (Story 1.6):** `getActiveBrowserConnection()` and `connectionStateStore` must be stable.
- **Epic 2 (Story 2.4):** Per-cell `//# sourceURL=` identity (`cell.document.uri.toString()`) is the canonical breakpoint key consumed by Story 10.2.
- **Story 2.5 transport surface:** The `BrowserDebuggerSession` interface on `ActiveBrowserConnection.debugger` is reused. Story 2.5's `breakpoint-mirror.ts` module and the unconditional `Debugger.enable` at attach are deleted.

### Architecture Guardrails (Must Follow)

- **DAP libraries:** Use `@vscode/debugprotocol` for types and `@vscode/debugadapter` for the `DebugSession` base class.
- **Adapter transport:** Use `vscode.DebugAdapterInlineImplementation` (no TCP / pipe / port management). The adapter runs in-process inside the extension.
- **Layer boundaries:** The DAP adapter must NOT import `chrome-remote-interface`. It reaches CDP only through `BrowserDebuggerSession` on `ActiveBrowserConnection.debugger`. If a new CDP command is needed, add it to `BrowserDebuggerSession` first.
- **Session ownership:** One `NotebookDebugAdapter` instance per debug run, created by the descriptor factory. No singletons. The session manager owns `Debugger.enable` / `Debugger.disable` and the `onPaused` subscription for the duration of the session.
- **Error localization:** All user-facing strings via `vscode.l10n.t()`; runtime keys in `l10n/bundle.l10n.json`, no `package.nls.json` additions.
- **Activation:** Add `onDebug:jupyter-browser-kernel`. Update `.github/copilot-instructions.md` to reflect the new allowed activation event.

### Testing Strategy

**Unit tests** must mock the `ActiveBrowserConnection` interface to avoid requiring a live browser:

- Create a fake connection object with required properties: `sessionId`, `targetId`, `endpoint`.
- Test error paths (e.g., connection is undefined, connection is invalid).
- Verify DAP adapter state is isolated per session and does not leak between tests.

**Integration tests** (if added later) should:

- Use a real or stubbed CDP endpoint to test end-to-end DAP-to-browser communication.
- Verify that starting two debug sessions in sequence does not cause port conflicts or state pollution.

### Known Unknowns & Future Decisions

1. **DAP capabilities set:** Capabilities will be extended in Stories 10.2–10.4 as request handlers land.
2. **Thread abstraction:** Notebook-cell debugging uses a single thread per session. Future multi-cell parallelism may require a thread pool abstraction.
3. **Source identity for `Source` payloads:** Story 10.2 defines how `vscode-notebook-cell://…` URIs map onto DAP `Source` objects; 10.1 only stubs the threads list.

### Related Documentation

- [VS Code Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/)
- [`@vscode/debugprotocol` NPM package](https://www.npmjs.com/package/@vscode/debugprotocol)
- [VS Code Extension API — Debug](https://code.visualstudio.com/api/extension-guides/debugger-extension)
- [docs/architecture.md — Architectural Boundaries](../architecture.md#architectural-boundaries)
- [docs/architecture.md — State Management](../architecture.md#state-management-patterns)
