# Sprint Change Proposal — New Epic for Full VS Code Debugging

**Date:** 2026-05-11
**Author:** Sylvercode (via correct-course workflow)
**Mode:** Incremental
**Trigger source:** `docs/stories/deferred-work.md` ("Deferred from: Story 2.5 scope split (2026-04-25)")
**Scope classification:** Major (new epic, PRD extension, architecture extension, UX extension, sprint-status update)

---

## 1. Issue Summary

### Problem Statement

Epic 2 now delivers breakpoint mirroring into the browser debugger and preserves DevTools coexistence, but it does **not** deliver a native VS Code debugging experience for notebook cells. Users still cannot get a verified breakpoint state in the editor, paused-line highlight, Variables/Watch/Call Stack panes, or step controls in VS Code.

### Discovery Context

The gap is explicitly documented in `docs/stories/deferred-work.md` under "Full VS Code Debug Adapter for cell debugging". That note states this is an epic-sized effort because it requires a dedicated DAP adapter that bridges VS Code debug requests onto the existing CDP Runtime/Debugger layers.

### Evidence

- `docs/epics/epic-2-execute-javascript-cells-no-intentional-capture.md` Story 2.5 scope note: browser-side debugging works; full VS Code debug UI is out of scope.
- `docs/stories/deferred-work.md` explicitly defers full VS Code debug adapter work to a future epic.
- PRD FR38 only guarantees browser Sources-panel breakpoint binding, not a first-class VS Code debug UI loop.

---

## 2. Checklist Execution Status

### Section 1 — Understand Trigger and Context

- [x] 1.1 Triggering story identified: Story 2.5 scope split (2026-04-25)
- [x] 1.2 Core problem defined: New requirement emerged (full VS Code debug UX, not just browser breakpoint binding)
- [x] 1.3 Supporting evidence gathered from Epic 2 Story 2.5 and deferred-work

### Section 2 — Epic Impact Assessment

- [x] 2.1 Current epic viability: Epic 2 remains valid and near-complete
- [x] 2.2 Required epic-level change: add a new epic for DAP-driven debugging
- [x] 2.3 Remaining epics reviewed for dependency impact
- [x] 2.4 Future-epic invalidation check complete: no invalidation, but priority should be adjusted
- [x] 2.5 Order/priority impact identified: new debugging epic should be prioritized immediately after Epic 2 completion

### Section 3 — Artifact Conflict and Impact Analysis

- [x] 3.1 PRD conflict check complete: FR coverage gap for VS Code-native debugging
- [x] 3.2 Architecture conflict check complete: no contradiction, but DAP boundary not yet specified
- [x] 3.3 UX conflict check complete: current UX focuses native surfaces but not debug pane lifecycle
- [x] 3.4 Secondary artifacts identified: sprint-status and deferred-work status updates

### Section 4 — Path Forward Evaluation

- [x] 4.1 Option 1 (Direct Adjustment): **Viable**, effort Medium-High, risk Medium
- [ ] 4.2 Option 2 (Potential Rollback): **Not viable**, effort High, risk High
- [ ] 4.3 Option 3 (PRD MVP Review): **Not viable**, effort High, risk Medium
- [x] 4.4 Selected approach: **Option 1 (Direct Adjustment)**

### Section 5 — Proposal Components

- [x] 5.1 Issue summary completed
- [x] 5.2 Epic/artifact impact documented
- [x] 5.3 Recommended path with rationale documented
- [x] 5.4 MVP impact + action plan documented
- [x] 5.5 Handoff plan defined

### Section 6 — Final Review and Handoff Readiness

- [x] 6.1 Checklist reviewed for completeness
- [x] 6.2 Proposal reviewed for internal consistency
- [x] 6.3 User approval obtained (`yes`)
- [x] 6.4 `docs/stories/sprint-status.yaml` updated with Epic 10 backlog entries
- [x] 6.5 Next-step handoff responsibilities drafted

---

## 3. Impact Analysis

### Epic Impact

| Epic                            | Current Status | Impact                                                                                   |
| ------------------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| Epic 2                          | in-progress    | No rollback required. Keep scope as-is; finish Story 2.5.                                |
| Epic 3-9                        | backlog        | No scope invalidation; sequencing should shift to prioritize full debugging epic sooner. |
| **New Epic (proposed Epic 10)** | new            | Add post-MVP core epic for full VS Code DAP debugging experience.                        |

### Story Impact

- No destructive change to existing Story 2.x scope.
- Add a new story set under the new epic (10.1-10.5 proposed) for debug adapter lifecycle, breakpoints, stack/scopes/variables, stepping, and reliability/coexistence validation.

### Artifact Conflicts and Required Updates

| Artifact                                                                                          | Required Change                                                                            |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `docs/prd.md`                                                                                     | Add new post-MVP core requirement(s) for VS Code-native debugging experience (DAP-backed). |
| `docs/epics/epic-list.md`                                                                         | Add new epic entry and FR coverage mapping.                                                |
| `docs/epics/epic-10-full-vscode-debugging-experience-post-mvp-core.md`                            | New epic file with stories and acceptance criteria.                                        |
| `docs/architecture.md`                                                                            | Add DAP adapter architecture subsection and boundary/ownership rules.                      |
| `docs/ux-spec/06-detailed-core-user-experience.md` and/or `docs/ux-spec/09-user-journey-flows.md` | Add debug lifecycle and pause-inspection flow details for VS Code panels.                  |
| `docs/stories/sprint-status.yaml`                                                                 | Add new epic and story backlog entries after approval.                                     |
| `docs/stories/deferred-work.md`                                                                   | Mark "Full VS Code Debug Adapter for cell debugging" as planned under new epic.            |

### Technical Impact

- Introduces DAP adapter lifecycle (`initialize`, `launch/attach`, termination).
- Requires URI mapping between `vscode-notebook-cell://...` and CDP script/source identities already established in Epic 2.
- Requires event reconciliation between CDP pause/resume and VS Code debug events.
- Requires strict coexistence guarantees so VS Code debug session and browser DevTools can remain attached without deadlock.

---

## 4. Recommended Approach

### Selected Path: Option 1 (Direct Adjustment)

Create a new post-MVP core epic for full VS Code debugging without changing completed Epic 1 work or in-flight Epic 2 contract.

### Why this is the best path

1. Preserves momentum: Epic 2 can complete without scope creep.
2. Keeps architecture clean: browser-debug compatibility remains in Epic 2; full editor-debug lifecycle is isolated to a dedicated epic.
3. Reduces risk: avoids reopening validated CDP findings and instead layers DAP capabilities on top of known-good source identity and debugger behavior.

### Effort, Risk, Timeline

- Effort: Medium-High
- Risk: Medium
- Timeline impact: Moderate; this should become the next core epic after Epic 2 if full VS Code debugging is now priority.

### MVP Impact

- MVP remains achievable and unchanged as currently defined.
- New epic is a **post-MVP core enhancement** that upgrades debugging ergonomics, not baseline execution viability.

---

## 5. Detailed Change Proposals (Incremental Review)

### Proposal A — PRD update (`docs/prd.md`)

**Section:** Functional Requirements (post-MVP core)

OLD:

```md
- FR37 [Post-MVP Core]: A user can define $prompt() substitution placeholders in a notebook cell so that execution pauses and requests a value for each placeholder before running.
```

NEW:

```md
- FR37 [Post-MVP Core]: A user can define $prompt() substitution placeholders in a notebook cell so that execution pauses and requests a value for each placeholder before running.
- FR39 [Post-MVP Core]: A user can start a VS Code debug session for notebook-cell execution and see breakpoint verification, paused-line highlighting, call stack, variables, and watch evaluation in native VS Code debug surfaces.
```

Rationale: FR38 currently covers browser Sources-panel breakpoints; FR39 defines first-class VS Code debugging behavior as a separate post-MVP capability.

Status: **Pending user approval [a/e/s]**

---

### Proposal B — Epic list update (`docs/epics/epic-list.md`)

**Section:** Add new epic entry

OLD:

```md
## Epic 9: Prompted Input Substitution (Post-MVP Core)

Users can inject prompted placeholder values before execution for dynamic, repeatable notebook runs without manual code edits.
**FRs covered:** FR37
**Depends on:** Epic 1, Epic 2
```

NEW:

```md
## Epic 9: Prompted Input Substitution (Post-MVP Core)

Users can inject prompted placeholder values before execution for dynamic, repeatable notebook runs without manual code edits.
**FRs covered:** FR37
**Depends on:** Epic 1, Epic 2

## Epic 10: Full VS Code Debugging Experience (Post-MVP Core)

Users can debug notebook cells fully inside VS Code with verified breakpoints, pause/step controls, call stack, variables, and watches, while preserving browser DevTools coexistence.
**FRs covered:** FR39
**Depends on:** Epic 1, Epic 2
```

Rationale: Adds the missing epic-sized capability explicitly deferred from Story 2.5.

Status: **Pending user approval [a/e/s]**

---

### Proposal C — New epic file (`docs/epics/epic-10-full-vscode-debugging-experience-post-mvp-core.md`)

**Section:** New epic with stories

OLD:

```md
(no file)
```

NEW (proposed outline):

```md
# Epic 10: Full VS Code Debugging Experience (Post-MVP Core)

**Goal:** Deliver a first-class VS Code notebook-cell debugging workflow via a dedicated DAP adapter, while preserving CDP multiplexing and DevTools coexistence.

## Story 10.1: Register and bootstrap notebook-cell DAP session

## Story 10.2: Verify and bind notebook-cell breakpoints in VS Code debug UI

## Story 10.3: Surface stack frames, scopes, and variables from CDP into DAP

## Story 10.4: Implement stepping controls and pause lifecycle synchronization

## Story 10.5: Validate coexistence and reliability under dual-client debugging
```

Rationale: Keeps DAP-surface complexity isolated from Epic 2 and gives explicit implementable slices.

Status: **Pending user approval [a/e/s]**

---

### Proposal D — Architecture update (`docs/architecture.md`)

**Section:** Core Architectural Decisions -> Debugger Domain Integration

OLD:

```md
Pause inspection (paused-line marker, Variables / Call Stack / Watch panels, step controls) happens in the browser's DevTools, not in VS Code. Surfacing pause inspection inside VS Code requires registering a Debug Adapter Protocol (DAP) adapter and is tracked as deferred work, not part of FR38's MVP scope.
```

NEW:

```md
Pause inspection for FR38 remains browser-DevTools owned in MVP.

Post-MVP core (FR39) adds a dedicated Debug Adapter Protocol (DAP) adapter that maps notebook-cell debug events and controls into VS Code native debug surfaces. The adapter must preserve CDP flat-session coexistence and must not regress external DevTools interoperability.
```

Rationale: Promotes deferred architecture note into planned, versioned scope while preserving current MVP boundary.

Status: **Pending user approval [a/e/s]**

---

### Proposal E — UX spec update (`docs/ux-spec/09-user-journey-flows.md`)

**Section:** Debug journey extension

OLD:

```md
(No explicit VS Code debug-pane journey for notebook-cell execution)
```

NEW:

```md
Add a post-MVP journey: "Debug in VS Code" where a user sets a notebook-cell breakpoint in the gutter, starts a debug session, execution pauses with line highlight, and the user inspects Variables/Watch/Call Stack before stepping and resuming.
```

Rationale: UX currently emphasizes notebook-output and browser-side debugging; this adds the missing editor-native flow.

Status: **Pending user approval [a/e/s]**

---

### Proposal F — Sprint status update (`docs/stories/sprint-status.yaml`)

**Section:** development_status

OLD:

```yaml
epic-9: backlog
9-1-define-prompt-placeholder-substitution-flow: backlog
9-2-validate-placeholder-resolution-and-cancellation-paths: backlog
9-3-surface-prompt-diagnostics-and-recovery-guidance: backlog
epic-9-retrospective: optional
```

NEW:

```yaml
epic-9: backlog
9-1-define-prompt-placeholder-substitution-flow: backlog
9-2-validate-placeholder-resolution-and-cancellation-paths: backlog
9-3-surface-prompt-diagnostics-and-recovery-guidance: backlog
epic-9-retrospective: optional

epic-10: backlog
10-1-register-and-bootstrap-notebook-cell-dap-session: backlog
10-2-verify-and-bind-notebook-cell-breakpoints-in-vscode-ui: backlog
10-3-surface-stack-scopes-and-variables-in-vscode: backlog
10-4-implement-stepping-and-pause-lifecycle-sync: backlog
10-5-validate-dual-client-debugging-coexistence: backlog
epic-10-retrospective: optional
```

Rationale: Enables standard BMAD story lifecycle tracking for the new epic.

Status: **Pending user approval [a/e/s]**

---

### Proposal G — Deferred work update (`docs/stories/deferred-work.md`)

**Section:** Deferred from Story 2.5 scope split

OLD:

```md
- **Full VS Code Debug Adapter for cell debugging.** ... This is sized as a new epic ...
```

NEW:

```md
- **Full VS Code Debug Adapter for cell debugging.** Planned under Epic 10 (Post-MVP Core): "Full VS Code Debugging Experience" via Sprint Change Proposal 2026-05-11. Keep deferred until Epic 10 starts.
```

Rationale: converts a generic deferral into a concrete planned destination.

Status: **Pending user approval [a/e/s]**

---

## 6. Implementation Handoff

### Scope Category

**Major** — Requires PM/Architect coordination plus SM backlog restructuring.

### Handoff Recipients and Responsibilities

- Product Manager: approve FR39 wording and post-MVP positioning in PRD.
- Architect: define DAP adapter boundary, protocol mapping rules, and coexistence invariants.
- Scrum Master: add Epic 10 artifacts, update sprint status, and sequence Story 10.x creation.
- Developer: implement Story 10.x in order once story specs are prepared.

### Success Criteria

1. Epic 10 exists with story-ready decomposition and acceptance criteria direction.
2. PRD contains explicit requirement for VS Code-native debugging experience.
3. Architecture and UX artifacts contain coherent DAP/debug-flow guidance.
4. Sprint tracking includes Epic 10 backlog entries.

---

## 7. Next Step Decision Gate

Review complete proposal.

- Continue with approved edits: `[c]`
- Request revisions to proposals: `[e]`

Approval checkpoint for implementation routing:

- Approve this Sprint Change Proposal for implementation: `yes`
- Reject/hold: `no`
- Approve with revisions: `revise`

Approval outcome:

- Final approval: `yes`
- Routing status: completed
- Approved changes applied to PRD, architecture, epics, UX journey flows, deferred-work, and sprint status.
