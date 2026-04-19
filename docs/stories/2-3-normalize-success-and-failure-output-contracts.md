---
storyId: "2.3"
storyKey: "2-3-normalize-success-and-failure-output-contracts"
title: "Normalize Success and Failure Output Contracts"
status: "ready-for-dev"
created: "2026-04-19"
epic: "2"
priority: "p0"
---

# Story 2.3: Normalize Success and Failure Output Contracts

**Status:** ready-for-dev

## Story

As a developer,
I want consistent result shapes for every cell run,
So that success and failure are interpretable regardless of transport internals.

## Acceptance Criteria

### AC 1: Success Results Follow Normalized Contract

**Given** a cell that executes successfully
**When** the result is serialized
**Then** it follows the normalized success contract (value, type metadata)
**And** no raw CDP protocol fields are visible in cell output.

### AC 2: Failure Results Follow Normalized Contract

**Given** any execution failure
**When** the error result is produced
**Then** it includes message, error type, and stack where available
**And** it follows the normalized failure contract consistently.

### AC 3: Transport-Level Errors Wrapped in Normalized Contract

**Given** a transport-level error (e.g., session drop mid-run)
**When** execution fails
**Then** the error is wrapped in the normalized failure contract
**And** no protocol-level detail leaks directly to the cell output.

### AC 4: Classification Parity Across Sync and Async Paths

**Given** both sync and async execution paths
**When** results are produced
**Then** classification parity holds — the same contract shapes are used
**And** downstream rendering code does not branch on transport type.

## Tasks / Subtasks

### 1. Handle CDP `unserializableValue` in `serializeRemoteValue` (AC: 1)

CDP's `Runtime.evaluate` uses the `unserializableValue` field (instead of `value`) for JavaScript values that cannot be JSON-serialized: `Infinity`, `-Infinity`, `NaN`, `-0`, and bigint literals like `"123n"`. The current `serializeRemoteValue` does not check this field. For these values, `result.value` is `undefined` and the function falls through to `result.description ?? result.type ?? "undefined"` — which works by accident for some cases because CDP happens to set `description` to the right string. This is fragile.

- [ ] In `src/kernel/execution-result.ts`, add `unserializableValue?: string` to the `RemoteObjectLike` interface:
  ```typescript
  interface RemoteObjectLike {
    type?: string;
    subtype?: string;
    value?: unknown;
    unserializableValue?: string;
    description?: string;
  }
  ```
- [ ] In `serializeRemoteValue`, add a branch after the `undefined` type check and before the `typeof result.value === "string"` check:
  ```typescript
  if (result.unserializableValue !== undefined) {
    return result.unserializableValue;
  }
  ```
  Position: after `if (result.type === "undefined")` and before `if (typeof result.value === "string")`.
- [ ] Remove the dead `bigint` branch (`if (typeof result.value === "bigint")`). With `returnByValue: true`, CDP never sets `result.value` to a BigInt — it uses `unserializableValue` instead (e.g., `"123n"`). This branch cannot fire at runtime and its presence is misleading.

**Why this matters:** Without explicit `unserializableValue` handling, evaluating `Infinity`, `NaN`, or `-0` relies on CDP always setting `description` — an undocumented behavioral dependency. The `unserializableValue` field is the stable CDP contract for these values.

### 2. Add Serialization Edge-Case Tests (AC: 1)

Add tests in `tests/unit/kernel/execution-result.test.ts` for CDP response types not covered by existing tests. All use `normalizeEvaluationResult` and verify the returned `ExecutionSuccess` shape.

- [ ] `Infinity` via `unserializableValue`:
  ```typescript
  createResponse({
    result: { type: "number", unserializableValue: "Infinity" },
  });
  ```
  Expected: `{ ok: true, type: "number", value: "Infinity" }`.
- [ ] `NaN` via `unserializableValue`:
  ```typescript
  createResponse({
    result: { type: "number", unserializableValue: "NaN" },
  });
  ```
  Expected: `{ ok: true, type: "number", value: "NaN" }`.
- [ ] `-0` via `unserializableValue`:
  ```typescript
  createResponse({
    result: { type: "number", unserializableValue: "-0" },
  });
  ```
  Expected: `{ ok: true, type: "number", value: "-0" }`.
- [ ] BigInt via `unserializableValue`:
  ```typescript
  createResponse({
    result: { type: "bigint", unserializableValue: "123n" },
  });
  ```
  Expected: `{ ok: true, type: "bigint", value: "123n" }`.
- [ ] Symbol (no `value`, has `description`):
  ```typescript
  createResponse({
    result: { type: "symbol", description: "Symbol(foo)" },
  });
  ```
  Expected: `{ ok: true, type: "symbol", value: "Symbol(foo)" }`.
- [ ] Function (no `value`, has `description`):
  ```typescript
  createResponse({
    result: { type: "function", description: "function greet() { ... }" },
  });
  ```
  Expected: `{ ok: true, type: "function", value: "function greet() { ... }" }`.
- [ ] Array via `returnByValue`:
  ```typescript
  createResponse({
    result: { type: "object", subtype: "array", value: [1, 2, 3] },
  });
  ```
  Expected: `{ ok: true, type: "array", value: "[1,2,3]" }`.
- [ ] Object via `returnByValue`:
  ```typescript
  createResponse({
    result: { type: "object", value: { a: 1, b: "two" } },
  });
  ```
  Expected: `{ ok: true, type: "object", value: '{"a":1,"b":"two"}' }`.
- [ ] Empty string value (edge case — value is present but zero-length):
  ```typescript
  createResponse({
    result: { type: "string", value: "" },
  });
  ```
  Expected: `{ ok: true, type: "string", value: "" }`.

**Naming convention:** Group tests under a `test("serialization edge cases", ...)` description block or prefix with `"normalizeEvaluationResult"` to match existing patterns.

### 3. Add Contract Shape Invariant Tests (AC: 1, 2, 3, 4)

Add tests that verify the `ExecutionResult` contract shapes hold across all execution categories. These are **contract tests** — they verify structural invariants, not individual values.

- [ ] In `tests/unit/kernel/execution-result.test.ts`, add a contract test for success results that verifies the result object has exactly three properties (`ok`, `value`, `type`), all of type `string` (except `ok` which is `boolean`), with no extra properties leaking from the CDP response:

  ```typescript
  test("normalizeEvaluationResult success contract: exact shape, no extra properties", () => {
    const result = normalizeEvaluationResult(
      createResponse({
        result: {
          type: "object",
          subtype: "array",
          value: [1],
          className: "Array",
          description: "Array(1)",
          objectId: "1234",
        },
      }),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result).sort(), ["ok", "type", "value"]);
    if (result.ok) {
      assert.equal(typeof result.value, "string");
      assert.equal(typeof result.type, "string");
    }
  });
  ```

  This test verifies that CDP fields like `className`, `description`, and `objectId` do NOT leak into the `ExecutionSuccess` shape.

- [ ] Add a contract test for failure results that verifies the result object has exactly the expected properties (`ok`, `name`, `message`, `kind`, and optionally `stack`):

  ```typescript
  test("normalizeEvaluationResult failure contract: exact shape, no extra properties", () => {
    const result = normalizeEvaluationResult(
      createResponse({
        result: { type: "undefined" },
        exceptionDetails: {
          exceptionId: 100,
          text: "Uncaught TypeError: bad",
          lineNumber: 0,
          columnNumber: 0,
          exception: {
            type: "object",
            className: "TypeError",
            description: "TypeError: bad\n    at <anonymous>:1:1",
          },
        },
      }),
    );
    assert.equal(result.ok, false);
    const keys = Object.keys(result).sort();
    // stack is present when description is multiline
    assert.deepEqual(keys, ["kind", "message", "name", "ok", "stack"]);
  });
  ```

- [ ] Add a contract test for `normalizeTransportError` that verifies the output shape:
  ```typescript
  test("normalizeTransportError contract: exact shape", () => {
    const result = normalizeTransportError(new Error("socket closed"));
    assert.deepEqual(Object.keys(result).sort(), [
      "kind",
      "message",
      "name",
      "ok",
      "stack",
    ]);
    assert.equal(result.ok, false);
    assert.equal(typeof result.name, "string");
    assert.equal(typeof result.message, "string");
    assert.equal(typeof result.kind, "string");
  });
  ```

### 4. Add Classification Parity Tests (AC: 4)

NFR6 requires identical classification across execution paths. Add tests that verify sync-like and async-like CDP responses produce the same contract shapes.

- [ ] In `tests/unit/kernel/execution-result.test.ts`, add parity tests:
  - Success parity: a non-Promise value (sync) and a resolved-Promise value (same CDP shape since `awaitPromise: true` normalizes both) → same `ExecutionSuccess` shape. Note: this is already covered by the existing "resolved Promise value produces ExecutionSuccess (same as sync)" test. Add a comment reference confirming parity is validated.
  - Failure parity — sync throw vs. async rejection for the same error type: create both `"Uncaught TypeError: boom"` (sync) and `"Uncaught (in promise) TypeError: boom"` (async rejection) responses. Verify both produce `ExecutionFailure` with:
    - Same `name: "TypeError"`
    - Same `message: "boom"`
    - Both have `stack` when multiline description is present
    - Different `kind` values (`"runtime-error"` vs. `"promise-rejection"`) — this is the ONLY expected difference.
  - Write this as a single test named `"normalizeEvaluationResult classification parity: sync throw vs async rejection produce identical shapes except kind"`.

### 5. Add Cell-Output No-Leak Tests (AC: 1, 3)

Verify that `writeSuccessOutput` and `writeFailureOutput` do not expose raw CDP or transport internals in the rendered cell output. These tests go in `tests/unit/kernel/execution-kernel.test.ts`.

- [ ] Success output test: execute a cell that returns a value. Verify the cell output is a single `text/plain` item containing only the serialized value string. No `type` metadata, no CDP fields, no JSON wrapper.
  - This is already partially covered by the existing `"executeCell writes success output with result value"` test. Verify that test checks the output item's MIME type is `text/plain` and the content is the plain value string. If not already checked, add assertions.
- [ ] Infrastructure failure output test: execute a cell that produces a timeout failure. Verify the cell output is `text/plain` containing a localized human-readable message — no raw error message, no CDP protocol text, no stack trace.
  - This is already partially covered by the existing `"executeCell writes text output and reports on timeout"` test. Verify that test asserts the output is `text/plain` and contains the localized message string.
- [ ] User-error output test: execute a cell that throws a `TypeError`. Verify the cell output uses `NotebookCellOutputItem.error()` with a JS `Error` object that has only `name`, `message`, and optionally `stack` — no `kind`, no CDP fields.
  - This is already partially covered by the existing `"executeCell writes error output on runtime exception"` test. Verify the `Error` object passed to `.error()` has the expected shape.
- [ ] For any existing tests that don't fully verify MIME types and content shapes, **add assertions** rather than creating new tests. If all existing tests already verify these properties, add a comment block documenting that AC 1 and AC 3 no-leak requirements are validated by the existing suite.

### 6. Run Full Validation Suite (AC: 1, 2, 3, 4)

- [ ] Run `npm run lint` — no new warnings or errors.
- [ ] Run `npm run test` — all unit tests pass including new tests.
- [ ] Run `npm run compile` — clean compilation with no type errors.

## Dev Notes

### Story Context and Scope

This is the **third story in Epic 2**. Stories 2.1 and 2.2 already established the core normalization pipeline:

- `ExecutionResult` discriminated union (`ExecutionSuccess | ExecutionFailure`)
- `normalizeEvaluationResult` for CDP responses
- `normalizeTransportError` for transport-level errors
- 6 failure kinds: `syntax-error`, `runtime-error`, `transport-error`, `no-session`, `promise-rejection`, `timeout`
- Rendering split: infrastructure failures → `text/plain`; user code errors → `Error` object

**Story 2.3 hardens and validates this existing contract.** The implementation changes are small (Task 1: `unserializableValue` handling) but the testing work is the primary deliverable. This story's value is proving NFR5 (no silent failure) and NFR6 (classification parity) through comprehensive deterministic tests.

**Scope boundaries:**

- Story 2.3 normalizes the contract and proves its invariants.
- Story 2.4 adds fast rerun and iteration patterns (IIFE wrapping, state accumulation).
- Story 4.1 extends output with structured rendering and value-presentation semantics.
- Story 4.2 adds display formatting beyond `text/plain`.

### Architecture Guardrails (Must Follow)

- **Layer boundaries:** Kernel cannot import `chrome-remote-interface`. Notebook calls kernel. Kernel calls transport interface. [Source: docs/architecture.md#Architectural-Boundaries]
- **Result normalization:** All execution outcomes use the discriminated union `ExecutionResult`. No raw CDP fields in cell output. [Source: docs/architecture.md#Error-Handling-Patterns, docs/architecture.md#Format-Patterns]
- **State ownership:** Transport owns connection state. Do NOT introduce independent lifecycle flags. [Source: docs/architecture.md#State-Management-Patterns]
- **File naming:** kebab-case files, PascalCase types/interfaces, camelCase functions/variables, UPPER_SNAKE_CASE constants. [Source: docs/architecture.md#Naming-Patterns]
- **Error kind literals:** kebab-case (`promise-rejection`, `timeout`). [Source: docs/architecture.md#API-Naming-Conventions]
- **Tests in `tests/` tree only.** [Source: docs/architecture.md#File-Structure-Patterns]
- **Localization:** All user-facing strings through `vscode.l10n.t()`. Add keys to `l10n/bundle.l10n.json`. [Source: .github/copilot-instructions.md#Coding-Standards]
- **Named interfaces for all non-trivial types.** [Source: .github/copilot-instructions.md#Coding-Standards]
- **Prefer `const` over `let`.** [Source: .github/copilot-instructions.md#Coding-Standards]
- **Do not duplicate library-owned types.** [Source: .github/copilot-instructions.md#Coding-Standards]
- **Classification parity (NFR6):** Sync and async results use the same `ExecutionResult` contract shapes. The `kind` field distinguishes the failure category; downstream rendering does not branch on transport type. [Source: docs/prd.md#NFR6]

### Key Technical Details

#### CDP `unserializableValue` Field

CDP's `Runtime.RemoteObject` has an `unserializableValue` field used for JavaScript values that cannot be represented in JSON:

| JavaScript Value | CDP `type` | CDP `value` | CDP `unserializableValue` |
| ---------------- | ---------- | ----------- | ------------------------- |
| `Infinity`       | `"number"` | absent      | `"Infinity"`              |
| `-Infinity`      | `"number"` | absent      | `"-Infinity"`             |
| `NaN`            | `"number"` | absent      | `"NaN"`                   |
| `-0`             | `"number"` | absent      | `"-0"`                    |
| `123n` (BigInt)  | `"bigint"` | absent      | `"123n"`                  |

The current `serializeRemoteValue` does NOT check `unserializableValue`. It falls through to `result.description ?? result.type ?? "undefined"`, which works by accident when CDP sets `description` but is not a stable contract. The fix is to add an explicit `unserializableValue` branch.

#### Dead `bigint` Branch in `serializeRemoteValue`

The current code has:

```typescript
if (typeof result.value === "bigint") {
  return `${String(result.value)}n`;
}
```

With `returnByValue: true`, CDP never sets `result.value` to a JavaScript BigInt — it uses `unserializableValue: "123n"` instead. The `typeof result.value === "bigint"` check cannot fire at runtime. After adding `unserializableValue` handling, this branch becomes redundant and should be removed.

#### `ExecutionSuccess.type` Uses CDP Type Taxonomy

The `type` field on `ExecutionSuccess` is set to `response.result.subtype ?? response.result.type ?? "unknown"`. These are CDP type/subtype values like `"number"`, `"string"`, `"array"`, `"null"`, `"object"`, `"function"`, `"symbol"`, `"bigint"`. This is intentional — CDP's type taxonomy is a reasonable and stable classification for JavaScript values. The `type` field is **not rendered in cell output** (only `value` is rendered as `text/plain`), so using CDP types does not violate AC 1's "no raw CDP protocol fields visible in cell output" requirement. Story 4.1 may normalize or extend type labels when adding structured rendering.

#### Contract Shape Invariants

The `ExecutionResult` contract guarantees:

**Success (`ok: true`):**

- `value: string` — always present, never undefined. Serialized text representation.
- `type: string` — always present. CDP-derived type label.
- No other properties.

**Failure (`ok: false`):**

- `name: string` — always present. Error class name or synthetic name.
- `message: string` — always present. Human-readable error description.
- `kind: ExecutionFailureKind` — always present. One of the 6 literals.
- `stack?: string` — present when stack trace is available.
- No other properties.

Tests must verify these exact shapes using `Object.keys()` to detect property leakage from CDP response objects.

#### Existing Test Coverage That Validates Contract

The following existing tests in `execution-result.test.ts` already partially validate the contract:

- 5 success-path tests (number, string, boolean, null, undefined) use `assert.deepEqual` which implicitly checks shape.
- 7 failure-path tests verify `kind`, `name`, `message`, and `stack`.
- 4 transport-error tests verify `kind`, `name`, `message`.

What's **missing** and needed for story 2.3:

- Explicit `Object.keys()` checks for property leakage (no extra CDP fields).
- Serialization edge cases (Infinity, NaN, -0, BigInt, Symbol, Function, Array, Object).
- Classification parity test (sync throw vs. async rejection produce equivalent shapes).

### Files to Create or Modify

| File                                         | Action     | Purpose                                                                                                          |
| -------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/kernel/execution-result.ts`             | **Modify** | Add `unserializableValue` to `RemoteObjectLike`, add branch in `serializeRemoteValue`, remove dead bigint branch |
| `tests/unit/kernel/execution-result.test.ts` | **Modify** | Add serialization edge-case tests, contract shape tests, parity tests                                            |
| `tests/unit/kernel/execution-kernel.test.ts` | **Modify** | Verify existing tests cover no-leak requirements; add MIME type and shape assertions if missing                  |

### What NOT to Do

- Do NOT change `ExecutionSuccess` or `ExecutionFailure` interfaces — they are stable from Story 2.1/2.2 and downstream consumers (kernel, notebook controller) depend on their shape.
- Do NOT normalize `ExecutionSuccess.type` to user-friendly labels — that is Story 4.1/4.2 scope for structured rendering.
- Do NOT change `writeSuccessOutput` or `writeFailureOutput` rendering logic — the rendering is correct; this story validates it.
- Do NOT add new `ExecutionFailureKind` values — the 6 existing kinds cover all current execution paths.
- Do NOT change the `evaluate` function signature or CDP parameters in `browser-connect.ts` — transport internals are stable from Story 2.2.
- Do NOT add new localized strings to `l10n/bundle.l10n.json` — no new user-facing messages are introduced in this story.
- Do NOT add integration tests — this story's deliverable is unit-level contract tests. Integration coverage exists in `tests/integration/`.
- Do NOT import `chrome-remote-interface` types in kernel. [Source: docs/architecture.md#Architectural-Boundaries]

### Previous Story Intelligence (Story 2.2)

From Story 2.2 implementation and review:

1. **`replMode: true`** was added to the `evaluate` call without spec authorization. It is flagged for Story 2.4 planning. Do not modify or remove it in this story.
2. **Timeout detection** relies on regex pattern matching (`TIMEOUT_ERROR_PATTERN`) against CDP error text. This is intentionally broad and accepted. Do not narrow it.
3. **`raceWithTimeout`** wraps CDP evaluation with a client-side timeout and best-effort `Runtime.terminateExecution` cancellation. This is transport-internal and not relevant to story 2.3.
4. **Promise rejection detection** via `exceptionDetails.text.includes("(in promise)")` is the stable CDP signal. Already tested.
5. **Post-implementation finding:** Bare non-awaited Promise expressions serialize as `{}`. This is accepted for Story 2.2 and planned for Story 2.4 (async IIFE wrapping).
6. **Test patterns:** Tests use `node:test` and `node:assert/strict`. Manual fakes, no mocking framework. `createLocalizeMock()` shared utility. Tests import from compiled `.js` paths.
7. **`createResponse()` helper** casts `Partial<BrowserRuntimeEvaluateResult>` to full type for test convenience. Reuse this pattern.

### Epic 1 Retro Lessons (Carry Forward)

1. **Transport owns lifecycle** — kernel checks session, does not manage connection state.
2. **Normalized errors only** — no raw CDP leaks to cell output.
3. **Localization from the start** — every user-facing string through `vscode.l10n.t()`.
4. **Named interfaces for all non-trivial types.**
5. **`const` over `let` with mutation.**
6. **Do not duplicate library types.**
7. **Concurrency guard mindset for Promise-based flows.**

### Project Structure Notes

No new directories or files are created. All changes are within existing modules established by Story 2.1:

- `src/kernel/execution-result.ts` — the `RemoteObjectLike` interface and `serializeRemoteValue` function
- `tests/unit/kernel/execution-result.test.ts` — contract and edge-case tests
- `tests/unit/kernel/execution-kernel.test.ts` — no-leak verification of existing tests

### References

- [Source: docs/epics/epic-2-execute-javascript-cells-no-intentional-capture.md#Story-2.3] — AC definitions
- [Source: docs/architecture.md#Format-Patterns] — normalized result contract requirements
- [Source: docs/architecture.md#Error-Handling-Patterns] — error normalization mandate
- [Source: docs/prd.md#FR10] — return execution values to notebook output
- [Source: docs/prd.md#FR11] — surface errors as notebook output
- [Source: docs/prd.md#FR14] — shared result contract with transport-boundary isolation
- [Source: docs/prd.md#NFR5] — no silent failure
- [Source: docs/prd.md#NFR6] — classification parity across execution paths
- [Source: docs/ux-spec/10-component-strategy.md#Cell-Output-Envelope-Contract] — output envelope spec
- [Source: docs/stories/2-2-run-asynchronous-javascript-cells.md] — previous story implementation and review findings
- [Source: docs/stories/2-1-run-synchronous-javascript-cells.md] — baseline synchronous pipeline
- [Source: .github/copilot-instructions.md] — coding standards and stable technical constraints

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
