# Epic List

## Epic 1: Connect and Control Browser Sessions

Users can configure endpoints, connect, reconnect, disconnect, and maintain a stable, visible session state while coexisting with DevTools.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR22
**Depends on:** None (foundational)

## Epic 2: Execute JavaScript Cells (No Intentional Capture)

Users can run and rerun JavaScript notebook cells, set source-level breakpoints from the browser's developer tools, and validate behavior through explicit success or failure results and visible browser effects.
**FRs covered:** FR8, FR9, FR11, FR12, FR13, FR14, FR15, FR38
**Depends on:** Epic 1

## Epic 3: Capture Intentional Logs

Users can emit and review intentional runtime logs that are clearly separated from ambient browser console noise.
**FRs covered:** FR16, FR23 (structured logging facet)
**Depends on:** Epic 1, Epic 2

## Epic 4: Capture Intentional Values (Basic)

Users can emit and inspect intentional value outputs inline and preserve useful session-scoped comparison continuity.
**FRs covered:** FR10, FR17, FR23 (output capture and value inspection facets)
**Depends on:** Epic 1, Epic 2

## Epic 5: Present Complex Variables and Watches (Post-MVP Core)

Users can define watched expressions, refresh them, and inspect depth-limited complex structures for advanced observation workflows.
**FRs covered:** FR24, FR25, FR26
**Depends on:** Epic 1, Epic 2, Epic 4

## Epic 6: Safe Experimentation and Core Reliability

Users can test risky operations with forward-and-rollback notebook flows while the core pipeline is validated through deterministic fixtures.
**FRs covered:** FR18, FR19, FR20, FR21
**Depends on:** Epic 1, Epic 2

## Epic 7: Enable Foundry Profile Eligibility and Runtime (Post-MVP Profile)

Foundry users can execute only when profile eligibility is satisfied and receive deterministic profile-specific readiness guidance.
**FRs covered:** FR27, FR28, FR29, FR30, FR31, FR32
**Depends on:** Epic 1, Epic 2

## Epic 8: Deliver Foundry Productivity Workflows (Post-MVP Profile)

Foundry users can adopt notebook-first macro iteration with starter examples and reusable action workflows.
**FRs covered:** FR33, FR34, FR35, FR36
**Depends on:** Epic 7

## Epic 9: Prompted Input Substitution (Post-MVP Core)

Users can inject prompted placeholder values before execution for dynamic, repeatable notebook runs without manual code edits.
**FRs covered:** FR37
**Depends on:** Epic 1, Epic 2

## Epic 10: Full VS Code Debugging Experience (Post-MVP Core)

Users can debug notebook cells fully inside VS Code with verified breakpoints, pause and step controls, call stack, variables, and watches, while preserving browser DevTools coexistence.
**FRs covered:** FR39
**Depends on:** Epic 1, Epic 2
