---
storyId: "2.1"
storyKey: "2-1-run-synchronous-javascript-cells"
title: "Run Synchronous JavaScript Cells"
status: "ready-for-dev"
created: "2026-04-14"
epic: "2"
priority: "p0"
---

# Story 2.1: Run Synchronous JavaScript Cells

**Status:** ready-for-dev

## Story

As a developer,
I want to execute synchronous JavaScript cells against the active browser target,
So that I can validate browser state and behavior directly from notebook cells.

## Acceptance Criteria

### AC 1: Synchronous Cell Executes in Browser Context

**Given** an active session with a valid browser execution target
**When** I run a synchronous JavaScript cell
**Then** the code executes in the browser context
**And** the primitive or serializable return value is shown inline.

### AC 2: Synchronous Throw Surfaces Structured Error

**Given** a cell that throws synchronously
**When** execution completes
**Then** the error message and type are shown inline
**And** no uncaught exception leaks to the extension host.

### AC 3: No Active Session Blocks Execution with Reconnect Prompt

**Given** no active session
**When** I attempt to run a cell
**Then** execution is blocked
**And** a clear reconnect prompt is shown in the cell output.

## Tasks / Subtasks

### 1. Register a Notebook Controller (AC: 1, 2, 3)

- [ ] Create `src/notebook/kernel-controller.ts`.
- [ ] Call `vscode.notebooks.createNotebookController()` with:
  - `id`: `"jupyter-browser-kernel"`
  - `notebookType`: `"jupyter-notebook"`
  - `label`: localized display name (e.g., `"Browser Kernel"`)
  - `supportedLanguages`: `["javascript"]`
- [ ] Implement `controller.executeHandler` that receives `NotebookCell[]` and a `NotebookController`.
- [ ] Register the controller in `extension.ts` `activate()` and push to `context.subscriptions`.
- [ ] **Do NOT** add `ms-toolsai.jupyter` to `extensionDependencies` — `vscode.notebooks.createNotebookController` is a core VS Code API; users install Jupyter separately.

### 2. Implement Cell Execution Pipeline (AC: 1, 2)

- [ ] Create `src/kernel/execution-kernel.ts` with an `executeCell` function.
- [ ] The execute handler in the notebook controller must:
  1. Check for an active browser connection (`getActiveBrowserConnection()`).
  2. If connected, extract cell text from `cell.document.getText()`.
  3. Create a `NotebookCellExecution` via `controller.createNotebookCellExecution(cell)`.
  4. Call `execution.start(Date.now())` and set `execution.executionOrder`.
  5. Send `Runtime.evaluate` to the browser via CDP `client.send()` using the active session:
     ```
     client.send("Runtime.evaluate", {
       expression: cellText,
       returnByValue: true,
       awaitPromise: false,
       generatePreview: false,
     }, sessionId)
     ```
     **Note:** `awaitPromise: false` for this story — async support is Story 2.2.
  6. Normalize the CDP response into the execution result contract (see Dev Notes).
  7. Write output to the cell via `execution.replaceOutput()`.
  8. Call `execution.end(success, Date.now())`.

### 3. Handle No-Session Execution Block (AC: 3)

- [ ] In `executeHandler`, before evaluation, check `getActiveBrowserConnection()`.
- [ ] If `undefined`, write an error output to the cell with a clear reconnect message using `vscode.NotebookCellOutputItem.error()` or a text output item.
- [ ] The message must be localized and direct the user to run the Reconnect command.
- [ ] Call `execution.end(false, Date.now())` to mark the cell as failed.
- [ ] Do NOT attempt silent reconnect — manual reconnect is the MVP model. [Source: docs/prd.md#Technical-Constraints]

### 4. Normalize Execution Results (AC: 1, 2)

- [ ] Create `src/kernel/execution-result.ts` with the normalized result contract:

  ```typescript
  interface ExecutionSuccess {
    ok: true;
    value: string; // serialized return value
    type: string; // CDP RemoteObject type or subtype
  }

  interface ExecutionFailure {
    ok: false;
    name: string; // e.g., "TypeError", "ReferenceError", "SyntaxError"
    message: string; // error message text
    stack?: string; // stack trace when available
    kind: ExecutionFailureKind;
  }

  type ExecutionFailureKind =
    | "syntax-error"
    | "runtime-error"
    | "transport-error"
    | "no-session";

  type ExecutionResult = ExecutionSuccess | ExecutionFailure;
  ```

- [ ] Implement a `normalizeEvaluationResult` function that maps CDP `Runtime.evaluate` responses to `ExecutionResult`:
  - If `result.exceptionDetails` is present → extract name, message, stack from the exception and classify as `syntax-error` (if `exceptionDetails.exception.className === "SyntaxError"`) or `runtime-error`.
  - If `result.result` is present without exception → map `result.result.value` and `result.result.type`/`result.result.subtype` into `ExecutionSuccess`.
  - If CDP call throws (e.g., session dropped) → wrap in `ExecutionFailure` with `kind: "transport-error"`.
- [ ] **Do NOT** leak raw CDP `RemoteObject` fields or `exceptionDetails` structures into cell output. [Source: docs/architecture.md#Error-Handling-Patterns]

### 5. Render Cell Output (AC: 1, 2, 3)

- [ ] For `ExecutionSuccess`:
  - Use `NotebookCellOutputItem.text(value, 'text/plain')` for primitive string representations.
  - For `undefined` return values, show a localized `"undefined"` text output.
  - Call `execution.end(true, Date.now())`.
- [ ] For `ExecutionFailure`:
  - Use `NotebookCellOutputItem.error()` with an `Error` object constructed from the normalized failure (name, message, stack).
  - Call `execution.end(false, Date.now())`.
- [ ] For no-session:
  - Use `NotebookCellOutputItem.error()` with a localized reconnect prompt message.
  - Call `execution.end(false, Date.now())`.

### 6. Expose CDP Evaluation Through Transport Interface (AC: 1, 2)

- [ ] The notebook controller needs a way to call `Runtime.evaluate` on the active CDP session. The current `ActiveBrowserConnection` stores `targetId`, `sessionId`, and `endpoint` but does NOT expose the CDP client.
- [ ] Add an `evaluate` method to `ActiveBrowserConnection` (or create a transport-facing `evaluateOnTarget` function in `src/transport/browser-connect.ts`) that:
  - Accepts an expression string.
  - Calls `client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: false }, sessionId)`.
  - Returns the raw CDP result (which the kernel then normalizes).
- [ ] **Keep the CDP client reference internal to transport** — the kernel must NOT import `chrome-remote-interface` directly. [Source: docs/architecture.md#Architectural-Boundaries — "Kernel communicates with transport through interfaces only"]
- [ ] Update the `close` function on `ActiveBrowserConnection` to remain the sole lifecycle control.

### 7. Add Unit Tests (AC: 1, 2, 3)

- [ ] Create `tests/unit/kernel/execution-result.test.ts`:
  - Test `normalizeEvaluationResult` with successful primitive results (number, string, boolean, null, undefined).
  - Test with `SyntaxError` exception → `kind: "syntax-error"`.
  - Test with `TypeError`/`ReferenceError` exception → `kind: "runtime-error"`.
  - Test with transport-level error → `kind: "transport-error"`.
  - Test stack extraction from `exceptionDetails.exception.description` or `exceptionDetails.stackTrace`.
- [ ] Create `tests/unit/kernel/execution-kernel.test.ts`:
  - Test successful cell execution calls evaluate and writes success output.
  - Test error cell execution writes error output.
  - Test no-session returns reconnect prompt error.
  - Use a mock/fake transport that returns controlled CDP responses.
- [ ] Create `tests/unit/notebook/kernel-controller.test.ts`:
  - Test controller registration with correct notebook type and language.
  - Test execute handler dispatches to kernel.
- [ ] Follow existing test patterns: Node.js built-in `test` module, `assert/strict`, localize mock from `tests/unit/test-utils/localize-mock.ts`.
- [ ] Tests go under `tests/unit/` — NOT co-located with source. [Source: docs/architecture.md#File-Structure-Patterns]

### 8. Run Full Validation Suite (AC: 1, 2, 3)

- [ ] Run `npm run lint` — no new warnings or errors.
- [ ] Run `npm run test:unit` — all unit tests pass including new tests.
- [ ] Run `npm run compile` — clean compilation with no type errors.
- [ ] Manually verify in Extension Development Host (if available):
  - [ ] Open a `.ipynb` notebook with Jupyter extension installed.
  - [ ] Select "Browser Kernel" as the kernel.
  - [ ] Run a cell with `2 + 2` while connected → see `4` inline.
  - [ ] Run a cell with `throw new TypeError("boom")` → see structured error inline.
  - [ ] Run a cell while disconnected → see reconnect prompt error.

## Dev Notes

### Story Context and Scope

This is the **first story in Epic 2** and the first notebook execution story in the project. Epic 1 established the complete browser session lifecycle: connect, disconnect, reconnect, DevTools coexistence, connection state UI, and CI packaging. Story 2.1 introduces the first cell execution path.

**Scope boundary (FR10):** This story establishes baseline inline return-value visibility for successful synchronous execution. Story 4.1 extends this with structured rendering and explicit value-presentation semantics. Story 2.2 adds async/Promise support. Story 2.3 formalizes the full normalized result contract across all execution paths.

### Architecture Guardrails (Must Follow)

- **Layer boundaries:** Kernel cannot import concrete transport (`chrome-remote-interface`). Notebook layer calls kernel. Kernel calls transport interface. [Source: docs/architecture.md#Architectural-Boundaries]
- **Result normalization:** All execution outcomes must use the discriminated union contract. Raw CDP protocol fields must NOT appear in cell output. [Source: docs/architecture.md#Error-Handling-Patterns, docs/architecture.md#Format-Patterns]
- **State ownership:** Transport owns connection state. Do NOT introduce independent lifecycle flags in the kernel/notebook layer. Check session availability via `getActiveBrowserConnection()`. [Source: docs/architecture.md#State-Management-Patterns]
- **File naming:** kebab-case files, PascalCase types/interfaces, camelCase functions/variables, UPPER_SNAKE_CASE constants. [Source: docs/architecture.md#Naming-Patterns]
- **Error kind literals:** kebab-case (e.g., `syntax-error`, `runtime-error`, `transport-error`). [Source: docs/architecture.md#API-Naming-Conventions]
- **Tests in `tests/` tree only.** [Source: docs/architecture.md#File-Structure-Patterns]
- **Localization:** All user-facing strings through `vscode.l10n.t()`. Add keys to `l10n/bundle.l10n.json`. [Source: .github/copilot-instructions.md#Coding-Standards]
- **No complex ad hoc types in function signatures.** Use named interfaces. [Source: .github/copilot-instructions.md#Coding-Standards]
- **Prefer `const` over `let` with mutation.** [Source: .github/copilot-instructions.md#Coding-Standards]
- **Do not duplicate library-owned types.** Use `Pick`, `Partial`, or indexed access to bind to source types. [Source: .github/copilot-instructions.md#Coding-Standards]

### Key Technical Details

#### CDP `Runtime.evaluate` Response Shape

The CDP `Runtime.evaluate` call returns an object with these relevant fields:

```typescript
{
  result: {
    type: string;         // "number", "string", "boolean", "undefined", "object", "function", "symbol", "bigint"
    subtype?: string;     // "null", "array", "regexp", "date", "map", "set", "error", etc.
    value?: any;          // Present when returnByValue is true and value is serializable
    description?: string; // Human-readable description
    className?: string;   // Class name for object types
  };
  exceptionDetails?: {
    exceptionId: number;
    text: string;         // Short description like "Uncaught SyntaxError: ..."
    lineNumber: number;
    columnNumber: number;
    exception?: {
      type: string;
      subtype?: string;
      className?: string;  // "SyntaxError", "TypeError", "ReferenceError", etc.
      description?: string; // Full error message + stack trace
    };
    stackTrace?: {
      callFrames: Array<{
        functionName: string;
        scriptId: string;
        url: string;
        lineNumber: number;
        columnNumber: number;
      }>;
    };
  };
}
```

#### How to Call CDP Through the Active Session

The current `ActiveBrowserConnection` does NOT expose the CDP client. The `retainedClient` is captured in a closure and only exposed through `close()`.

**Required change:** Add an `evaluate` function to the transport interface. Two options:

1. **Extend `ActiveBrowserConnection`** with an `evaluate` method that captures the CDP client in its closure (preferred — matches the existing `close` closure pattern).
2. **Create a new `evaluateOnTarget` export** in `browser-connect.ts`.

Both options keep `chrome-remote-interface` internal to the transport module. The kernel layer calls `connection.evaluate(expression)` and receives a plain object it normalizes.

#### NotebookController API

```typescript
const controller = vscode.notebooks.createNotebookController(
  "jupyter-browser-kernel",    // id
  "jupyter-notebook",          // notebookType — standard Jupyter notebook
  "Browser Kernel",            // label — user-visible name
);
controller.supportedLanguages = ["javascript"];
controller.executeHandler = async (cells, notebook, controller) => { ... };
```

The `executeHandler` receives an array of cells to execute. For each cell:

```typescript
const execution = controller.createNotebookCellExecution(cell);
execution.start(Date.now());
execution.executionOrder = nextExecutionOrder++;
// ... do work ...
execution.replaceOutput([
  new vscode.NotebookCellOutput([
    vscode.NotebookCellOutputItem.text(resultText, "text/plain"),
  ]),
]);
execution.end(success, Date.now());
```

#### Execution Order Counter

Maintain a module-scoped counter for `execution.executionOrder`. Increment on each cell execution. Reset is not required per session for MVP — Jupyter convention is monotonically increasing within a kernel session.

### Files to Create or Modify

| File                                            | Action     | Purpose                                                                   |
| ----------------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| `src/kernel/execution-result.ts`                | **Create** | Normalized result contract types and CDP→result normalizer                |
| `src/kernel/execution-kernel.ts`                | **Create** | Cell execution orchestration (session check, evaluate, normalize, output) |
| `src/kernel/index.ts`                           | **Create** | Barrel export for kernel module                                           |
| `src/notebook/kernel-controller.ts`             | **Create** | VS Code `NotebookController` registration and `executeHandler`            |
| `src/notebook/index.ts`                         | **Create** | Barrel export for notebook module                                         |
| `src/transport/browser-connect.ts`              | **Modify** | Add `evaluate` capability to `ActiveBrowserConnection`                    |
| `src/extension.ts`                              | **Modify** | Register notebook controller in `activate()`                              |
| `l10n/bundle.l10n.json`                         | **Modify** | Add localized strings for notebook output messages                        |
| `tests/unit/kernel/execution-result.test.ts`    | **Create** | Tests for result normalization                                            |
| `tests/unit/kernel/execution-kernel.test.ts`    | **Create** | Tests for execution orchestration                                         |
| `tests/unit/notebook/kernel-controller.test.ts` | **Create** | Tests for controller registration                                         |

### What NOT to Do

- Do NOT add `ms-toolsai.jupyter` to `extensionDependencies` — it blocks CDP access when it forces the container workspace host. [Source: .github/copilot-instructions.md#Stable-Technical-Constraints]
- Do NOT add `awaitPromise: true` to `Runtime.evaluate` — async execution is Story 2.2.
- Do NOT implement deep object inspection or rich rendering — that is Story 4.1+.
- Do NOT implement intentional output helpers (`$f.out()`, `$f.log()`) — that is Epic 3.
- Do NOT add automatic reconnect on session loss during execution — manual reconnect is MVP scope. [Source: docs/prd.md#Technical-Constraints]
- Do NOT import `chrome-remote-interface` in kernel or notebook layers. [Source: docs/architecture.md#Architectural-Boundaries]
- Do NOT introduce a separate error notification channel for notebook failures — the cell output IS the notification surface. [Source: docs/ux-spec/06-detailed-core-user-experience.md#Experience-Mechanics]
- Do NOT define ad hoc inline types for CDP response shapes in function signatures — create named interfaces. [Source: .github/copilot-instructions.md#Coding-Standards]
- Do NOT modify connection/disconnect/reconnect commands — those are stable from Epic 1.
- Do NOT change activation events — `onCommand:jupyterBrowserKernel.connect` remains the sole activation trigger unless notebook activation requires it (see Implementation Note below).

### Implementation Notes

#### Activation Event Consideration

The current activation event is `onCommand:jupyterBrowserKernel.connect`. With a notebook controller, VS Code may need to activate the extension when the user opens a notebook and selects the kernel. Check whether `onNotebook:jupyter-notebook` needs to be added to `activationEvents` in `package.json`. If the controller does not appear in the kernel picker without it, add it. The controller ID must match the `createNotebookController` ID.

#### Execution Order Management

Use a simple module-scoped counter. The counter persists across cell executions within the same extension activation. If the extension deactivates and reactivates, the counter resets — this is acceptable for MVP.

```typescript
let executionOrder = 0;
```

#### Timeout Handling

Story 2.1 does not require explicit execution timeouts for synchronous evaluation. CDP `Runtime.evaluate` with `awaitPromise: false` returns immediately for synchronous code. If the connection drops mid-evaluate, the CDP client will reject the promise, which the kernel catches and wraps as `transport-error`.

### Epic 1 Retro Lessons (Carry Forward)

From the Epic 1 retrospective, these patterns must be preserved:

1. **Transport owns lifecycle** — kernel checks session, does not manage connection state.
2. **Normalized errors only** — no raw CDP leaks to cell output.
3. **Localization from the start** — every user-facing string through `vscode.l10n.t()`.
4. **Named interfaces for all non-trivial types** — no inline ad hoc types.
5. **`const` over `let` with mutation** — prefer IIFE for multi-step initialization.
6. **Do not duplicate library types** — bind to source types with `Pick`/`Partial`.
7. **Review checklist items for Epic 2:** async state transitions, disconnected-session blocking, localized notebook output, transport-boundary isolation. [Source: docs/stories/epic-1-retro-2026-04-14.md#Action-Items]

### Git Intelligence

- Most recent commit: `1a6ca95` (Epic 1 retrospective).
- Tag: `v0.1.0` on `c06c2d1`.
- The `src/transport/browser-connect.ts` file was last materially changed in Stories 1.3–1.5. It is stable.
- No notebook-related code exists yet — this story creates the first notebook and kernel code.

### Project Structure Notes

This story creates two new source directories (`src/kernel/`, `src/notebook/`) and two new test directories (`tests/unit/kernel/`, `tests/unit/notebook/`). These align exactly with the architecture document's project structure. [Source: docs/architecture.md#Complete-Project-Directory-Structure]

### References

- [Source: docs/epics/epic-2-execute-javascript-cells-no-intentional-capture.md#Story-2.1] — AC definitions
- [Source: docs/architecture.md#Architectural-Boundaries] — layer import constraints
- [Source: docs/architecture.md#Format-Patterns] — normalized result contract requirements
- [Source: docs/architecture.md#Error-Handling-Patterns] — error normalization mandate
- [Source: docs/architecture.md#Complete-Project-Directory-Structure] — target file layout
- [Source: docs/architecture.md#State-Management-Patterns] — transport-owned state
- [Source: docs/prd.md#FR8] — user can run JavaScript notebook cells against the active browser target
- [Source: docs/prd.md#FR10] — extension can return successful execution values to notebook output
- [Source: docs/prd.md#FR11] — extension can surface syntax and runtime errors as notebook output
- [Source: docs/prd.md#FR14] — shared result contract with transport-boundary isolation
- [Source: docs/prd.md#Technical-Constraints] — manual reconnect, JavaScript only, serialization limits
- [Source: docs/ux-spec/06-detailed-core-user-experience.md] — inline feedback mechanics
- [Source: docs/ux-spec/09-user-journey-flows.md#Journey-1] — rapid snippet iteration
- [Source: docs/stories/epic-1-retro-2026-04-14.md] — retro lessons and Epic 2 preparation tasks
- [Source: .github/copilot-instructions.md] — coding standards and stable technical constraints

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
