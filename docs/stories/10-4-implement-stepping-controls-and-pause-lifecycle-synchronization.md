---
storyId: "10.4"
storyKey: "10-4-implement-stepping-controls-and-pause-lifecycle-synchronization"
title: "Implement Stepping Controls and Pause Lifecycle Synchronization"
status: "backlog"
created: "2026-05-11"
epic: "10"
priority: "p0-blocker"
dependencies:
  [
    "10-1-register-and-bootstrap-notebook-cell-dap-session",
    "10-3-surface-stack-frames-scopes-and-variables-in-vs-code",
  ]
---

# Story 10.4: Implement Stepping Controls and Pause Lifecycle Synchronization

**Status:** backlog

## Story

As a developer,
I want continue, step in, step out, and next to work from VS Code,
So that execution control stays fully in the editor.

## Acceptance Criteria

### AC 1: Continue Button Resumes Execution

**Given** execution is paused at a breakpoint
**When** the user clicks "Continue" in VS Code debug toolbar
**Then** the adapter sends a resume command to the runtime debugger
**And** execution resumes immediately
**And** VS Code receives a `continued` event.

### AC 2: Step Over (Next) Executes One Line

**Given** execution is paused
**When** the user clicks "Step Over" (F10)
**Then** the adapter sends a step-over command to the runtime
**And** execution advances to the next line
**And** execution pauses again automatically
**And** VS Code updates the Call Stack and Variables panes with new state.

### AC 3: Step Into (Step In) Descends Into Function Calls

**Given** execution is paused on a line with a function call
**When** the user clicks "Step Into" (F11)
**Then** the adapter sends a step-into command to the runtime
**And** execution enters the called function (if source available)
**Or** execution steps over if called function is external/built-in
**And** execution pauses at the first line inside the function
**And** VS Code updates the stack frame to show the new frame.

### AC 4: Step Out (Finish) Returns to Caller

**Given** execution is paused inside a function
**When** the user clicks "Step Out" (Shift+F11)
**Then** the adapter sends a step-out command to the runtime
**And** execution continues to the end of the current function
**And** execution pauses at the return point in the caller
**And** VS Code updates the Call Stack to reflect the caller frame.

### AC 5: Event Ordering Remains Deterministic

**Given** rapid stepping events occur (e.g., user presses F10 repeatedly)
**When** the runtime pauses multiple times quickly
**Then** the adapter preserves event order and does not drop or reorder pause events
**And** no duplicate "paused" states appear in VS Code
**And** the adapter waits for each step to complete before accepting the next command (no parallel steps).

### AC 6: Runtime Pause Events Are Reliably Synchronized

**Given** the user does not explicitly pause (e.g., runs to completion)
**When** execution completes or a breakpoint is hit naturally
**Then** the runtime emits a `Debugger.paused` event
**And** the adapter receives and relays it to VS Code
**And** VS Code receives `stopped` event with reason and updated state.

## Tasks / Subtasks

### 1. Implement `continue` DAP Request Handler (AC: 1)

- [ ] In `src/debugger/notebook-dap-adapter.ts`, add `continueRequest(response, args)`.
- [ ] Validate `args.threadId === 1` (notebook execution is single-threaded for MVP).
- [ ] Call `BrowserDebuggerSession.resume()` (already exists from Story 2.5; reused, never bypassed).
- [ ] Mark the session as running, clear cached pause state via the variable store's `clearForPause()` (Story 10.3).
- [ ] Send `ContinuedEvent({ threadId: 1, allThreadsContinued: true })` and resolve the request immediately. The next pause arrives asynchronously through the `Debugger.paused` subscription owned by the session manager (Story 10.1).
- [ ] If `resume()` rejects, return a localized DAP error response and leave the session in its prior state.

### 2. Implement `next` / `stepIn` / `stepOut` DAP Request Handlers (AC: 2, 3, 4)

- [ ] Add `nextRequest`, `stepInRequest`, `stepOutRequest`. Each handler:
  - Validates `args.threadId === 1`.
  - Calls the matching method on `BrowserDebuggerSession` (Task 5): `stepOver`, `stepInto`, or `stepOut`.
  - Clears cached pause state via `clearForPause()`.
  - Sends `ContinuedEvent` and resolves the request immediately.
  - Sets an internal `awaitingStepCompletion = true` flag (consumed by Task 8 to suppress duplicate `stopped` events).
- [ ] CDP does not have a `Debugger.resumed` event. The adapter relies entirely on the next `Debugger.paused` event (or session termination) as the signal that the step is complete.

### 5. Extend `BrowserDebuggerSession` for Stepping (AC: 1–4)

- [ ] Extend `BrowserDebuggerSession` in [src/transport/browser-connect.ts](../../src/transport/browser-connect.ts) (no new transport file). Add the three step methods alongside the existing `resume()`:
  - `stepOver(params?: ProtocolMappingApi.Commands["Debugger.stepOver"]["paramsType"][0]): Promise<void>` — wraps `Debugger.stepOver`.
  - `stepInto(params?: ProtocolMappingApi.Commands["Debugger.stepInto"]["paramsType"][0]): Promise<void>` — wraps `Debugger.stepInto`.
  - `stepOut(): Promise<void>` — wraps `Debugger.stepOut`.
- [ ] Each method sends the command on the per-target session and resolves on the CDP ack (no waiting for `Debugger.paused`).
- [ ] Update [tests/unit/transport/browser-connect.test.ts](../../tests/unit/transport/browser-connect.test.ts) with forwarding tests for each method.

### 6. Consume `Debugger.paused` From the Session Manager (AC: 5, 6)

- [ ] The session manager (Story 10.1) is the sole subscriber to `BrowserDebuggerSession.onPaused`. Story 10.4 adds a typed `onPaused(handler)` registration on the session manager that the adapter uses to receive parsed pause events.
- [ ] Adapter `handlePaused(payload)`:
  1. Cache `payload.callFrames` for Story 10.3.
  2. Map `payload.reason` (`"other"`, `"step"`, `"breakpoint"`, `"exception"`, `"OOM"`, etc.) to the DAP `stopped` reason vocabulary (`"step"`, `"breakpoint"`, `"exception"`, `"pause"`, `"entry"`).
  3. If `awaitingStepCompletion` is true, override the reason to `"step"` regardless of CDP's value, then clear the flag.
  4. Emit `StoppedEvent({ reason, threadId: 1, allThreadsStopped: true, hitBreakpointIds: payload.hitBreakpoints })`.
- [ ] There is no `Debugger.resumed` event to subscribe to — CDP does not emit one. Resume is observable only via the next `Debugger.paused` or session termination.

### 7. Pause Subscription Lifecycle (AC: 5, 6)

- [ ] Subscription is owned by the session manager (Story 10.1) for the lifetime of the DAP session and disposed on `terminate`/`disconnect`. Story 10.4 only registers the adapter's handler with the manager, never with `BrowserDebuggerSession.onPaused` directly.

### 8. Pause Event Serialization (AC: 5)

- [ ] Create `src/debugger/pause-event-serializer.ts` exporting `createPauseEventSerializer({ adapter })`.
- [ ] Internally guard with a single in-flight Promise: each incoming `Debugger.paused` payload is appended to a queue; the serializer awaits the previous handler before invoking the next so `StoppedEvent`s are emitted in CDP arrival order.
- [ ] Drop duplicate consecutive payloads with identical `(reason, hitBreakpoints, top callFrame.location)` to defend against CDP retries.
- [ ] Step commands (Task 2) are queued through the same serializer so the adapter never has two outstanding step requests against V8.

### 9. Step Completion Without a Pause (AC: 2–5, 6)

- [ ] No client-side timeout. If the program runs to completion after a step, V8 will not send another `Debugger.paused`. Termination is observed independently:
  - A target detached / connection lost event from the transport surfaces a DAP `terminated` event via the session manager (Story 10.1).
  - Without termination and without pause, the session legitimately stays in the running state — VS Code's UI handles this correctly.
- [ ] Do NOT introduce a synthetic timeout that emits `terminated`; that would race with normal long-running scripts.

### 10. Pause Capability Hardening (AC: 6)

- [ ] Update Story 10.1's `initialize` capability set to enable `supportsRestartFrame: false`, `supportsStepBack: false`, `supportsTerminateThreadsRequest: false`. Stepping is implicitly supported — no DAP capability flag is required for `next`/`stepIn`/`stepOut`/`continue`.
- [ ] Optional explicit `pause` request (DAP `pauseRequest`) calls `client.send("Debugger.pause", ..., sessionId)` via a new `BrowserDebuggerSession.pause()` method (add alongside step methods in Task 5). On success, the next `Debugger.paused` becomes the user-initiated pause.

### 11. Add Unit Tests (AC: 1–6)

- [ ] `tests/unit/debugger/notebook-dap-adapter-stepping.test.ts`: each of `continue`/`next`/`stepIn`/`stepOut` calls the matching `BrowserDebuggerSession` method exactly once, emits `ContinuedEvent`, and resolves immediately; failure paths return localized DAP errors.
- [ ] `tests/unit/debugger/pause-event-serializer.test.ts`: rapid pause arrivals are emitted in order; duplicate consecutive payloads collapse; step + pause interleaving never overlaps two handlers.
- [ ] `tests/unit/debugger/notebook-dap-adapter-paused.test.ts`: `awaitingStepCompletion` flag overrides CDP reason to `"step"`; CDP `"breakpoint"` reason maps verbatim with `hitBreakpointIds` populated; `"exception"` maps to `"exception"`.
- [ ] `tests/unit/transport/browser-connect.test.ts` (update): forwarding tests for `stepOver`/`stepInto`/`stepOut`/`pause`.

### 12. Run Full Validation Suite (AC: 1–6)

- [ ] Run `npm run lint` — no new warnings.
- [ ] Run `npm run test:unit` — all tests pass.
- [ ] Run `npm run compile` — clean compilation.
- [ ] (Manual) In Extension Development Host:
  - [ ] Set breakpoint in notebook cell.
  - [ ] Run cell and pause at breakpoint.
  - [ ] Click "Continue" and verify execution resumes.
  - [ ] Set breakpoint again, pause, and verify "Step Over" advances one line.
  - [ ] Verify "Step Into" descends into a function call (if applicable).
  - [ ] Verify "Step Out" returns to caller.
  - [ ] Test rapid stepping (press F10 multiple times quickly) and verify no drops or reordering.
  - [ ] Verify VS Code Call Stack and Variables update after each step.

## Dev Notes

### Story Context and Scope

This is the **fourth story in Epic 10** and focuses on execution control (stepping) and pause-event synchronization. It builds on prior stories' DAP foundation and frame/variable resolution.

**Scope boundary:** This story covers stepping and pause events. Conditional stepping and breakpoint conditions are deferred. Reverse execution (debugger reversing) is not in scope for any MVP plan.

### Architecture Guardrails (Must Follow)

- **No `Debugger.resumed`.** The CDP `Debugger` domain does not emit a `resumed` event. The DAP `ContinuedEvent` is sent by the adapter immediately after issuing the resume/step command. The next observable runtime event is either `Debugger.paused` or session termination.
- **Asynchronous stepping.** Stepping requests resolve immediately; the next `StoppedEvent` arrives asynchronously through the session manager's `Debugger.paused` subscription.
- **Single transport surface.** All stepping commands go through `BrowserDebuggerSession` (extended in Task 5). No `src/transport/debugger-interface.ts`. No direct `client.send("Debugger.*", ...)` outside `src/transport/`.
- **Folder is `src/debugger/`.** Created by Story 2.5, owned by Epic 10.
- **Event ordering.** Pause events and step requests are funneled through `pause-event-serializer.ts` so the adapter never has two outstanding handlers.
- **No client-side step timeout.** A step that completes without pausing simply leaves the session running until the program ends or a breakpoint is hit; termination is signaled by transport, not by a synthetic timer.
- **Localization.** All error messages via `vscode.l10n.t()` keyed in `l10n/bundle.l10n.json`.

### Transport Layer Extensions

Add to `BrowserDebuggerSession` in [src/transport/browser-connect.ts](../../src/transport/browser-connect.ts):

```typescript
export interface BrowserDebuggerSession {
  // ...existing members from Story 2.5 / 10.1 / 10.2 / 10.3...
  stepOver(
    params?: ProtocolMappingApi.Commands["Debugger.stepOver"]["paramsType"][0],
  ): Promise<void>;
  stepInto(
    params?: ProtocolMappingApi.Commands["Debugger.stepInto"]["paramsType"][0],
  ): Promise<void>;
  stepOut(): Promise<void>;
  pause(): Promise<void>; // optional, for explicit DAP pauseRequest
}
```

`resume()` is already exposed by Story 2.5; the adapter reuses it for `continueRequest`.

### Known Unknowns & Future Decisions

1. **Reverse execution:** Not in scope. DAP supports reverse stepping; CDP runtime does not natively. If reverse debugging is required, it requires specialized support (recording execution or alternative runtimes).
2. **Instruction-level stepping:** CDP supports line-level stepping. Instruction-level stepping is deferred.
3. **Continue to line:** VS Code supports "Continue to Line" (right-click on line). This requires setting a temporary breakpoint, then continuing. Deferred as enhancement.
4. **Pause on exception:** Currently, pause is only at breakpoints or after user-triggered steps. Pause-on-exception is deferred.

### Related Documentation

- [DAP continue specification](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_Continue)
- [DAP next specification](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_Next)
- [DAP stepIn specification](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_StepIn)
- [DAP stepOut specification](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_StepOut)
- [DAP stopped event specification](https://microsoft.github.io/debug-adapter-protocol/specification#Events_Stopped)
- [CDP Debugger.resume](https://chromedevtools.github.io/devtools-protocol/tot/Debugger/#method-resume)
- [CDP Debugger.stepOver](https://chromedevtools.github.io/devtools-protocol/tot/Debugger/#method-stepOver)
- [CDP Debugger.stepInto](https://chromedevtools.github.io/devtools-protocol/tot/Debugger/#method-stepInto)
- [CDP Debugger.stepOut](https://chromedevtools.github.io/devtools-protocol/tot/Debugger/#method-stepOut)
