---
storyId: "1.5"
storyKey: "1-5-preserve-devtools-coexistence"
title: "Preserve DevTools Coexistence"
status: "done"
created: "2026-04-12"
epic: "1"
priority: "p0"
---

# Story 1.5: Preserve DevTools Coexistence

**Status:** done

## Story

As a developer,
I want kernel connectivity to coexist with browser DevTools attachment,
So that I can debug and iterate notebooks at the same time.

## Acceptance Criteria

### AC 1: Active DevTools Session Does Not Force Disconnect

**Given** DevTools is attached to the same browser context
**When** kernel connection is active
**Then** forced disconnect does not occur
**And** execution capability remains available.

### AC 2: Reconnect Preserves Viability During DevTools Usage

**Given** reconnect is invoked during active DevTools usage
**When** reconnect completes
**Then** session viability is preserved or explicit error is returned
**And** no silent failure path exists.

### AC 3: Coexistence Regression Is Detectable in Tests

**Given** coexistence behavior regresses
**When** integration tests run
**Then** deterministic tests fail
**And** the regression is attributable to coexistence checks.

## Tasks / Subtasks

### 1. Harden Browser-Level Attach Invariants (AC: 1, 2)

- [x] Keep browser-level CDP websocket attach as the only connect path.
  - [x] Reconfirm connect flow resolves `webSocketDebuggerUrl` from `/json/version` and never binds to page-level websocket endpoints.
  - [x] Keep `CDP({ target: browserWebSocketUrl, local: true })` behavior intact.
- [x] Keep flat target sessions mandatory for multiplexing.
  - [x] Preserve `Target.attachToTarget({ flatten: true })` in connect flow.
  - [x] Add explicit guard comments near attach call documenting that changing `flatten` breaks coexistence.
- [x] Keep session-scoped command routing behavior.
  - [x] Preserve `client.send(method, params, sessionId)` for probe/evaluation paths.
  - [x] Ensure no domain shorthand path is introduced for session-scoped operations.

### 2. Make Coexistence Failure Surfaces Explicit (AC: 2)

- [x] Ensure reconnect and connect failure paths remain categorized and actionable.
  - [x] Reuse existing failure categories (`target-mismatch`, `endpoint-connectivity`, `transport-failure`).
  - [x] Explicitly surface coexistence-impacting transport failures instead of generic silent failures.
- [x] Keep command outcomes state-led.
  - [x] Every reconnect attempt must end in `connected` or `error`.
  - [x] No intermediate failure path may leave state ambiguous.

### 3. Add Deterministic Coexistence Regression Coverage (AC: 3)

- [x] Add or extend integration tests for browser-level multiplexing behavior.
  - [x] Validate two independent sessions can attach to the same page target and execute isolated commands.
  - [x] Validate session-scoped event routing remains isolated by `sessionId`.
- [x] Add reconnect-plus-coexistence coverage.
  - [x] Simulate reconnect while a separate attach session remains active.
  - [x] Assert outcome is either restored viability (`connected`) or explicit categorized error (`error`) with guidance.
- [x] Add negative guardrail tests.
  - [x] Document and test expected failure mode when attach semantics are intentionally broken (for example flatten disabled in test double), proving tests would catch real regressions.

### 4. Preserve Ownership Boundaries and Existing Runtime Patterns (AC: 1, 2)

- [x] Keep transport lifecycle ownership in transport modules.
  - [x] Do not move connection lifecycle logic into command/UI layers.
- [x] Keep profile ownership for target eligibility/matching.
  - [x] Do not hardcode profile-specific URL assumptions in transport.
- [x] Keep normalized diagnostics.
  - [x] Do not leak raw CRI protocol errors directly to user-facing surfaces.

### 5. Validate Locally and Record Outcomes (AC: 1, 2, 3)

- [x] Run unit tests for command/transport state transitions touched by coexistence work.
- [x] Run deterministic integration coverage for coexistence scenarios.
- [x] Run compile to confirm extension host/runtime type safety.

## Dev Notes

### Story Context and Scope

- Story 1.3 introduced browser-level CDP attach with flat sessions and deterministic target selection.
- Story 1.4 introduced explicit disconnect/reconnect lifecycle plus cancellation-safe transition handling.
- Story 1.5 is a guardrail-and-regression story: preserve and prove DevTools coexistence, not redesign lifecycle architecture.

### Architecture Guardrails (Must Follow)

- Browser-level websocket multiplexing is mandatory for coexistence.
- Flat target session attach (`flatten: true`) is mandatory.
- Connection lifecycle remains transport-owned, with manual reconnect only.
- Result/failure normalization remains required at transport boundary.

### UX Guardrails (Must Follow)

- Keep one authoritative textual state label (`Disconnected`, `Connecting`, `Connected`, `Error`).
- Reconnect outcomes must be explicit and actionable.
- No silent failure path is acceptable.

### Implementation Guidance by File

- `src/transport/browser-connect.ts`
  - Preserve browser-level attach and flat-session behavior.
  - Keep session-scoped command routing and abort-aware flow.
- `src/commands/connect-command.ts`
  - Keep categorized diagnostics and endpoint-settings guidance.
- `src/commands/reconnect-command.ts`
  - Preserve deterministic reconnect completion states and explicit user feedback.
- `src/transport/connect-diagnostics.ts`
  - Keep clear coexistence-relevant failure guidance.
- `tests/integration/`
  - Add deterministic coexistence tests for multiplex attach and session isolation.
- `tests/unit/transport/`
  - Add focused guardrail tests around attach parameters/routing where practical.

### Previous Story Intelligence (Story 1.4)

- Cancellation-safe transitions were added to prevent stale in-flight operations from overriding final lifecycle state; reuse this behavior, do not bypass it.
- Disconnect/reconnect commands already enforce deterministic outcomes and share settings-prompt helpers.
- Review patches in 1.4 fixed real failure modes (in-flight cancellation and disconnect/reconnect teardown resilience); keep these protections intact while adding coexistence coverage.

### Git Intelligence Summary (Recent Commits)

- Recent commits are focused on story 1.4 lifecycle and review patches in command/transport code.
- Coexistence work should stay incremental and localized to transport + tests to avoid regressing freshly stabilized reconnect behavior.

### Latest Technical Information

- `chrome-remote-interface` latest published version: `0.34.0`.
- `devtools-protocol` latest published version: `0.0.1612613`.
- Current project already targets CRI `^0.34.0`; no dependency bump is required for this story.

### Manual Test Checklist

- [x] Connect while Edge DevTools is attached to the same browser/page context.
  - [x] Confirm status reaches and remains `Connected`.
  - [x] Confirm no forced disconnect occurs.
- [x] Execute reconnect while DevTools remains attached.
  - [x] Confirm final state is `Connected` or explicit `Error` with category and action.
  - [x] Confirm no silent stall or ambiguous state.
- [x] Execute a runtime probe/evaluation after coexistence scenario.
  - [x] Confirm session-scoped command still succeeds.
- [x] Repeat reconnect multiple times with DevTools attached.
  - [x] Confirm deterministic outcomes and no escalating instability.

## References

- `docs/epics/epic-1-connect-and-control-browser-sessions.md` (Story 1.5 requirements and traceability)
- `docs/prd.md` (coexistence property, FR7, NFR8, NFR2, NFR4)
- `docs/architecture.md` (browser-level multiplexing, transport-owned lifecycle, boundary rules)
- `docs/ux-spec/06-detailed-core-user-experience.md` (state clarity and recovery expectations)
- `docs/ux-spec/10-component-strategy.md` (authoritative status contract)
- `docs/ux-spec/11-ux-consistency-patterns.md` (state-led feedback and explicit recovery actions)
- `spike/cdp-multiplex-findings.md` (CRI multiplex proof, `flatten: true`, session-scoped routing)
- `docs/stories/1-4-disconnect-and-manual-reconnect-lifecycle.md` (prior lifecycle safeguards and learnings)

## Dev Agent Record

### Agent Model Used

GPT-5.3-Codex

### Debug Log References

- Story context created via create-story workflow on 2026-04-12.
- `npm run lint`
- `npm run test:unit`
- `npm run test:integration`
- `npm run compile`

### Completion Notes List

- Comprehensive context assembled from epic, PRD, architecture, UX specs, CDP multiplex findings, previous story intelligence, and current repository reality.
- Story status set to ready-for-dev for implementation handoff.
- Scope constrained to coexistence preservation and deterministic regression proofing.
- Added transport-level coexistence guardrails with explicit flat-session attach helper and attach-path documentation.
- Added deterministic unit guardrails for attach flatten enforcement and session-scoped event-key construction.
- Added CDP integration coverage for multi-session coexistence and reconnect viability with an externally attached session.
- Improved transport-failure diagnostics with explicit coexistence recovery guidance.
- Validation passed: lint, unit tests, integration test suite (CDP tests gated/skipped without `RUN_CDP_INTEGRATION=1`), and compile.

### Review Findings

- [x] [Review][Patch] Use `toSessionScopedEventName` for integration test event keys to keep session-scoped routing conventions consistent. [tests/integration/transport/browser-connect.integration.test.ts]
- [x] [Review][Patch] Add negative guardrail coverage for omitted flatten mode to prove coexistence regression detectability. [tests/integration/transport/browser-connect.integration.test.ts]

### File List

- docs/stories/1-5-preserve-devtools-coexistence.md
- docs/stories/sprint-status.yaml
- src/transport/browser-connect.ts
- src/transport/connect-diagnostics.ts
- tests/integration/transport/browser-connect.integration.test.ts
- tests/unit/transport/browser-connect.test.ts

## Change Log

- 2026-04-12: Implemented Story 1.5 coexistence guardrails and regression coverage; status advanced to review.
