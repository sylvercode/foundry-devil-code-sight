---
storyId: "1.4"
storyKey: "1-4-disconnect-and-manual-reconnect-lifecycle"
title: "Disconnect and Manual Reconnect Lifecycle"
status: "ready-for-dev"
created: "2026-04-11"
epic: "1"
priority: "p0"
---

# Story 1.4: Disconnect and Manual Reconnect Lifecycle

**Status:** ready-for-dev

## Story

As a developer,
I want explicit disconnect and reconnect controls,
So that I can recover from reloads or drops without restarting VS Code.

## Acceptance Criteria

### AC 1: Clean Disconnect Transition

**Given** an active session
**When** I run Disconnect
**Then** the session closes cleanly
**And** state becomes disconnected.

### AC 2: Manual Reconnect Recovers Using Current Configuration

**Given** a disconnected, error, or connected (possibly stale) session
**When** I run Reconnect
**Then** the extension tears down any existing session first, then attempts recovery using current configuration
**And** reports success or failure within 5 seconds when the target browser and page are available (NFR2/NFR4).

### AC 3: Reconnect Failure Diagnostics Are Explicit and Actionable

**Given** reconnect fails
**When** diagnostics are rendered
**Then** the root-cause category is explicit
**And** the next recovery step is clear.

## Tasks / Subtasks

### 1. Add Lifecycle Commands and Wiring (AC: 1, 2)

- [ ] Contribute command entries for disconnect and reconnect in package metadata.
  - [ ] Add command ids: jupyterBrowserKernel.disconnect and jupyterBrowserKernel.reconnect in package.json contributes.commands.
  - [ ] Add localization keys in package.nls.json and l10n/bundle.l10n.json for new command titles and any new runtime strings.
  - [ ] Note: l10n/bundle.l10n.json is currently missing many Story 1.3 runtime strings (e.g., status labels, connect messages). Add new strings for this story; backfilling 1.3 gaps is out of scope but do not remove existing entries.
  - [ ] Register both commands in src/extension.ts using existing runtime ownership patterns.
- [ ] Activation events: no explicit activationEvents field is needed. VS Code auto-generates onCommand activation for all contributed commands. Adding disconnect/reconnect commands implicitly broadens activation, which is acceptable since those commands no-op safely without an active session.

### 2. Implement Transport-Owned Disconnect Behavior (AC: 1)

- [ ] Add a disconnect command runtime that closes any active browser client/session idempotently.
  - [ ] Reuse disconnectActiveBrowserConnection from src/transport/browser-connect.ts.
  - [ ] Ensure repeated disconnect calls remain safe (already disconnected should not throw).
- [ ] Drive canonical state transition to disconnected after disconnect completes.
  - [ ] Keep state labels limited to disconnected/connecting/connected/error.
  - [ ] Avoid introducing ad-hoc lifecycle booleans in command handlers.
- [ ] Concurrency guard: if state is `connecting` (in-flight connect/reconnect), cancel the in-flight operation (tear down), then proceed with disconnect.
  - [ ] From any state (connected, error, disconnected, connecting), disconnect must be safe and end in `disconnected`.
- [ ] Note: `deactivate()` in extension.ts already calls `disconnectActiveBrowserConnection()` directly without updating the state store. This is correct — the extension is shutting down and state updates are unnecessary. Do not "fix" deactivate to also update state.

### 3. Implement Manual Reconnect Orchestration (AC: 2, 3)

- [ ] Implement reconnect command flow that performs deterministic sequence:
  - [ ] Read and validate endpoint using existing endpoint-config helpers.
  - [ ] Tear down any existing active connection (force-reconnect from any state including connected).
  - [ ] Note: connectViaBrowserTargetAttach internally calls clearActiveBrowserConnection() before setting new connection. Explicit pre-cleanup is still correct for state-management clarity; the transport's internal cleanup makes this idempotent, not redundant.
  - [ ] Re-run connect operation via connectToBrowserTarget using current effective configuration.
  - [ ] Update state to connecting and then connected/error via shared transition helper patterns.
- [ ] Concurrency guard: if state is `connecting` (in-flight connect/reconnect), cancel the in-flight operation (tear down current transport), then proceed with fresh reconnect.
- [ ] On success, show a distinct reconnect-specific message (e.g., "Jupyter Browser Kernel: Reconnected to target {0} at {1}.") to help users distinguish reconnect from initial connect.
- [ ] Keep reconnect manual-only.
  - [ ] Do not add timers, auto-retry loops, or background auto-reconnect behavior.
  - [ ] Reconnect must report outcome within 5 seconds when the target is available (NFR2). Do not add long uncontrolled waits.

### 4. Failure Categorization and Recovery Guidance (AC: 3)

- [ ] Reuse normalized connect failure categories in reconnect output.
  - [ ] At minimum: target-mismatch, endpoint-connectivity, transport-failure.
- [ ] Ensure reconnect failure diagnostics are state-led and actionable.
  - [ ] Route settings prompt to cdpPort for endpoint-connectivity, otherwise cdpHost.
  - [ ] Keep sensitive endpoint details redacted in user-facing messages.
  - [ ] Include one concrete next step per failure branch.

### 5. UI State and Coexistence Guarantees (AC: 1, 2)

- [ ] Keep one authoritative status indicator surface as the source of truth.
  - [ ] Disconnect sets Disconnected immediately after successful cleanup.
  - [ ] Reconnect sets Connecting during attempt and final Connected or Error.
- [ ] Preserve browser-level CDP attach model for coexistence.
  - [ ] Do not regress to page-level websocket attach.
  - [ ] Keep flat session attach usage via Target.attachToTarget with flatten: true in connect path.

### 6. Tests and Regression Coverage (AC: 1, 2, 3)

- [ ] Add unit tests for disconnect behavior.
  - [ ] Active session disconnect closes client and transitions to disconnected.
  - [ ] No active session disconnect is idempotent and remains non-fatal.
- [ ] Add unit tests for reconnect command behavior.
  - [ ] Happy path: disconnected/error to connecting to connected.
  - [ ] Failure path: disconnected/error to connecting to error with categorized output.
  - [ ] Validation failure path blocks reconnect attempt with field-specific corrective guidance.
  - [ ] Force-reconnect path: connected to (teardown) to connecting to connected.
  - [ ] Concurrency: reconnect while connecting cancels in-flight, proceeds with new attempt.
- [ ] Add unit tests for disconnect concurrency.
  - [ ] Disconnect while connecting cancels in-flight and transitions to disconnected.
- [ ] Add unit tests for command registration/runtime wiring where needed.
  - [ ] New commands are registered and call correct runtime handlers.
  - [ ] Localization keys resolve for command labels/messages.
- [ ] Keep tests in top-level tests folders only.

## Dev Notes

### Story Context and Scope

- Story 1.3 established browser-level connect, target attach, normalized connect failures, and canonical connection states.
- Story 1.4 extends lifecycle control with explicit disconnect and manual reconnect commands.
- This story is lifecycle control only. It does not introduce notebook execution semantics, profile-specific eligibility expansions, or auto-reconnect.

### Architecture Guardrails (Must Follow)

- Transport owns connection lifecycle and cleanup. Commands orchestrate flows but must not duplicate transport internals.
- Manual reconnect only; auto-reconnect is deferred.
- Normalized diagnostic categories only; no raw protocol errors to user surfaces.
- Preserve browser-level websocket + flat target session attachment for DevTools coexistence.
- See Story 1.3 for inherited guardrails: profile-owned target selection, endpoint redaction, activation scope, JavaScript-only v1 direction.

### UX Guardrails (Must Follow)

- One authoritative textual state label (Disconnected, Connecting, Connected, Error). Color is supplemental; text is primary.
- Recovery messaging must be actionable, concise, and deterministic.
- Reconnect is idempotent and safe to invoke from any state (disconnected, error, or connected).

### Command State-Entry Table

| Command    | Valid From States                          | Transition Sequence                           |
|------------|-------------------------------------------|-----------------------------------------------|
| disconnect | connected, error, connecting, disconnected | → disconnected (idempotent from disconnected) |
| reconnect  | disconnected, error, connected             | → (teardown) → connecting → connected \| error |
| reconnect  | connecting (in-flight)                     | → cancel in-flight → connecting → connected \| error |

### Implementation Guidance by File

- package.json
  - Add disconnect and reconnect command contributions.
- package.nls.json
  - Add localized titles for disconnect/reconnect commands and any new static strings.
- src/extension.ts
  - Register disconnect/reconnect commands alongside connect.
  - Share the same connectionStateStore and status indicator.
- src/commands/
  - Add disconnect-command.ts and reconnect-command.ts or equivalent command-level modules following current command runtime style.
  - Reuse endpoint validation helpers from src/config/endpoint-config.ts.
  - Extract showSettingsPrompt and settingsKeyForEndpointFailure from connect-command.ts into a shared command utility (e.g., src/commands/command-utils.ts) so reconnect-command.ts can reuse them without duplication. Update connect-command.ts to import from the shared module.
- src/transport/browser-connect.ts
  - Reuse existing disconnect helpers and active connection tracking.
  - Keep cleanup resilient (non-fatal cleanup errors remain swallowed where appropriate).
- src/transport/connection-state.ts
  - Reuse existing transition helpers or add minimal helper(s) for reconnect/disconnect state sequencing.
- tests/unit/commands/
  - Add command tests for disconnect and reconnect behavior.
- tests/unit/transport/
  - Extend transport tests to cover lifecycle cleanup assumptions as needed.

### Previous Story Intelligence (Story 1.3)

- Reuse existing connection state model and status indicator integration; avoid introducing a second state source.
- Keep target selection profile-owned and deterministic; reconnect should call existing connect path instead of re-implementing target logic.
- Keep categorized diagnostic formatting path through connect-diagnostics and settings prompt behavior.
- Preserve endpoint summary redaction behavior for user-facing messages.
- Story 1.3 added a concurrency guard on connect: early-return when state is `connecting`. Story 1.4 uses cancel+proceed instead of early-return for disconnect/reconnect (see Command State-Entry Table).
- Actual profile files from Story 1.3 are: src/profile/target-profile.ts, src/profile/core-target-profile.ts, and src/profile/profile-types.ts. The Story 1.3 file list reference to `foundry-target-profile.ts` is stale — that file does not exist.

### Git Intelligence Summary (Recent Commits)

- Recent commit history continues story-scoped incremental delivery and cleanup patches:
  - Merge pull request #14 from sylvercode:remove-false-ipv6-only-workaround
  - Add extensionKind patch defered work documentation
  - Simply Start-EdgeDebug script
  - Remove false ipv6 only and locahost only workaround
  - Merge pull request #13 from sylvercode/connect-browser
- Guidance: keep 1.4 implementation tight and localized to lifecycle command/control surfaces plus tests.

### Latest Technical Information

- Current dependency: chrome-remote-interface@^0.34.0.
- Latest published npm version (checked 2026-04-11): 0.34.0.
- No dependency bump is required for this story; prioritize stable lifecycle behavior over package churn.

### Manual Test Checklist

- [ ] Start with a connected session and run disconnect.
  - [ ] Confirm status changes to Disconnected.
  - [ ] Confirm subsequent disconnect invocation is safe and does not throw.
- [ ] From disconnected state, run reconnect with valid endpoint and active target.
  - [ ] Confirm Connecting then Connected state sequence.
  - [ ] Confirm one successful probe/connect path without restarting VS Code.
- [ ] Run reconnect with invalid endpoint configuration.
  - [ ] Confirm reconnect blocks before transport attempt and shows field-specific correction.
- [ ] Run reconnect when browser/endpoint is unreachable.
  - [ ] Confirm explicit endpoint-connectivity category and clear next step.
- [ ] Run reconnect when no eligible target exists.
  - [ ] Confirm target-mismatch category and actionable guidance.
- [ ] Repeat reconnect while Edge DevTools is attached to same browser context.
  - [ ] Confirm no forced disconnect regression and successful or explicitly categorized failure outcome.
- [ ] Run reconnect while already connected (force-reconnect).
  - [ ] Confirm teardown of existing session, then Connecting then Connected.
  - [ ] Confirm distinct reconnect success message (not the connect message).
- [ ] Run disconnect while a connect/reconnect is in-flight (connecting state).
  - [ ] Confirm in-flight operation is cancelled and state becomes Disconnected.

## References

- docs/epics/epic-1-connect-and-control-browser-sessions.md (Story 1.4 requirements and traceability)
- docs/prd.md (FR4, FR5, FR6, FR7; NFR2, NFR4, NFR8, NFR15, NFR17)
- docs/architecture.md (transport-owned lifecycle, manual reconnect scope, DevTools coexistence constraints)
- docs/ux-spec/06-detailed-core-user-experience.md (connection lifecycle and recovery expectations)
- docs/ux-spec/10-component-strategy.md (authoritative status contract)
- docs/ux-spec/11-ux-consistency-patterns.md (action hierarchy, state-led feedback, recovery guidance)
- spike/cdp-multiplex-findings.md (browser-level websocket and flat-session attach model)
- docs/stories/1-3-connect-to-a-valid-browser-target.md (prior story implementation patterns and guardrails)

## Dev Agent Record

### Agent Model Used

GPT-5.3-Codex

### Debug Log References

- Story context created via create-story workflow on 2026-04-11.

### Completion Notes List

- Comprehensive context assembled from epic, PRD, architecture, UX specs, CDP multiplex findings, prior story intelligence, and current repository reality.
- Story status set to ready-for-dev for implementation handoff.
- Task plan scoped to explicit disconnect and manual reconnect lifecycle only.

### File List

- docs/stories/1-4-disconnect-and-manual-reconnect-lifecycle.md
- docs/stories/sprint-status.yaml
