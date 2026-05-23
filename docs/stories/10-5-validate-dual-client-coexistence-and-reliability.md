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

### 7. Reuse the Existing Headless-Chromium Harness (AC: 6)

- [ ] Do NOT create a new mock CDP server or static HTML file. Reuse [tests/integration/helpers/headless-chromium.ts](../../tests/integration/helpers/headless-chromium.ts), which already launches a real Chromium with the inline test page used by other Epic 1 / Epic 2 / Story 2.5 integration suites.
- [ ] If the existing helper does not expose a hook for evaluating arbitrary scripts in the test page, extend the helper (small, additive) rather than forking a new harness. The single helper is the project's canonical CDP integration entry point.
- [ ] Test pages that need multiple stack frames or scopes are emitted as inline `Runtime.evaluate` strings ending with `//# sourceURL=vscode-notebook-cell://test/<name>.js` so they exercise the real Story 2.4 sourceURL contract.

### 8. Create Deterministic Integration Test Suite (AC: 6)

- [ ] Create `tests/integration/debugger/debugger-lifecycle.integration.test.ts` (gated by `RUN_CDP_INTEGRATION=1`, reuses `tests/integration/helpers/headless-chromium.ts`):
  - Test 1: **Adapter Startup** — spin up the inline DAP adapter against a real connection, drive `initialize` + `launch` through a synthetic DAP client, assert `Debugger.enable` is sent.
  - Test 2: **Breakpoint Binding** — evaluate a script with `//# sourceURL=vscode-notebook-cell://test/lifecycle.js`, send DAP `setBreakpoints`, assert `verified: true` with non-empty `locations[]`.
  - Test 3: **Pause and Inspect** — hit the breakpoint, send DAP `stackTrace` / `scopes` / `variables` / `evaluate`, assert well-formed responses.
  - Test 4: **Stepping Sequence** — next → next → stepIn → stepOut → continue, asserting each `StoppedEvent` arrives at the expected line.
  - Test 5: **Event Ordering** — send three `next` commands back-to-back through the adapter; assert exactly three `StoppedEvent`s in order, no duplicates.
  - Test 6: **Clean Teardown** — `disconnect`, then assert `Debugger.disable` was sent, the per-target session has no remaining `Debugger.paused` listeners, and no `objectId` was leaked (variable store reports zero outstanding handles).

### 9. Dual-Client Coexistence Integration Test (AC: 1–5)

- [ ] Add `tests/integration/debugger/dual-client-coexistence.integration.test.ts` (gated by `RUN_CDP_INTEGRATION=1`, reuses `tests/integration/helpers/headless-chromium.ts`):
  - Open a second flat session against the same browser-level CDP socket (the spike Q3 pattern — see [spike/cdp-multiplex-findings.md](../../spike/cdp-multiplex-findings.md)) to act as the "DevTools" client; do not require an actual `--auto-open-devtools-for-tabs` browser.
  - Assert that resuming on the adapter's session leaves the secondary session free to issue independent `Debugger.pause` and `Debugger.getProperties` calls.
  - Assert that closing the secondary session does not affect the adapter's session (and vice versa).
  - This is the only test that proves the architectural coexistence guarantee in CI; it is not optional.

### 10. CI Integration (AC: 6)

- [ ] No new npm scripts. Reuse the existing `test:integration:cdp` script (or whatever name the headless-chromium harness already exposes) so the new debugger integration tests run alongside Epic 1 / 2 / 6 integration suites.
- [ ] Verify the workspace's existing CI workflow already executes the integration test command behind `RUN_CDP_INTEGRATION=1`. If it does, add no entries; if it does not, surface that gap as a blocker rather than silently bolt on a new workflow file.

### 11. Update the Existing Epic 10 Architecture Addendum (AC: 1–6)

- [ ] Update the existing **"Epic 10 Addendum: Full VS Code Debugging Experience"** section in [docs/architecture.md](../architecture.md). Do NOT create a new top-level architecture section.
  - Promote the coexistence story from "requirement" to "verified by `tests/integration/debugger/dual-client-coexistence.integration.test.ts`".
  - Cross-link the dual-client integration test alongside the spike findings.
  - Note any limitations the integration test surfaces (e.g., DevTools breakpoint markers not appearing for adapter-set breakpoints — that nuance is already in the Debugger Domain Integration section).

### 12. Add Unit Tests (AC: 1–5)

- [ ] `tests/unit/debugger/notebook-dap-adapter-coexistence.test.ts` using the `BrowserDebuggerSession` mock pattern established by Stories 10.1–10.4:
  - Adapter never sends a CDP command without going through `BrowserDebuggerSession`.
  - Disposing the DAP session releases the manager's `onPaused` subscription exactly once and does not call `client.close()`.
  - Connection-lost callback from the manager produces a single `TerminatedEvent` and clears the variable store.
  - Rapid `next`+`next`+`continue` requests serialize through the pause-event-serializer (Story 10.4) and never overlap.

### 13. Validation

- [ ] `npm run lint`.
- [ ] `npm run test`.
- [ ] `npm run test:integration:cdp`.
- [ ] `npm run compile`.
- [ ] Manual smoke (Extension Development Host with real Edge or Chromium):
  - Connect, open browser DevTools (F12) on the same page.
  - Set a breakpoint in VS Code, hit it, confirm DevTools also pauses.
  - Step / continue from VS Code, confirm DevTools state stays coherent.
  - Force-reload the page and confirm both clients terminate gracefully with the localized message from Story 10.1.

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

**Headless Chromium harness (existing):** [tests/integration/helpers/headless-chromium.ts](../../tests/integration/helpers/headless-chromium.ts) is the canonical CDP integration entry point. Story 10.5 extends it (additively) only if it lacks a primitive the new tests need; no parallel mock CDP server, no static HTML fixture file.

**Test scripts:** Inline `Runtime.evaluate` strings carrying `//# sourceURL=vscode-notebook-cell://test/<name>.js`. This guarantees the test exercises the real Story 2.4 source-identity contract.

**Dual-client emulation:** Open a second flat CDP session against the same browser-level WebSocket, per the Spike Q3 pattern documented in [spike/cdp-multiplex-findings.md](../../spike/cdp-multiplex-findings.md). This is identical to how a real DevTools attach behaves and avoids the cost and flake of launching a second browser UI.

### Known Unknowns & Future Decisions

1. **Connection pooling:** If many debug sessions are created in sequence, connection management may need optimization. Currently: one connection per session, dispose on session end.
2. **Event batching:** If events arrive very rapidly, consider batching pause events for efficiency. Currently: process one-by-one.
3. **Stress testing:** Not in scope for MVP. Future: test with hundreds of breakpoints, complex variable trees, etc.

### Related Documentation

- [Chrome DevTools Protocol Session Multiplexing](https://chromedevtools.github.io/devtools-protocol/#protocol---target-domain)
- [docs/architecture.md — Architectural Boundaries](../architecture.md#architectural-boundaries)
- [docs/prd.md — DevTools Coexistence](../prd.md#mvp---core-kernel-scope)
- Prior stories: Epic 10, Stories 10.1–10.4
