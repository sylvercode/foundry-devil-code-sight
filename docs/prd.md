---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-02b-vision
  - step-02c-executive-summary
  - step-03-success
  - step-04-journeys
  - step-05-domain
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
  - step-12-complete
  - step-e-01-discovery
  - step-e-02-review
  - step-e-03-edit
classification:
  projectType: developer_tool
  domain: browser execution platform
  complexity: medium
  projectContext: greenfield
  adapterFocus: foundry-example
  platformCore: browser-kernel
inputDocuments:
  - docs/product-brief.md
  - docs/brainstorming-session-2026-03-14-162248.md
  - spike/cdp-multiplex-findings.md
documentCounts:
  productBriefs: 1
  research: 0
  brainstorming: 1
  projectDocs: 0
  planningArtifacts: 1
workflowType: prd
workflow: edit
projectName: jupyter-browser-kernel
lastEdited: 2026-03-20
editHistory:
  - date: 2026-03-18
    changes: Reframed the product as a browser execution platform with Foundry as the first MVP profile, split core platform and profile scope, and regrouped requirements.
  - date: 2026-03-19
    changes: Strengthened NFR measurability and specificity with explicit thresholds, conditions, and measurement methods.
  - date: 2026-03-19
    changes: Closed scope-to-FR traceability gaps by aligning MVP scope bullets to output capture, execution-history retention, and forward or rollback workflow requirements, while making transport-boundary isolation explicit in the shared result contract requirement.
  - date: 2026-03-19
    changes: Fixed FR wording issues by rewriting declarative and passive requirement forms into capability language, tightening vague quantifiers, removing subjective adjectives, and converting negative constraints into explicit capabilities.
  - date: 2026-03-19
    changes: Added Requirements Traceability Map section mapping all five user journeys to scope items, FRs, and NFRs.
  - date: 2026-03-19
    changes: Closed four traceability gaps by adding the Foundry starter-notebook requirement to RTM mapping, demonstrating output discrimination in Journey 1 climax, and extending Foundry scope coverage for execution gating and in-app guidance.
  - date: 2026-03-19
    changes: Added $prompt() pre-execution parameter substitution to Phase 3 scope and as a post-MVP requirement, resolving the critical product-brief coverage gap.
  - date: 2026-03-19
    changes: Restored intentional execution-output capture as a core kernel MVP capability, expanded scope coverage, and updated Journey 4 plus Journey Requirements Summary. Clarified $f.out()/$f.log() as Foundry-profile helpers in Foundry scope planning.
  - date: 2026-03-19
    changes: Promoted structured-output helper coverage into MVP at that time because core output-capture behavior was considered untestable without a concrete emitter, added Foundry-scope helper coverage, removed helper deferral from Phase 2, and updated RTM J1/J4 rows.
  - date: 2026-03-19
    changes: Post-validation refinements added explicit platform connection states, measurement methods to reliability and test-coverage NFRs, and a glossary defining profile, transport, shared result contract, execution history retention, transport-boundary isolation, readiness state, and connection state.
  - date: 2026-03-20
    changes: Removed companion-module MVP dependency and readiness-state gating, preserved structured output protocol as extension-owned MVP behavior, and updated Foundry scope/FR/NFR/journeys to use target-eligibility and fail-loud diagnostics.
  - date: 2026-03-20
    changes: Repositioned product naming to jupyter-browser-kernel and reframed Foundry as the first example web-app profile; retained Foundry-specific capabilities as profile-specific and mostly post-MVP.
  - date: 2026-03-20
    changes: Reframed MVP as profile-agnostic core kernel delivery, moved app-profile requirements and journeys to post-MVP framing, and removed repetitive negative companion phrasing in favor of neutral extension-owned architecture language.
---

# Product Requirements Document - jupyter-browser-kernel

**Author:** Sylvercode
**Date:** 2026-03-15
**Last Edited:** 2026-03-20

## Executive Summary

`jupyter-browser-kernel` is a VS Code extension that provides a browser-backed JavaScript notebook execution kernel for rapid workflow iteration against live browser applications. MVP delivery focuses on the profile-agnostic core execution loop. App-specific profiles, including a Foundry VTT example profile, are layered on after the core loop is stable.

The immediate user problem is cycle time. Browser-hosted automation work often lacks a deterministic, notebook-first execution loop that can run against a live page, surface structured results, and coexist with existing developer tooling.

The product solves that problem by combining notebook execution, normalized result handling, and browser-session orchestration behind a single workflow. Users write a cell, run it against the active page, inspect the result inline, adjust one line, and rerun without re-establishing context. The kernel, result contract, reconnect model, and diagnostics are designed to operate without requiring any app-specific profile at MVP, while still enabling profile layers later.

A key architectural property is coexistence. The execution model must work alongside active browser debugging tools, including Edge DevTools, without forced disconnect behavior. The platform also preserves transport flexibility: direct CDP transport is viable today, and a browser-extension bridge remains a credible later transport option. The kernel contract must remain stable even if transport changes.

### What Makes This Special

The differentiator is not a notebook UI by itself. The differentiator is a deterministic browser execution loop with explicit profile boundaries.

1. **Fast rerun:** re-execute any cell against the active target without copy-paste workflows or page-local editors.
2. **Structured visibility:** surface success values, intentional output, and execution errors inline in the notebook with a shared result contract.
3. **Safe experimentation:** keep forward and rollback cells adjacent so destructive experiments are reversible inside the same notebook flow.
4. **Coexistence by design:** preserve compatibility with browser developer tools instead of treating them as a competing attachment.
5. **Profile-ready architecture:** keep target matching, target-eligibility diagnostics, and runtime helpers profile-owned so app-specific behavior remains optional relative to the core kernel.

### Project Classification

| Dimension       | Value                                              |
| --------------- | -------------------------------------------------- |
| Project Type    | Developer Tool (VS Code extension)                 |
| Domain          | Browser execution kernel for live web applications |
| Complexity      | Medium                                             |
| Project Context | Greenfield                                         |
| MVP Scope       | Profile-agnostic core kernel                       |

## Success Criteria

### Core Platform User Success

- A user can open a `.ipynb` notebook in VS Code, connect to a live browser target, run a JavaScript cell, and see a structured result inline.
- A user can rerun modified cells repeatedly against the same browser session without rebuilding context between runs.
- Syntax and runtime failures always appear as explicit notebook output with message, stack, and source location when available.
- Manual reconnect restores a usable execution session after target reload or disconnect.
- Intentional execution output is distinguishable from unrelated browser console noise.
- A user can keep forward-operation and rollback cells side by side to make risky state mutations reversible.
- Structured variable and log output is available in-cell through extension-owned helper protocol.

### Business Success

- The extension supports reliable personal daily use for browser-based notebook iteration in profile-agnostic core workflows.
- The planning artifacts support future profile expansion without requiring a second product-boundary rewrite.
- If published later, the extension is documented clearly enough that users understand what the platform core does and what each example profile adds.

### Technical Success

- JavaScript notebook cell execution succeeds for synchronous and asynchronous browser-page code.
- The shared result contract normalizes success and failure outcomes independent of transport choice.
- Edge DevTools coexistence is preserved for the core kernel session model.
- Core execution and normalization are verifiable against deterministic static HTML fixtures without requiring any live app-profile runtime.

### Measurable Outcomes

- A JavaScript notebook cell executes against a live browser target and returns a structured result: pass or fail.
- Execution failures surface as notebook output with name, message, and stack: pass or fail.
- Edge DevTools coexistence remains intact during kernel execution: pass or fail.
- Manual reconnect restores a usable session within a few seconds when the browser target is available: pass or fail.
- Headless static-fixture tests cover success, syntax-error, runtime-error, and serialization-edge-case paths for the core kernel: pass or fail.

## Product Scope & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Establish a reliable browser-backed notebook execution kernel that works without requiring any app-specific profile.

**Resource Requirements:** Solo developer with JavaScript, VS Code extension APIs, and browser-execution transport knowledge. App-domain familiarity is only required when a profile is added post-MVP.

**Core User Journeys Supported:**

- Primary success path: rapid notebook write-run-inspect loop.
- Primary edge path: safe experimentation with forward and rollback cells.
- Solo operations path: reconnect and target-eligibility diagnostics.
- Platform path: preserve explicit boundaries so future profiles can reuse the kernel.

### MVP - Core Kernel Scope

1. Browser-session connection and lifecycle management for a live execution target.
2. Browser debugger coexistence as a first-class requirement.
3. JavaScript notebook execution for `.ipynb` cells, including async execution.
4. Shared result contract for normalized success and error handling with transport-boundary isolation.
5. Manual reconnect command and connection-state reporting.
6. Explicit transport boundary so one MVP transport can ship without defining the permanent platform transport.
7. Intentional execution-output capture, discrimination, and execution-history retention in notebook workflows.
8. Extension-owned runtime envelope behavior and structured output helpers (`$f.out()`, `$f.log()`) as the emitter surface for the output-capture contract.
9. Deterministic target-matching and target-eligibility diagnostics for the active profile.
10. Forward and rollback notebook-cell workflow for safe experimentation, including multi-version iteration.
11. Automated core-kernel validation against deterministic browser-test fixtures.

### Post-MVP - App-Specific Profile Enhancements (Foundry Example)

1. Foundry macro iteration patterns and profile examples that replace Foundry macro-editor loops.
2. Foundry-specific notebook example showing token-state read and token update.
3. Profile-specific quickstart and troubleshooting guidance for Foundry.
4. Rich complex-object inspection and app-aware diagnostics for Foundry objects, with optional companion-module enhancements.

### Growth Features

**Phase 2 - Core Platform:**

- Better diagnostics and troubleshooting ergonomics.
- Configurable retry interval and timeout handling.
- Hardened transport abstraction after the transport spike selects a long-term direction.
- Stronger automated platform coverage for reconnect, serialization, and output tagging behavior.
- Variable watch with manual or execution-event refresh and shallow projection plus drill-down support.

**Phase 2 - Example Profile Enhancements (Foundry-first):**

- Guided diagnostics for common Foundry target-matching and execution-envelope failures.
- Optional companion-module path for app-specific enhancements that require deep Foundry runtime introspection.
- Rich variable-inspector enhancements for complex Foundry object graphs that exceed shallow serialization.

**Phase 3 - Expansion:**

- Workspace-scoped action promotion and reuse flows.
- Pre-execution parameter substitution (`$prompt()`) for parameterized action inputs.
- Adapter onboarding guidance for future profiles.
- Public Marketplace hardening, packaging maturity, and onboarding polish.
- Additional browser-application profiles only after the core kernel is stable.

### Vision (Future)

- A public VS Code browser-execution platform with a stable core and optional first-party example profiles (starting with Foundry VTT).
- Reusable execution and diagnostics contracts that support additional browser applications without redefining the product.
- Profile-specific helper surfaces that remain thin and optional relative to the platform core, including optional post-MVP companion modules when app-specific features require them.

### Risk Mitigation Strategy

**Core Platform Risks:**

- CDP coexistence and session-routing fragility.
  - Mitigation: browser-level session design plus deterministic fixture-based regression coverage.
- Transport lock-in before profile boundaries stabilize.
  - Mitigation: preserve transport as an explicit architecture decision and keep the kernel contract transport-agnostic.
- Error normalization drift across execution paths.
  - Mitigation: test the shared result contract against success, syntax, runtime, and serialization cases before live-profile expansion.

- Misattributed failures between user cell code and extension execution envelope.
  - Mitigation: fail-loud diagnostics that label envelope/parsing errors separately from user-code runtime errors.
- Unsafe rapid experimentation in mutable app state.
  - Mitigation: forward/rollback notebook patterns and example notebooks.

**Resource Risks:**

- Solo bandwidth can drive scope creep and premature multi-profile abstraction.
  - Mitigation: keep MVP focused on the profile-agnostic core kernel and add profiles only after core stability.

## User Journeys

The following journeys describe MVP delivery for the profile-agnostic core kernel. App-specific profile journeys are post-MVP.

### Journey 1: Primary Success Path - Rapid Snippet Iteration

**Persona:** Power-user web developer iterating against a live browser app.

**Opening scene:**
The user needs to test runtime logic quickly against an already loaded browser application and wants durable iteration history.

**Rising action:**
They open a `.ipynb` notebook in VS Code, connect to the active browser target, write a JavaScript cell, run it, inspect the result inline, edit one line, and rerun repeatedly.

**Climax:**
The intended behavior appears and expected value output is shown immediately in the notebook, clearly distinguishable from unrelated browser console activity.

**Resolution:**
They keep working versions in notebook cells and use the notebook as durable execution history.

**Failure/recovery path:**
If evaluation throws, the error is visible in-cell with structured details, and rerun is immediate after editing.

### Journey 2: Primary Edge Path - Safe Experimentation and Reversal

**Persona:** Same user testing risky live-app mutations.

**Opening scene:**
The user needs to try a destructive or broad operation but is unsure about side effects.

**Rising action:**
They write a forward-operation cell and, directly below it, a reversal cell. They execute forward, inspect output, and decide whether to keep or roll back.

**Climax:**
Unexpected behavior appears, but they immediately run the rollback cell and restore state without leaving VS Code.

**Resolution:**
Risky experimentation becomes cheap enough to support aggressive iteration.

**Failure/recovery path:**
If rollback logic is incomplete, they inspect affected values, patch the rollback cell, and rerun.

### Journey 3: Operations Path - Connection and Target Recovery

**Persona:** Same user acting as installer and operator of their own toolchain.

**Opening scene:**
The browser target reloads, detaches, or target selection drifts.

**Rising action:**
They run reconnect, the extension re-establishes the session, and target-eligibility diagnostics report whether the current target can execute code.

**Climax:**
Connection is restored and notebook execution resumes without restarting VS Code.

**Resolution:**
Operational overhead remains low enough for one user to maintain the workflow routinely.

**Failure/recovery path:**
If reconnect fails, diagnostics point first to endpoint configuration, target selection, or execution-envelope/parsing failure category.

### Journey 4: Support Path - Diagnosing Unexpected Behavior

**Persona:** Same user acting as their own support engineer.

**Opening scene:**
A snippet runs, but resulting app state does not match expectation.

**Rising action:**
They rerun narrow cells, use intentional output capture to surface intermediate values, and isolate the failing assumption while Edge DevTools remains available for deeper browser debugging.

**Climax:**
They identify the mismatch between expected and actual state, such as permission boundaries, stale references, or object-path assumptions.

**Resolution:**
They patch the snippet and validate the fix in the same notebook sequence.

**Failure/recovery path:**
If the issue grows more complex, they add smaller cells and converge incrementally instead of rewriting the whole script.

### Journey 5: Platform Path - Adding an App Profile (Post-MVP)

**Persona:** A future developer adding an app-specific profile after MVP.

**Opening scene:**
The kernel has already proven stable without requiring app-specific profile logic. A browser application becomes a candidate profile target.

**Rising action:**
The developer defines profile-owned target matching, execution precondition diagnostics, runtime helpers, and example notebooks while reusing the existing session, execution, reconnect, and result-normalization logic.

**Climax:**
Notebook cells execute against the new profile with the same result structure and failure behavior as the core kernel contract.

**Resolution:**
The product expands by adding profile-specific boundaries instead of rewriting the platform core.

**Failure/recovery path:**
If the new profile cannot satisfy the shared eligibility diagnostics or result contract, the issue is treated as a platform-boundary decision rather than patched with one-off profile logic.

### Journey Requirements Summary

These journeys imply concrete capability needs:

1. Fast, repeatable notebook cell execution against a live browser target.
2. Clear in-cell success and error rendering.
3. Minimal-friction rerun loops for micro-iterations.
4. Intentional execution-output capture and inline surfacing distinct from background browser noise.
5. Reliable reconnect and explicit profile target-eligibility diagnostics.
6. Coexistence with browser developer tools.
7. Support for forward/rollback scripting patterns in core workflows.
8. Deterministic result handling independent of transport choice.
9. Platform boundaries that allow future profiles to reuse the kernel.

## Domain-Specific Requirements

### Compliance and Regulatory

- No formal regulated-domain compliance target applies to the MVP.
- If Marketplace distribution happens later, the extension should follow VS Code packaging and security expectations, including clear disclosure of platform behavior and profile-specific capabilities.

### Technical Constraints

- JavaScript is the only runtime language supported in v1.
- Browser debugger coexistence is a non-negotiable platform constraint.
- CDP multiplexing is the current leading technical path for coexistence, but transport remains an explicit architecture decision rather than a permanent product assumption.
- Manual reconnect is acceptable for MVP; automatic reconnect is deferred.
- Serialization limits require shallow result inspection and explicit drill-down patterns rather than deep object mirroring.

### Integration Requirements

**Core Platform Integration:**

- Must integrate with VS Code notebook workflows.
- Must connect to a live browser execution target through a user-controlled transport.
- Must normalize execution results into a shared contract independent of the transport implementation.
- Must provide extension-owned structured output helpers (`$f.out()`, `$f.log()`) during execution.
- Must provide deterministic target-matching and target-eligibility diagnostics for the active profile.

**App-Specific Profile Integration (Post-MVP, Foundry Example):**

- Must preserve app-specific guidance and examples without making them platform assumptions.
- Must layer app-aware diagnostics and complex-object inspection without changing core execution contracts.

### Trust and Security Model

- The MVP assumes one user controls both VS Code and the active browser session used for execution.
- The platform core should not assume that all future profiles share the Foundry trust model used in the first example profile.
- Each future profile must document its own target-eligibility diagnostics, permissions, and runtime helper assumptions.

### Risk Mitigations

- Risk: transport changes invalidate the execution model.
  - Mitigation: keep transport separate from the notebook execution and result contracts.
- Risk: a future profile hardcodes target logic into the platform core.
  - Mitigation: keep target matching and execution-precondition diagnostics profile-owned.
- Risk: example-profile-specific expectations leak into general platform language.
  - Mitigation: isolate profile-specific terminology and examples to example-profile sections.

## Project-Type Requirements

### Project-Type Overview

This product is a VS Code-only developer tool. Its core job is deterministic JavaScript notebook execution against a live browser target. Foundry is an example profile that can be layered on after core-kernel MVP validation.

### Technical Architecture Considerations

- The platform core owns session orchestration, notebook execution, reconnect behavior, and result normalization.
- A profile owns target matching, execution-precondition diagnostics, runtime helpers, and profile-specific diagnostics.
- Transport is a replaceable architecture layer. The product can ship one transport in MVP without freezing the long-term transport decision.
- Feature design should optimize for VS Code notebook workflows and avoid premature abstraction for non-MVP IDEs.

### Language and Runtime Scope

- Supported runtime language: JavaScript only.
- Non-goals for MVP:
  - TypeScript runtime transpilation
  - Multi-language notebook kernels
  - Alternate script runtimes

### Installation and Distribution Model

- Installation model for MVP: manual installation only.
- Marketplace publishing is out of scope for MVP.
- Documentation should assume a personal-use installation path for profile-agnostic core workflows, with profile-specific quickstarts added post-MVP.
- Install guidance depth for MVP is a minimal quickstart, not a polished onboarding system.

### IDE Integration Boundaries

- Hard boundary: VS Code only.
- No support commitments for JetBrains IDEs, Neovim, or other editors in MVP.
- The extension depends on notebook workflows rather than a cross-editor abstraction layer.

### Documentation and Example Requirements

- Minimum documentation for MVP:
  - One architecture explanation distinguishing platform core from example-profile responsibilities
  - One quickstart path for manual installation and reconnect troubleshooting for profile-agnostic core workflows

- Minimum documentation for post-MVP example profiles:
  - One Foundry notebook example demonstrating token-state read and token update

### Adapter Implementation Constraints

- Foundry-specific concepts such as tokens, actors, and app-specific commands must not appear as platform-level requirements unless they are explicitly marked as example-profile behavior.
- Future profiles should extend the platform by supplying profile boundaries, not by rewriting core session or notebook logic.
- Profiles should stay thin. Profile-specific runtime helpers are optional convenience layers, not platform prerequisites outside that profile.

### Implementation Considerations

- Keep interfaces explicit and small.
- Favor predictable behavior and actionable failure messages over breadth.
- Generalize at contracts and boundaries, not through speculative multi-profile frameworks.

## Functional Requirements

Traceability highlights: FR1 through FR23 cover the platform execution contract used by MVP journeys; FR24 through FR26 and FR37 are post-MVP core-platform extensions; FR27 through FR36 cover post-MVP app-specific profile requirements (Foundry).

### Core Platform Requirements

#### Connection and Session Control

- FR1: A user can configure the connection endpoint used by the extension.
- FR2: A user can initiate a connection from VS Code to a live browser execution target.
- FR3: The extension can identify and select a valid execution target according to the active profile's matching rules.
- FR4: The extension can report current connection state to the user using defined platform states: `disconnected`, `connecting`, `connected`, and `error`.
- FR5: A user can manually reconnect the extension after disconnection or target reload.
- FR6: A user can disconnect the active execution session from VS Code.
- FR7: The extension can preserve coexistence with active browser developer tools connected to the same target.

#### Notebook Execution

- FR8: A user can run JavaScript notebook cells against the active browser target from VS Code.
- FR9: The extension can execute asynchronous JavaScript cell logic and return resolved outcomes.
- FR10: The extension can return successful execution values to notebook output.
- FR11: The extension can surface syntax and runtime errors as notebook output with message, stack, and source location when available.
- FR12: A user can rerun modified cells repeatedly in the same notebook workflow.
- FR13: The extension can support execution isolation per cell while allowing explicit shared-runtime patterns when the user chooses them.

#### Result Normalization and Output Contract

- FR14: The extension can normalize success and failure outcomes across supported transports and profiles through a shared result contract while preserving transport-boundary isolation from notebook execution semantics.
- FR15: A user can inspect execution results inline in the notebook after each run.
- FR16: The extension can capture output generated during cell execution and surface it as notebook output, distinguishable from unrelated browser console activity.
- FR17: The extension can preserve session-scoped execution history so a user can compare the result of each cell revision within a working session.

#### Platform Testing and Validation

- FR18: A developer can verify the notebook execution pipeline and shared result contract against deterministic browser-test fixtures without any profile-specific runtime.

#### Experimentation and Observation Workflow

- FR19: A user can maintain forward-operation and reversal-operation cells in the same notebook.
- FR20: A user can execute reversal cells to restore state after experiments.
- FR21: A user can iterate through at least two successive snippet versions in a single notebook session.
- FR22: A user can install and use the extension through a manual VS Code workflow without requiring Marketplace distribution.
- FR23: The extension can expose intentional script output through extension-owned runtime helpers such as `$f.out()` and `$f.log()`.

#### Observation Extensions [Post-MVP Core]

- FR24 [Post-MVP]: A user can define watched expressions and refresh them manually or after execution events.
- FR25 [Post-MVP]: A user can configure shallow projections and reference drill-down for watched values.
- FR26 [Post-MVP]: A user can continue refreshing other watched values when one watcher evaluation fails.

### Example Web-App Profile Requirements (Post-MVP, Foundry VTT)

#### Foundry Target and Execution Preconditions [Post-MVP]

- FR27: The Foundry profile can identify valid execution targets using profile-owned matching rules.
- FR28: The Foundry profile execution path can rely on extension-owned runtime envelope and helper injection.
- FR29: The extension can inject a minimal execution envelope that carries structured value and log output for each cell run.
- FR30: The Foundry profile can classify target eligibility (for example, `eligible`, `target_mismatch`, `disconnected`).
- FR31: The Foundry profile can present actionable reconnect or target-selection guidance when target eligibility is not satisfied.
- FR32: A user can proceed with Foundry execution whenever the current target is classified as `eligible`.

#### Foundry Notebook Workflow [Post-MVP]

- FR33: A Foundry power user can execute macro logic from notebook cells without using the Foundry macro editor during iteration.
- FR34: The extension can provide a Foundry starter notebook demonstrating token-state read and token-value update.

#### Foundry Action Reuse (Foundry-App-Specific Post-MVP Extensions)

- FR35 [Post-MVP]: A Foundry power user can save a notebook cell as a reusable action.
- FR36 [Post-MVP]: A Foundry power user can reopen or execute a saved action, including prompted inputs when required.

#### Core Parameterization Extension [Post-MVP Core]

- FR37 [Post-MVP]: A user can define `$prompt()` substitution placeholders in a notebook cell so that execution pauses and requests a value for each placeholder before running.

## Non-Functional Requirements

### Core Platform Performance

- NFR1: Notebook execution feedback must render within 2 seconds for synchronous JavaScript cells, measured as elapsed time from run command to notebook output render using a deterministic test cell under normal local development conditions.
- NFR2: Manual reconnect must report success or failure within 5 seconds when the target browser and page are available, measured as elapsed time from reconnect command invocation to final connection state.
- NFR3: Intentional output or watched-value refresh behavior, when enabled, must render within 2 seconds, measured as elapsed time from execution completion to output render under the same baseline conditions as NFR1.

### Core Platform Reliability

- NFR4: Manual reconnect must restore execution capability within 5 seconds after target reload when the target is reachable, measured by successful reconnection state and one successful JavaScript cell execution without restarting VS Code.
- NFR5: Runtime and syntax failures must always surface as explicit notebook outputs; silent failure is not acceptable, measured by regression tests exercising all error paths including syntax errors, runtime exceptions, and evaluation timeouts.
- NFR6: The shared result contract must preserve identical success and failure classification across supported transports for equivalent test cases, measured by deterministic regression fixtures that cover success, syntax error, runtime error, and serialization-edge cases with 100% classification parity.

### Core Platform Integration and Contracts

- NFR7: The platform core must remain adapter-agnostic; it does not hardcode app-specific target matching rules.
- NFR8: The extension must coexist with Edge DevTools without forced disconnect behavior, measured by sustained active session state and successful notebook execution after DevTools attaches to the same target.
- NFR9: Each profile must implement deterministic target-eligibility diagnostics with explicit states and guidance, measured by integration tests that verify state classification and deterministic diagnostic outcomes.

### Example Web-App Profile Integration and Contracts (Post-MVP, Foundry VTT)

- NFR10 [Post-MVP]: The Foundry profile attaches only to targets classified as `eligible` by profile-owned matching rules.
- NFR11 [Post-MVP]: The Foundry target-eligibility check must complete within a configurable timeout and return one of `eligible`, `target_mismatch`, or `disconnected`, with default timeout 5 seconds and configurable bounds of 1 to 30 seconds, measured from check start to state result.

### Core Platform Testing and Validation

- NFR12: Core execution and result normalization must be validated through deterministic automated tests that require 100% pass rate for success paths, syntax errors, runtime errors, and serialization-boundary cases without requiring a live profile runtime.
- NFR13: Automated platform tests must cover success paths, syntax errors, runtime errors, reconnect state transitions, and serialization boundaries including circular references, null or undefined values, and large payload handling, measured by test-suite coverage audit confirming each listed path has at least one exercising test case.
- NFR14: Any future profile must pass fixture-based target-matching and target-eligibility diagnostics tests before live-environment integration testing begins.

### Security and Diagnostics

- NFR15: The extension must connect only to explicitly user-configured endpoints and must not initiate other outbound endpoint connections, measured by connection-policy tests and traffic inspection during normal workflows.
- NFR16: The extension must not persist sensitive runtime secrets from evaluated cells unless explicitly saved by user action, measured by file-system audit and settings-state verification after execution sessions.
- NFR17: User-facing diagnostics must include actionable root-cause category and next-step guidance while excluding sensitive environment details such as tokens, credentials, and private paths, measured by diagnostic-message review against a defined redaction checklist.

### Deferred Quality Improvements

- Visual syntax error underlining in notebook cells remains deferred until the core execution and diagnostics loop is stable.
- A browser-extension bridge transport remains a candidate future architecture path, but evaluating it is separate from MVP delivery.

## Requirements Traceability Map

This table maps each user journey to the scope items, functional requirements, and non-functional requirements it exercises. Use this as the primary cross-reference for epic and story decomposition.

| Journey                               | Scope Items              | FRs                 | NFRs                         |
| ------------------------------------- | ------------------------ | ------------------- | ---------------------------- |
| J1: Rapid Snippet Iteration           | Core 1–12                | FR1–FR18, FR22–FR23 | NFR1, NFR3, NFR5–9, NFR12–13 |
| J2: Safe Experimentation and Reversal | Core 3–4, 10             | FR8–FR17, FR19–FR21 | NFR1, NFR3, NFR5–6           |
| J3: Connection and Target Recovery    | Core 1–2, 4–5            | FR1–FR7             | NFR2, NFR4, NFR8–9           |
| J4: Diagnosing Unexpected Behavior    | Core 2, 4, 7             | FR14–FR18           | NFR5–6, NFR8, NFR15–17       |
| J5: Adding an App Profile (Post-MVP)  | Profile scope (post-MVP) | FR27–FR36           | NFR10–11, NFR14              |

## Glossary

- **Profile:** A configuration boundary that defines target-matching rules, target-eligibility diagnostics, runtime helpers, and examples for a specific browser application. Profiles are post-MVP layers over the core kernel.
- **Transport:** The communication layer between the extension and the browser target. CDP over browser-level WebSocket is the MVP transport; the architecture preserves replaceability.
- **Shared result contract:** The normalized data structure that represents success and failure outcomes from cell execution, independent of transport or profile. Ensures consistent behavior across all execution paths.
- **Execution history retention:** Session-scoped storage of cell execution results so earlier outputs remain available for comparison as cells are revised and rerun.
- **Transport-boundary isolation:** The architectural property that notebook execution semantics do not depend on transport internals. The result contract mediates between transport and notebook concerns.
- **Target-eligibility state:** A profile-owned classification of whether the current target can execute profile code (`eligible`, `target_mismatch`, or `disconnected`).
- **Connection state:** A platform-level classification of the session lifecycle: `disconnected`, `connecting`, `connected`, or `error`.
