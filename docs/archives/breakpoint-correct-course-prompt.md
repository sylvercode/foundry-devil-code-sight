# Correct Course Prompt: Breakpoint Debugging as MVP Capability

**When to run:** Before starting Story 2.4 (Support Fast Rerun and Iteration Patterns).
**Workflow:** `bmad-correct-course`
**Mode:** Incremental (recommended — several artifacts need coordinated edits).

---

## Triggering Issue

Breakpoint debugging in notebook cells does not work. This capability was never identified during requirements discovery, but it is an implicit expectation for a notebook-backed browser execution tool. Users expect to set breakpoints in notebook cells and hit them in the browser's debugger — this is standard behavior in Jupyter kernels with language debugger support.

Without this, the product ships an execution environment where the primary debugging workflow (breakpoints) silently fails, violating the DevTools coexistence principle that is already a first-class requirement.

## Technical Findings

### Current Implementation (as of Story 2.2 completion)

1. **Source labeling is static.** `addSourceLabeling()` in `src/kernel/execution-kernel.ts` appends `//# sourceURL=cell.js` to every cell. All cells appear as the same source file in DevTools. Breakpoints set in one "cell.js" apply ambiguously to all cells.

2. **`replMode: true` is used for evaluation.** Added in Story 2.2 for top-level await support. REPL-mode evaluation in V8/CDP has different debugger semantics than script evaluation — it may not support breakpoints at all in some engine versions.

3. **No CDP `Debugger` domain usage.** The extension never calls `Debugger.enable`, `Debugger.setBreakpointByUrl`, or any debugger-domain methods. There is no debug adapter protocol integration.

4. **No wrapping lambda yet.** Cell code is sent as bare expressions. Story 2.4 planning includes wrapping lambdas for variable-creation control vs. fast rerun, which will change the call stack structure and line-number offsets.

### What Breakpoint Support Requires

For browser-level breakpoints to work when DevTools is open alongside the extension:

- **Per-cell source identity:** Each cell needs a unique `sourceURL` that reflects the notebook file name and cell index (e.g., `MyNotebook.cell-3.js`). This is how the browser maps breakpoints to evaluated code.
- **Source-name stability:** The sourceURL for a given cell must be stable across re-executions so breakpoints persist through edit-run cycles.
- **`replMode` evaluation:** Must be validated or replaced. If `replMode` prevents breakpoint binding, the execution path may need to switch to `Runtime.compileScript` + `Runtime.runScript` or an alternative.
- **Wrapper line-offset accounting:** When wrapping lambdas are added (Story 2.4), the line numbers in the wrapper must be offset so breakpoints set on user-visible line N map to the correct line in the wrapped source.
- **CDP `Debugger` domain:** At minimum, `Debugger.enable` must be called on the target session for breakpoints to fire. Full integration may require `Debugger.setBreakpointByUrl` passthrough or delegation to DevTools.

### Interaction With DevTools Coexistence

The extension already uses browser-level CDP multiplexing to coexist with DevTools. Breakpoint debugging is a natural extension of this coexistence: the user sets breakpoints in DevTools' Sources panel using the `sourceURL` identity that the extension provides. The extension does not need its own breakpoint UI — it needs to ensure the source identity contract is correct so DevTools breakpoints work.

## Artifacts That Need Changes

### PRD

- **New functional requirement** (e.g., FR38): Cell code must support source-level breakpoint debugging via the browser's Debugger domain when DevTools is attached.
- **Traceability:** Map to Journey 1 (rapid macro iteration) and the DevTools coexistence NFRs.
- **Scope:** MVP — this is core kernel behavior, not profile-specific.

### Architecture

- New section covering:
  - CDP `Debugger` domain usage and interaction with existing `Runtime` domain usage.
  - Source-name contract: how notebook URI + cell index maps to `sourceURL`.
  - `replMode` vs. compiled-script evaluation trade-off (may need a design decision).
  - Line-offset mapping when wrapping lambdas are present.

### Epic 2

- **Story 2.4** gains constraints:
  - The `sourceURL` scheme must be per-cell, stable, and reflect the notebook file name.
  - The wrapping lambda design must account for line-number offsets between user code and the wrapper.
  - `replMode` must be validated for breakpoint compatibility or an alternative chosen.
- **Possible new story** in Epic 2 (e.g., 2.5): Dedicated debugger-integration story if breakpoint enablement is too large to fold into 2.4. Covers `Debugger.enable`, source-name contract, and validation that breakpoints fire correctly.

### Epic List

- Update Epic 2 FR coverage to include the new FR.
- If a new story is added, update the epic description.

## Deferred Work Context

The following related items are already tracked in `docs/stories/deferred-work.md`:

- `replMode: true` authorization question (from 2.2 code review) — directly relevant, as `replMode` may conflict with breakpoint support.
- Static `sourceURL` replacement — already deferred to 2.4.
- Magic string coupling in timeout errors — tangentially relevant to shared error contract design.

## Questions for the Correct Course Agent to Resolve

1. Should breakpoint support be a constraint on Story 2.4, a new Story 2.5, or both?
2. Does this require a new Epic, or does it fit within Epic 2's existing goal ("reliable JavaScript cell execution")?
3. Is `replMode: true` compatible with breakpoint binding? If not, what evaluation strategy replaces it while preserving top-level await?
4. Should the sourceURL scheme be specified in the architecture doc, or is it an implementation detail for the story?
5. Does this change affect Epic 6 (Safe Experimentation and Core Reliability) test fixtures?
