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

- [ ] In `src/debug/notebook-dap-adapter.ts`, add method `onContinueRequest(args: ContinueArguments): ContinueResponse`.
- [ ] The handler must:
  - Accept `args.threadId` (expect `1` for MVP).
  - Call transport layer `sendDebuggerContinue(sessionId)` (new method).
  - Update internal paused state to `false`.
  - Return a `ContinueResponse` immediately (do NOT wait for runtime to finish execution).
  - The runtime will emit a separate `Debugger.resumed` or `Debugger.paused` event later.
- [ ] Handle error case: if continue fails, log and return error response.

### 2. Implement `next` DAP Request Handler (AC: 2)

- [ ] Add method `onNextRequest(args: NextArguments): void`.
- [ ] The handler must:
  - Accept `args.threadId`.
  - Call transport layer `sendDebuggerStepOver(sessionId)` (new method).
  - Set a flag `awaitingStepCompletion: true` to ensure we don't accept new step commands.
  - Do NOT send a response immediately. Wait for the runtime to pause again.
  - When the runtime pauses (via `Debugger.paused` event), then send `stopped` event to VS Code.
  - Return via the stopped event, not via the initial request response.

### 3. Implement `stepIn` DAP Request Handler (AC: 3)

- [ ] Add method `onStepInRequest(args: StepInArguments): void`.
- [ ] Similar to `onNextRequest()`:
  - Call transport layer `sendDebuggerStepInto(sessionId)` (new method).
  - Set `awaitingStepCompletion: true`.
  - Wait for runtime pause and send `stopped` event.

### 4. Implement `stepOut` DAP Request Handler (AC: 4)

- [ ] Add method `onStepOutRequest(args: StepOutArguments): void`.
- [ ] Similar structure:
  - Call transport layer `sendDebuggerStepOut(sessionId)` (new method).
  - Set `awaitingStepCompletion: true`.
  - Wait for runtime pause and send `stopped` event.

### 5. Add Transport Methods for Stepping Commands (AC: 1–4)

- [ ] Update `src/transport/debugger-interface.ts`:
  - Add method `sendDebuggerContinue(sessionId: string): Promise<void>`:
    - Sends `Debugger.resume` via CDP.
    - Resolves immediately after command is sent.
  - Add method `sendDebuggerStepOver(sessionId: string): Promise<void>`:
    - Sends `Debugger.stepOver` via CDP.
    - Resolves immediately after command is sent.
  - Add method `sendDebuggerStepInto(sessionId: string): Promise<void>`:
    - Sends `Debugger.stepInto` via CDP.
    - Resolves immediately after command is sent.
  - Add method `sendDebuggerStepOut(sessionId: string): Promise<void>`:
    - Sends `Debugger.stepOut` via CDP.
    - Resolves immediately after command is sent.
  - All methods should throw descriptive errors if the command fails.

### 6. Implement Runtime Pause Event Listener (AC: 5, 6)

- [ ] In `NotebookDAPAdapter`:
  - Add a method `onRuntimePaused(reason: "breakpoint" | "step" | "pause" | "entry", location)`:
    1. Validate we are not already in a paused state (prevent duplicate pause events).
    2. If `awaitingStepCompletion` is true, clear the flag.
    3. Query stack trace and update cached frames.
    4. Clear old variable handles.
    5. Emit DAP `stopped` event with:
       - `reason: reason` (e.g., `"step"`, `"breakpoint"`).
       - `threadId: 1`.
       - `text: description` (optional, e.g., `"Paused on line 42"`).
  - Register this callback with the transport layer so it's called when runtime emits `Debugger.paused`.

### 7. Create Event Subscription in Transport Layer (AC: 5, 6)

- [ ] Update `src/transport/debugger-interface.ts` or `src/transport/browser-connect.ts`:
  - Add a method `subscribeToDebuggerEvents(sessionId: string, callbacks)`:
    - Registers a callback object with methods:
      - `onPaused(pauseInfo): void`.
      - `onResumed(): void`.
  - On the underlying CDP client:
    - Listen for `Debugger.paused` events and call `onPaused()` with event data.
    - Listen for `Debugger.resumed` events and call `onResumed()`.
  - Store these listeners so they can be cleaned up when debug session ends.

### 8. Implement Pause Event Queuing (AC: 5)

- [ ] In `NotebookDAPAdapter`:
  - Maintain a `pauseEventQueue: PauseEvent[]` to handle rapid pause events.
  - When a pause event arrives:
    1. If `currentlyProcessing` is false, process immediately.
    2. If `currentlyProcessing` is true, enqueue the event.
  - After processing each event, dequeue and process the next (FIFO).
  - This ensures deterministic ordering and prevents dropped events.

### 9. Handle Step Completion and State Synchronization (AC: 2–4, 5)

- [ ] After each step command:
  - Start a timeout (e.g., 5 seconds) waiting for the runtime to pause again.
  - If timeout expires, log warning but don't crash.
  - If runtime pauses before timeout, process the pause event immediately.
  - If runtime emits error (e.g., execution completed without pausing), emit `terminated` event.

### 10. Test Running-to-Completion Scenario (AC: 6)

- [ ] Handle case where user clicks "Step" but code runs to completion:
  - Runtime will emit `Debugger.paused` with reason `"other"` or similar, or will not emit `paused` at all.
  - Adapter must handle both gracefully.
  - If no pause occurs within timeout, emit `terminated` event to VS Code.

### 11. Add Unit Tests (AC: 1–6)

- [ ] Create `tests/unit/debug/notebook-dap-adapter-stepping.test.ts`:
  - Test `onContinueRequest()` calls transport and updates state.
  - Test `onNextRequest()` sets `awaitingStepCompletion` and waits for pause event.
  - Test `onStepInRequest()` similar to `onNextRequest()`.
  - Test `onStepOutRequest()` similar to `onNextRequest()`.
  - Test error case: stepping fails → error response is returned.
  - Test rapid stepping: queue events properly and maintain order.
  - Test pause event drops after timeout → emit `terminated`.
- [ ] Create `tests/unit/debug/pause-event-queue.test.ts` (if queue is in separate module):
  - Test FIFO ordering of queued pause events.
  - Test processing state flag.
  - Test event dequeuing and processing.
- [ ] Create `tests/integration/debug/stepping-integration.test.ts` (if integration tests exist):
  - Test full stepping cycle: pause → step → receive new pause event → continue.
  - Test rapid stepping with multiple commands in sequence.

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

- **Asynchronous stepping:** Stepping commands return immediately to VS Code; actual pause events come later via `stopped` event. This is correct DAP behavior. Do NOT block waiting for step completion in the request handler.
- **Event ordering:** Use a queue to preserve FIFO ordering of pause events. Do NOT process events out of order or in parallel.
- **State consistency:** The adapter's paused state must always match the runtime's state. If desynchronization is detected (e.g., pause event but state says not paused), log a warning and force resynchronization.
- **Error handling:** If stepping fails, emit an error response. If running-to-completion fails, emit a `terminated` event (not an error).
- **Transport abstraction:** All stepping commands go through transport layer methods. DAP adapter does NOT call CDP directly.
- **Timeout management:** Use a reasonable timeout for step completion (5 seconds is typical). Log warnings if exceeded but don't crash.

### Transport Layer Extensions

```typescript
export async function sendDebuggerContinue(sessionId: string): Promise<void>;
export async function sendDebuggerStepOver(sessionId: string): Promise<void>;
export async function sendDebuggerStepInto(sessionId: string): Promise<void>;
export async function sendDebuggerStepOut(sessionId: string): Promise<void>;

export function subscribeToDebuggerEvents(
  sessionId: string,
  callbacks: {
    onPaused(info: DebuggerPausedInfo): void;
    onResumed(): void;
  },
): Subscription;
```

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
