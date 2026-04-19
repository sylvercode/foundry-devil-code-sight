# Sprint Change Proposal — Breakpoint Debugging as MVP Capability

**Date:** 2026-04-19
**Author:** Sylvercode (via correct-course workflow)
**Mode:** Incremental
**Trigger source:** `docs/stories/breakpoint-correct-course-prompt.md`
**Scope classification:** Moderate (PRD + architecture + epic edits, one new story, sprint-status update)

---

## 1. Issue Summary

Breakpoint debugging in notebook cells does not work today. The capability was never elicited during requirements discovery, but it is an implicit user expectation for any notebook-backed browser execution tool. Without it, the product ships an execution environment where the standard debugging workflow (set breakpoint, hit breakpoint, step) silently fails — directly undermining the DevTools coexistence principle that is already a first-class platform requirement.

Discovery context (recorded in `docs/stories/deferred-work.md`, entry "breakpoint compatibility discovery 2026-04-19"):

- `addSourceLabeling()` in `src/kernel/execution-kernel.ts` emits a static `//# sourceURL=cell.js` for every cell. All cells share the same source identity in DevTools, so breakpoints cannot bind to a specific cell.
- Story 2.2 added `replMode: true` to `Runtime.evaluate` without authorization. REPL-mode evaluation has different debugger semantics than script evaluation and may prevent breakpoint binding.
- The extension never calls any method on the CDP `Debugger` domain. No `Debugger.enable`, no `setBreakpointByUrl`, no debug adapter integration.
- Story 2.4 will introduce wrapping lambdas (for variable-creation control vs fast rerun); without line-offset accounting, breakpoints set on user-visible line N will land on the wrapper, not the user code.

## 2. Impact Analysis

### Epic Impact

| Epic             | Status      | Impact                                                                                                     |
| ---------------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| 1                | done        | None                                                                                                       |
| 2                | in-progress | Goal broadens to include breakpoint-debuggable execution. Story 2.4 gains constraints; new Story 2.5 added |
| 3, 4, 5, 7, 8, 9 | backlog     | No scope change                                                                                            |
| 6                | backlog     | One existing fixture story (6.1) gains an AC for a breakpoint-binding fixture                              |

### Story Impact

- **Story 2.4 (Support Fast Rerun and Iteration Patterns)** — not yet created; new constraints to bake in at creation.
- **Story 2.5 (Enable Source-Level Breakpoint Debugging)** — new story.
- **Story 6.1 (Validate Core Pipeline with Deterministic Fixtures)** — extend fixture coverage with a breakpoint-binding fixture.

### Artifact Conflicts

| Artifact                                                               | Edits                                                                                                                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/prd.md`                                                          | New FR38 in Notebook Execution; traceability map row update                                                                                                      |
| `docs/architecture.md`                                                 | New "Debugger Domain Integration" subsection covering source identity contract, `Debugger.enable` lifecycle, `replMode` decision posture, line-offset accounting |
| `docs/epics/epic-2-execute-javascript-cells-no-intentional-capture.md` | Goal line updated; Story 2.4 expanded; Story 2.5 added                                                                                                           |
| `docs/epics/epic-list.md`                                              | Epic 2 FR coverage updated to include FR38; one-line description updated                                                                                         |
| `docs/epics/epic-6-safe-experimentation-and-core-reliability.md`       | Story 6.1 AC for breakpoint fixture                                                                                                                              |
| `docs/stories/sprint-status.yaml`                                      | Add `2-5-enable-source-level-breakpoint-debugging: backlog`                                                                                                      |
| `docs/stories/deferred-work.md`                                        | Mark static-sourceURL, `replMode` authorization, and breakpoint-discovery entries as resolved-by-2.4/2.5                                                         |

### Technical Impact

- New CDP domain dependency: `Debugger.enable` must be invoked on each page session at session attach time.
- Source identity contract becomes a cross-layer concern (kernel emits the directive; transport carries evaluation; notebook controller supplies the notebook URI used to derive the per-cell name).
- `replMode: true` may need to be replaced with `Runtime.compileScript` + `Runtime.runScript`, or kept after empirical validation. Decision is implementation-scoped within Story 2.5; PRD only requires the capability.

## 3. Recommended Approach

**Direct Adjustment (Option 1)** with these specific moves:

1. Add **FR38** to PRD declaring breakpoint debugging as a core kernel MVP capability.
2. Add an architecture subsection that defines the source-identity contract and the Debugger-domain lifecycle, and records the `replMode` open question with a resolution gate inside Story 2.5.
3. Constrain **Story 2.4** so the wrapping lambda design and per-cell sourceURL scheme are debugger-aware from the first commit.
4. Add **Story 2.5** for the dedicated debugger-domain integration and validation work.
5. Extend **Story 6.1** fixture coverage with one breakpoint-binding case so reliability validation includes the new capability.
6. Update sprint-status and retire the now-superseded deferred-work entries.

Effort estimate: Medium. Risk: Low — additive, no shipped behavior to migrate, well-bounded transport surface.

Rejected alternatives:

- **Rollback (Option 2):** nothing to roll back; Stories 2.1–2.3 are correct as built.
- **MVP review (Option 3):** breakpoint debugging is additive, not de-scoping. MVP boundaries do not need to shift.

## 4. Detailed Change Proposals

### 4.1 PRD — `docs/prd.md`

**Edit 1: Add FR38 under Notebook Execution.**

```
#### Notebook Execution

- FR8: ...
- ...
- FR13: The extension can support execution isolation per cell while allowing explicit shared-runtime patterns such as a shared global namespace when the user chooses them.
- FR38: A user can set source-level breakpoints in notebook cells from the browser's developer-tools Sources panel and have them bind to the executing cell code, with stable per-cell source identity that persists across re-execution within a session.
```

**Edit 2: Update traceability map row J1 to include FR38.**

```
| J1: Rapid Snippet Iteration           | Core 1–11                | FR1–FR18, FR22–FR23, FR38; post-MVP: FR24–FR26, FR37 | NFR1, NFR3, NFR5–9, NFR12–13 |
```

**Edit 3: Update front-matter `lastEdited` and append an `editHistory` entry.**

```
  - date: 2026-04-19
    changes: Added FR38 establishing source-level breakpoint debugging as a core kernel MVP capability and updated J1 traceability to cover it.
```

**Edit 4: Update FR traceability prose lead-in (one-line tweak).**

Replace:

```
Traceability highlights: FR1 through FR23 cover the platform execution contract used by MVP journeys; FR24 through FR26 (observation extensions) and FR37 (parameterized execution) are post-MVP core-platform enhancements mapped to existing journeys as post-MVP expansions; FR27 through FR36 cover post-MVP app-specific profile requirements (Foundry).
```

With:

```
Traceability highlights: FR1 through FR23 plus FR38 cover the platform execution contract used by MVP journeys; FR24 through FR26 (observation extensions) and FR37 (parameterized execution) are post-MVP core-platform enhancements mapped to existing journeys as post-MVP expansions; FR27 through FR36 cover post-MVP app-specific profile requirements (Foundry).
```

### 4.2 Architecture — `docs/architecture.md`

**Edit 1: New subsection under "Core Architectural Decisions" (after "API and Communication Patterns") titled "Debugger Domain Integration".**

```
### Debugger Domain Integration

The kernel must support source-level breakpoint debugging from the browser's developer-tools Sources panel. This is a cross-layer contract spanning transport, kernel, and notebook layers.

**Per-cell source identity contract:**

- Every evaluated cell carries a `//# sourceURL=` directive that is unique per cell and stable across re-execution within a session.
- The directive is derived from the notebook URI and the cell index. The exact format is implementation-scoped within Story 2.5 but must satisfy the properties required for FR38 breakpoint binding to work: uniqueness per cell (so a breakpoint binds to one cell, not all cells sharing a name), stability across reruns of the same cell (so a breakpoint persists through edit-run cycles), and human-readable association with the notebook file (so the user can locate the cell source in the browser's Sources panel to set the breakpoint in the first place).
- The notebook controller layer is the source of the notebook URI; the kernel applies the directive; the transport carries it unmodified.

**Debugger lifecycle:**

- `Debugger.enable` is invoked on each page session at session attach time, alongside existing `Runtime.enable` setup.
- The extension does not own a breakpoint UI. Breakpoints are set in the browser's Sources panel against the cell sourceURL identity that the extension provides.
- The extension does not need `Debugger.setBreakpointByUrl` for MVP; user-set browser breakpoints fire because the sourceURL contract is honored.

**Evaluation strategy and `replMode`:**

- Story 2.2 introduced `replMode: true` to enable top-level await. `replMode` may interfere with breakpoint binding because it wraps the expression in an IIFE.
- Story 2.5 must validate `replMode` empirically. If breakpoints do not bind reliably, the evaluation path switches to `Runtime.compileScript` + `Runtime.runScript` (or another validated alternative) while preserving top-level await semantics.
- This decision is recorded in Story 2.5; the architecture commits only to: top-level await must survive, and breakpoints must bind.

**Wrapping-lambda line offset:**

- Story 2.4 introduces a wrapping lambda for variable-creation control. The wrapper prepends a known number of lines before user code.
- The sourceURL directive emission and any synthesized lines must keep user line N mapped to user line N in the source visible to the debugger. Mechanisms include: emitting the sourceURL after a leading newline budget, using `//# sourceURL` placement that does not shift user lines, or using `Debugger.setScriptSource` style mappings if needed.
- Story 2.5 owns the validation test that proves user-visible line numbers match Sources-panel line numbers.

**DevTools coexistence interaction:**

- The browser-level CDP multiplexing already used to coexist with DevTools is sufficient. `Debugger.enable` invoked from the extension's flat session does not displace or interfere with DevTools' own debugger session.
```

**Edit 2: Update "Functional Requirements Coverage" bullet list to include FR38.**

Replace:

```
- FR8-FR13 (Notebook Execution) are covered by `src/kernel/` and `src/notebook/`.
```

With:

```
- FR8-FR13, FR38 (Notebook Execution including breakpoint debugging) are covered by `src/kernel/`, `src/notebook/`, and `src/transport/` debugger-domain enablement.
```

### 4.3 Epic 2 — `docs/epics/epic-2-execute-javascript-cells-no-intentional-capture.md`

**Edit 1: Update goal line.**

Replace:

```
**Goal:** Enable reliable JavaScript cell execution against a live browser execution target, with normalized result contracts and fast iteration patterns.
```

With:

```
**Goal:** Enable reliable, breakpoint-debuggable JavaScript cell execution against a live browser execution target, with normalized result contracts and fast iteration patterns.
```

**Edit 2: Augment Story 2.4 acceptance criteria with debugger-aware constraints.**

Append to Story 2.4 ACs:

```
**Given** any cell run
**When** the kernel emits the cell to the browser
**Then** the cell carries a per-cell `//# sourceURL` directive derived from the notebook URI and cell index
**And** the directive is stable across reruns of the same cell within the session.

**Given** wrapping-lambda introduction for variable-creation control
**When** the wrapper is applied
**Then** user-visible line numbers map 1:1 to the source visible in the browser's Sources panel
**And** any synthesized lines do not shift user line numbers.

**Scope Note (FR38 boundary):** Story 2.4 establishes the per-cell source identity contract and line-offset preservation. Story 2.5 enables the CDP Debugger domain and validates that browser-set breakpoints bind and fire on this identity.
```

**Edit 3: Add Story 2.5.**

```
## Story 2.5: Enable Source-Level Breakpoint Debugging

As a developer,
I want to set breakpoints in notebook cells from the browser's developer-tools Sources panel and have them fire,
So that I can debug cell code with the same workflow I use for any browser script.

**Acceptance Criteria:**

**Given** an active session with a valid browser execution target
**When** the session attaches
**Then** `Debugger.enable` is invoked on the per-target session
**And** session attach failure for the Debugger domain surfaces as a normalized error.

**Given** a cell with a per-cell `//# sourceURL` (Story 2.4 contract)
**When** I set a breakpoint on a line of that cell in the browser's Sources panel
**Then** the breakpoint binds to that cell's source identity
**And** rerunning the cell hits the breakpoint at the expected line.

**Given** the same cell is edited and rerun
**When** I have a breakpoint set in the browser
**Then** the breakpoint persists against the stable sourceURL
**And** the breakpoint fires on the new execution if the line still exists.

**Given** evaluation requires top-level await (Story 2.2 behavior)
**When** the evaluation path is chosen for Story 2.5
**Then** breakpoints bind reliably AND top-level await still resolves
**And** the chosen path (`replMode: true` retained, or `Runtime.compileScript` + `Runtime.runScript`, or alternative) is documented in the story dev notes.

**Given** Edge DevTools is attached to the same target
**When** the extension enables the Debugger domain
**Then** DevTools' own debugger session is not displaced
**And** notebook execution continues to coexist with DevTools.

**Traceability Note:** Implements FR38 and validates NFR8 (DevTools coexistence) under active debugger usage.
```

### 4.4 Epic List — `docs/epics/epic-list.md`

**Edit:** Update Epic 2 block.

Replace:

```
## Epic 2: Execute JavaScript Cells (No Intentional Capture)

Users can run and rerun JavaScript notebook cells and validate behavior through explicit success or failure results and visible browser effects.
**FRs covered:** FR8, FR9, FR11, FR12, FR13, FR14, FR15
**Depends on:** Epic 1
```

With:

```
## Epic 2: Execute JavaScript Cells (No Intentional Capture)

Users can run and rerun JavaScript notebook cells, set source-level breakpoints from the browser's developer tools, and validate behavior through explicit success or failure results and visible browser effects.
**FRs covered:** FR8, FR9, FR11, FR12, FR13, FR14, FR15, FR38
**Depends on:** Epic 1
```

### 4.5 Epic 6 — `docs/epics/epic-6-safe-experimentation-and-core-reliability.md`

**Edit:** Add one AC to Story 6.1 (Validate Core Pipeline with Deterministic Fixtures) covering breakpoint binding fixture.

```
**Given** the deterministic fixture suite
**When** a breakpoint-binding fixture runs against a static page
**Then** the kernel-emitted per-cell `//# sourceURL` is observed on the evaluated script
**And** the test asserts the Debugger domain is enabled on the session.
```

(Exact wording to be confirmed when Story 6.1 is created.)

### 4.6 Sprint Status — `docs/stories/sprint-status.yaml`

**Edit:** Insert under Epic 2 block.

```
  2-5-enable-source-level-breakpoint-debugging: backlog
```

(Inserted between `2-4-...: backlog` and `epic-2-retrospective: optional`.)

Update `last_updated` timestamp.

### 4.7 Deferred Work — `docs/stories/deferred-work.md`

**Edit:** Mark the three relevant entries as resolved by 2.4/2.5.

In the "Deferred from: code review of 2-2-run-asynchronous-javascript-cells (2026-04-18)" section, strike-through and annotate:

```
- ~~`replMode: true` was added to `Runtime.evaluate` params in Story 2.2 without spec authorization. ...~~ Resolved: addressed by Story 2.5 (validate `replMode` against breakpoint binding; switch evaluation strategy if incompatible).
```

In the "Deferred from: breakpoint compatibility discovery (2026-04-19)" section, strike-through both bullets and annotate:

```
- ~~`addSourceLabeling` uses a static `//# sourceURL=cell.js` ...~~ Resolved: addressed by Story 2.4 per-cell sourceURL contract.
- ~~Breakpoint debugging was identified as an implicit MVP capability ...~~ Resolved: Sprint Change Proposal 2026-04-19 added FR38, Story 2.5, and architecture coverage.
```

## 5. Implementation Handoff

**Scope classification:** Moderate.

**Handoff plan:**

| Recipient           | Responsibility                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| PM (John)           | Apply edits 4.1 (PRD) — confirm FR38 wording and traceability update                                                                        |
| Architect (Winston) | Apply edits 4.2 (architecture) — confirm Debugger Domain Integration subsection placement and content                                       |
| SM (Bob)            | Apply edits 4.3, 4.4, 4.5, 4.6, 4.7. Run `bmad-create-story` for Story 2.5 when 2.4 is done. Bake 2.4 constraints in at story-creation time |
| Dev (Amelia)        | Implement 2.4 with debugger-aware constraints, then 2.5                                                                                     |

**Success criteria for the change itself:**

- All seven artifact edits applied.
- Story 2.4 is created with the per-cell sourceURL and line-offset constraints in its acceptance criteria.
- Story 2.5 is created and accepted into the backlog.
- Deferred-work entries for static sourceURL, `replMode` authorization, and breakpoint discovery are marked resolved.

**Success criteria for the resulting capability (validated when 2.5 is `done`):**

- A user opens a notebook, runs a cell, sets a breakpoint in the browser's Sources panel on the cell's source, and the breakpoint fires on the next run.
- Breakpoints persist across cell edits when the line still exists.
- Top-level await continues to resolve.
- Edge DevTools coexistence remains intact during active debugger usage.
