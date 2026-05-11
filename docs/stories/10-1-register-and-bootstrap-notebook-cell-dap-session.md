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
**Then** a "jupyter-browser-kernel" debug configuration appears in the configuration dropdown
**And** selecting it does not require external files to be manually configured.

### AC 2: DAP Server Starts When Debug Session Begins

**Given** a notebook is open with the Browser Kernel selected
**When** the user starts a debug run (F5 or Debug menu)
**Then** the extension starts a DAP server listening on a local TCP socket or pipe
**And** VS Code connects to the DAP server without manual port entry
**And** the DAP server is reported as ready within 2 seconds.

### AC 3: Session Lifecycle is Owned by Extension

**Given** an active DAP session
**When** the browser connection remains valid
**Then** the DAP session stays active and responsive to VS Code requests
**And** session state is deterministically tied to the extension's active browser connection.

**Given** the browser connection is lost
**When** the loss is detected
**Then** the DAP session terminates gracefully
**And** VS Code receives a `terminated` event with guidance to reconnect.

### AC 4: Session Startup Failures Surface Clear Diagnostics

**Given** the DAP server fails to start
**When** startup completes
**Then** the user receives an error notification in VS Code
**And** the error message includes root cause and next steps (e.g., "Browser connection unavailable; run Reconnect command").

**Given** VS Code cannot connect to the DAP server
**When** connection times out
**Then** VS Code displays "Debug adapter failed" with actionable guidance
**And** no orphan server process remains on the system.

### AC 5: Adapter Resources are Disposed Deterministically

**Given** an active DAP session
**When** the session ends (user stops, connection drops, or VS Code closes)
**Then** the DAP server socket is closed
**And** all internal session state is cleared
**And** subsequent debug starts can reconnect without VS Code reload.

## Tasks / Subtasks

### 1. Create Debug Configuration Provider (AC: 1, 2, 4)

- [ ] Create `src/debug/debug-config-provider.ts`.
- [ ] Implement `vscode.DebugConfigurationProvider` interface:
  - `resolveDebugConfiguration(folder, config, token)`: Return or modify the debug config.
  - `resolveDebugConfigurationWithSubstitutedVariables(folder, config, token)` (optional): Resolve any variables.
- [ ] Register the provider in `extension.ts` via `vscode.debug.registerDebugConfigurationProvider("jupyter-browser-kernel", provider)`.
- [ ] The provider must ensure:
  - `type` is set to `"jupyter-browser-kernel"`.
  - `request` defaults to `"launch"` if not set.
  - `name` defaults to a localized name (e.g., `"Browser Kernel Debug"`).
  - No external file paths or port numbers are required from the user.
  - Port/socket is either auto-selected or statically known (use static local port e.g., `5555` or use `0` to let OS choose, then communicate to VS Code).

### 2. Create DAP Server Bootstrap Module (AC: 2, 3, 4)

- [ ] Create `src/debug/dap-server.ts`.
- [ ] Implement a DAP server factory function `createDAPServer(activeConnection: ActiveBrowserConnection)`:
  - Accept the current active browser connection (containing `sessionId`, `targetId`, `endpoint`).
  - Return an object with lifecycle methods: `start()`, `stop()`, `getPort()` or `getPipe()`.
  - **Do NOT start the server automatically.** Let the caller control startup timing.
  - Throw a descriptive error if `activeConnection` is `undefined` or invalid.
- [ ] The DAP server must:
  - Listen on a local TCP socket (recommended: port `5555` for MVP, or use port `0` and report back the assigned port).
  - Implement the DAP protocol wire format (JSON-RPC 2.0 over stdin/stdout or TCP).
  - Use `@vscode/debugprotocol` library for type safety.
  - **Do NOT import CDP client directly.** Communicate with transport layer through the existing `ActiveBrowserConnection` interface (or add needed methods to it).

### 3. Create Debug Adapter Factory (AC: 2, 3)

- [ ] Create `src/debug/notebook-dap-adapter.ts`.
- [ ] Implement the core DAP adapter `NotebookDAPAdapter` class with:
  - `constructor(connection: ActiveBrowserConnection, log: ILogger)`.
  - Methods for DAP request types (to be detailed in Story 10.2–10.4):
    - `onInitialize(args)`: Respond with capabilities.
    - `onLaunch(args)`: Start the debug session.
    - `onTerminate()`: Clean up and tear down.
    - `onThreads()`: Return thread information (single thread for notebook cells).
    - (Other methods added in subsequent stories.)
  - The adapter must maintain a reference to the `activeConnection` for lifetime scope.
  - **The adapter must NOT be a singleton.** Create one per debug session, dispose one per session end.

### 4. Integrate DAP Server into Debug Configuration Provider (AC: 2, 3, 4, 5)

- [ ] Update `src/debug/debug-config-provider.ts` to:
  - In `resolveDebugConfiguration()`:
    1. Check if `getActiveBrowserConnection()` is available.
    2. If not available, return a config with an error message or set `preLaunchTask` to trigger a reconnect prompt.
    3. If available, store the connection reference in a module-level map indexed by session ID (to be assigned by VS Code).
    4. Return the resolved config with `debugServer` set to the port that the DAP server will listen on.
  - Add a hook that fires when VS Code initiates the debug session (use `vscode.debug.onDidStartDebugSession` in `extension.ts`):
    1. Extract the debug session ID.
    2. Retrieve the stored connection reference.
    3. Create the DAP server via `createDAPServer(connection)`.
    4. Call `server.start()`.
    5. Register a cleanup handler via `vscode.debug.onDidTerminateDebugSession` to call `server.stop()` and clear state.
    6. If server start fails, send error notification and terminate the session.

### 5. Implement Initialize Request Handler (AC: 1, 2)

- [ ] In `NotebookDAPAdapter.onInitialize()`:
  - Return a `InitializedEvent` response with capabilities:
    - `supportsBreakpointLocationsRequest`: `true` (for Story 10.2).
    - `supportsSetVariable`: `false` for MVP (deferred).
    - `supportsEvaluateForHovers`: `true` (for Watch evaluation, Story 10.3).
    - `supportTerminateRequest`: `true`.
    - `supportTerminateDebuggee`: `true`.
    - `supportsStepInTargetsRequest`: `false` for MVP.
    - `supportsClipboardContext`: `false` for MVP.
  - Respond immediately; state initialization happens in `onLaunch()`.

### 6. Implement Launch and Terminate Handlers (AC: 3, 5)

- [ ] In `NotebookDAPAdapter.onLaunch(args)`:
  - Validate the connection is still active.
  - Initialize internal session state (thread ID, pause state, breakpoints map).
  - Respond with a `launch` response.
  - Send `initialized` event to signal readiness for breakpoint requests (Story 10.2).
- [ ] In `NotebookDAPAdapter.onTerminate()`:
  - Detach from the browser runtime debugger (if attached).
  - Clear all session state (breakpoints, threads, watches).
  - Close any pending debug protocol communication.
  - Remove references to the connection.
  - Respond to VS Code with a `terminated` event.
  - Allow subsequent debug starts without reload.

### 7. Implement Error Handling and Reconnect Guidance (AC: 4, 5)

- [ ] Add error handling in debug session lifecycle:
  - If browser connection is lost during a debug session:
    1. Detect the loss via subscription to connection-state changes.
    2. Emit a `terminated` event to VS Code with reason `"connection_closed"`.
    3. Log diagnostics to `OUTPUT_CHANNEL` with reconnect guidance.
  - If DAP server startup fails:
    1. Log the error (e.g., port already in use, permission denied).
    2. Send `vscode.window.showErrorMessage()` with:
       - Clear error title (e.g., "DAP Server Failed to Start").
       - Root cause (e.g., "Port 5555 already in use").
       - Action button (e.g., "Reconnect").
    3. Prevent the debug session from continuing.
  - If VS Code cannot connect to DAP server:
    1. Ensure server cleanup happens even if connection fails.
    2. Let VS Code show its standard "Debug adapter failed" message.

### 8. Add Debug Activation Event (AC: 2)

- [ ] Update `package.json` `activationEvents`:
  - Add `"onDebug:jupyter-browser-kernel"` to ensure the extension is activated before a debug session starts.
  - Verify in `.github/copilot-instructions.md` that this is the intended scope (currently only `onCommand:jupyterBrowserKernel.connect`; verify if broadening is acceptable).

### 9. Add Unit Tests (AC: 1, 2, 3, 4, 5)

- [ ] Create `tests/unit/debug/debug-config-provider.test.ts`:
  - Test `resolveDebugConfiguration()` returns a valid config with correct type and defaults.
  - Test error case when no active connection exists.
  - Test config is localized (strings use `vscode.l10n.t()`).
- [ ] Create `tests/unit/debug/dap-server.test.ts`:
  - Test `createDAPServer()` accepts valid `ActiveBrowserConnection` and returns server object.
  - Test `server.start()` resolves within timeout.
  - Test `server.stop()` cleans up resources and resolves.
  - Test server throws descriptive error if connection is undefined.
  - Test server listens on expected port (or returns dynamically assigned port).
- [ ] Create `tests/unit/debug/notebook-dap-adapter.test.ts`:
  - Test adapter constructor stores connection reference.
  - Test `onInitialize()` returns capabilities with correct boolean flags.
  - Test `onLaunch()` validates connection and responds.
  - Test `onTerminate()` clears state deterministically.
  - Test error path: if connection is lost, `onLaunch()` rejects with clear error message.
  - Use mock connection object (fake `ActiveBrowserConnection`).
- [ ] Create `tests/integration/debug/dap-session-lifecycle.test.ts` (if integration tests exist in project):
  - Test full lifecycle: config resolve → server start → DAP client connect → initialize → launch → terminate.
  - Verify no orphan processes or sockets remain after cleanup.

### 10. Run Full Validation Suite (AC: 1, 2, 3, 4, 5)

- [ ] Run `npm run lint` — no new warnings or errors.
- [ ] Run `npm run test:unit` — all unit tests pass.
- [ ] Run `npm run compile` — clean TypeScript compilation, no errors.
- [ ] (Manual) In Extension Development Host:
  - [ ] Install extension with F5.
  - [ ] Ensure notebook kernel is selected and browser is connected.
  - [ ] Open Debug view and verify "jupyter-browser-kernel" config appears.
  - [ ] Press F5 to start debugging and observe:
    - [ ] DAP server starts (check logs).
    - [ ] VS Code connects to DAP server and shows "Debugging" state.
    - [ ] Debug controls (pause, step, continue) are available.
  - [ ] Disconnect browser and verify DAP session terminates gracefully with diagnostic message.
  - [ ] Reconnect and verify debug session can restart without reload.

## Dev Notes

### Story Context and Scope

This is the **first story in Epic 10** and establishes the foundation for VS Code native debugging. It focuses on DAP server bootstrap, session lifecycle ownership, and error handling. Subsequent stories (10.2–10.4) implement DAP request handlers for breakpoints, stack frames, stepping, and variable inspection.

**Epic 10 dependencies:**

- **Epic 1 completion (Story 1.6):** Connection state and recovery actions must be stable so the debug adapter can rely on `getActiveBrowserConnection()`.
- **Epic 2 completion (Story 2.4):** Fast rerun patterns establish the execution kernel that the debug adapter will eventually instrument.

**Scope boundary:** This story covers DAP server lifecycle only. Breakpoint binding, frame inspection, variable scoping, and stepping are Stories 10.2–10.4. Dual-client testing is Story 10.5.

### Architecture Guardrails (Must Follow)

- **DAP Protocol Library:** Use `@vscode/debugprotocol` package for DAP types and constants. Do not manually construct DAP payloads; use typed constructors.
- **Layer boundaries:** DAP adapter must NOT import CDP client directly. It communicates with the transport layer via `ActiveBrowserConnection` interface. If new transport methods are needed (e.g., to attach/detach the runtime debugger), add them to the transport layer, not DAP adapter.
- **Session ownership:** One DAP session instance per debug run. Create in response to VS Code `onDidStartDebugSession`. Dispose in response to `onDidTerminateDebugSession` or connection loss. Do NOT maintain a singleton or pool of sessions.
- **Port selection:** For MVP, use a static port (e.g., `5555`) or port `0` with OS auto-assignment. Document the choice in code comments. If multiple debug sessions may run in parallel, switch to dynamic port allocation.
- **Error localization:** All user-facing error messages must use `vscode.l10n.t()`. Add message keys to `l10n/bundle.l10n.json`.
- **No hardcoded strings:** Capabilities, thread names, config defaults must be localized.
- **Logging:** Use the extension's logger (if available in `src/logging/`) to log DAP lifecycle events. Do NOT use `console.log()` directly.
- **Timeouts:** DAP server start should timeout within 5 seconds. Document this as a soft SLA; if exceeded, log a warning but do not fail (allow VS Code to detect and report).

### Testing Strategy

**Unit tests** must mock the `ActiveBrowserConnection` interface to avoid requiring a live browser:

- Create a fake connection object with required properties: `sessionId`, `targetId`, `endpoint`.
- Test error paths (e.g., connection is undefined, connection is invalid).
- Verify DAP adapter state is isolated per session and does not leak between tests.

**Integration tests** (if added later) should:

- Use a real or stubbed CDP endpoint to test end-to-end DAP-to-browser communication.
- Verify that starting two debug sessions in sequence does not cause port conflicts or state pollution.

### Known Unknowns & Future Decisions

1. **Port allocation strategy:** Current plan is static port `5555`. If parallel debug sessions are required, this may need to be revisited.
2. **DAP capabilities set:** The capabilities returned in `onInitialize()` may need to be extended after Stories 10.2–10.4 are implemented based on actual runtime requirements.
3. **Thread abstraction:** Notebook-cell debugging uses a single thread per session. Future multi-cell parallelism may require a thread pool abstraction.

### Related Documentation

- [VS Code Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/)
- [`@vscode/debugprotocol` NPM package](https://www.npmjs.com/package/@vscode/debugprotocol)
- [VS Code Extension API — Debug](https://code.visualstudio.com/api/extension-guides/debugger-extension)
- [docs/architecture.md — Architectural Boundaries](../architecture.md#architectural-boundaries)
- [docs/architecture.md — State Management](../architecture.md#state-management-patterns)
