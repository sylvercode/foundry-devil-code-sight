# Manual Test Plan - Story 10.2

## Purpose

Validate notebook-cell breakpoint behavior in VS Code for Story 10.2:

- Breakpoints can be set from notebook gutters.
- Breakpoints are bound through the Browser Kernel debug adapter.
- Breakpoint state stays synchronized as users add/remove/toggle.
- Failures are reported clearly and do not fail whole batches.
- Conditional breakpoints are forwarded.
- Breakpoints survive cell reruns without duplicate runtime bindings.

## Scope

In scope:

- Story 10.2 acceptance criteria AC1-AC6.
- Manual end-to-end behavior from notebook editor to pause/resume.

Out of scope:

- Full variable/scopes UX depth (Story 10.3+).
- Advanced stepping semantics (Story 10.4+).

## Environment

Required:

- Extension built and installed in Extension Development Host.
- Browser Kernel connected to a browser target matching /game.
- A notebook with JavaScript code cells.
- Debug config type: jupyter-browser-kernel.

Recommended:

- Keep Browser Kernel output logs visible.
- Use a clean browser profile to reduce unrelated scripts.

## Test Data Setup

Create one notebook cell with predictable executable lines:

```javascript
const x = 1;
const y = x + 1;
const z = y + 1;
z;
```

Also prepare variants:

- A blank line and comment-only line for non-bindable breakpoint checks.
- A conditional scenario where x can be changed between runs.

## Entry Criteria

- Browser connection state is Connected.
- Debug session can launch successfully.
- Cell execution works without breakpoints.

## Test Cases

### TC-1: Set breakpoint in notebook gutter (AC1)

Steps:

- Open notebook cell in editor.
- Start debug session.
- Click gutter on an executable line.
- Press F9 on another executable line.

Expected:

- Breakpoint marker appears/toggles in gutter.
- Breakpoint UI state updates immediately.

Pass/Fail: [x] Pass [ ] Fail
Notes:

> If the cell was never run, the breakpoint is unboud. If the breakpoint exists before first run, the breakpoint is still unboud.

---

### TC-2: Runtime binding and verify behavior (AC2)

Steps:

- Set one breakpoint on an executable line.
- Run the cell.
- Continue execution after pause.

Expected:

- Execution pauses at breakpoint line.
- Continue resumes normally.
- Breakpoint is treated as verified by adapter/runtime behavior.

Pass/Fail: [X] Pass [ ] Fail
Notes:

> If the browser is launch by the same vscode that we will run the jupyter cell and debug, the breakpoin is catch but by the browser debug adpter, not our. If the browser is lauch by another vscode, it that browser debug adatper that catch the breakpoint. A temporary file is open with the sent code to the browser. Unbound breakpoint from TC-1 are still catched.

---

### TC-3: Full-state synchronization on add/remove/toggle (AC3)

Steps:

- Set breakpoints on lines A, B, C.
- Change state to A, C, D (remove B, add D).
- Rerun cell multiple times.
- Toggle one line on/off/on and rerun.

Expected:

- Pauses occur only on final active set.
- Removed breakpoint line B no longer pauses.
- No stale breakpoint behavior persists.

Pass/Fail: [x] Pass [ ] Fail
Notes:

---

### TC-4: Per-breakpoint failure handling (AC4)

Steps:

- Set one breakpoint on blank/comment line and one on executable line.
- Run the cell.

Expected:

- Non-bindable breakpoint is reported as unverified.
- Clear user-facing failure message is shown.
- Valid breakpoint still works.
- Batch request completes (no global failure).

Pass/Fail: [x] Pass [ ] Fail
Notes:

> breakpoint are placed on next valid line (vscode behavior)

---

### TC-5: Conditional, logpoint, and hit-condition behavior (AC5)

Steps:

- Set conditional breakpoint (x > 10) where condition is false.
- Run cell (expect no pause).
- Change code/data so condition is true and rerun.
- Add logpoint and hit-count breakpoint in UI.
- Run again.

Expected:

- Condition is respected for conditional breakpoint.
- Logpoint/hit-count entries are accepted for MVP path.
- Informational message indicates deferred support semantics.

Pass/Fail: [ ] Pass [X] Fail
Notes:

> Uncaught ReferenceError ReferenceError: Cannot access 'y1' before initialization

---

### TC-6: Breakpoint survives reruns without duplication (AC6)

Steps:

- Set and confirm one working breakpoint.
- Run cell, continue.
- Rerun same cell multiple times without changing breakpoints.

Expected:

- Breakpoint continues to hit on reruns.
- No duplicate runtime bindings (no extra duplicate pauses caused by duplicated breakpoints).

Pass/Fail: [x] Pass [ ] Fail
Notes:

---

### TC-7: Teardown and reconnect safety

Steps:

- With active breakpoints, disconnect/terminate debug session.
- Reconnect and relaunch.
- Run cell again.

Expected:

- Session terminates cleanly.
- Reconnect succeeds.
- Breakpoint behavior is clean (no leaked/stale state from prior session).

Pass/Fail: [x] Pass [ ] Fail
Notes:

> old break point works (but TC-1 behavior)

## Regression Spot Checks

- DAP lifecycle still works: initialize -> launch -> threads -> disconnect.
- Cell execution without breakpoints remains unchanged.
- Connection-lost path terminates session cleanly.

## Exit Criteria

- All test cases pass, or failures are logged with reproducible steps.
- No blocking regressions remain in core debug lifecycle.

## Defect Capture Template

- ID:
- Test Case:
- Environment:
- Steps to Reproduce:
- Expected:
- Actual:
- Logs/Screenshots:
- Severity:

## Sign-Off

- Tester:
- Date:
- Result: [ ] Pass [ ] Fail
- Follow-ups:
