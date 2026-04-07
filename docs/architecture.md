---
stepsCompleted:
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
  - 7
  - 8
inputDocuments:
  - docs/product-brief.md
  - docs/prd.md
  - docs/index.md
  - docs/brainstorming-session-2026-03-14-162248.md
  - spike/cdp-multiplex-findings.md
  - _bmad-output/planning-artifacts/sprint-change-proposal-2026-03-18.md
  - docs/ux-spec/index.md
  - docs/ux-spec/01-executive-summary.md
  - docs/ux-spec/02-core-user-experience.md
  - docs/ux-spec/03-desired-emotional-response.md
  - docs/ux-spec/04-ux-pattern-analysis-inspiration.md
  - docs/ux-spec/05-design-system-foundation.md
  - docs/ux-spec/06-detailed-core-user-experience.md
  - docs/ux-spec/07-visual-design-foundation.md
  - docs/ux-spec/08-design-direction-decision.md
  - docs/ux-spec/09-user-journey-flows.md
  - docs/ux-spec/10-component-strategy.md
  - docs/ux-spec/11-ux-consistency-patterns.md
  - docs/ux-spec/12-responsive-design-accessibility.md
workflowType: architecture
project_name: jupyter-browser-kernel
user_name: Sylvercode
date: 2026-03-21
lastStep: 8
status: complete
completedAt: 2026-03-21
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
The requirement set defines a clear two-layer architecture. The core layer owns browser session lifecycle, JavaScript notebook execution, normalized result contracts, intentional output handling, execution history, reconnect operations, and deterministic testing. A separate profile layer owns target-matching policies, eligibility diagnostics, runtime envelope details, and profile-specific workflows.

The FR structure also enforces stability boundaries:

- Core execution semantics must remain consistent regardless of transport details.
- Profile behaviors must remain additive and not leak into core runtime assumptions.
- Post-MVP capability expansion (watchers, prompts, reusable actions) extends existing contracts rather than replacing them.

**Non-Functional Requirements:**
The NFRs are architecture-driving and measurable:

- Performance: render and reconnect responsiveness targets.
- Reliability: explicit failure surfacing and parity across execution paths.
- Integration: DevTools coexistence, profile-owned eligibility checks, adapter-agnostic core.
- Security: user-configured endpoint boundaries, no secret persistence by default, safe diagnostics.
- Verification: deterministic fixture coverage for success, syntax/runtime errors, reconnect states, and serialization boundaries.

**Scale and Complexity:**
This is a medium-complexity platform foundation project with high precision requirements in runtime contracts and operational behavior.

- Primary domain: VS Code extension and browser execution kernel platform
- Complexity level: medium
- Estimated architectural components: 9

### Technical Constraints and Dependencies

- Runtime scope is JavaScript-only for v1.
- VS Code extension APIs and notebook workflow are the host boundary.
- Browser execution currently depends on CDP capabilities and coexistence-safe session orchestration.
- Direct transport details must remain replaceable behind a stable execution contract.
- Manual reconnect is required for MVP; automatic reconnect is deferred.
- Serialization limits require shallow value strategies and intentional drill-down patterns.
- Core and profile responsibilities must remain strictly separated to prevent scope and coupling regressions.

### Cross-Cutting Concerns Identified

- Connection-state and target-eligibility state modeling
- Result normalization contract across all execution outcomes
- Intentional output discrimination from ambient browser noise
- Diagnostics quality, actionability, and sensitive-data redaction
- DevTools coexistence guarantees under active execution
- Transport abstraction and future transport migration safety
- Deterministic automated validation via static browser fixtures
- Reversible experimentation workflow support (forward and rollback cells)

## Starter Template Evaluation

### Primary Technology Domain

VS Code extension platform on Node.js, TypeScript-only.

### Starter Options Considered

| Option                  | Version                          | Status        | Notes                                               |
| ----------------------- | -------------------------------- | ------------- | --------------------------------------------------- |
| Yeoman + generator-code | yo@7.0.0, generator-code@1.11.18 | ✅ Selected   | Updated Feb 2026, official VS Code recommended path |
| create-vscode-extension | 0.1.3                            | ❌ Eliminated | Last updated 2022, stale and unmaintained           |
| Manual scaffold         | —                                | ❌ Not chosen | Highest effort, lowest leverage                     |

### Selected Starter: Yeoman + generator-code (TypeScript + esbuild + ESM)

**Initialization Command:**

```bash
npx --package yo --package generator-code -- yo code --extensionType ts --bundler esbuild --pkgManager npm --skipOpen
```

Followed by configuring ESM output in `tsconfig.json` and esbuild config.

### Module System Decision: ESM

| Factor                               | CommonJS                       | ESM                                         |
| ------------------------------------ | ------------------------------ | ------------------------------------------- |
| VS Code extension host compatibility | Proven, no edge cases          | Requires validation in early implementation |
| TypeScript output                    | `module: commonjs`             | `module: esnext` or `module: node16`        |
| Import semantics                     | `require()` / `module.exports` | `import` / `export`                         |
| Bundler support                      | Universal                      | esbuild handles natively                    |
| Future compatibility                 | Legacy model                   | Modern standard                             |
| Project preference                   | —                              | ✅ Explicit user preference                 |

**Decision: ESM** — with an explicit compatibility checkpoint in the first implementation story to validate extension-host loading, test runner integration, and esbuild bundle output.

### Architectural Decisions Derived from Starter

- **Language:** TypeScript strict mode (`"strict": true`)
- **Build system:** esbuild, ESM output target
- **Runtime:** VS Code extension host (Node.js)
- **Distribution:** Local/dev only for MVP — no Marketplace publishing
- **Packaging:** `@vscode/vsce@3.7.1` available when Marketplace distribution is needed post-MVP
- **Testing:** Modern tooling preferred; `@vscode/test-cli@0.0.12` available as primary test runner candidate

> **Implementation Note:** Project initialization using the command above is the first implementation story. The ESM compatibility checkpoint is part of that story's acceptance criteria.

## Core Architectural Decisions

### Decision Priority Analysis

Critical Decisions (Block Implementation):

- Transport architecture: Direct CDP for MVP through browser-level WebSocket multiplexing with flat sessions.
- Result contract: Discriminated union with strict success/error parity.
- Connection lifecycle: Transport-owned connection state machine with manual reconnect only.

Important Decisions (Shape Architecture):

- Module decomposition: Clear core/kernel, transport, profile, notebook, and UI boundaries.
- Execution envelope: Hybrid strategy where kernel owns canonical envelope and normalization while profile can inject controlled hooks.
- Profile boundary: Capability-negotiated profile interface with minimal default capability surface.
- Testing strategy: Layered deterministic strategy spanning unit, contract, integration, and extension-host tests.

Deferred Decisions (Post-MVP):

- Alternate transport implementations beyond CDP (for example browser extension bridge).
- Advanced output channels and deeper inspect capabilities not required for MVP.
- Expanded profile capability negotiation beyond baseline execution and handshake needs.

### Data Architecture

- No application database is required for MVP.
- Persistent storage is limited to local extension state where necessary for UX continuity, not domain data modeling.
- No migration framework is required for MVP scope.
- Caching is in-memory only and bounded to session/runtime concerns.

### Authentication and Security

- No user authentication or authorization layer in MVP scope.
- Security model centers on local development usage with explicit user-controlled browser endpoint configuration.
- No secret persistence by default.
- Diagnostics must redact sensitive endpoint details where applicable.
- Transport boundary prevents leaking raw protocol errors outside normalized contracts.

### API and Communication Patterns

- Internal API style is interface-first TypeScript contracts between kernel, transport, and profile boundaries.
- External communication in MVP is transport-driven command/evaluate flows over CDP.
- Error handling standard is normalized execution results only:
  - success branch with value and representation
  - failure branch with name, message, optional stack, and failure kind
- No network rate-limiting strategy is required for MVP because communication is local and session-scoped.
- Version-verified toolchain references:
  - chrome-remote-interface: 0.34.0 (modified 2026-02-09)
  - vitest: 4.1.0 (modified 2026-03-12)
  - @vscode/test-cli: 0.0.12 (modified 2025-10-09)

### Frontend Architecture

- VS Code extension UI surface only (status and diagnostics), no standalone frontend app.
- State ownership is explicit:
  - transport state machine for connection lifecycle
  - profile state machine for post-connect environment readiness
- Notebook output rendering consumes normalized kernel results only.
- No additional bundle-optimization strategy beyond starter esbuild setup is required in MVP.

### Infrastructure and Deployment

- Local and development-only distribution for MVP.
- Build system: TypeScript strict + esbuild with ESM output.
- CI can be introduced with compile, lint, and test gates, but marketplace release automation is deferred.
- Monitoring/logging is local diagnostic-first and actionability-focused.
- Scaling strategy for MVP is single-user local workflow; horizontal runtime scaling is out of scope.

### Decision Impact Analysis

Implementation Sequence:

1. Establish transport abstractions and transport-owned connection state machine.
2. Implement CDP transport (direct CDP) with flat session orchestration.
3. Implement kernel execution pipeline with canonical envelope and normalized result union.
4. Define profile interface and profile-owned state machine, then implement baseline generic profile.
5. Integrate notebook controller and UI diagnostics/status surfaces.
6. Build deterministic layered tests with fixture-driven browser integration and extension-host coverage.

Cross-Component Dependencies:

- Kernel depends on transport and profile interfaces, not implementations.
- Profile depends on transport-provided target/session handles but does not manage raw transport lifecycle.
- UI and notebook layers depend only on kernel-facing contracts and normalized state/results.
- Transport substitution is enabled by interface boundaries, preserving kernel behavior and tests.

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

Critical conflict points identified: 5 major areas where AI agents could make different choices and create integration friction:

- Naming and symbol style drift
- Layer boundary and file placement drift
- Result/error/data format drift
- Event/log/state communication drift
- Process and validation timing drift

### Naming Patterns

Database Naming Conventions:

- No application database conventions required for MVP.
- If persistence is introduced later, naming rules must be added before implementation.

API Naming Conventions:

- External API surface is not a primary project concern in MVP; internal contract naming is mandatory.
- Internal contract fields use camelCase.
- Error kind literals use kebab-case (for example: syntax-error, transport-error).

Code Naming Conventions:

- File names: kebab-case (for example: execution-kernel.ts, cdp-transport.ts).
- Types, classes, and interfaces: PascalCase (for example: ExecutionKernel, ITransport).
- Functions and variables: camelCase.
- Constants and env keys: UPPER_SNAKE_CASE.
- Avoid alias names for core concepts; one canonical name per concept across layers.

### Structure Patterns

Project Organization:

- Unit and contract tests must live outside source folders in dedicated tests folders.
- Integration fixtures must live under tests/fixtures.
- Extension-host test entry points must live under tests (not under source).
- Source folders must contain runtime code only.

File Structure Patterns:

- No cross-layer imports that violate architecture boundaries:
  - kernel cannot import concrete transport and profile implementations
  - ui and notebook cannot import transport directly
- Transport implementations stay in transport; profile implementations stay in profile.
- Shared helper utilities must be explicitly scoped (kernel helper, transport helper, profile helper) rather than generic dumping grounds.
- Prefer narrow exports; avoid broad wildcard re-export patterns that blur boundaries.

### Format Patterns

API Response Formats:

- Execution and evaluation results must always use the normalized discriminated union contract.
- Raw transport and protocol errors must never leak beyond transport boundary.
- Success and failure branches must be exhaustive and type-checkable.

Data Exchange Formats:

- Runtime payload fields use camelCase.
- Date and time values use ISO-8601 strings.
- Error payload shape is normalized: { name, message, stack?, kind }.
- Nullability must be explicit in types; avoid implicit undefined contracts for required fields.

### Communication Patterns

Event System Patterns:

- Internal events use dot.case naming (for example: transport.connected, profile.handshake.ok).
- Event payloads must have stable typed interfaces.
- Event names reflect domain ownership (transport._, profile._, kernel.\*).

State Management Patterns:

- Connection lifecycle state is transport-owned.
- Post-connect readiness and compatibility state is profile-owned.
- Kernel consumes state from transport and profile interfaces and must not duplicate independent ad-hoc lifecycle flags.
- UI surfaces derive state from canonical state machines, not inferred booleans.

### Process Patterns

Error Handling Patterns:

- Normalize all execution outcomes before returning to notebook and UI layers.
- Separate diagnostic detail for logs from user-facing message text.
- Enforce deterministic failure-kind mapping for syntax, runtime, transport, and limit paths.
- Preserve actionable error context while redacting sensitive endpoint details when needed.

Loading State Patterns:

- Loading states come from state machines and operation status, not manually scattered booleans.
- Manual reconnect only for MVP.
- Validation timing must be consistent:
  - transport validation at connect
  - profile handshake after connect
  - envelope and result validation before notebook output render

### Enforcement Guidelines

All AI Agents MUST:

- Follow naming and file placement rules exactly.
- Respect layer boundaries and import constraints.
- Return normalized result and error formats only.
- Place all tests under dedicated tests folders outside source.
- Add or update tests for each feature touching kernel, transport, or profile behavior.

Pattern Enforcement:

- Enforce via lint rules, TypeScript strict mode, and review checklist gates.
- Reject pull requests that introduce cross-layer import violations or unnormalized results.
- Document violations in review comments with exact rule references.
- Update this pattern section before adopting any intentional convention change.

### Pattern Examples

Good Examples:

- tests/unit/execution-kernel.test.ts
- tests/contract/transport-contract.test.ts
- tests/integration/fixtures/runtime-error.html
- transport.connected event with typed payload
- Normalized failure: { ok: false, name: "TypeError", message: "...", kind: "runtime-error" }

Anti-Patterns:

- Source-co-located tests (for example: src/kernel/execution-kernel.test.ts)
- Kernel importing CdpTransport directly
- UI importing transport implementation directly
- Throwing raw protocol errors past transport boundary
- Mixed naming styles for same concept across modules

## Project Structure & Boundaries

### Complete Project Directory Structure

```text
jupyter-browser-kernel/
├── README.md
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsconfig.eslint.json
├── esbuild.mjs
├── eslint.config.mjs
├── .vscodeignore
├── .gitignore
├── CHANGELOG.md
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── lint-test.yml
├── docs/
│   ├── prd.md
│   ├── product-brief.md
│   └── architecture.md
├── src/
│   ├── extension.ts
│   ├── kernel/
│   │   ├── execution-kernel.ts
│   │   ├── execution-result.ts
│   │   ├── envelope-runner.ts
│   │   ├── output-collector.ts
│   │   └── index.ts
│   ├── transport/
│   │   ├── i-transport.ts
│   │   ├── connection-state-machine.ts
│   │   ├── cdp-transport.ts
│   │   ├── cdp-session.ts
│   │   └── index.ts
│   ├── profile/
│   │   ├── i-profile.ts
│   │   ├── profile-state-machine.ts
│   │   ├── profile-capabilities.ts
│   │   ├── generic-web-profile.ts
│   │   └── index.ts
│   ├── notebook/
│   │   ├── kernel-controller.ts
│   │   ├── output-renderer.ts
│   │   └── index.ts
│   ├── ui/
│   │   ├── status-bar.ts
│   │   ├── diagnostics.ts
│   │   └── index.ts
│   ├── config/
│   │   ├── extension-config.ts
│   │   └── defaults.ts
│   └── shared/
│       ├── types/
│       │   ├── error-types.ts
│       │   └── event-types.ts
│       └── utils/
│           ├── assert.ts
│           └── redact.ts
├── tests/
│   ├── unit/
│   │   ├── kernel/
│   │   ├── transport/
│   │   └── profile/
│   ├── contract/
│   │   ├── transport-contract.test.ts
│   │   └── profile-contract.test.ts
│   ├── integration/
│   │   ├── browser-cdp/
│   │   └── notebook-flow/
│   ├── extension-host/
│   │   ├── suite/
│   │   └── run-test.mjs
│   ├── fixtures/
│   │   ├── success/
│   │   ├── syntax-error/
│   │   ├── runtime-error/
│   │   ├── serialization-limit/
│   │   └── reconnect/
│   └── test-utils/
│       ├── fake-transport.ts
│       ├── fake-profile.ts
│       └── chromium-harness.ts
└── dist/
  └── extension.mjs
```

### Architectural Boundaries

API Boundaries:

- Extension command and notebook entry points are exposed only through extension and notebook layers.
- No external network API boundary is required for MVP.
- Transport protocol details are hidden behind transport interfaces.

Component Boundaries:

- Kernel communicates with transport and profile through interfaces only.
- Notebook and UI consume kernel outputs and state, not transport internals.
- Profile owns target selection and post-connect readiness; transport owns connection lifecycle.

Service Boundaries:

- Transport service: session lifecycle, connection state, protocol execution.
- Profile service: target resolution, handshake and readiness checks, profile capabilities.
- Kernel service: execution orchestration, envelope application, result normalization.

Data Boundaries:

- No persistent domain database boundary in MVP.
- Runtime data contracts are typed and normalized at kernel boundary.
- Diagnostics data is redacted before user-facing output.

### Requirements to Structure Mapping

Feature and FR Mapping:

- Connection lifecycle and reconnect requirements: src/transport plus src/ui/status-bar and tests/integration/reconnect.
- Execution result normalization requirements: src/kernel/execution-result and tests/unit/kernel plus tests/fixtures.
- Profile eligibility and handshake requirements: src/profile and tests/contract/profile.
- Notebook execution workflow requirements: src/notebook plus tests/integration/notebook-flow.
- DevTools coexistence and CDP multiplexing requirements: src/transport/cdp-\* and tests/integration/browser-cdp.

Cross-Cutting Concerns:

- Error normalization and redaction: src/shared/types/error-types and src/shared/utils/redact.
- State consistency: transport and profile state machine modules.
- Output consistency: src/kernel/output-collector and src/notebook/output-renderer.

### Integration Points

Internal Communication:

- extension initializes composition root and wires interfaces.
- notebook and ui subscribe to kernel-facing state and results.
- kernel calls transport and profile contracts and returns normalized outputs.

External Integrations:

- Chromium CDP endpoint through chrome-remote-interface in transport layer.
- VS Code extension APIs and notebook controller APIs in extension and notebook layers.

Data Flow:

1. User triggers notebook execution.
2. Kernel requests transport readiness and profile execution plan.
3. Kernel runs canonical envelope with controlled profile hooks.
4. Transport executes against active session.
5. Kernel normalizes success or failure result.
6. Notebook and UI render normalized output and diagnostics.

### File Organization Patterns

Configuration Files:

- Root-level toolchain and extension config files.
- Runtime defaults and extension setting access in src/config.

Source Organization:

- Layered structure by architectural responsibility, not by ad-hoc feature dumping.
- Shared folder limited to cross-layer types and utilities only.

Test Organization:

- All tests live in top-level tests folders outside source.
- Unit, contract, integration, extension-host, fixtures, and test-utils are isolated by purpose.

Asset Organization:

- Fixture assets and HTML pages live in tests/fixtures.
- No mixed runtime assets under source unless explicitly required by extension packaging.

### Development Workflow Integration

Development Server Structure:

- Watch and compile run against source layers; tests run from dedicated tests tree.

Build Process Structure:

- esbuild produces dist output from extension entry while preserving layer boundaries in source.

Deployment Structure:

- Local and dev-focused packaging from dist output with extension metadata at root.

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
All technology choices are compatible and version-verified. TypeScript strict + esbuild ESM output + VS Code extension host form a proven toolchain. chrome-remote-interface@0.34.0 operates behind `ITransport`, keeping the kernel independent of protocol choice. vitest@4.1.0 and @vscode/test-cli@0.0.12 cover separate test layers without overlap or conflict. The discriminated union result contract fits naturally with TypeScript exhaustive type narrowing. No contradictory decisions were found.

**Pattern Consistency:**
Implementation patterns support architectural decisions uniformly. Naming conventions (kebab-case files, PascalCase types, camelCase functions, dot.case events) apply consistently across kernel, transport, profile, notebook, and UI layers. The event domain-ownership convention (`transport.*`, `profile.*`, `kernel.*`) aligns directly with the module decomposition. Normalized result and error formats use the same discriminated union shape at every boundary. Tests-outside-source rule is enforced by directory structure.

**Structure Alignment:**
The project structure fully supports architectural decisions. `src/transport/` owns `connection-state-machine.ts` and `i-transport.ts`, matching the transport-owned lifecycle decision. `src/profile/` owns `profile-state-machine.ts` and `i-profile.ts`, matching the profile-owned readiness decision. Kernel depends only on interfaces, and notebook/UI layers consume only kernel outputs. Boundary isolation is structural, not advisory. The `tests/` tree mirrors the layered testing strategy exactly: unit, contract, integration, extension-host, and fixtures all have dedicated locations.

### Requirements Coverage Validation ✅

**Epic/Feature Coverage:**
The architecture supports all MVP platform capabilities: connection and session control, notebook execution, normalized result contract, output discrimination, execution history, manual reconnect, and deterministic fixture-based testing. Profile-specific and post-MVP capabilities are scoped to dedicated profile boundaries and capability negotiation without contaminating core kernel modules.

**Functional Requirements Coverage:**

- FR1-FR7 (Connection and Session Control) are covered by `src/transport/`, `src/config/`, and `src/ui/status-bar`.
- FR8-FR13 (Notebook Execution) are covered by `src/kernel/` and `src/notebook/`.
- FR14-FR17 (Result and Output Contract) are covered by `src/kernel/execution-result`, `src/kernel/output-collector`, and shared error/event types.
- FR18 (Platform Testing and Validation) is covered by `tests/fixtures/`, `tests/integration/`, and `tests/contract/`.
- FR19-FR22 (Experimentation Workflow and install path) are supported by notebook execution flow and session lifecycle design.
- FR23 (Extension-owned output helpers) is covered by kernel envelope and profile hook strategy under architecture-scoped helper conventions.
- FR24-FR37 (Post-MVP) are accommodated through capability-negotiated profile interfaces and explicit deferred architectural slots.

**Non-Functional Requirements Coverage:**

- NFR1-NFR3 (Performance) are supported by a shallow execution pipeline and explicit state-driven flow.
- NFR4-NFR6 (Reliability and parity) are supported by transport connection-state management and discriminated union normalization with deterministic fixtures.
- NFR7-NFR9 (Integration and contracts) are supported by adapter-agnostic core boundaries, DevTools coexistence strategy, and deterministic profile diagnostics.
- NFR10-NFR11 (Post-MVP profile eligibility specifics) are structurally supported via profile state machine and capability model.
- NFR12-NFR14 (Testing and validation) are supported by layered test architecture and dedicated fixture suites.
- NFR15-NFR17 (Security and diagnostics) are covered by user-configured endpoints, no secret persistence by default, and redaction-oriented diagnostic utilities.

### Implementation Readiness Validation ✅

**Decision Completeness:**
All implementation-blocking decisions are documented with specific direction and version anchors where required. The architecture provides unambiguous ownership boundaries for transport, profile, kernel, notebook, and UI responsibilities. Consistency rules are explicit enough to reduce AI-agent divergence.

**Structure Completeness:**
The project structure defines all key source and test areas needed for implementation kickoff. Module boundaries, integration points, and data flow are clearly specified. There are no missing top-level domains that would block initial implementation.

**Pattern Completeness:**
Naming, structure, format, communication, and process patterns are all defined with enforcement guidance and anti-pattern examples. Known conflict points are covered, including result normalization, state ownership, and test placement.

### Gap Analysis Results

**Critical Gaps:**

- None.

**Important Gaps:**

- None.

**Nice-to-Have Gaps:**

- Future CI workflow detail (exact job matrix and gating thresholds) can be elaborated in implementation stories.
- Additional concrete examples for post-MVP profile capability negotiation could be added later for onboarding speed.

### Validation Issues Addressed

No critical or important validation issues were found that require architectural rework before implementation.

### Architecture Completeness Checklist

**✅ Requirements Analysis**

- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**✅ Architectural Decisions**

- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**✅ Implementation Patterns**

- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**✅ Project Structure**

- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** HIGH based on validation results.

**Key Strengths:**

- Strong transport abstraction boundary that preserves future transport substitution.
- Clear separation between transport lifecycle state and profile readiness state.
- Deterministic normalized result contract suitable for consistent notebook and UI behavior.
- Test strategy aligned to architecture boundaries with dedicated non-co-located test structure.

**Areas for Future Enhancement:**

- Add deeper post-MVP profile capability examples and migration playbook for alternate transports.
- Expand optional advanced output inspection patterns after core loop stabilization.

### Implementation Handoff

**AI Agent Guidelines:**

- Follow all architectural decisions exactly as documented.
- Use implementation patterns consistently across all components.
- Respect project structure and boundaries.
- Refer to this document for all architectural questions.

**First Implementation Priority:**
npx --package yo --package generator-code -- yo code --extensionType ts --bundler esbuild --pkgManager npm --skipOpen
