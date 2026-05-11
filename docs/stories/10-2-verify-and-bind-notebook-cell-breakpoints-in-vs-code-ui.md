---
storyId: "10.2"
storyKey: "10-2-verify-and-bind-notebook-cell-breakpoints-in-vs-code-ui"
title: "Verify and Bind Notebook-Cell Breakpoints in VS Code UI"
status: "backlog"
created: "2026-05-11"
epic: "10"
priority: "p0-blocker"
dependencies: ["10-1-register-and-bootstrap-notebook-cell-dap-session"]
---

# Story 10.2: Verify and Bind Notebook-Cell Breakpoints in VS Code UI

**Status:** backlog

## Story

As a developer,
I want notebook-cell gutter breakpoints to be verified and bound by the adapter,
So that breakpoint state in VS Code matches actual runtime behavior.

## Acceptance Criteria

### AC 1: Breakpoints Can Be Set in Notebook-Cell Gutter

**Given** a notebook cell is open in the editor
**When** the user clicks the gutter (or presses F9) on a line in the cell
**Then** a breakpoint is displayed as a red dot in the gutter
**And** VS Code sends a `setBreakpoints` DAP request to the adapter.

### AC 2: Adapter Translates Breakpoints to Runtime Debugger

**Given** a `setBreakpoints` request with line numbers
**When** the adapter receives the request
**Then** the adapter maps notebook-cell source lines to runtime debugger breakpoints
**And** the adapter sends `Debugger.setBreakpoint` (or equivalent) to the runtime debugger via transport
**And** verified breakpoint responses include accurate line and column mapping.

### AC 3: Breakpoint State Stays Synchronized

**Given** breakpoints are set and debug session is active
**When** the user adds, removes, enables, or disables a breakpoint
**Then** the adapter receives a new `setBreakpoints` request immediately
**And** the runtime debugger is updated to reflect the change
**And** stale breakpoints are removed from the runtime.

### AC 4: Breakpoint Verification Failures Are Clear

**Given** a breakpoint cannot be set at a requested line
**When** the runtime debugger rejects the breakpoint
**Then** the adapter marks the breakpoint as `verified: false` with reason
**And** the breakpoint gutter shows an unfilled or grayed-out dot
**And** VS Code displays a hover tooltip explaining why (e.g., "Not a valid breakpoint location").

### AC 5: Conditional Breakpoints Are Parsed (MVP Scope Minimal)

**Given** a user tries to set a conditional breakpoint
**When** the condition is passed to the adapter
**Then** the adapter accepts the condition string and includes it in the `setBreakpoint` call (if supported by runtime)
**Or** the adapter accepts it silently and treats it as a regular breakpoint (deferred support).

## Tasks / Subtasks

### 1. Implement `setBreakpoints` DAP Request Handler (AC: 1, 2)

- [ ] In `src/debug/notebook-dap-adapter.ts`, add method `onSetBreakpoints(args: SetBreakpointsArguments): SetBreakpointsResponse`.
- [ ] The handler must:
  - Extract source file path from `args.source` (for notebook sources, use a special naming convention, e.g., `"notebook://cellId:line"`).
  - Extract line numbers from `args.breakpoints` (array of `{ line, column }` objects).
  - For each breakpoint:
    1. Map the notebook-cell line number to the actual runtime source location (determined by how source maps are handled; see Dev Notes).
    2. Call `evaluateDebuggerSetBreakpoint(line, column)` on the transport layer (new method to add).
    3. Collect responses.
  - Return a `SetBreakpointsResponse` with an array of verified breakpoint objects.
  - Each breakpoint object must include:
    - `verified: boolean` (true if runtime accepted it, false otherwise).
    - `line: number` (the line that the runtime accepted, may differ from requested).
    - `source: Source` (the source file).
    - Optional `message: string` (reason if not verified).

### 2. Create Breakpoint Source Mapping Layer (AC: 2, 4)

- [ ] Create `src/debug/source-mapper.ts`:
  - Implement `NotebookSourceMapper` class that:
    - Converts notebook-cell source lines to runtime source locations.
    - Maintains a mapping of breakpoints: `Map<sourceId, Breakpoint[]>`.
    - Provides methods:
      - `registerNotebookCell(cellId, sourceCode)`: Record a cell's source.
      - `mapBreakpoint(cellId, line)`: Return runtime line number for a cell line.
      - `unmapBreakpoint(runtimeLine)`: Return notebook cell line (reverse mapping).
      - `clearCell(cellId)`: Remove all breakpoints for a cell.
    - **For MVP:** Assume 1:1 line mapping (notebook line N = runtime line N). This is valid since each cell is evaluated as a standalone script.
    - **Future:** Replace with proper source-map handling if cells are bundled or transpiled.

### 3. Add Transport Interface for Debugger Commands (AC: 2)

- [ ] Update `src/transport/browser-connect.ts` or create `src/transport/debugger-interface.ts`:
  - Add method `evaluateDebuggerSetBreakpoint(line: number, column: number): Promise<SetBreakpointResult>`:
    - Accepts a line and column number.
    - Sends `Debugger.setBreakpoint` request to the runtime debugger via CDP.
    - Returns result with `breakpointId`, `actualLine`, `actualColumn`, and any error message.
  - Add method `evaluateDebuggerRemoveBreakpoint(breakpointId: string): Promise<void>`:
    - Accepts a breakpoint ID.
    - Sends `Debugger.removeBreakpoint` request.
    - Resolves when removed.
  - **Keep CDP client reference internal to transport.** DAP adapter calls these methods, not CDP directly.

### 4. Track Active Breakpoints in Debug Session (AC: 1, 3)

- [ ] In `NotebookDAPAdapter`, add a breakpoint store:
  - `private breakpointsBySource: Map<string, DAP.Breakpoint[]>`.
  - In `onLaunch()`, initialize the store.
  - In `onSetBreakpoints()`:
    1. Retrieve breakpoints currently set for the source.
    2. Find breakpoints that are in `args.breakpoints` but not in the current set → ADD these to runtime.
    3. Find breakpoints in the current set but not in `args.breakpoints` → REMOVE these from runtime.
    4. Update the store with the new breakpoint list.
    5. Return verified responses.

### 5. Handle Breakpoint Removal and Sync (AC: 3, 4)

- [ ] In `onSetBreakpoints()`:
  - For each breakpoint to remove:
    1. Extract the breakpoint ID (stored when added).
    2. Call transport's `evaluateDebuggerRemoveBreakpoint(id)`.
    3. Verify removal succeeds; if it fails, log a warning but continue.
  - Return updated breakpoint state to VS Code.
  - VS Code will update its UI based on the response (verified status, line number).

### 6. Implement Breakpoint Location Resolution (AC: 4)

- [ ] Create `src/debug/breakpoint-resolver.ts`:
  - Implement `validateBreakpointLocation(source, line): BreakpointValidation`:
    - For now, always return `{ valid: true }` for MVP (all lines are valid locations in a single-cell context).
    - In future stories, enhance to detect unreachable lines, function definitions, etc.
  - Use this in `onSetBreakpoints()` to pre-validate before sending to runtime.
  - If invalid, return `verified: false` with a clear reason message.

### 7. Handle Conditional Breakpoints (AC: 5)

- [ ] In `onSetBreakpoints()`:
  - Check if `args.breakpoints[i].condition` is set.
  - If condition exists:
    - Include it in the `Debugger.setBreakpoint` call if the runtime supports conditions.
    - If not supported in runtime, log a warning and treat as unconditional breakpoint.
    - For MVP, conditions are optional; accept silently without full evaluation support (deferred to Story 10.3).
  - Store the condition in the breakpoint object for reference.

### 8. Add Breakpoint State Queries (AC: 3)

- [ ] Implement DAP request handlers for breakpoint queries (future use, but set up structure now):
  - `onBreakpointLocationsRequest(args)` (optional for MVP, but prepare structure):
    - Allows VS Code to query valid breakpoint locations in a source.
    - For MVP, return all lines as valid.

### 9. Add Unit Tests (AC: 1, 2, 3, 4, 5)

- [ ] Create `tests/unit/debug/source-mapper.test.ts`:
  - Test `registerNotebookCell()` stores source correctly.
  - Test `mapBreakpoint()` returns expected runtime line (1:1 for MVP).
  - Test `unmapBreakpoint()` reverses correctly.
  - Test `clearCell()` removes all breakpoints for a cell.
- [ ] Create `tests/unit/debug/notebook-dap-adapter-breakpoints.test.ts`:
  - Test `onSetBreakpoints()` with valid line numbers → returns verified breakpoints.
  - Test adding new breakpoints → transport method called with correct parameters.
  - Test removing breakpoints → transport method called to remove.
  - Test sync: new breakpoints replace old ones correctly.
  - Test error case: runtime rejects breakpoint → returns `verified: false`.
  - Test conditional breakpoint → included in runtime call (or ignored for MVP).
  - Use mock transport that returns controlled results.
- [ ] Create `tests/unit/debug/breakpoint-resolver.test.ts`:
  - Test `validateBreakpointLocation()` returns valid for all lines (MVP).
  - Test invalid source file handling.

### 10. Run Full Validation Suite (AC: 1, 2, 3, 4, 5)

- [ ] Run `npm run lint` — no new warnings or errors.
- [ ] Run `npm run test:unit` — all unit tests pass including breakpoint tests.
- [ ] Run `npm run compile` — clean compilation.
- [ ] (Manual) In Extension Development Host:
  - [ ] Start debug session with notebook connected to browser.
  - [ ] Click gutter to set a breakpoint on a line with code.
  - [ ] Verify red dot appears and remains after click.
  - [ ] Set a breakpoint, then toggle enable/disable via right-click menu.
  - [ ] Verify breakpoint state in runtime matches VS Code UI.
  - [ ] Remove a breakpoint by clicking the gutter again.
  - [ ] Verify breakpoint is removed from runtime and UI.

## Dev Notes

### Story Context and Scope

This is the **second story in Epic 10** and builds on Story 10.1's DAP server foundation. It focuses on mapping notebook-cell breakpoints to runtime breakpoint locations and keeping state synchronized between VS Code and the runtime debugger.

**Scope boundary:** This story covers breakpoint setting and synchronization. Variable inspection at breakpoints is Story 10.3. Stepping controls are Story 10.4.

### Architecture Guardrails (Must Follow)

- **Source mapping:** Notebook cells are evaluated as standalone scripts in the runtime. For MVP, line mapping is 1:1 (notebook line N = runtime line N). Do NOT attempt source-map rewriting or transpilation. If cells are bundled in future, source mapping will need to be redesigned.
- **Transport abstraction:** DAP adapter calls `evaluateDebuggerSetBreakpoint()` and similar methods on the transport layer. The adapter does NOT call CDP directly.
- **Breakpoint ID handling:** The runtime returns a `breakpointId` for each set breakpoint. Store this ID in the adapter's state so you can remove the breakpoint later by ID, not by line number (runtime debugger semantics).
- **No hardcoded magic numbers:** Use named constants for defaults (e.g., `DEFAULT_BREAKPOINT_COLUMN = 0`).
- **Error localization:** Breakpoint failure messages must use `vscode.l10n.t()`.

### Transport Layer Extensions

Add to `src/transport/browser-connect.ts` or equivalent:

```typescript
interface SetBreakpointResult {
  breakpointId: string;
  actualLine: number;
  actualColumn: number;
  verified: boolean;
  message?: string;
}

// On ActiveBrowserConnection or transport module:
export async function evaluateDebuggerSetBreakpoint(
  line: number,
  column: number,
  sessionId: string,
): Promise<SetBreakpointResult> {
  // Send Debugger.setBreakpoint via CDP
  // Return structured result
}

export async function evaluateDebuggerRemoveBreakpoint(
  breakpointId: string,
  sessionId: string,
): Promise<void> {
  // Send Debugger.removeBreakpoint via CDP
}
```

### Known Unknowns & Future Decisions

1. **Conditional breakpoint support:** Current plan is to accept but ignore conditions for MVP. Full condition evaluation requires runtime integration.
2. **Logpoints:** VS Code supports logpoint syntax (breakpoint that logs instead of pausing). Defer this to a future story.
3. **Hit count breakpoints:** Similar defer.
4. **Source map integration:** If cells are eventually transpiled or bundled, source mapping strategy will need revision.

### Related Documentation

- [DAP setBreakpoints specification](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_SetBreakpoints)
- [Chrome DevTools Protocol — Debugger domain](https://chromedevtools.github.io/devtools-protocol/tot/Debugger/)
