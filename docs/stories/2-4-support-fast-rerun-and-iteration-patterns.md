---
storyId: "2.4"
storyKey: "2-4-support-fast-rerun-and-iteration-patterns"
title: "Support Fast Rerun and Iteration Patterns"
status: "done"
created: "2026-04-26"
epic: "2"
priority: "p0"
---

# Story 2.4: Support Fast Rerun and Iteration Patterns

**Status:** done

## Story

As a developer,
I want to rerun edited cells quickly with predictable execution state,
So that I can iterate rapidly without connection overhead or state confusion.

## Acceptance Criteria

### AC 1: Rerun Without Reconnect Cycle

**Given** an active session
**When** I rerun an edited cell
**Then** execution begins without a reconnect cycle
**And** the result reflects the current cell content.

### AC 2: Default State Accumulation Across Cells

**Given** default kernel semantics
**When** multiple cells run in sequence
**Then** state accumulates within the session as expected (top-level `let`, `const`, `var`, function declarations, and `globalThis` mutations remain visible to subsequent cells in the same session)
**And** no unintended isolation occurs unless explicitly requested.

### AC 3: Opt-In Per-Cell Isolation

**Given** intentional namespace isolation is desired
**When** a cell opts into isolation through the documented kernel contract (cell metadata flag — see Dev Notes "Isolation opt-in contract")
**Then** it executes without inheriting prior cell state into its lexical scope
**And** the isolation boundary is visible from cell output metadata or output content so the user can confirm the boundary applied.

### AC 4: Inline Outcome Visibility

**Given** any cell run outcome
**When** execution completes
**Then** success or failure is visible inline in the cell's output area without navigating away from the notebook
**And** the next edit-run cycle requires no additional navigation steps.

### AC 5: Stable Per-Cell `//# sourceURL` Identity

**Given** any cell run
**When** the kernel emits the cell expression to the browser
**Then** the cell carries a per-cell `//# sourceURL` directive equal to `NotebookCell.document.uri.toString()` (the exact `vscode-notebook-cell://<authority>/<notebook-path>#<opaque-fragment>` resource URI VS Code uses for that cell)
**And** the directive is byte-identical across reruns of the same cell within the session
**And** two distinct cells in the same notebook never share the same `//# sourceURL`.

### AC 6: Wrapper Preserves 1:1 User-Line Mapping

**Given** the isolation wrapper is applied to a cell (per AC 3)
**When** the wrapped expression is sent to the browser
**Then** wrapper prefix and suffix are concatenated **on the same line** as the user's first and last source line respectively (Pattern B — same-line concatenation, locked by the spike)
**And** for every user-visible line `N` in the cell editor, the corresponding `Debugger.scriptParsed`/`Debugger.paused` `lineNumber` reports the same `N` (zero-based) with no offset
**And** no synthesized line is inserted before, between, or after user lines that would shift user line numbers in the browser's Sources panel
**And** the `//# sourceURL` directive is appended on a new line after the wrapped suffix (this trailing line does not affect any user line mapping).

### AC 7: Passive Provider Posture Preserved

**Given** the kernel is connected to a target
**When** any cell runs (with or without the isolation wrapper)
**Then** the extension does **not** call `Debugger.enable` on its per-target session (Passive Provider posture — locked by spike Q2)
**And** evaluation continues to use `Runtime.evaluate({ expression, replMode: true, awaitPromise: true, returnByValue: true, generatePreview: false, timeout: <existing> })`.

### AC 8: Cell-Toolbar Toggle for Isolation Opt-In/Out

**Given** a JavaScript notebook cell handled by the Browser Kernel controller
**When** the user views the cell
**Then** the cell title toolbar shows a single toggle action labeled `"Isolate Cell"` (when the cell is currently shared) or `"Share Cell State"` (when the cell is currently isolated), localized via `vscode.l10n.t(...)`
**And** the toggle is contributed only for cells in notebooks whose controller is `jupyter-browser-kernel` and whose cell language is `javascript` (use a `when` clause built from `notebookType` and `notebookCellResource`-compatible context, or a context key set by the controller — see Dev Notes "Toolbar `when` clause").

**Given** a cell whose `metadata.jupyterBrowserKernel.isolated` is missing or `!== true`
**When** the user invokes the toggle action
**Then** the extension applies a `WorkspaceEdit` containing a `NotebookEdit.updateCellMetadata(cellIndex, { ...existingMetadata, jupyterBrowserKernel: { ...existing, isolated: true } })` for that cell
**And** the toolbar action updates to the `"Share Cell State"` label and a distinct icon variant
**And** the change is undoable via the standard VS Code undo stack.

**Given** a cell whose `metadata.jupyterBrowserKernel.isolated === true`
**When** the user invokes the toggle action
**Then** the extension removes the `isolated` key from the `jupyterBrowserKernel` metadata sub-object via `NotebookEdit.updateCellMetadata`. If `jupyterBrowserKernel` becomes empty after removal, the empty sub-object is removed too
**And** the toolbar action updates to the `"Isolate Cell"` label.

**Given** a cell whose isolation state has just been toggled
**When** the user runs the cell next
**Then** the kernel reads the freshly-updated metadata and applies (or does not apply) the Pattern B wrapper accordingly — i.e., the toggle takes effect on the next run with no extension reload.

## Tasks / Subtasks

### 1. Define the Per-Cell SourceURL Contract (AC: 5)

The current production code already emits `\n//# sourceURL=${cell.document.uri.toString()}` (see [src/kernel/execution-kernel.ts](../../src/kernel/execution-kernel.ts) `addSourceLabeling`). This task locks that behavior under explicit unit coverage and a named helper.

- [x] In `src/kernel/`, extract a small named helper `buildCellExpression(userCode: string, sourceUri: string, options: { isolate: boolean }): string` (see Task 2 for `isolate` semantics). The helper is the single source of truth for what is sent to `connection.evaluate`.
- [x] When `isolate: false`, the helper returns `${userCode}\n//# sourceURL=${sourceUri}\n` (same `\n` placement as today; trailing `\n` is recommended by spike findings — see Dev Notes "SourceURL placement").
- [x] Replace the inline `addSourceLabeling` call site in `executeCell` with the new helper.
- [x] Use `cell.document.uri.toString()` unchanged. Do NOT reconstruct, encode, decode, or normalize the URI. The exact runtime cell URI string is the source of identity. [Source: spike/cdp-sourceurl-debugger-findings.md#Decisions-Locked, .memory/cdp-eval-notes.md]
- [x] Update [tests/unit/kernel/execution-kernel.test.ts](../../tests/unit/kernel/execution-kernel.test.ts) line 185 expectation to match the helper output (account for trailing `\n` if introduced; otherwise leave the assertion shape unchanged).

### 2. Implement the Pattern B Isolation Wrapper (AC: 3, 6, 7)

Pattern B is the only wrapper strategy permitted. It wraps the user expression with `(async()=>{` on the **same line** as the user's first source line and `})()` on the **same line** as the user's last source line. This preserves user-visible line numbers exactly, is breakpoint-friendly per spike Q1+Q5, and supports top-level `await` inside the wrapper. [Source: spike/cdp-sourceurl-debugger-findings.md#Q5, spike/cdp-sourceurl-debugger-findings.md#Decisions-Locked]

- [x] In the new helper from Task 1, when `isolate: true`, build the wrapped expression as exactly:

  ```text
  (async()=>{<userCode-line-1>\n<userCode-line-2>\n...\n<userCode-line-N>})()
  //# sourceURL=<sourceUri>
  ```

  Concretely: split `userCode` on `\n`, prepend `(async()=>{` to the first element, append `})()` to the last element, rejoin with `\n`, then append `\n//# sourceURL=${sourceUri}\n`.

- [x] Single-line user code is a degenerate case: `(async()=>{<userCode>})()`. The helper must produce that exact shape (no synthesized newline before or after user code).

- [x] Empty user code (`""`) must produce a syntactically valid no-op `(async()=>{})()`. (This guards against degenerate cells; the kernel still emits the sourceURL line.)

- [x] Do NOT attempt to apply the wrapper to cells that already start with `(async()=>{` or to "auto-detect" wrapping — the contract is binary: wrapper is applied if and only if the isolation flag is set.

- [x] Do NOT introduce inline `//# sourceMappingURL=` directives, multi-line wrappers, `Function`-constructor wrapping, `Runtime.compileScript` / `Runtime.runScript`, or any source-map fallback. These were rejected by spike Q6. [Source: spike/cdp-sourceurl-debugger-findings.md#Q6]

- [x] Do NOT call `Debugger.enable`, `Debugger.setBreakpointByUrl`, or any Debugger-domain method from this story. Story 2.5 owns the Debugger mirror. [Source: spike/cdp-sourceurl-debugger-findings.md#Decisions-Locked]

### 3. Define the Isolation Opt-In Contract (AC: 3)

This story owns the wire-format for opt-in isolation. The recommended contract uses VS Code notebook cell metadata, which round-trips through `.ipynb` and is editable from the Cell Properties UI.

- [x] Pick the metadata key `cell.metadata.jupyterBrowserKernel.isolated` (boolean). When present and `=== true`, the kernel applies the Pattern B wrapper for that cell. Any other value (including missing, `false`, non-boolean, non-object metadata) means **not isolated** — default state-accumulation semantics apply. [Source: docs/architecture.md#API-Naming-Conventions, .github/copilot-instructions.md#Coding-Standards — settings/metadata namespace `jupyterBrowserKernel.*`]
- [x] In [src/kernel/execution-kernel.ts](../../src/kernel/execution-kernel.ts) `executeCell`, read the metadata before building the expression. Pass the resulting boolean into the helper from Task 1.
- [x] Validate with a defensive type guard. Do not throw on malformed metadata; default to `isolate: false`.
- [x] After successful execution of an isolated cell, append a small annotation to the cell output indicating the isolation boundary applied — e.g., a localized `text/plain` line `"(isolated cell)"`. Place the annotation **before** the value output so it is visible alongside the result. The annotation must be:
  - Localized via `vscode.l10n.t(...)` (add a new key to [l10n/bundle.l10n.json](../../l10n/bundle.l10n.json) and [package.nls.json](../../package.nls.json) where appropriate).
  - Suppressed for failure outputs (failure annotations are owned by the existing failure path; do not duplicate there).
  - Implemented as an additional `NotebookCellOutputItem.text(..., "text/plain")` item inside the existing `NotebookCellOutput`, NOT as a separate `NotebookCellOutput` (keeps a single output container per cell run, consistent with existing rendering).

  AC 3's "visible from cell output metadata or output content" is satisfied by this output annotation. Cell-level output metadata is acceptable as an alternative if `NotebookCellOutput.metadata` is preferred — choose one mechanism and make it observable from the test harness either way.

### 4. Wire Helper Into `executeCell` (AC: 1, 2, 4, 5, 6)

- [x] In `executeCell`, replace the existing call sequence (`expression = cell.document.getText(); sourceUriStr = cell.document.uri.toString(); ...evaluateCellExpression(connection, expression, sourceUriStr)`) with:
  1. Read `userCode = cell.document.getText()`.
  2. Read `sourceUri = cell.document.uri.toString()`.
  3. Compute `isolate = readIsolationMetadata(cell)`.
  4. Call `expression = buildCellExpression(userCode, sourceUri, { isolate })`.
  5. Call `connection.evaluate(expression)` (existing path).
- [x] Remove the standalone `addSourceLabeling` function once `buildCellExpression` covers both isolated and non-isolated paths.
- [x] AC 1 ("no reconnect cycle") and AC 4 ("inline visibility") are already satisfied by the existing kernel + transport implementation. Do NOT introduce new connection-state checks, retries, or output-redirection logic. This story validates these properties via tests; it does not re-architect them.
- [x] AC 2 ("state accumulates by default") is already satisfied by `Runtime.evaluate({ replMode: true, ... })` REPL bindings on the V8 execution context (top-level `let`/`const`/`var`/`function` persist across evaluations on the same context). This story validates this property via the contract test in Task 5; no production change is required for the default path.

### 5. Unit Tests — SourceURL Identity, Wrapper Shape, Metadata Routing (AC: 3, 5, 6, 7)

Add tests in [tests/unit/kernel/execution-kernel.test.ts](../../tests/unit/kernel/execution-kernel.test.ts) (and a new sibling `tests/unit/kernel/build-cell-expression.test.ts` if the helper is exported separately). Use the existing `createFakeConnection` / `createExecutionRecorder` patterns.

- [x] **SourceURL identity (AC 5):** rerun the same cell URI twice; assert the captured `evaluate` expressions end with the **identical** `\n//# sourceURL=<uri>\n` suffix bytes both times.
- [x] **SourceURL uniqueness (AC 5):** evaluate two cells with different `document.uri` values from the same notebook; assert their `//# sourceURL=` lines differ.
- [x] **No-wrapper default (AC 2, 6):** a cell with no isolation metadata produces an expression equal to `${userCode}\n//# sourceURL=${sourceUri}\n` (no `(async()=>{`).
- [x] **Wrapper shape — multi-line (AC 6):** isolation-flagged cell with `userCode = "let x = 1;\nlet y = 2;\nx + y"` produces:

  ```text
  (async()=>{let x = 1;
  let y = 2;
  x + y})()
  //# sourceURL=<uri>
  ```

  Assert byte-equality. The `(async()=>{` MUST be on the same line as `let x = 1;` and `})()` MUST be on the same line as `x + y`.

- [x] **Wrapper shape — single line (AC 6):** isolation-flagged cell with `userCode = "1 + 1"` produces `(async()=>{1 + 1})()\n//# sourceURL=<uri>\n` (single line of executable code, no synthesized newlines).
- [x] **Wrapper shape — empty (AC 6):** isolation-flagged cell with `userCode = ""` produces `(async()=>{})()\n//# sourceURL=<uri>\n`.
- [x] **Metadata routing (AC 3):** four cases — `metadata` undefined, `metadata.jupyterBrowserKernel` undefined, `metadata.jupyterBrowserKernel.isolated === false`, `metadata.jupyterBrowserKernel.isolated === "true"` (string, not boolean) — all route to the no-wrapper path. Only `metadata.jupyterBrowserKernel.isolated === true` routes to the wrapper path.
- [x] **Isolation annotation (AC 3):** isolation-flagged cell with successful evaluation produces an output containing both an `"(isolated cell)"` (or localized equivalent) `text/plain` item AND the result value `text/plain` item, in that order, inside a single `NotebookCellOutput`.
- [x] **No annotation on failure (AC 3 sub-clause):** isolation-flagged cell whose evaluation produces an `ExecutionFailure` does NOT prepend the annotation; failure rendering remains unchanged.
- [x] **Passive Provider invariant (AC 7):** the kernel test surface does not call any `Debugger.*` method on the fake connection. Add a fake-connection assertion that `Debugger.enable` was never invoked. (If the fake connection only exposes `evaluate` + `terminateExecution`, document in a code comment that the kernel layer has no `Debugger` surface and the invariant is structurally enforced.)

### 6. Update Existing Test (AC: 5)

- [x] Update the existing assertion at [tests/unit/kernel/execution-kernel.test.ts](../../tests/unit/kernel/execution-kernel.test.ts) line 185 if and only if the trailing newline is added in Task 1. Otherwise leave it unchanged. Either way, the test must still pass after the helper extraction in Task 1.

### 7. Integration Test — Stable Identity Across Reruns Under Live CDP (AC: 1, 5, 6)

Add a new test in [tests/integration/transport/](../../tests/integration/transport/) (or a new `tests/integration/kernel/` folder if the kernel is exercised through `executeCell`). The goal is to prove the contract end-to-end against headless Chromium without requiring Story 2.5's debugger mirror.

- [x] Connect to a headless Chromium target (reuse `startHeadlessChromium` helper).
- [x] Evaluate a cell expression built by `buildCellExpression` twice in succession against the same fake notebook URI; assert both evaluations succeed and the second is independent of any reconnect (AC 1).
- [x] Evaluate two cells with shared global namespace usage — cell A: `globalThis.__story24 = 42`; cell B: `globalThis.__story24` — assert cell B returns `42` (AC 2 default state accumulation).
- [x] Evaluate the same cell URI with `isolate: true` twice; assert each invocation produces the wrapped form on the wire and that local `let` declarations inside the wrapper do NOT leak to subsequent runs.
- [x] Optional (skip if `Debugger.scriptParsed` listening adds non-trivial harness complexity): attach a transient surrogate session that calls `Debugger.enable`, set a `Debugger.setBreakpointByUrl` against the cell URI on a known line, evaluate, and assert `Debugger.paused.callFrames[0].location.lineNumber` matches the user-visible line. This validates AC 6 against live V8 the same way the spike did. If included, gate behind the existing `RUN_CDP_INTEGRATION=1` env. [Source: scripts pattern in .memory/test-commands.md]
- [x] Run integration tests: `npm run test:integration:cdp`.

### 8. Cell-Toolbar Toggle Command (AC: 8)

Provides the only realistic UI affordance for AC 3's per-cell opt-in. VS Code does not surface arbitrary cell metadata in any built-in panel, so a contributed cell-title menu action is required to make the feature discoverable and usable.

- [x] Add a new command `jupyterBrowserKernel.toggleCellIsolation` to [package.json](../../package.json) `contributes.commands`. Title localized via `package.nls.json` key `command.toggleCellIsolation.title` (e.g., `"Jupyter Browser Kernel: Toggle Cell Isolation"`).
- [x] Contribute the command to the `notebook/cell/title` menu in [package.json](../../package.json) `contributes.menus`. Use a single menu entry with two label variants (one for each direction) controlled by a context key, OR use two menu entries with mutually-exclusive `when` clauses bound to a context key. See Dev Notes "Toolbar `when` clause" for the recommended approach.
- [x] Add localized strings to [package.nls.json](../../package.nls.json):
  - `command.toggleCellIsolation.title` — command-palette title.
  - `command.toggleCellIsolation.isolate.label` — toolbar label when cell is currently shared (e.g., `"Isolate Cell"`).
  - `command.toggleCellIsolation.share.label` — toolbar label when cell is currently isolated (e.g., `"Share Cell State"`).
- [x] Create `src/commands/toggle-cell-isolation-command.ts` exporting `registerToggleCellIsolationCommand(context: vscode.ExtensionContext, api: ToggleCellIsolationApi): vscode.Disposable`. The command handler:
  1. Receives the cell as the first argument (VS Code passes the active cell when a `notebook/cell/title` action is invoked from the toolbar). Defensively accept both a `vscode.NotebookCell` directly and an undefined argument; if undefined, fall back to `vscode.window.activeNotebookEditor?.selection`-derived cell or no-op.
  2. Reads `cell.metadata` defensively (may be `undefined` or arbitrary shape).
  3. Computes the new metadata object immutably (do not mutate `cell.metadata`):
     - If currently isolated → omit the `isolated` key from `jupyterBrowserKernel`. If `jupyterBrowserKernel` becomes empty (`Object.keys(...).length === 0`), omit it from the resulting metadata too.
     - If not currently isolated → set `jupyterBrowserKernel.isolated = true` while preserving any other keys under `jupyterBrowserKernel.*`.
  4. Applies a `vscode.WorkspaceEdit` containing `vscode.NotebookEdit.updateCellMetadata(cell.index, newMetadata)` against `cell.notebook.uri`, then `await vscode.workspace.applyEdit(edit)`.
- [x] Wire the command registration into `src/extension.ts` activation alongside existing `connect`/`disconnect`/`reconnect` registrations. Push the disposable into `context.subscriptions`.
- [x] Add a context key (e.g., `jupyterBrowserKernel.cellIsolated`) updated by the kernel controller (or a small `NotebookEditor.onDidChangeNotebookCellSelection` + `workspace.onDidChangeNotebookDocument` listener) so the menu can pick the correct label variant. Set/unset via `vscode.commands.executeCommand("setContext", ...)`. If maintaining a context key proves fragile, fall back to a single menu entry with a generic label (`"Toggle Cell Isolation"`) and surface the current state in the cell output annotation only — acceptable per AC 8 if labels become per-state-aware later.
- [x] Add unit tests in `tests/unit/commands/toggle-cell-isolation-command.test.ts`:
  - Toggling an unisolated cell sets `metadata.jupyterBrowserKernel.isolated = true` and preserves unrelated metadata keys.
  - Toggling an isolated cell removes the `isolated` key.
  - Toggling an isolated cell whose `jupyterBrowserKernel` sub-object contains only `isolated` removes the `jupyterBrowserKernel` sub-object entirely.
  - Toggling preserves other top-level metadata keys (e.g., `metadata.tags`).
  - The handler does NOT mutate `cell.metadata` directly (verify by passing a frozen object).
  - The handler is a no-op (no thrown error) when invoked with `undefined` and no active notebook editor.
  - The handler issues exactly one `WorkspaceEdit.applyEdit` call per invocation.

### 9. Validation (AC: 1–8)

- [x] `npm run lint` — no new warnings or errors.
- [x] `npm run test` — all unit tests pass including new tests.
- [x] `npm run compile` — clean TypeScript compilation.
- [x] `npm run test:integration:cdp` — passes when Chromium is available (skip is acceptable in environments without Chromium per existing precedent).
- [x] Manual smoke check (post-build): in the Extension Development Host, open a `.ipynb`, select the Browser Kernel controller on a JavaScript cell, click the toolbar toggle, save the notebook, reopen, and confirm the metadata persists in the saved `.ipynb` JSON.

## Dev Notes

### Story Context and Scope

This is the **fourth story in Epic 2** and follows the spike (`2-spike-cdp-sourceurl-debugger`) whose findings are binding. The spike empirically locked every contentious decision (evaluation flags, wrapper strategy, source-URL identity, debugger posture) — see [spike/cdp-sourceurl-debugger-findings.md](../../spike/cdp-sourceurl-debugger-findings.md). This story implements the production-side contract that Story 2.5 will then build on for breakpoint mirroring.

**Scope boundaries:**

- Story 2.4 owns: per-cell `//# sourceURL` identity contract, Pattern B isolation wrapper, isolation opt-in metadata, fast-rerun validation tests.
- Story 2.4 does NOT own: `Debugger.enable`, `Debugger.setBreakpointByUrl`, breakpoint mirror, debugger lifecycle. Those are Story 2.5.
- Story 2.4 does NOT own: structured value rendering (Story 4.1), display formatting beyond `text/plain` (Story 4.2), intentional log capture (Epic 3).
- Story 2.4 does NOT introduce a VS Code Debug Adapter — that is deferred work.

### Locked Decisions From Spike (Must Be Honored)

These are non-negotiable and have empirical backing:

1. **Evaluation flags:** `Runtime.evaluate({ expression, replMode: true, awaitPromise: true, returnByValue: true, generatePreview: false, timeout: 30_000 })`. Already in [src/transport/browser-connect.ts](../../src/transport/browser-connect.ts) line 425–445; do not change. [Source: spike/cdp-sourceurl-debugger-findings.md#Q1]
2. **Debugger-domain posture:** **Passive Provider.** Extension MUST NOT call `Debugger.enable` from any kernel/transport code in this story. [Source: spike/cdp-sourceurl-debugger-findings.md#Q2]
3. **Wrapper strategy:** **Pattern B — same-line concatenation.** Prefix `(async()=>{` on the same line as user line 1; suffix `})()` on the same line as user's last line. No prepended/appended user-line shifts. [Source: spike/cdp-sourceurl-debugger-findings.md#Q5, spike/cdp-sourceurl-debugger-findings.md#Q6]
4. **Source identity:** Use `NotebookCell.document.uri.toString()` exactly. Do not reconstruct, encode, decode, normalize, or simplify. [Source: spike/cdp-sourceurl-debugger-findings.md#URL-scheme-sub-probe]
5. **Source-map fallback:** Rejected. Do not introduce `//# sourceMappingURL=` directives or import `source-map` at runtime (it stays in `devDependencies` for the spike harness only). [Source: spike/cdp-sourceurl-debugger-findings.md#Q6]
6. **First-evaluation breakpoint binding:** Works without UX caveat — no "run-once-first" guidance is needed in user docs. [Source: spike/cdp-sourceurl-debugger-findings.md#Q4]
7. **Multiplex regression:** Adding `Debugger.enable` clients does not regress the browser-level multiplex transport. (Only relevant to Story 2.5; recorded here as the boundary for what Story 2.4 must NOT break.) [Source: spike/cdp-sourceurl-debugger-findings.md#Multiplex-Regression-Sanity-Check]

### Architecture Guardrails (Must Follow)

- **Layer boundaries:** Kernel cannot import `chrome-remote-interface` or transport implementations directly; it consumes `ActiveBrowserConnection` only. Notebook calls kernel; kernel calls transport interface. [Source: docs/architecture.md#Architectural-Boundaries, docs/architecture.md#File-Structure-Patterns]
- **Result normalization:** All execution outcomes use the existing `ExecutionResult` discriminated union. The isolation annotation is rendered output content; it is NOT a new failure kind or a new success-shape variant. [Source: docs/architecture.md#Format-Patterns, docs/architecture.md#Error-Handling-Patterns, docs/stories/2-3-normalize-success-and-failure-output-contracts.md]
- **State ownership:** Transport owns connection lifecycle. Do NOT introduce kernel-side connection retries or reconnect-on-rerun logic. AC 1's "no reconnect cycle" is satisfied by the existing transport-owned active connection. [Source: docs/architecture.md#State-Management-Patterns]
- **File naming:** kebab-case files, PascalCase types/interfaces, camelCase functions/variables, UPPER_SNAKE_CASE constants. [Source: docs/architecture.md#Naming-Patterns]
- **Tests in `tests/` tree only.** Source folder is runtime code only. [Source: docs/architecture.md#File-Structure-Patterns]
- **Localization:** All user-facing strings through `vscode.l10n.t(...)`. Add new keys to [l10n/bundle.l10n.json](../../l10n/bundle.l10n.json). [Source: .github/copilot-instructions.md#Coding-Standards]
- **Named interfaces for non-trivial types.** Define `BuildCellExpressionOptions`, do not inline `{ isolate: boolean }` everywhere. [Source: .github/copilot-instructions.md#Coding-Standards]
- **Prefer `const` over `let` with mutation.** [Source: .github/copilot-instructions.md#Coding-Standards]
- **Do not duplicate library types.** Reuse `vscode.NotebookCell`, `vscode.NotebookCellOutput`, `vscode.NotebookCellOutputItem` directly. [Source: .github/copilot-instructions.md#Coding-Standards]
- **Settings/metadata namespace:** `jupyterBrowserKernel.*`. The chosen metadata key `cell.metadata.jupyterBrowserKernel.isolated` matches this convention. [Source: .github/copilot-instructions.md#Stable-Technical-Constraints]

### SourceURL Placement

The spike harness appended `\n//# sourceURL=<url>\n` (with both leading and trailing `\n`). The current production code appends only `\n//# sourceURL=<url>` (no trailing `\n`). Spike Q1 used the trailing-newline form, but the current production form has been observed to bind breakpoints in the spike's URL-scheme sub-probe and is already deployed in Story 2.2/2.3. **Either is acceptable** for AC 5; the test in Task 5 should assert byte-equality against whichever form the helper produces. Recommend keeping the existing single-`\n` form unless the integration test in Task 7 reveals binding issues, in which case switch to the harness form `\n//# sourceURL=<url>\n`.

### Isolation Opt-In Contract — Why Cell Metadata

Three contract surfaces were considered:

1. **In-cell magic comment** (e.g., `// @isolate` as the first line). Rejected: pollutes user code, complicates the "user-visible line numbers map 1:1" property of AC 6 because the magic comment occupies user line 1.
2. **Notebook-level setting** (one isolation mode per notebook). Rejected: AC 3 specifies per-cell opt-in.
3. **Cell metadata** (chosen). Round-trips through `.ipynb`, namespace-scoped under `jupyterBrowserKernel.*`, and reads via `cell.metadata` without introducing new APIs. VS Code does **not** surface arbitrary cell metadata in any built-in UI panel — the cell-toolbar toggle command from Task 8 is the only discoverable affordance and is required by AC 8.

The chosen key path is `cell.metadata.jupyterBrowserKernel.isolated: boolean`. Defensive read: any non-`true` value falls back to default (state-accumulating) semantics.

### Toolbar `when` clause

The `notebook/cell/title` menu contribution needs a `when` expression so the toggle only appears for cells the Browser Kernel controller actually executes. Recommended approach (least fragile):

- Match by notebook type via `notebookType == jupyter-notebook` (the controller's `notebookType` registered in [src/notebook/kernel-controller.ts](../../src/notebook/kernel-controller.ts)) AND by cell language via `cellLangId == javascript`.
- Combined `when`: `notebookType == 'jupyter-notebook' && cellLangId == 'javascript'`.

For the two-label-variant requirement (AC 8 — `"Isolate Cell"` vs `"Share Cell State"`), the cleanest VS Code idiom is **two menu entries** with mutually-exclusive `when` clauses driven by a context key the kernel controller maintains as the active cell selection changes:

- Context key: `jupyterBrowserKernel.activeCellIsolated` (boolean).
- Entry 1 `when`: `<base when> && !jupyterBrowserKernel.activeCellIsolated` → label `%command.toggleCellIsolation.isolate.label%`.
- Entry 2 `when`: `<base when> && jupyterBrowserKernel.activeCellIsolated` → label `%command.toggleCellIsolation.share.label%`.

If maintaining the context key reliably across cell-selection changes is impractical in this story's scope, fall back to a single menu entry with the generic title `"Toggle Cell Isolation"`. The output annotation from Task 3 still gives users feedback on the current state. Document the chosen approach in the implementation note.

VS Code reference: cell-title menu actions follow the same pattern as `notebook/cell/title` contributions used by the Jupyter extension and the built-in Markdown notebook — the command receives the cell as the first argument when invoked from the toolbar.

### `replMode` and State Accumulation

`Runtime.evaluate({ replMode: true })` enables top-level `await` and — critically for AC 2 — uses V8's REPL semantics for top-level binding declarations. Top-level `let`, `const`, `var`, and function declarations made in one `Runtime.evaluate` call persist as bindings on the same execution context for subsequent calls. This is why default (non-isolated) cells naturally accumulate state without any extra kernel work.

When the Pattern B IIFE wrapper is applied, those declarations move into the IIFE's local scope and are NOT exposed to the surrounding execution context — that is precisely how the wrapper achieves isolation. Users who want to share state across isolated cells must explicitly assign to `globalThis.X = ...` or `window.X = ...`. This matches FR13 verbatim: "execution isolation per cell while allowing explicit shared-runtime patterns such as a shared global namespace when the user chooses them." [Source: docs/prd.md#FR13]

### Files to Create or Modify

| File                                                                                           | Action     | Purpose                                                                                                       |
| ---------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| [src/kernel/execution-kernel.ts](../../src/kernel/execution-kernel.ts)                         | **Modify** | Replace `addSourceLabeling` with `buildCellExpression(userCode, sourceUri, options)`; read isolation metadata |
| `src/kernel/build-cell-expression.ts`                                                          | **Create** | New named helper module exporting `buildCellExpression` and `BuildCellExpressionOptions`                      |
| [src/kernel/index.ts](../../src/kernel/index.ts)                                               | **Modify** | Re-export the new helper if used by tests                                                                     |
| [src/kernel/execution-messages.ts](../../src/kernel/execution-messages.ts)                     | **Modify** | Add a localized `getIsolationAnnotationMessage(localize)` returning the `"(isolated cell)"` string            |
| [l10n/bundle.l10n.json](../../l10n/bundle.l10n.json)                                           | **Modify** | Add a key for the isolation annotation message                                                                |
| `src/commands/toggle-cell-isolation-command.ts`                                                | **Create** | Cell-toolbar toggle command handler (AC 8)                                                                    |
| [src/extension.ts](../../src/extension.ts)                                                     | **Modify** | Register the new toggle command alongside existing connect/disconnect/reconnect registrations                 |
| [package.json](../../package.json)                                                             | **Modify** | Add `jupyterBrowserKernel.toggleCellIsolation` command + `notebook/cell/title` menu contribution              |
| [package.nls.json](../../package.nls.json)                                                     | **Modify** | Add `command.toggleCellIsolation.title`, `.isolate.label`, `.share.label` keys                                |
| [tests/unit/kernel/execution-kernel.test.ts](../../tests/unit/kernel/execution-kernel.test.ts) | **Modify** | Update line-185 expectation if trailing `\n` is introduced; add metadata-routing and annotation tests         |
| `tests/unit/kernel/build-cell-expression.test.ts`                                              | **Create** | New tests for wrapper shape (multi-line, single-line, empty), sourceURL identity, sourceURL uniqueness        |
| `tests/unit/commands/toggle-cell-isolation-command.test.ts`                                    | **Create** | Unit tests for the toggle command handler (metadata mutation immutability, edge cases)                        |
| `tests/integration/kernel/fast-rerun.integration.test.ts` (or transport equivalent)            | **Create** | Live-CDP test for AC 1 (rerun without reconnect), AC 2 (state accumulation), AC 6 (line fidelity, optional)   |

### What NOT to Do

- Do NOT call `Debugger.enable`, `Debugger.setBreakpointByUrl`, `Debugger.removeBreakpoint`, or any `Debugger.*` method. That is Story 2.5's exclusive scope. [Source: spike/cdp-sourceurl-debugger-findings.md#Decisions-Locked]
- Do NOT introduce inline `//# sourceMappingURL=` directives or any source-map runtime path. [Source: spike/cdp-sourceurl-debugger-findings.md#Q6]
- Do NOT use multi-line wrapper shapes (Pattern B-alt). Even if they "look cleaner", they silently mis-report `Debugger.paused` line numbers and break user breakpoints. [Source: spike/cdp-sourceurl-debugger-findings.md#Q6]
- Do NOT switch the evaluation strategy to `Runtime.compileScript` + `Runtime.runScript` or strip `replMode`. The spike validated `replMode: true` works for both top-level await and breakpoint binding. [Source: spike/cdp-sourceurl-debugger-findings.md#Q1]
- Do NOT modify `ExecutionResult`, `ExecutionSuccess`, or `ExecutionFailure` shapes. Stories 2.1–2.3 stabilized them and downstream rendering depends on the shape. [Source: docs/stories/2-3-normalize-success-and-failure-output-contracts.md, docs/architecture.md#Format-Patterns]
- Do NOT modify `evaluate`, `terminateExecution`, or any field of `ActiveBrowserConnection`. The transport surface is stable. [Source: src/transport/browser-connect.ts]
- Do NOT add new `ExecutionFailureKind` literals. The 6 existing kinds cover all paths. [Source: docs/stories/2-3-normalize-success-and-failure-output-contracts.md#Story-Context-and-Scope]
- Do NOT reconstruct the cell URI (e.g., `notebook-cell:` with manual encoding). Use `cell.document.uri.toString()` verbatim. [Source: .memory/cdp-eval-notes.md, spike/cdp-sourceurl-debugger-findings.md#URL-scheme-sub-probe]
- Do NOT add reconnect-on-rerun retry logic to `executeCell`. AC 1 is satisfied by the current implementation; transport owns lifecycle. [Source: docs/architecture.md#State-Management-Patterns]
- Do NOT auto-detect existing `(async()=>{` wrappers in user code. The contract is binary on the metadata flag.
- Do NOT introduce a notebook-wide isolation setting. AC 3 is per-cell.
- Do NOT mirror the isolation annotation as a separate `NotebookCellOutput` — keep it as an additional `NotebookCellOutputItem` inside the existing single output to preserve current output-envelope shape.

### Previous Story Intelligence

**From Story 2.3 (just completed):**

- `serializeRemoteValue` now handles `unserializableValue` (Infinity, NaN, -0, BigInt). No change needed for Story 2.4.
- Contract-shape tests use `Object.keys(...).sort()` invariants. Reuse this pattern for any new output-shape tests in Task 5.
- `createResponse()` and `createFakeConnection()` test helpers are stable — reuse them.
- `npm test` now resolves to `npm run test:unit` (script change in Story 2.3); use `npm run test:integration:cdp` for live-CDP coverage.

**From Story 2.2:**

- `replMode: true` is intentional and validated. Do not remove. The "deferred replMode authorization" question was resolved by the spike for Story 2.5; Story 2.4 simply consumes the locked decision.
- Bare non-awaited `Promise` expressions serialize as `{}`. This is accepted and not in scope for Story 2.4.
- `raceWithTimeout` and `terminateExecution` are transport-internal and unchanged.

**From Epic 1 retro:**

- Transport owns lifecycle — kernel checks session, does not manage connection state.
- Normalized errors only — no raw CDP leaks to cell output.
- Localization from the start — every user-facing string through `vscode.l10n.t()`.
- Named interfaces for all non-trivial types.
- `const` over `let` with mutation.

### Project Structure Notes

- New file `src/kernel/build-cell-expression.ts` lives in the kernel layer alongside the existing `execution-kernel.ts`, `execution-result.ts`, `execution-messages.ts`. No new top-level folder.
- New test file `tests/unit/kernel/build-cell-expression.test.ts` mirrors source structure under `tests/unit/kernel/`.
- New integration test goes under `tests/integration/kernel/` (create folder if absent) or `tests/integration/transport/` if it leans on transport-level CDP probes. Either is consistent with the existing layout: `tests/integration/{transport,notebook}/`. [Source: docs/architecture.md#File-Structure-Patterns]
- No detected variances from the architecture's prescribed layout.

### References

- [Source: docs/epics/epic-2-execute-javascript-cells-no-intentional-capture.md#Story-2.4] — AC definitions
- [Source: docs/prd.md#FR12] — rerun modified cells
- [Source: docs/prd.md#FR13] — execution isolation per cell with explicit shared-runtime
- [Source: docs/prd.md#FR38] — source-level breakpoint debugging contract (Story 2.5 owns the debugger side; Story 2.4 owns the source-identity side that 2.5 binds to)
- [Source: docs/prd.md#NFR1] — 2-second sync execution feedback
- [Source: docs/prd.md#NFR8] — DevTools coexistence
- [Source: docs/architecture.md#Debugger-Domain-Integration] — per-cell source identity contract, wrapping-lambda line offset rule
- [Source: docs/architecture.md#Architectural-Boundaries] — kernel/transport boundary
- [Source: docs/architecture.md#Format-Patterns] — normalized result contract
- [Source: docs/architecture.md#File-Structure-Patterns] — tests-outside-source rule
- [Source: spike/cdp-sourceurl-debugger-findings.md] — full set of locked decisions (Q1–Q6)
- [Source: spike/cdp-multiplex-findings.md] — browser-level multiplex transport pattern
- [Source: docs/stories/2-3-normalize-success-and-failure-output-contracts.md] — previous story; contract stability
- [Source: docs/stories/2-2-run-asynchronous-javascript-cells.md] — async execution baseline
- [Source: docs/stories/2-spike-cdp-sourceurl-debugger.md] — spike origin story
- [Source: docs/stories/breakpoint-correct-course-prompt.md] — context for FR38 introduction
- [Source: .github/copilot-instructions.md] — coding standards and stable technical constraints
- [Source: .memory/cdp-eval-notes.md] — repo memory: `replMode` rationale and sourceURL contract

### Review Findings

Code review run 2026-05-03 against `main`. All four `patch` candidates were reviewed by the user and dismissed as intentional deviations from the original spec. Recorded here for traceability:

- [x] [Review][Dismiss] Isolation annotation uses two `NotebookCellOutput` containers instead of one with two items [src/kernel/execution-kernel.ts:243] — **Kept by design.** User prefers two separate outputs over the single-container shape originally specified in Task 3 / "What NOT to Do".
- [x] [Review][Dismiss] Wrapper prefix is `await (async()=>{` instead of bare Pattern B `(async()=>{` [src/kernel/build-cell-expression.ts:14] — **`await` is required.** Bare Pattern B did not work in practice; the outer `await` is necessary even with `Runtime.evaluate({ awaitPromise: true })`. Tests at [tests/unit/kernel/build-cell-expression.test.ts:21](../../tests/unit/kernel/build-cell-expression.test.ts#L21) and [tests/unit/kernel/execution-kernel.test.ts:768](../../tests/unit/kernel/execution-kernel.test.ts#L768) correctly lock in the as-built shape.
- [x] [Review][Dismiss] Menu `when` clauses filter by `notebookCellType == 'code'` instead of `cellLangId == 'javascript'` [package.json:62] — **Acceptable.** The extension is JavaScript-only, so the broader code-cell filter is good enough; `cellLangId` was found to be unreliable in practice.
- [x] [Review][Dismiss] `buildCellExpression` preserves a trailing newline in `userCode`, placing `})()` on its own line [src/kernel/build-cell-expression.ts:23] — **Intentional.** User-authored trailing whitespace is preserved as-is; the kernel does not silently strip it.

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References

- `npm run lint`
- `npm run test`
- `npm run compile`
- `npm run test:integration:cdp`
- `RUN_CDP_INTEGRATION=1 node --test out/tests/integration/notebook/stop-button.integration.test.js`
- `RUN_CDP_INTEGRATION=1 node --test out/tests/integration/kernel/fast-rerun.integration.test.js`

### Completion Notes List

- Implemented `buildCellExpression` as the single source of truth for per-cell source labeling and Pattern B isolation wrapping.
- Routed `executeCell` through metadata-based isolation detection and added localized isolated-cell output annotation for successful isolated runs.
- Added the cell-toolbar isolation toggle command, state-aware menu labels, and active-cell context synchronization.
- Added focused unit coverage for sourceURL identity, wrapper shape, metadata routing, isolation annotation behavior, and toggle command editing behavior.
- Added live CDP integration coverage for fast rerun, shared-state accumulation, and isolated non-leakage.
- Serialized the aggregate integration runner for integration directories so CDP suites complete reliably in this environment.
- Updated the notebook stop-button integration fixture to include notebook cell URIs required by the sourceURL contract.

### File List

- `l10n/bundle.l10n.json`
- `package.json`
- `package.nls.json`
- `scripts/run-node-tests.mjs`
- `src/commands/toggle-cell-isolation-command.ts`
- `src/extension.ts`
- `src/kernel/build-cell-expression.ts`
- `src/kernel/execution-kernel.ts`
- `src/kernel/execution-messages.ts`
- `src/kernel/index.ts`
- `tests/integration/kernel/fast-rerun.integration.test.ts`
- `tests/integration/notebook/stop-button.integration.test.ts`
- `tests/unit/commands/command-registration.test.ts`
- `tests/unit/commands/toggle-cell-isolation-command.test.ts`
- `tests/unit/kernel/build-cell-expression.test.ts`
- `tests/unit/kernel/execution-kernel.test.ts`

### Change Log

- 2026-04-26: Implemented story 2.4 fast-rerun iteration support, isolation metadata tooling, sourceURL helper extraction, and automated validation coverage.
