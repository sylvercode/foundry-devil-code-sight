---
storyId: "1.3"
storyKey: "1-3-connect-to-a-valid-browser-target"
title: "Connect to a Valid Browser Target"
status: "ready-for-dev"
created: "2026-04-04"
epic: "1"
priority: "p0"
---

# Story 1.3: Connect to a Valid Browser Target

**Status:** ready-for-dev

## Story

As a developer,
I want to initiate connection from VS Code to a valid browser target,
So that I can begin notebook execution quickly.

## Acceptance Criteria

### AC 1: Deterministic Connect State Transitions

**Given** valid endpoint configuration
**When** I run Connect
**Then** state transitions deterministically from connecting to connected or error
**And** final state is visible in the status indicator.

### AC 2: Valid Target Selection with Mismatch Category

**Given** multiple browser targets are present
**When** Connect executes
**Then** profile matching selects a valid target or returns target-mismatch
**And** the diagnostic names the failure category.

### AC 3: Actionable Guidance When No Valid Target Exists

**Given** no valid target exists
**When** Connect completes
**Then** an actionable next-step message is shown
**And** suggested actions include target-selection or endpoint checks.

## Tasks / Subtasks

### 1. Connection Lifecycle Baseline in Runtime Code (AC: 1)

- [ ] Add a canonical connection-state model using the platform states `disconnected`, `connecting`, `connected`, and `error`.
  - [ ] Keep transport lifecycle ownership in runtime code; avoid ad-hoc booleans in command handlers.
  - [ ] Ensure every connect attempt emits a deterministic transition sequence.
- [ ] Wire `jupyterBrowserKernel.connect` to set `connecting` before transport work begins.
  - [ ] Set `connected` only after target attach succeeds.
  - [ ] Set `error` for any categorized failure path.

### 2. CDP Browser-Target Connection and Session Attach (AC: 1, 2)

- [ ] Implement CDP browser-level connect flow using `chrome-remote-interface` (existing dependency).
  - [ ] Resolve browser-level WebSocket URL from `/json/version`.
  - [ ] Connect to browser target (not page target) to preserve DevTools coexistence.
- [ ] Enumerate targets and apply profile matching.
  - [ ] Match only page targets eligible for this profile (current planning constraint: URL includes `/game`).
  - [ ] If one eligible target exists, select it deterministically.
  - [ ] If no eligible targets exist, return categorized `target-mismatch`.
- [ ] Attach with `Target.attachToTarget({ flatten: true })` and capture `sessionId` for future operations.

### 3. User-Facing Diagnostics and Actionability (AC: 2, 3)

- [ ] Add categorized diagnostic output for connect outcomes.
  - [ ] Categories must include at minimum: `target-mismatch`, endpoint/connectivity failure, and uncategorized transport failure.
  - [ ] Keep user-facing messages state-led and concise.
- [ ] For `target-mismatch`, provide concrete next steps.
  - [ ] Check browser tab selection / active target context.
  - [ ] Verify endpoint host/port configuration.
  - [ ] Confirm profile-specific target URL expectations.
- [ ] Continue to redact sensitive endpoint details in user-facing errors.

### 4. Status Indicator Surface (AC: 1)

- [ ] Implement one authoritative status indicator for connection state.
  - [ ] Labels: `Disconnected`, `Connecting`, `Connected`, `Error`.
  - [ ] Keep text as the primary signal; color is supplemental only.
- [ ] Ensure final state is always visible after Connect completes (success or failure).

### 5. Tests and Regression Coverage (AC: 1, 2, 3)

- [ ] Add unit tests for state transition sequencing around connect.
  - [ ] Happy path: `disconnected -> connecting -> connected`.
  - [ ] Failure path: `disconnected -> connecting -> error`.
- [ ] Add unit tests for target selection/matching logic.
  - [ ] Selects deterministic eligible target when multiple targets exist.
  - [ ] Returns `target-mismatch` when no target matches.
- [ ] Add unit tests for diagnostic messaging.
  - [ ] Failure category is included in diagnostic output.
  - [ ] `target-mismatch` guidance includes actionable next steps.
- [ ] Keep tests under top-level `tests/` folders, not under `src/`.

## Dev Notes

### Story Context and Scope

- This story is the first real transport connection story after endpoint configuration hardening.
- Story 1.2 already validates endpoint values and provides field-specific remediation. Reuse that validation path; do not duplicate config validation logic.
- Connect remains the only contributed lifecycle command at this point. Reconnect/disconnect controls are separate stories.

### Architecture Guardrails (Must Follow)

- Keep runtime JavaScript-only execution direction (v1 scope).
- Preserve extension activation scope on `onCommand:jupyterBrowserKernel.connect`.
- Preserve transport/profile separation:
  - Transport owns connection lifecycle.
  - Profile owns target matching/eligibility semantics.
- Use normalized, categorized failures instead of leaking raw protocol errors.
- Keep manual reconnect as future story behavior; do not add auto-reconnect in this story.

### CDP and DevTools Coexistence Requirements

- Connect through browser-level CDP WebSocket (`/json/version` -> `webSocketDebuggerUrl`) rather than page-level WS endpoints.
- Use flat sessions (`flatten: true`) when attaching to target.
- Use session-scoped command/event paths for future safety; avoid APIs that cannot scope by `sessionId`.
- Preserve coexistence with active DevTools sessions; do not introduce forced disconnect behavior.

### Implementation Shape in Current Repository

- Current runtime code is concentrated in:
  - `src/extension.ts`
  - `src/commands/connect-command.ts`
  - `src/config/endpoint-config.ts`
- Introduce only the minimum new modules needed to support this story, for example:
  - `src/transport/*` for CDP connection and target attach behavior
  - `src/profile/*` for profile-owned target matching rules
  - `src/ui/*` for status indicator state mapping
- Keep file naming kebab-case and avoid speculative folder sprawl.

### Testing Requirements

- Prioritize deterministic unit tests for:
  - connection state transitions,
  - target selection classification,
  - diagnostic category and message content.
- If integration coverage is added, keep it fixture-driven and deterministic; do not rely on brittle live browser assumptions for baseline CI reliability.
- Place all tests in top-level tests directories (for example `tests/unit`, `tests/integration`) to align with project architecture constraints.

### Manual Test Checklist

- [ ] Set valid endpoint (`jupyterBrowserKernel.cdpHost`, `jupyterBrowserKernel.cdpPort`) and run connect.
  - [ ] Confirm status changes to `Connecting`, then `Connected` on success.
- [ ] With browser running but no eligible target open, run connect.
  - [ ] Confirm final status `Error`.
  - [ ] Confirm diagnostic includes `target-mismatch` category and actionable next steps.
- [ ] With invalid endpoint settings, run connect.
  - [ ] Confirm existing endpoint validation (Story 1.2) blocks before transport attempts.
- [ ] With multiple page targets including at least one eligible profile target, run connect.
  - [ ] Confirm deterministic target selection behavior and stable final state.
- [ ] Attach Edge/DevTools to the same browser context and rerun connect.
  - [ ] Confirm no forced disconnect behavior is introduced.

### Previous Story Intelligence (Story 1.2)

- Reuse existing endpoint validation contract from `src/config/endpoint-config.ts` and command runtime wiring in `src/commands/connect-command.ts`.
- Preserve deterministic and actionable error language patterns already established.
- Keep endpoint redaction behavior (`summarizeEndpointForDisplay`) for user-facing diagnostics.
- Keep settings namespace and command naming stable (`jupyterBrowserKernel.*`, `jupyterBrowserKernel.connect`).

### Git Intelligence Summary (Recent Commits)

- Recent work pattern is story-driven, with implementation + tests + docs/sprint status updates in lockstep.
- Endpoint validation and connect command scaffolding were recently hardened; this story should extend rather than replace those foundations.
- Commit trend shows strict incremental delivery: preserve that style and avoid broad speculative refactors.

### Latest Technical Information

- Current repository dependency: `chrome-remote-interface@^0.33.2`.
- Latest published package version: `0.34.0`.
- Guidance for this story:
  - Use latest published package version.
  - If upgrading, include explicit compatibility validation for browser-target connect and `Target.attachToTarget({ flatten: true })` behavior.

## References

- `docs/epics/epic-1-connect-and-control-browser-sessions.md` (Story 1.3 requirements and acceptance criteria)
- `docs/prd.md` (FR2, FR3, FR4, FR7, NFR8, NFR15, NFR17)
- `docs/architecture.md` (transport-owned lifecycle, profile-owned matching, state-model, normalized errors)
- `docs/ux-spec/10-component-strategy.md` (single authoritative status contract)
- `docs/ux-spec/11-ux-consistency-patterns.md` (state-led actionable messaging)
- `docs/ux-spec/06-detailed-core-user-experience.md` (connection lifecycle + eligibility diagnostics expectations)
- `spike/cdp-multiplex-findings.md` (browser-level WS + flat-session multiplexing with CRI)
- `docs/stories/1-2-configure-browser-endpoint.md` (existing endpoint validation and connect command baseline)

## Dev Agent Record

### Agent Model Used

GPT-5.3-Codex

### Debug Log References

- Created via create-story workflow execution on 2026-04-04.

### Completion Notes List

- Comprehensive context assembled from epic, PRD, architecture, UX specs, CDP spike findings, previous story intelligence, and current repository reality.
- Story status set to `ready-for-dev`.
- Guardrails include deterministic state transitions, categorized target-mismatch diagnostics, and actionable recovery guidance.
- CDP guidance explicitly preserves browser-level multiplexing and DevTools coexistence requirements.

### File List

- docs/stories/1-3-connect-to-a-valid-browser-target.md
