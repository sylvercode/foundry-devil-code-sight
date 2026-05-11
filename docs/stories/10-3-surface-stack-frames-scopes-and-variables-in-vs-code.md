---
storyId: "10.3"
storyKey: "10-3-surface-stack-frames-scopes-and-variables-in-vs-code"
title: "Surface Stack Frames, Scopes, and Variables in VS Code"
status: "backlog"
created: "2026-05-11"
epic: "10"
priority: "p0-blocker"
dependencies:
  [
    "10-1-register-and-bootstrap-notebook-cell-dap-session",
    "10-2-verify-and-bind-notebook-cell-breakpoints-in-vs-code-ui",
  ]
---

# Story 10.3: Surface Stack Frames, Scopes, and Variables in VS Code

**Status:** backlog

## Story

As a developer,
I want paused execution context in VS Code debug panes,
So that I can inspect stack and state without switching to browser DevTools.

## Acceptance Criteria

### AC 1: Stack Frames Are Displayed When Paused

**Given** execution is paused at a breakpoint in a notebook cell
**When** the debug view opens the "Call Stack" pane
**Then** a stack frame is displayed for the current cell execution
**And** the frame shows the source file name (or cell ID) and line number
**And** clicking the frame navigates the editor to the breakpoint line.

### AC 2: Scopes Are Resolved When Frame is Selected

**Given** a stack frame is displayed and selected
**When** VS Code requests scopes for the frame
**Then** the adapter returns scope objects for:

- Local scope (variables declared in the cell)
- Global scope (window, global objects)
  **And** each scope includes an accurate variable count.

### AC 3: Variables Are Resolved with Handles

**Given** a scope is expanded in the Variables pane
**When** VS Code requests variables for the scope
**Then** the adapter returns a list of variable objects with:

- Name (variable identifier).
- Value (serialized or `[Object]`, `[Array]`, etc. for complex types).
- Type (inferred or from runtime, e.g., `"number"`, `"object"`).
- Handles for objects/arrays that allow drill-down expansion.
  **And** variable resolution respects CDP serialization limits (values limited to ~10KB per variable).

### AC 4: Complex Variables Can Be Expanded

**Given** a variable is an object or array
**When** the user clicks the expand arrow in the Variables pane
**Then** the adapter fetches nested properties (up to a configurable depth, default 2)
**And** nested properties are displayed with names, values, and types.

### AC 5: Unsupported Values Fail Gracefully

**Given** a variable cannot be serialized (e.g., function, DOM node)
**When** the adapter attempts to resolve it
**Then** the variable shows a human-readable placeholder (e.g., `"[Function: myFunc]"`, `"[HTMLElement]"`)
**And** no error is thrown; the UI remains stable.

### AC 6: Watch Expressions Can Be Evaluated

**Given** the user adds a watch expression in VS Code debug
**When** execution is paused
**Then** the adapter evaluates the expression in the paused context
**And** returns the result or an error message if evaluation fails.

## Tasks / Subtasks

### 1. Implement `threads` DAP Request Handler (AC: 1)

- [ ] In `src/debug/notebook-dap-adapter.ts`, add method `onThreadsRequest(): ThreadsResponse`.
- [ ] The response must include:
  - A single thread object with:
    - `id: 1` (notebook execution is single-threaded for MVP).
    - `name: "Cell Execution"` or localized equivalent.
  - Return `{ threads: [thread] }`.

### 2. Implement `stackTrace` DAP Request Handler (AC: 1)

- [ ] Add method `onStackTraceRequest(args: StackTraceArguments): StackTraceResponse`.
- [ ] The handler must:
  - Accept `args.threadId` (expect `1` for MVP).
  - Query the runtime debugger for the call stack via transport layer (new method).
  - Map each CDP call frame to a DAP `StackFrame`:
    - `id: frameIndex` (0 for top frame, incrementing down).
    - `name: functionName` or `"<anonymous>"` for unnamed functions.
    - `source: { path: cellSourcePath }` (cell ID or notebook path).
    - `line: callFrame.location.lineNumber` (adjusted for any line offset).
    - `column: callFrame.location.columnNumber`.
  - Return frames in order from top (most recent) to bottom (oldest).
  - Handle case where no frames are available (e.g., paused in top-level cell code).

### 3. Add Transport Method for Stack Retrieval (AC: 1)

- [ ] Update `src/transport/debugger-interface.ts`:
  - Add method `getCallStack(sessionId: string): Promise<CallFrame[]>`:
    - Sends `Debugger.getCallStack` or equivalent via CDP.
    - Returns array of frame objects with:
      - `functionName: string`.
      - `location: { lineNumber, columnNumber }`.
      - Additional fields as needed for scope resolution.

### 4. Implement `scopes` DAP Request Handler (AC: 2)

- [ ] Add method `onScopesRequest(args: ScopesArguments): ScopesResponse`.
- [ ] The handler must:
  - Accept `args.frameId` (correlates to stack frame index).
  - Return a list of scope objects:
    - Local scope: `{ name: "Local", variablesReference: <handle>, expensive: false }`.
    - Global scope: `{ name: "Global", variablesReference: <handle>, expensive: false }`.
  - Store the frame ID and scope type in a reference map so `onVariablesRequest()` can retrieve the correct scope.
  - Each scope must have a unique `variablesReference` handle for tracking.

### 5. Create Variable Handle Manager (AC: 3, 4)

- [ ] Create `src/debug/variable-handler.ts`:
  - Implement `VariableHandleManager` class that:
    - Maintains a map of handles to variable objects: `Map<handle, VariableReference>`.
    - Provides methods:
      - `createHandle(frameId, scopeName): handle` → create and store a handle for a scope.
      - `createHandle(parentHandle, propertyName): handle` → create handle for a nested property.
      - `getVariableReference(handle): VariableReference` → retrieve the stored reference.
      - `clearFrame(frameId): void` → remove all handles for a frame (on resume).
    - Assign sequential numeric handles starting from `1000` (to avoid colliding with frame IDs).

### 6. Implement `variables` DAP Request Handler (AC: 3, 4)

- [ ] Add method `onVariablesRequest(args: VariablesArguments): VariablesResponse`.
- [ ] The handler must:
  - Accept `args.variablesReference` (the handle).
  - Look up the reference in the handle manager.
  - Determine if it's a scope or nested property.
  - If scope:
    1. Call transport layer to fetch scope variables from runtime debugger.
    2. For each variable, create a DAP variable object:
       - `name: variableName`.
       - `value: serializedValue` (JSON string, or `"[Object]"` for unserializable types).
       - `type: runtimeType` (e.g., `"number"`, `"object"`, `"function"`).
       - `variablesReference: handle` (if value is expandable; `0` otherwise).
    3. Return the list.
  - If nested property:
    1. Fetch the nested properties from the runtime (up to depth limit).
    2. Return nested variables.
  - Limit results to a reasonable count (e.g., first 100 variables; show "..." for overflow).

### 7. Add Transport Method for Variable Resolution (AC: 3, 4)

- [ ] Update `src/transport/debugger-interface.ts`:
  - Add method `getScopeVariables(frameId: number, scopeType: "local" | "global", sessionId: string): Promise<Variable[]>`:
    - Sends `Runtime.getProperties` or `Debugger.evaluateOnCallFrame` via CDP.
    - Returns array of variable objects with name, value, type.
    - Applies serialization limits (truncate values > 10KB).
  - Add method `getNestedProperties(objectId: string, depth: number, sessionId: string): Promise<Variable[]>`:
    - Fetches nested properties of an object/array.
    - Respects depth limit.

### 8. Implement Variable Serialization and Value Formatting (AC: 3, 5)

- [ ] Create `src/debug/variable-formatter.ts`:
  - Implement `formatVariableValue(cdpValue, maxLength = 10240): string`:
    - Serialize CDP value to a display string.
    - For primitives: return literal (e.g., `123`, `"hello"`).
    - For objects/arrays: return placeholder (e.g., `"{...}"`, `"[...]"`).
    - For functions: return `"[Function: name]"` or `"[Function]"`.
    - For DOM nodes: return `"[HTMLElement]"` or similar.
    - If serialization exceeds `maxLength`, truncate and add `"..."`
  - Implement `getVariableType(cdpValue): string`:
    - Return runtime type (e.g., `"number"`, `"string"`, `"object"`, `"function"`).

### 9. Implement `evaluate` DAP Request Handler for Watch Expressions (AC: 6)

- [ ] Add method `onEvaluateRequest(args: EvaluateArguments): EvaluateResponse`.
- [ ] The handler must:
  - Accept `args.expression` (the watch expression).
  - Accept `args.frameId` (the context frame, or `-1` for top-level).
  - Call transport layer to evaluate the expression in the paused context.
  - Return result:
    - `result: serializedValue`.
    - `type: runtimeType`.
    - `variablesReference: handle` (if expandable).
  - If evaluation fails, return error message instead of throwing.

### 10. Add Transport Method for Expression Evaluation (AC: 6)

- [ ] Update `src/transport/debugger-interface.ts`:
  - Add method `evaluateExpressionInFrame(expression: string, frameId: number, sessionId: string): Promise<EvaluationResult>`:
    - Sends `Debugger.evaluateOnCallFrame` via CDP (if available).
    - Or falls back to `Runtime.evaluate` with context object.
    - Returns result with value, type, and object ID (for drill-down).

### 11. Handle Pause State and Variable Lifecycle (AC: 1–6)

- [ ] In `NotebookDAPAdapter`:
  - Add a `paused` state flag (set when execution pauses at breakpoint).
  - Add a method `onPaused(reason: "breakpoint" | "step" | "pause")`:
    1. Set paused flag.
    2. Query stack trace and cache it.
    3. Clear old variable handles.
    4. Send `stopped` event to VS Code with reason and `threadId: 1`.
  - Add a method `onResumed()`:
    1. Clear paused flag.
    2. Clear all variable handles.
    3. Clear cached stack trace.
    4. Send `continued` event to VS Code.

### 12. Add Unit Tests (AC: 1–6)

- [ ] Create `tests/unit/debug/notebook-dap-adapter-frames.test.ts`:
  - Test `onThreadsRequest()` returns single thread with ID 1.
  - Test `onStackTraceRequest()` with valid frame data → returns mapped frames.
  - Test error case: no frames available → returns empty array gracefully.
- [ ] Create `tests/unit/debug/notebook-dap-adapter-scopes.test.ts`:
  - Test `onScopesRequest()` returns Local and Global scopes.
  - Test scopes have unique `variablesReference` handles.
- [ ] Create `tests/unit/debug/notebook-dap-adapter-variables.test.ts`:
  - Test `onVariablesRequest()` for scope → returns list of variables.
  - Test nested variable expansion → handles are created correctly.
  - Test variable serialization (primitives, objects, functions).
  - Test unsupported values (functions, DOM nodes) → return placeholders.
  - Test limit enforcement (max 100 variables).
- [ ] Create `tests/unit/debug/variable-formatter.test.ts`:
  - Test `formatVariableValue()` with various types.
  - Test truncation of large values.
  - Test `getVariableType()` accuracy.
- [ ] Create `tests/unit/debug/notebook-dap-adapter-evaluate.test.ts`:
  - Test `onEvaluateRequest()` with valid expression → returns result.
  - Test error case: invalid expression → returns error message.
  - Test evaluation in paused context.

### 13. Run Full Validation Suite (AC: 1–6)

- [ ] Run `npm run lint` — no new warnings.
- [ ] Run `npm run test:unit` — all tests pass.
- [ ] Run `npm run compile` — clean compilation.
- [ ] (Manual) In Extension Development Host:
  - [ ] Set breakpoint in notebook cell.
  - [ ] Run cell and verify it pauses.
  - [ ] Inspect Call Stack pane and verify frame is shown.
  - [ ] Click frame to navigate to breakpoint line.
  - [ ] Inspect Variables pane and verify Local and Global scopes.
  - [ ] Expand Local scope and verify variables are displayed.
  - [ ] Expand an object variable and verify nested properties.
  - [ ] Add a watch expression and verify it evaluates in paused context.
  - [ ] Continue execution and verify scopes/variables are cleared.

## Dev Notes

### Story Context and Scope

This is the **third story in Epic 10** and focuses on surfacing execution context (frames, scopes, variables) to VS Code debug panes. It builds on Story 10.1's DAP foundation and Story 10.2's breakpoint handling.

**Scope boundary:** This story covers inspection and viewing. Modifying variables is deferred (MVP doesn't support `setVariable`). Stepping controls are Story 10.4.

### Architecture Guardrails (Must Follow)

- **Transport abstraction:** All runtime queries go through transport layer methods. DAP adapter does NOT call CDP directly.
- **Handle management:** Use sequential numeric handles starting from `1000` to avoid conflicts. Track handle lifecycle carefully to prevent memory leaks (clear handles on resume).
- **Value serialization:** Respect CDP limits. Never expose raw CDP `RemoteObject` structures to DAP. Always format for display.
- **Error boundaries:** If any runtime query fails (e.g., scope resolution), return graceful error messages. Do NOT crash the debug session.
- **Localization:** Scope names (`"Local"`, `"Global"`), placeholder strings (`"[Function]"`, `"[HTMLElement]"`), and error messages must use `vscode.l10n.t()`.

### Transport Layer Extensions

```typescript
interface Variable {
  name: string;
  value: string; // serialized
  type: string;
  objectId?: string; // for nested expansion
}

export async function getScopeVariables(
  frameId: number,
  scopeType: "local" | "global",
  sessionId: string,
): Promise<Variable[]> {
  // Implementation with CDP
}

export async function getNestedProperties(
  objectId: string,
  depth: number,
  sessionId: string,
): Promise<Variable[]> {
  // Implementation with CDP
}

export async function evaluateExpressionInFrame(
  expression: string,
  frameId: number,
  sessionId: string,
): Promise<EvaluationResult> {
  // Implementation with CDP
}
```

### Known Unknowns & Future Decisions

1. **Watch expression persistence:** Currently, watches are transient (cleared on resume). Future: persist watches across pause/resume cycles.
2. **Variable modification:** `setVariable` request is not supported in MVP. Future story.
3. **Depth limit:** Current MVP uses depth 2 for nested properties. Configurable depth is a future enhancement.
4. **Performance:** Fetching many variables may be slow. Consider lazy loading for large variable lists.

### Related Documentation

- [DAP stackTrace specification](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_StackTrace)
- [DAP scopes specification](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_Scopes)
- [DAP variables specification](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_Variables)
- [DAP evaluate specification](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_Evaluate)
- [CDP Runtime.getProperties](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-getProperties)
- [CDP Debugger.evaluateOnCallFrame](https://chromedevtools.github.io/devtools-protocol/tot/Debugger/#method-evaluateOnCallFrame)
