---
storyId: "10.5"
storyKey: "10-5-validate-dual-client-coexistence-and-reliability"
title: "Validate Dual-Client Coexistence and Reliability"
status: "backlog"
created: "2026-05-11"
epic: "10"
priority: "p0-blocker"
dependencies:
  [
    "10-1-register-and-bootstrap-notebook-cell-dap-session",
    "10-2-verify-and-bind-notebook-cell-breakpoints-in-vs-code-ui",
    "10-3-surface-stack-frames-scopes-and-variables-in-vs-code",
    "10-4-implement-stepping-controls-and-pause-lifecycle-synchronization",
  ]
---

# Story 10.5: Validate Dual-Client Coexistence and Reliability

**Status:** backlog

## Story

As a developer,
I want VS Code debugging to coexist with browser DevTools attachments,
So that advanced debugging tools can run side-by-side without deadlock or forced disconnect behavior.

## Acceptance Criteria

### AC 1: Both Clients Can Inspect Breakpoints Simultaneously

**Given** VS Code debug session and browser DevTools are both attached to the same target
**When** a breakpoint is hit in VS Code
**Then** DevTools also receives the pause event
**And** both clients can inspect the call stack and variables independently
**And** neither client forces the other to disconnect.

### AC 2: Stepping Commands Are Reliable with Dual Clients

**Given** both VS Code and DevTools are paused at a breakpoint
**When** the user steps in VS Code (or DevTools)
**Then** both clients remain synchronized
**And** both pause again at the new location
**And** no deadlock or hung connection state occurs.

### AC 3: Resume Is Consistent Across Clients

**Given** both clients are paused
**When** the user resumes in VS Code (or DevTools)
**Then** execution continues for both clients
**And** both receive resumed events
**And** no out-of-sync state persists.

### AC 4: Adapter Handles Rapid Command Sequences

**Given** both VS Code and DevTools are issuing debugging commands rapidly (e.g., stepping in both simultaneously)
**When** commands are processed
**Then** adapter prioritizes commands correctly or queues them gracefully
**And** no commands are lost or cause hangs.

### AC 5: Connection Loss Is Handled Predictably

**Given** both clients are active
**When** the browser connection is lost
**Then** both the VS Code DAP session and DevTools connection are terminated gracefully
**And** clear error messages guide the user to reconnect.

### AC 6: Deterministic Fixture Tests Validate Full Lifecycle

**Given** automated test fixtures for the debugger
**When** CI validation runs
**Then** test coverage includes:

- Adapter startup with connection validation.
- Breakpoint binding against a static HTML target.
- Paused-state inspection (frames, variables, watches).
- Stepping (continue, next, step-in, step-out).
- Pause/resume cycles with proper event ordering.
- Clean teardown with no orphan sockets or references.
  **And** tests pass consistently without flakiness.

## Tasks / Subtasks

### 1. Audit DAP Adapter for Coexistence Issues (AC: 1–3)

- [ ] Review `NotebookDAPAdapter` implementation (from Stories 10.1–10.4):
  - Verify that all CDP commands use `sessionId` parameter (multiplexed sessions).
  - Ensure breakpoint tracking is per-session, not global.
  - Verify that pause/resume events are correctly delivered to both clients without interference.
  - Check that adapter does NOT close the CDP client or disconnect DevTools on session end.
- [ ] Document findings in code comments for future maintainers.

### 2. Implement Strict Event Ordering in Pause Handler (AC: 2, 4)

- [ ] In `NotebookDAPAdapter.onRuntimePaused()`:
  - Verify that pause events from the runtime debugger are processed sequentially.
  - If two pause events arrive in rapid succession (e.g., breakpoint pause, then step pause):
    1. Process the first pause completely (update frames, clear variable handles).
    2. Queue the second pause.
    3. Dequeue and process after the first is complete.
  - Use the pause event queue implemented in Story 10.4.
  - Log queue depth warnings if queue grows beyond expected size (e.g., > 10 items).

### 3. Validate Breakpoint State Consistency (AC: 1)

- [ ] Create test scenario:
  - Set a breakpoint in VS Code debug session.
  - Verify breakpoint is set in runtime via CDP.
  - Attach DevTools to the same target.
  - Verify DevTools also sees the breakpoint.
  - Hit the breakpoint and verify both clients pause.
  - Add a second breakpoint in DevTools.
  - Verify VS Code sees the new breakpoint.
  - Remove the breakpoint in VS Code.
  - Verify DevTools sees the removal.
- [ ] Implement unit test that simulates these operations with mock CDP client.

### 4. Test Stepping with Dual Clients (AC: 2)

- [ ] Create test scenario:
  - Pause at breakpoint with both clients attached.
  - Send step command from VS Code.
  - Verify DevTools receives corresponding pause event.
  - Send step command from DevTools.
  - Verify VS Code receives corresponding pause event.
  - Verify no deadlock or duplicate pause events.
- [ ] Use mock CDP client that emulates multi-client behavior.
- [ ] Test with rapid stepping: send 10 step commands in sequence and verify all are processed.

### 5. Test Resume Consistency (AC: 3)

- [ ] Create test scenario:
  - Pause at breakpoint with both clients.
  - Send resume from VS Code.
  - Verify DevTools receives resumed event.
  - Pause again (at next breakpoint or user-triggered).
  - Send resume from DevTools.
  - Verify VS Code receives resumed event.
- [ ] Verify internal adapter state matches external client state (no desynchronization).

### 6. Test Connection Loss Handling (AC: 5)

- [ ] Create test scenario:
  - Establish both VS Code and DevTools connections.
  - Verify both are active.
  - Simulate connection loss (e.g., close CDP WebSocket).
  - Verify DAP session terminates with clear reason.
  - Verify no orphan sockets or handles remain.
  - Verify error message is displayed to user with reconnect guidance.
- [ ] Test with connection loss at different points in debug lifecycle:
  - Connection lost during stepping.
  - Connection lost while variables are being resolved.
  - Connection lost immediately after breakpoint hit.

### 7. Create Static HTML Test Fixture (AC: 6)

- [ ] Create `tests/fixtures/debug-target.html`:
  - Simple HTML file with JavaScript code for debugging.
  - Includes functions for testing step-in, step-out, and variable inspection.
  - Example:

    ```javascript
    function outer() {
      let x = 42;
      inner(x);
      return x;
    }

    function inner(val) {
      let y = val + 1;
      return y;
    }

    outer();
    ```

  - Accessible via local HTTP server or file:// URL during tests.

### 8. Create Deterministic Integration Test Suite (AC: 6)

- [ ] Create `tests/integration/debug/debugger-lifecycle.test.ts`:
  - Test 1: **Adapter Startup**
    - Verify adapter initializes without errors.
    - Verify DAP server starts and VS Code can connect.
  - Test 2: **Breakpoint Binding**
    - Set breakpoint at a line in test fixture.
    - Verify runtime accepts breakpoint.
    - Verify breakpoint is verified.
  - Test 3: **Pause and Inspect**
    - Hit breakpoint.
    - Query stack frames, scopes, variables.
    - Verify responses are well-formed and complete.
  - Test 4: **Stepping Sequence**
    - Pause at breakpoint.
    - Execute: next → next → step-in → step-out → continue.
    - Verify each step pauses at expected location.
  - Test 5: **Event Ordering**
    - Send rapid stepping commands.
    - Verify pause events are delivered in correct order.
    - Verify no events are dropped.
  - Test 6: **Clean Teardown**
    - End debug session.
    - Verify all resources are disposed.
    - Verify no sockets remain open.
    - Verify no memory leaks in event listeners.

### 9. Add Mock CDP Server for Testing (AC: 1–6)

- [ ] Create `tests/fixtures/mock-cdp-server.ts`:
  - Implement a mock CDP server that:
    - Accepts WebSocket connections (simulating multiple clients).
    - Emulates breakpoint setting/removal.
    - Emulates pause/resume events.
    - Supports stepping commands.
    - Supports frame/variable queries.
  - Use for integration tests without requiring a real browser.

### 10. Implement CI Test Validation (AC: 6)

- [ ] Add npm script in `package.json`:
  - `"test:debug-integration"`: Runs integration tests for debugger.
  - `"test:all"`: Includes debug integration tests.
- [ ] Update CI workflow (if exists):
  - Add step to run `npm run test:debug-integration`.
  - Fail CI if tests do not pass.

### 11. Document Coexistence Guarantees (AC: 1–6)

- [ ] Add section to `docs/architecture.md`:
  - Title: **Debug Adapter Coexistence with DevTools**
  - Content:
    - Explain multi-client session multiplexing via CDP.
    - Document that both clients share the same pause/resume state.
    - Explain event ordering guarantees.
    - Explain limitations (if any) of dual-client debugging.
    - Link to troubleshooting guidance.

### 12. Add Unit Tests (AC: 1–5)

- [ ] Create `tests/unit/debug/notebook-dap-adapter-coexistence.test.ts`:
  - Test breakpoint state consistency with mock dual-client CDP.
  - Test stepping with dual clients.
  - Test resume consistency.
  - Test command queuing with rapid commands.
  - Test connection loss handling.
  - Use mock CDP client that simulates multi-client behavior.

### 13. Run Full Validation Suite (AC: 1–6)

- [ ] Run `npm run lint` — no new warnings.
- [ ] Run `npm run test:unit` — all tests pass.
- [ ] Run `npm run test:debug-integration` — all integration tests pass.
- [ ] Run `npm run compile` — clean compilation.
- [ ] (Manual) In Extension Development Host with real browser:
  - [ ] Start VS Code debug session connected to browser.
  - [ ] Open browser DevTools on same page (F12).
  - [ ] Set breakpoint in VS Code.
  - [ ] Run code and hit breakpoint.
  - [ ] Verify both VS Code and DevTools show breakpoint paused state.
  - [ ] Step in VS Code and verify DevTools updates.
  - [ ] Step in DevTools and verify VS Code updates.
  - [ ] Resume in VS Code and verify DevTools continues.
  - [ ] Reload page (connection loss scenario).
  - [ ] Verify both clients handle disconnection gracefully.
  - [ ] Reconnect and verify debug session restarts without issues.

## Dev Notes

### Story Context and Scope

This is the **fifth and final story in Epic 10** and validates the complete epic against the key architectural requirement: DevTools coexistence. It performs comprehensive testing and documentation of the debugger adapter's reliability and multi-client support.

**Epic completion:** After this story, Epic 10 is considered done. Users can use VS Code native debugging with breakpoints, stepping, variable inspection, and watch evaluation, while maintaining browser DevTools compatibility.

**Future work:** Post-MVP debugging enhancements (reverse execution, pause-on-exception, logpoints) are deferred to later epics.

### Architecture Guardrails (Must Follow)

- **Session multiplexing:** The adapter must NOT interfere with DevTools or other CDP clients. Use `sessionId` consistently to isolate sessions.
- **Event ordering:** Pause/resume events must be processed deterministically. Never drop or reorder events.
- **State consistency:** The adapter's internal state must never desynchronize from the runtime state. If desynchronization is detected, it's a critical bug.
- **Error recovery:** Connection loss must not leave orphan state. Cleanup must be deterministic and complete.
- **Testing:** Integration tests must be deterministic and not flaky. Use fixtures and mocks to avoid real-browser dependencies.

### Test Infrastructure

**Mock CDP Server:**
The mock server is critical for reliable, fast integration testing. It should:

- Emulate all CDP commands used by the debugger (setBreakpoint, pause, resume, stepOver, etc.).
- Support simultaneous connections (multiple clients).
- Emit realistic events (paused, resumed, breakpointResolved).
- Expose hooks for test control (e.g., trigger pause on next command).

**Test Fixtures:**

- Static HTML file with debuggable JavaScript.
- Must be runnable in headless environments (CI).
- Should include multiple functions and scopes for comprehensive testing.

### Known Unknowns & Future Decisions

1. **Connection pooling:** If many debug sessions are created in sequence, connection management may need optimization. Currently: one connection per session, dispose on session end.
2. **Event batching:** If events arrive very rapidly, consider batching pause events for efficiency. Currently: process one-by-one.
3. **Stress testing:** Not in scope for MVP. Future: test with hundreds of breakpoints, complex variable trees, etc.

### Related Documentation

- [Chrome DevTools Protocol Session Multiplexing](https://chromedevtools.github.io/devtools-protocol/#protocol---target-domain)
- [docs/architecture.md — Architectural Boundaries](../architecture.md#architectural-boundaries)
- [docs/prd.md — DevTools Coexistence](../prd.md#mvp---core-kernel-scope)
- Prior stories: Epic 10, Stories 10.1–10.4
