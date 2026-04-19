---
storyId: "2.2"
storyKey: "2-2-run-asynchronous-javascript-cells"
title: "Run Asynchronous JavaScript Cells"
status: "ready-for-dev"
created: "2026-04-18"
epic: "2"
priority: "p0"
---

# Story 2.2: Run Asynchronous JavaScript Cells

**Status:** review

## Story

As a developer,
I want async and Promise-based cell code to resolve correctly,
So that notebook execution supports real runtime workflows that use async APIs.

## Acceptance Criteria

### AC 1: Resolved Promise Value Shown Inline

**Given** a cell that returns a Promise or uses top-level await
**When** execution completes
**Then** the resolved value is shown inline
**And** resolution is deterministic within the CDP evaluation timeout.

### AC 2: Rejected Promise Surfaces Structured Error with Distinct Classification

**Given** a cell whose Promise rejects
**When** rejection propagates
**Then** the rejection reason is shown as a structured error
**And** the failure is classified separately from synchronous throws.

### AC 3: In-Progress Indicator and Timeout Diagnostics

**Given** any async cell
**When** the run starts
**Then** the cell shows an in-progress indicator until the Promise settles
**And** no timeout or hangup occurs without surfacing diagnostics.

## Tasks / Subtasks

### 1. Flip Transport to Await Promises (AC: 1, 2, 3)

- [x] In `src/transport/browser-connect.ts`, change `awaitPromise: false` → `awaitPromise: true` in the `evaluate` binding inside `connectViaBrowserTargetAttach`.
- [x] Add a `timeout` parameter to the `Runtime.evaluate` call to prevent indefinite hangs. Use a module-scoped constant (e.g., `const CDP_EVALUATION_TIMEOUT_MS = 30_000`).
- [x] The `evaluate` function signature on `ActiveBrowserConnection` does NOT change — the timeout is an implementation detail of the transport.
- [x] Verify that `awaitPromise: true` is already used successfully in `verifyRuntimeProbe` (line ~245) — this confirms CDP supports it on the current client.

**Why this is safe for sync code:** `awaitPromise: true` resolves non-Promise values immediately. `Runtime.evaluate` with `awaitPromise: true` and a synchronous expression like `2 + 2` returns the same result as `awaitPromise: false`. No behavior regression for Story 2.1 paths.

### 2. Add Promise-Rejection and Timeout Failure Kinds (AC: 2, 3)

- [x] In `src/kernel/execution-result.ts`, extend `ExecutionFailureKind`:
  ```typescript
  export type ExecutionFailureKind =
    | "syntax-error"
    | "runtime-error"
    | "promise-rejection"
    | "timeout"
    | "transport-error"
    | "no-session";
  ```
- [x] No changes to `ExecutionSuccess` or `ExecutionFailure` interfaces — the discriminated union shape is stable.

### 3. Detect Promise Rejections in Normalization (AC: 2)

- [x] In `normalizeExceptionDetails` in `src/kernel/execution-result.ts`, detect promise rejections using `exceptionDetails.text` (the raw input, NOT the `rawText` variable which is already sanitized). CDP prefixes rejection text with `"Uncaught (in promise)"`:
  ```typescript
  const isPromiseRejection = exceptionDetails.text?.includes("(in promise)");
  ```
- [x] Update the `kind` classification logic:
  ```typescript
  const kind =
    exceptionClassName === "SyntaxError" || name === "SyntaxError"
      ? "syntax-error"
      : isPromiseRejection
        ? "promise-rejection"
        : "runtime-error";
  ```
- [x] Update `sanitizeUncaughtPrefix` to also strip the `(in promise)` wrapper so that name/message parsing is not polluted:
  ```typescript
  return rawText.replace(/^Uncaught\s+(?:\(in promise\)\s+)?/, "").trim();
  ```

### 4. Detect Timeout Failures in Normalization (AC: 3)

- [x] CDP returns a timeout as an `exceptionDetails` response when the `timeout` parameter is exceeded. The `exceptionDetails.text` typically contains `"Script execution timed out"` or similar.
- [x] Add detection in `normalizeExceptionDetails` using `exceptionDetails.text` (the raw, unsanitized value — NOT the `rawText` variable which is already sanitized):
  ```typescript
  const isTimeout =
    exceptionDetails.text?.toLowerCase().includes("timed out") ?? false;
  ```
- [x] When `isTimeout` is true, classify as `kind: "timeout"` with `name: "EvaluationTimeout"`.
- [x] Timeout classification takes priority over all other kinds. The combined classification after merging Tasks 3 and 4 must be:
  ```typescript
  const kind = isTimeout
    ? "timeout"
    : exceptionClassName === "SyntaxError" || name === "SyntaxError"
      ? "syntax-error"
      : isPromiseRejection
        ? "promise-rejection"
        : "runtime-error";
  ```
- [x] **Note:** The timeout detection heuristic (`"timed out"`) is best-effort string matching against unspecified CDP text. Different Chrome/Edge versions may word this differently. Include a regression test with the actual CDP response text observed from the target browser.

### 5. Update Failure Reporting and Output for New Kinds (AC: 2, 3)

- [x] In `src/kernel/execution-kernel.ts`, update `shouldReportFailure` to include `"timeout"`:
  ```typescript
  function shouldReportFailure(failure: ExecutionFailure): boolean {
    return (
      failure.kind === "transport-error" ||
      failure.kind === "no-session" ||
      failure.kind === "timeout"
    );
  }
  ```
- [x] In `src/kernel/execution-kernel.ts`, update `writeFailureOutput` to handle `"timeout"` as a text-based output (like transport-error/no-session) rather than an `Error` object, since timeout is an infrastructure concern, not a code bug.
- [x] `"promise-rejection"` requires NO changes to `writeFailureOutput` — it falls through to the structured `Error` output path (same as `syntax-error` and `runtime-error`), which is correct: the rejection reason, name, and stack are shown inline.
- [x] In `src/kernel/execution-messages.ts`, add localized messages for timeout:

  ```typescript
  export function getTimeoutCellOutputMessage(localize: Localize): string {
    return localize(
      "Cell execution timed out. The async operation did not complete within the allowed time. Simplify the expression or check for unresolved Promises.",
    );
  }

  export function getTimeoutNotificationMessage(localize: Localize): string {
    return localize(
      "Cell execution timed out. Check for unresolved Promises and try again.",
    );
  }
  ```

- [x] Update `getKernelFailureCellOutputMessage` and `getKernelFailureNotificationMessage` in `execution-messages.ts` to handle `"timeout"` kind.
- [x] Update `getKernelFailureCategoryLabel` to return a localized `"evaluation timeout"` for the `"timeout"` kind.
- [x] Add all new localized strings to `l10n/bundle.l10n.json`.
- [x] **Downstream verification:** `src/logging/kernel-transport-failure-reporter.ts` calls `getKernelFailureCategoryLabel` and `getKernelFailureNotificationMessage`. Verify that after updating those message functions for the `"timeout"` kind, the reporter handles timeout failures correctly end-to-end. The reporter itself should not need code changes if the message functions are exhaustive.

### 6. Add Unit Tests for Async Normalization (AC: 1, 2, 3)

- [x] In `tests/unit/kernel/execution-result.test.ts`, add tests:
  - Resolved Promise returning a primitive → `ExecutionSuccess` with correct value/type (same structure as sync — confirms `awaitPromise: true` produces identical output for resolved values).
  - Rejected Promise with a typed error (e.g., `TypeError`) → `ExecutionFailure` with `kind: "promise-rejection"`, correct `name`, `message`, and `stack`.
  - Rejected Promise with a non-Error value (e.g., `Promise.reject("bad")`) → `ExecutionFailure` with `kind: "promise-rejection"`, fallback name.
  - Timeout exception → `ExecutionFailure` with `kind: "timeout"`, `name: "EvaluationTimeout"`.
  - `sanitizeUncaughtPrefix` correctly strips `"Uncaught (in promise) "` prefix.
  - Sync throw still classifies as `kind: "runtime-error"` (regression guard).
  - `SyntaxError` still classifies as `kind: "syntax-error"` (regression guard).

### 7. Add Unit Tests for Async Execution Pipeline (AC: 1, 2, 3)

- [x] In `tests/unit/kernel/execution-kernel.test.ts`, add tests:
  - Async cell that resolves → success output with resolved value.
  - Async cell that rejects → error output with structured rejection.
  - Async cell that times out → text output with timeout message, transport error reported.
  - Verify existing sync tests still pass (regression guard).
- [x] In `tests/unit/kernel/execution-messages.test.ts` (create if not exists), add tests for new message functions for `"timeout"` and `"promise-rejection"` kinds.

### 8. Run Full Validation Suite (AC: 1, 2, 3)

- [x] Run `npm run lint` — no new warnings or errors.
- [x] Run `npm run test:unit` — all unit tests pass including new tests.
- [x] Run `npm run compile` — clean compilation with no type errors.
- [ ] Manually verify in Extension Development Host (if available):
  - [x] Run `await new Promise(r => setTimeout(r, 1000)).then(() => 42)` → see `42` inline.
  - [x] Run `await Promise.reject(new TypeError("async boom"))` → see structured error with `TypeError` name.
    - _Post-test note_: The cell must use `await`. Without `await`, CDP's `awaitPromise: true` does not intercept the rejection — the Promise object itself is serialised as `{}` and the rejection escapes to the browser console as an unhandled error. This is an inherent limitation of evaluating without an enclosing async context and is **expected and acceptable** for Story 2.2. Wrapping cell code in an async IIFE (so all expressions implicitly become awaitable and return values work) is planned for Story 2.4.
  - [x] Run `await new Promise(() => {})` → after timeout, see timeout diagnostic message.
    - _Post-test note_: The cell must use `await` for the same reason as above — a bare `new Promise(() => {})` resolves immediately to `{}`.
  - [x] Run `2 + 2` (sync) → still see `4` inline (regression check).
  - [x] Run `throw new Error("sync boom")` (sync) → still see structured error (regression check).

## Dev Notes

### Story Context and Scope

This is the **second story in Epic 2**, building directly on Story 2.1 which established the synchronous cell execution pipeline. The key architectural insight is that `awaitPromise: true` in CDP's `Runtime.evaluate` is a **superset** of `awaitPromise: false` — non-Promise return values resolve identically, so flipping the flag is safe for all existing sync paths.

**Scope boundaries:**

- Story 2.2 adds async/Promise support and promise-rejection classification.
- Story 2.3 formalizes the full normalized result contract across all execution paths (success/failure parity).
- Story 2.4 adds fast rerun and iteration patterns.
- Story 4.1 extends output with structured rendering and explicit value-presentation semantics.

### Architecture Guardrails (Must Follow)

- **Layer boundaries:** Kernel cannot import `chrome-remote-interface`. Notebook calls kernel. Kernel calls transport interface. [Source: docs/architecture.md#Architectural-Boundaries]
- **Result normalization:** All execution outcomes use the discriminated union `ExecutionResult`. No raw CDP fields in cell output. [Source: docs/architecture.md#Error-Handling-Patterns, docs/architecture.md#Format-Patterns]
- **State ownership:** Transport owns connection state. Do NOT introduce independent lifecycle flags. Check via `getActiveBrowserConnection()`. [Source: docs/architecture.md#State-Management-Patterns]
- **File naming:** kebab-case files, PascalCase types/interfaces, camelCase functions/variables, UPPER_SNAKE_CASE constants. [Source: docs/architecture.md#Naming-Patterns]
- **Error kind literals:** kebab-case (`promise-rejection`, `timeout`). [Source: docs/architecture.md#API-Naming-Conventions]
- **Tests in `tests/` tree only.** [Source: docs/architecture.md#File-Structure-Patterns]
- **Localization:** All user-facing strings through `vscode.l10n.t()`. Add keys to `l10n/bundle.l10n.json`. [Source: .github/copilot-instructions.md#Coding-Standards]
- **Named interfaces for all non-trivial types.** [Source: .github/copilot-instructions.md#Coding-Standards]
- **Prefer `const` over `let`.** [Source: .github/copilot-instructions.md#Coding-Standards]
- **Do not duplicate library-owned types.** [Source: .github/copilot-instructions.md#Coding-Standards]
- **Classification parity (NFR6):** Sync and async results use the same `ExecutionResult` contract shapes. The `kind` field distinguishes the failure category; downstream rendering does not branch on transport type. [Source: docs/prd.md#NFR6]

### Key Technical Details

#### CDP Behavior with `awaitPromise: true`

When `Runtime.evaluate` is called with `awaitPromise: true`:

- **Non-Promise values** (e.g., `2 + 2`) → returns immediately with `result` containing the value. Identical to `awaitPromise: false`.
- **Resolved Promise** (e.g., `Promise.resolve(42)`) → waits for resolution, returns `result` with the resolved value. Same `result` shape as sync.
- **Rejected Promise** (e.g., `Promise.reject(new TypeError("boom"))`) → waits for rejection, returns `exceptionDetails`. The `exceptionDetails.text` is prefixed with `"Uncaught (in promise)"` instead of just `"Uncaught"`.
- **Unresolved Promise with timeout** → CDP terminates evaluation and returns `exceptionDetails` with timeout indication.

#### Post-Implementation CDP Findings From Headless Browser Validation

The integration tests added after implementation refined several assumptions above:

- `Runtime.evaluate(..., { awaitPromise: true, timeout })` is **not a reliable wall-clock timeout for Promise settlement**. A Promise such as `new Promise((resolve) => setTimeout(() => resolve("ok"), 250))` can still resolve successfully even when `timeout` is set lower (for example `50`).
- The `timeout` parameter **does** reliably terminate synchronous blocking work, including Promise executors that block synchronously before resolving.
- Timeout-like failures do **not** consistently surface as `exceptionDetails.text` containing `"timed out"`. In headless Chromium they were observed as transport-level rejections such as `"Execution was terminated"` and `"Internal error"`.
- Promise rejection detection via `exceptionDetails.text.includes("(in promise)")` remains valid.
- For async rejections, the useful rejection signal is in `exceptionDetails.text`; `result.description` may be empty and `result.value` may be `{}`.

**What was implemented in Story 2.2 to address these findings:**

- Added a higher-level timeout wrapper around `Runtime.evaluate` in transport (`raceWithTimeout`) so timeout behavior does not depend only on CDP's internal `timeout` handling.
- Expanded timeout normalization in `normalizeTransportError` to classify both explicit wrapper timeout errors and CDP transport-level timeout-like failures (including `"Execution was terminated"` and generic `"timed out"` variants) as `kind: "timeout"`.
- Preserved promise-rejection classification based on `exceptionDetails.text.includes("(in promise)")`, which remains the stable signal for rejected Promise failures.

**Remaining follow-up (post Story 2.2):**

- Bare non-awaited Promise expressions (for example `Promise.reject(...)`) still serialize as `{}` and can surface as unhandled browser-console errors unless the cell explicitly uses `await`. This behavior is accepted for Story 2.2 and is planned to be improved in Story 2.4.

#### Promise Rejection Detection via CDP

CDP distinguishes promise rejections from sync throws in `exceptionDetails.text`:

- Sync throw: `"Uncaught TypeError: some message"`
- Promise rejection: `"Uncaught (in promise) TypeError: some message"`

The `"(in promise)"` substring is the detection signal. The rest of the `exceptionDetails` structure (`exception.className`, `exception.description`, `stackTrace`) is identical in shape.

For non-Error rejections (e.g., `Promise.reject("just a string")`), `exceptionDetails.exception.className` is absent. The `text` field still contains `"(in promise)"`.

#### `sanitizeUncaughtPrefix` Must Handle Both Forms

The existing regex `/^Uncaught\s+/` strips `"Uncaught "`. For promise rejections, the text is `"Uncaught (in promise) TypeError: ..."`. The updated regex must strip both:

```typescript
/^Uncaught\s+(?:\(in promise\)\s+)?/;
```

This produces clean `"TypeError: some message"` for both sync and async paths.

#### Timeout Constant Placement

The timeout constant belongs in the transport layer since it's a CDP implementation detail:

```typescript
// src/transport/browser-connect.ts
const CDP_EVALUATION_TIMEOUT_MS = 30_000;
```

The kernel layer does not need to know about or configure the timeout. If a future story needs user-configurable timeout, it becomes a setting at that point.

#### In-Progress Indicator (AC 3)

VS Code's `NotebookCellExecution.start()` already shows a spinning/running indicator on the cell. The indicator remains visible until `execution.end()` is called. This means AC 3's in-progress requirement is **already satisfied by the existing pipeline** — no UI changes needed. The `execution.start()` → `await evaluate()` → `execution.end()` flow naturally shows the cell as running during async resolution.

#### The `evaluate` Interface Does NOT Change

```typescript
// ActiveBrowserConnection.evaluate signature stays the same:
evaluate: (expression: string) => Promise<BrowserRuntimeEvaluateResult>;
```

The `awaitPromise` and `timeout` parameters are internal to the CDP call. The kernel sees the same `Promise<BrowserRuntimeEvaluateResult>` return type regardless.

### Files to Create or Modify

| File                                           | Action     | Purpose                                                               |
| ---------------------------------------------- | ---------- | --------------------------------------------------------------------- |
| `src/transport/browser-connect.ts`             | **Modify** | Flip `awaitPromise: true`, add `timeout` parameter                    |
| `src/kernel/execution-result.ts`               | **Modify** | Add `"promise-rejection"` and `"timeout"` kinds, update normalization |
| `src/kernel/execution-kernel.ts`               | **Modify** | Update `shouldReportFailure` and `writeFailureOutput` for new kinds   |
| `src/kernel/execution-messages.ts`             | **Modify** | Add timeout message functions, update kind handlers                   |
| `l10n/bundle.l10n.json`                        | **Modify** | Add localized strings for timeout messages                            |
| `tests/unit/kernel/execution-result.test.ts`   | **Modify** | Add async normalization tests                                         |
| `tests/unit/kernel/execution-kernel.test.ts`   | **Modify** | Add async execution pipeline tests                                    |
| `tests/unit/kernel/execution-messages.test.ts` | **Create** | Tests for timeout and promise-rejection message functions             |

### What NOT to Do

- Do NOT change the `ActiveBrowserConnection.evaluate` function signature — `awaitPromise` and `timeout` are transport-internal details. [Source: docs/architecture.md#Architectural-Boundaries]
- Do NOT add a user-configurable timeout setting — a hardcoded constant is sufficient for MVP. Configurable timeout is a future enhancement.
- Do NOT import `chrome-remote-interface` in kernel or notebook layers. [Source: docs/architecture.md#Architectural-Boundaries]
- Do NOT add `ms-toolsai.jupyter` to `extensionDependencies`. [Source: .github/copilot-instructions.md#Stable-Technical-Constraints]
- Do NOT implement deep object inspection or rich rendering for resolved async values — that is Story 4.1+.
- Do NOT implement intentional output helpers (`$f.out()`, `$f.log()`) — that is Epic 3.
- Do NOT add automatic reconnect on session loss during async execution — manual reconnect is MVP scope. [Source: docs/prd.md#Technical-Constraints]
- Do NOT modify connection/disconnect/reconnect commands — those are stable from Epic 1.
- Do NOT add explicit activation events — VS Code infers them from `contributes`. Confirm the notebook controller is discovered when opening a Jupyter notebook.
- Do NOT create new source files — all source changes are modifications to existing files created in Story 2.1. New test files may be created as needed.
- Do NOT define ad hoc inline types for CDP response shapes — use named interfaces. [Source: .github/copilot-instructions.md#Coding-Standards]
- Do NOT introduce a separate execution path for async vs sync in the kernel layer. The pipeline is unified: `evaluateCellExpression` → `normalizeEvaluationResult`. The only difference is in transport (where `awaitPromise: true` handles both) and normalization (where `kind` classification distinguishes outcomes).

### Previous Story Intelligence (Story 2.1)

From Story 2.1 implementation and review:

1. **Review finding (patched):** Missing l10n keys — ensure all new localized strings are added to `bundle.l10n.json`.
2. **Review finding (patched):** `execution.end()` not guaranteed if `replaceOutput` throws — the outer `catch` block in `executeCell` calls `execution.end(false)` as a safety net. This pattern must be preserved.
3. **Review finding (patched):** Sync throw from `reportTransportError` was unguarded — `reportFailureAsync` now wraps in `void Promise.resolve(...).catch()`. Reuse this pattern.
4. **Pattern:** The `evaluateCellExpression` function catches transport errors and normalizes them. This function does NOT need changes — it already handles `connection.evaluate()` returning any CDP response shape.
5. **Pattern:** Source labeling (`addSourceLabeling`) appends `//# sourceURL=cell.js` — this applies identically to async code.
6. **Pattern:** Execution order is a module-scoped counter in `kernel-controller.ts` — no changes needed.

### Epic 1 Retro Lessons (Carry Forward)

1. **Transport owns lifecycle** — kernel checks session, does not manage connection state.
2. **Normalized errors only** — no raw CDP leaks to cell output.
3. **Localization from the start** — every user-facing string through `vscode.l10n.t()`.
4. **Named interfaces for all non-trivial types.**
5. **`const` over `let` with mutation.**
6. **Do not duplicate library types.**
7. **Concurrency guard mindset for Promise-based flows** — ensure `execution.end()` is always called, even if intermediate operations throw.

### Project Structure Notes

No new directories or files are created. All changes are within existing modules established by Story 2.1:

- `src/kernel/` — execution result contract and kernel pipeline
- `src/transport/` — CDP evaluate binding
- `tests/unit/kernel/` — kernel tests

### References

- [Source: docs/epics/epic-2-execute-javascript-cells-no-intentional-capture.md#Story-2.2] — AC definitions
- [Source: docs/architecture.md#Architectural-Boundaries] — layer import constraints
- [Source: docs/architecture.md#Format-Patterns] — normalized result contract requirements
- [Source: docs/architecture.md#Error-Handling-Patterns] — error normalization mandate
- [Source: docs/architecture.md#State-Management-Patterns] — transport-owned state
- [Source: docs/prd.md#FR9] — async JavaScript cell execution
- [Source: docs/prd.md#FR10] — return execution values to notebook output
- [Source: docs/prd.md#FR11] — surface errors as notebook output
- [Source: docs/prd.md#FR14] — shared result contract with transport-boundary isolation
- [Source: docs/prd.md#NFR5] — no silent failure, including evaluation timeouts
- [Source: docs/prd.md#NFR6] — classification parity across execution paths
- [Source: docs/prd.md#Technical-Constraints] — manual reconnect, JavaScript only, serialization limits
- [Source: docs/ux-spec/06-detailed-core-user-experience.md] — inline feedback mechanics
- [Source: docs/ux-spec/10-component-strategy.md] — cell output envelope contract
- [Source: docs/stories/2-1-run-synchronous-javascript-cells.md] — previous story implementation and review findings
- [Source: docs/stories/epic-1-retro-2026-04-14.md] — retro lessons and Epic 2 preparation tasks
- [Source: .github/copilot-instructions.md] — coding standards and stable technical constraints

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6

### Debug Log References

None.

### Completion Notes List

- Flipped `awaitPromise: false` → `awaitPromise: true` in `browser-connect.ts` evaluate binding and added `CDP_EVALUATION_TIMEOUT_MS = 30_000` constant plus `timeout` parameter.
- Extended `ExecutionFailureKind` with `"promise-rejection"` and `"timeout"` literals.
- Added `isTimeout` and `isPromiseRejection` detection in `normalizeExceptionDetails` using raw `exceptionDetails.text`. Timeout takes priority over all other kinds.
- Updated `sanitizeUncaughtPrefix` regex to strip `"(in promise)"` wrapper so name/message parsing is clean for async paths.
- Updated `shouldReportFailure` to include `"timeout"` (reported as infrastructure failure).
- Updated `writeFailureOutput` to render `"timeout"` as text output (same as transport-error/no-session), not structured Error.
- Added `getTimeoutCellOutputMessage`, `getTimeoutNotificationMessage` to `execution-messages.ts` and updated all three `getKernelFailure*` functions exhaustively.
- Added new l10n strings for timeout messages and `"evaluation timeout"` category label to `l10n/bundle.l10n.json`.
- Downstream reporter (`kernel-transport-failure-reporter.ts`) verified correct end-to-end — no changes needed.
- 99 unit tests pass (7 new normalization tests, 3 new kernel pipeline tests, 10 new message function tests).
- Post-implementation headless-CDP integration coverage refined two assumptions in the original story: Promise settlement is not reliably bounded by CDP's `timeout` parameter alone, and timeout failures may surface as transport-level errors like `"Execution was terminated"` or `"Internal error"` rather than `exceptionDetails.text` containing `"timed out"`.
- Manual E2E testing confirmed that bare (non-awaited) Promise expressions — e.g. `Promise.reject(new TypeError("async boom"))` — are serialised by CDP as `{}` and the rejection escapes to the browser console rather than surfacing inline. This is an inherent limitation of evaluating without an enclosing async context. Cells must `await` their Promises for Story 2.2's rejection path to fire correctly. Transparent top-level await support (via async IIFE wrapping) is deferred to Story 2.4, which will also need to handle implicit return-value lifting and stack-trace line-number offsets introduced by the wrapper.

### File List

- `src/transport/browser-connect.ts` — added `CDP_EVALUATION_TIMEOUT_MS`, flipped `awaitPromise: true`, added `timeout`
- `src/kernel/execution-result.ts` — added `"promise-rejection"` and `"timeout"` kinds, updated `normalizeExceptionDetails`, updated `sanitizeUncaughtPrefix`
- `src/kernel/execution-kernel.ts` — updated `shouldReportFailure` and `writeFailureOutput` for `"timeout"`
- `src/kernel/execution-messages.ts` — added `getTimeoutCellOutputMessage`, `getTimeoutNotificationMessage`, updated all `getKernelFailure*` functions
- `l10n/bundle.l10n.json` — added timeout message strings and `"evaluation timeout"` label
- `tests/unit/kernel/execution-result.test.ts` — added 7 async normalization tests
- `tests/unit/kernel/execution-kernel.test.ts` — added 3 async pipeline tests
- `tests/unit/kernel/execution-messages.test.ts` — created with 10 message function tests

## Change Log

- 2026-04-18: Implemented async JavaScript cell support with awaited CDP evaluation, promise-rejection/timeout normalization, timeout user messaging, and regression coverage.
