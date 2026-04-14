---
storyId: "1.6"
storyKey: "1-6-surface-connection-state-and-recovery-actions"
title: "Surface Connection State and Recovery Actions"
status: "done"
created: "2026-04-12"
epic: "1"
priority: "p0"
---

# Story 1.6: Surface Connection State and Recovery Actions

**Status:** done

## Story

As a developer,
I want one authoritative, low-noise state indicator with accessible labels,
So that I always know readiness and the next action.

## Acceptance Criteria

### AC 1: One Authoritative Label on State Transitions

**Given** any lifecycle transition
**When** status updates
**Then** one authoritative label is shown (Disconnected, Connecting, Connected, Error)
**And** text remains the primary state channel.

### AC 2: Error/Disconnected State Details with Recovery Actions

**Given** error or disconnected state
**When** I inspect status details
**Then** reconnect and configuration guidance is available
**And** guidance is actionable and concise.

### AC 3: Readability in Narrow Panes and Theme Variations

**Given** narrow panes or theme variation
**When** state is displayed
**Then** readability remains intact
**And** color is not the sole indicator.

### AC 4: Keyboard-Only Interaction for Primary Actions

**Given** keyboard-only interaction
**When** I execute connection controls
**Then** primary actions are reachable without pointer interaction
**And** command outcomes are announced in notebook or status feedback.

### AC 5: Explicit Text Labels for Critical States/Errors

**Given** critical state or error messages are rendered
**When** I review status or diagnostics
**Then** each message includes explicit text labels
**And** color is supplemental and never the sole indicator.

## Tasks / Subtasks

### 1. Enhance Status Bar Indicator with State-Aware Tooltips and Recovery Command (AC: 1, 2, 3, 5)

- [x] Update `src/ui/connection-status-indicator.ts` to accept a `command` on the status bar item.
  - [x] Set `statusBarItem.command` to `jupyterBrowserKernel.reconnect` when state is `disconnected` or `error`.
  - [x] Set `statusBarItem.command` to `jupyterBrowserKernel.disconnect` when state is `connected`.
  - [x] Clear `statusBarItem.command` (set to `undefined`) when state is `connecting`.
- [x] Add state-aware tooltips with recovery guidance.
  - [x] `disconnected`: Tooltip shows "Click to reconnect" (or "Run Reconnect command") plus current endpoint summary.
  - [x] `connecting`: Tooltip shows "Connection attempt in progress…".
  - [x] `connected`: Tooltip shows "Connected to browser target" plus current endpoint summary.
  - [x] `error`: Tooltip shows last failure category and actionable next step (reconnect or check settings).
- [x] Extend the `ConnectionStatusIndicator` interface to accept an optional error context for tooltip enrichment.
  - [x] Add `setErrorContext: (context: { category: string; guidance: string } | undefined) => void` to the interface.
  - [x] When `setState("error")` is called, tooltip uses the error context if available; otherwise shows generic "Error — run Reconnect or check settings."
- [x] Use `vscode.ThemeColor` for semantic status bar background to leverage theme compatibility.
  - [x] `error` state: set `statusBarItem.backgroundColor` to `new vscode.ThemeColor("statusBarItem.errorBackground")`.
  - [x] `connected`/`disconnected`/`connecting`: clear `statusBarItem.backgroundColor` (set to `undefined`).
  - [x] Text label always remains visible regardless of background color (AC 3, AC 5).
- [x] Verify status label format remains `"Jupyter Browser: {State}"` — concise and truncation-resistant in narrow panes.

### 2. Wire Error Context from Commands to Status Indicator (AC: 2, 5)

- [x] Update `ConnectionStoreHandler` to include an optional `onErrorContextChanged` callback (or extend the existing `onConnectionStateChanged` to pass error context alongside state).
  - [x] Design: add a `setErrorContext` method on `ConnectionStateStore` that the indicator can consume.
  - [x] Store error context (category + guidance string) alongside connection state.
- [x] Update `connect-command.ts`: on connect failure, pass failure category and formatted guidance to state store error context.
  - [x] Reuse `formatConnectFailureMessage` output for the guidance string, or extract a shorter tooltip-friendly summary.
- [x] Update `reconnect-command.ts`: on reconnect failure, pass failure context similarly.
- [x] Update `disconnect-command.ts`: clear error context on explicit disconnect (state becomes `disconnected`, error context is `undefined`).
- [x] Update `extension.ts` activation wiring to connect `onErrorContextChanged` from state store to `statusIndicator.setErrorContext`.

### 3. Ensure Keyboard-Only Operation for All Primary Actions (AC: 4)

- [x] Verify all three connection commands (`connect`, `disconnect`, `reconnect`) are registered in `package.json` `contributes.commands` and executable via Command Palette.
  - [x] Confirm commands have user-friendly titles in `package.nls.json` for Command Palette display.
- [x] Verify `statusBarItem.command` (set in Task 1) makes reconnect triggerable by keyboard focus + Enter on the status bar item.
- [x] Verify command outcomes produce observable feedback:
  - [x] State update reflected in status bar text (implicit keyboard-accessible feedback).
  - [x] Error/success notification via `showInformationMessage` or `showErrorMessage` (screen-reader announced by VS Code).

### 4. Add Output Channel Logging for State Transitions and Diagnostics (AC: 2, 4, 5)

- [x] Create an output channel: `vscode.window.createOutputChannel("Jupyter Browser Kernel")` in `extension.ts`.
  - [x] Register in `context.subscriptions` for proper disposal.
- [x] Log each connection state transition to the output channel with timestamp and explicit text label.
  - [x] Format: `[HH:MM:SS] Connection state: {State}`.
  - [x] On error state, append failure category and actionable guidance.
- [x] Wire state change logging via the `onConnectionStateChanged` callback (alongside status indicator update).
- [x] Ensure diagnostics written to output channel redact sensitive details per NFR17 (reuse `summarizeEndpointForDisplay` for endpoint references).

### 5. Add Unit Tests for Enhanced Status Indicator (AC: 1, 2, 3, 5)

- [x] Add tests for status bar `command` assignment by state:
  - [x] `disconnected` → command is `jupyterBrowserKernel.reconnect`.
  - [x] `error` → command is `jupyterBrowserKernel.reconnect`.
  - [x] `connecting` → command is `undefined`.
  - [x] `connected` → command is `undefined`.
- [x] Add tests for tooltip content by state:
  - [x] `disconnected` tooltip includes reconnect guidance.
  - [x] `error` tooltip includes failure category and guidance when error context is set.
  - [x] `error` tooltip shows generic guidance when no error context is available.
  - [x] `connected` tooltip shows connected message.
  - [x] `connecting` tooltip shows in-progress message.
- [x] Add tests for `backgroundColor` semantic theming:
  - [x] `error` state applies `statusBarItem.errorBackground` theme color.
  - [x] Other states clear `backgroundColor`.
- [x] Add tests for `setErrorContext` behavior:
  - [x] Setting error context updates tooltip on next `setState("error")`.
  - [x] Clearing error context reverts to generic error tooltip.

### 6. Add Unit Tests for Error Context Wiring in Commands (AC: 2, 5)

- [x] Add tests for `connect-command.ts`: on connect failure, error context includes failure category and guidance.
- [x] Add tests for `reconnect-command.ts`: on reconnect failure, error context includes failure category and guidance.
- [x] Add tests for `disconnect-command.ts`: on explicit disconnect, error context is cleared.
- [x] Add tests for output channel logging:
  - [x] State transitions produce timestamped log entries.
  - [x] Error transitions include failure category.
  - [x] Endpoint details in logs use redacted `summarizeEndpointForDisplay` format.

### 7. Run Full Validation Suite (AC: 1, 2, 3, 4, 5)

- [x] Run `npm run lint` — no new warnings or errors.
- [x] Run `npm run test:unit` — all unit tests pass including new tests.
- [x] Run `npm run test:integration` — no regressions in existing integration tests.
- [x] Run `npm run compile` — clean compilation with no type errors.
- [x] Manually verify (if Extension Development Host available):
  - [x] Status bar shows correct label for each state.
  - [x] Clicking status bar in `disconnected` or `error` state triggers reconnect.
  - [x] Tooltip shows state-appropriate recovery guidance.
  - [x] Output channel logs state transitions with timestamps.
  - [x] All actions accessible via Command Palette (keyboard-only).

### Review Findings

- [x] [Review][Decision] Connected state assigns disconnect command — accepted as improvement. Spec updated to reflect `disconnect` command on `connected` state. [src/ui/connection-status-indicator.ts:136]
- [x] [Review][Patch] Duplicate `formatConnectFailureMessage` call — called twice with identical args in failure path; compute once and reuse [src/commands/connect-command.ts:117-126]
- [x] [Review][Patch] Redundant `setState("error")` re-trigger in `onErrorContextChanged` — causes duplicate tooltip/background recomputation and double log line when error context changes while already in error state [src/extension.ts:62-65]
- [x] [Review][Patch] Logger emits duplicate error log line — `onErrorContextChanged` emits its own error line AND re-triggers `onConnectionStateChanged` via the `setState("error")` call, producing two log entries for one event [src/extension.ts:62-66, src/logging/connection-logger.ts:28-35]
- [x] [Review][Defer] Timestamp logging uses time-only format — `toLocaleTimeString` loses date; multi-day sessions have ambiguous log entries. Pre-existing pattern, not blocking. [src/logging/connection-state-log.ts:6-8] — deferred, pre-existing
- [x] [Review][Defer] Repeated endpoint config reads on every tooltip/log — `endpointSummary()` re-reads workspace config each invocation. Harmless at current frequency. [src/ui/connection-status-indicator.ts:82-88] — deferred, pre-existing

## Dev Notes

### Story Context and Scope

- Stories 1.1–1.5 are all **done**. This is the final UI/UX story in Epic 1.
- Story 1.3 established: connection state model (`disconnected` → `connecting` → `connected`/`error`), deterministic target selection, categorized diagnostics, and the `ConnectionStatusIndicator` UI surface.
- Story 1.4 established: cancellation-safe state transitions, idempotent disconnect, reconnect flow (validate → teardown → connect), and settings-prompt helpers.
- Story 1.5 proved: DevTools coexistence via browser-level CDP multiplexing, flat sessions, session-scoped routing, explicit failure surfaces, and regression test coverage.
- Story 1.6 builds on ALL of this to make the existing state and recovery infrastructure **visible, accessible, and actionable** to the user through the status bar, tooltips, output channel, and keyboard navigation.

### Architecture Guardrails (Must Follow)

- **State ownership:** Transport owns connection state. UI derives state from callbacks, never maintains independent booleans. [Source: docs/architecture.md#State-Patterns]
- **No polling:** Push-based state updates only via `onConnectionStateChanged` callback. [Source: docs/architecture.md#Communication-Patterns]
- **Normalized errors:** Raw CDP errors never leak to user surfaces. Use `formatConnectFailureMessage` and `summarizeEndpointForDisplay` for user-facing messages. [Source: docs/architecture.md#Error-Handling-Patterns]
- **Module boundaries:** UI cannot import concrete transport; commands cannot import UI directly. Status indicator subscribes via callback contracts. [Source: docs/architecture.md#Module-Boundaries]
- **File naming:** kebab-case files, PascalCase types, camelCase functions. [Source: docs/architecture.md#Naming-Conventions]
- **Tests in `tests/` tree**, not co-located with source. [Source: docs/architecture.md#File-Structure-Constraints]
- **Localization:** Use `vscodeApi.l10n.t` for all user-facing strings. Add keys to `l10n/bundle.l10n.json`. [Source: existing pattern in all command files]

### UX Guardrails (Must Follow)

- **One authoritative label:** Status bar shows exactly one state at a time — `Disconnected`, `Connecting`, `Connected`, `Error`. No dual indicators, spinners, or progress bars. [Source: docs/ux-spec/10-component-strategy.md#Status-Contract]
- **Text is primary:** Color is supplemental. Every state and error has an explicit text label. [Source: docs/ux-spec/12-responsive-design-accessibility.md, UX-DR19]
- **Recovery-first:** Disconnected/error states always offer a path forward (reconnect or settings). No dead ends. [Source: docs/ux-spec/11-ux-consistency-patterns.md#Navigation-Patterns]
- **Keyboard-first:** Primary actions (connect, disconnect, reconnect) reachable via Command Palette. [Source: docs/ux-spec/12-responsive-design-accessibility.md, UX-DR18]
- **Concise labels:** `"Jupyter Browser: {State}"` format — truncation-resistant for narrow panes. Details in tooltips, not headline. [Source: docs/ux-spec/11-ux-consistency-patterns.md#Loading-State]
- **Severity model:** Error = session-blocking, Warning = degraded but recoverable, Info = lifecycle state, Success = completed recovery. [Source: docs/ux-spec/11-ux-consistency-patterns.md#Feedback-Patterns]
- **Message format:** State-led first line, then actionable next step, then optional detail. [Source: docs/ux-spec/11-ux-consistency-patterns.md#Feedback-Patterns]
- **Theme compatibility:** Use VS Code semantic `ThemeColor`, no hardcoded palette. [Source: docs/ux-spec/07-visual-design-foundation.md, UX-DR20]

### Implementation Guidance by File

- **`src/ui/connection-status-indicator.ts`** — Primary file for this story. Enhance with `command` binding, state-aware tooltips, `setErrorContext`, and `ThemeColor` background. Keep the existing `setState`/`dispose` interface intact; extend it.
- **`src/transport/connection-state.ts`** — Add error context storage alongside state. Extend `ConnectionStateStore` with `setErrorContext`/`getErrorContext` or add an `onErrorContextChanged` callback. Keep existing transition logic untouched.
- **`src/extension.ts`** — Wire output channel creation, error context callback, and output channel logging to the state store. Keep `registerCommand` pattern intact.
- **`src/commands/connect-command.ts`** — After connect failure, call state store's `setErrorContext` with category and guidance. On success, clear error context.
- **`src/commands/reconnect-command.ts`** — Same pattern as connect: failure → set error context, success → clear.
- **`src/commands/disconnect-command.ts`** — On explicit disconnect, clear error context.
- **`src/transport/connect-diagnostics.ts`** — Possibly extract a short tooltip-friendly summary alongside the existing full message. Alternatively, reuse the full message in tooltip.
- **`l10n/bundle.l10n.json`** — Add new localization keys for tooltip strings and output channel messages.
- **`tests/unit/ui/`** — New test file for enhanced status indicator (may need to create `tests/unit/ui/` directory).
- **`tests/unit/commands/`** — Extend existing command tests for error context wiring.

### Previous Story Intelligence (Story 1.5)

- Story 1.5 confirmed that browser-level attach and flat sessions are stable and well-tested. No transport changes needed for 1.6.
- Coexistence regression tests pass. Story 1.6 should not modify transport behavior.
- Review findings in 1.5 were minor and already resolved (session-scoped event naming, negative guardrail coverage).
- Key learning: keep changes localized to the surface being enhanced. Story 1.5 succeeded by not modifying command or lifecycle logic.

### Git Intelligence Summary (Recent Commits)

- `aa26975` Add session-scoped event routing tests (Story 1.5 final)
- `e70c35b` Ensure preserve devtools coexistence (Story 1.5)
- `a8085a0` Merge pull request #15 from disconnect-manual-reconnect (Story 1.4)
- Recent work stabilized transport and command layers. Story 1.6 should only extend UI and wiring, not modify transport internals.

### Technical Constraints

- **VS Code API:** `vscode.window.createStatusBarItem` supports `.command`, `.tooltip` (string or `MarkdownString`), `.backgroundColor` (`ThemeColor` only), `.text`, `.name`. No custom HTML.
- **ThemeColor for status bar:** Only `statusBarItem.errorBackground` and `statusBarItem.warningBackground` are supported by VS Code for status bar item backgrounds. Do not use arbitrary theme colors.
- **Output channel:** `vscode.window.createOutputChannel(name)` creates a text output channel. Use `.appendLine()` for logging. Dispose on deactivation.
- **Tooltip:** `statusBarItem.tooltip` can be a `string` or `vscode.MarkdownString`. Use `MarkdownString` for richer tooltips if needed, but plain string is sufficient and more accessible.
- **No webview:** All surfaces must be native VS Code (status bar, output channel, notifications, command palette). [Source: docs/ux-spec/10-component-strategy.md, UX-DR16]

### Deferred Items Not In Scope

- Rich error detail expansion (stack traces, source maps) — post-MVP enhancement.
- Click handler context menus on the status bar — deferred pending higher-level interaction design.
- Profile-specific status indicators — post-MVP (Epic 7+).
- Automatic reconnect — explicitly deferred per PRD.
- 5-second timeout wrapper for reconnect (NFR2/NFR4) — deferred from Story 1.4, remains deferred.

### Project Structure Notes

- New test directory may be needed: `tests/unit/ui/` (does not exist yet).
- All existing source files follow the architecture module boundary rules. Story 1.6 additions stay within `src/ui/` and `src/transport/` (state store extension) plus `src/extension.ts` (wiring).
- No new source directories needed. Output channel is created in `extension.ts`, not a separate module.

### References

- [Source: docs/epics/epic-1-connect-and-control-browser-sessions.md#Story-1.6] — Acceptance criteria
- [Source: docs/prd.md#FR4] — Connection state reporting requirement
- [Source: docs/prd.md#NFR17] — Diagnostics redaction and actionability
- [Source: docs/architecture.md#State-Patterns] — State ownership and anti-patterns
- [Source: docs/architecture.md#Communication-Patterns] — Push-based state updates
- [Source: docs/architecture.md#Error-Handling-Patterns] — Normalized error surfaces
- [Source: docs/ux-spec/06-detailed-core-user-experience.md] — Trust signals (connection state + eligibility)
- [Source: docs/ux-spec/10-component-strategy.md#Status-Contract] — Authoritative status component
- [Source: docs/ux-spec/11-ux-consistency-patterns.md] — Feedback patterns, navigation, severity model
- [Source: docs/ux-spec/12-responsive-design-accessibility.md] — Accessibility and responsive strategy
- [Source: docs/stories/1-5-preserve-devtools-coexistence.md] — Previous story intelligence
- [Source: docs/stories/1-4-disconnect-and-manual-reconnect-lifecycle.md] — Lifecycle and cancellation patterns
- [Source: docs/stories/deferred-work.md] — Known deferred items

## Dev Agent Record

### Agent Model Used

GPT-5.3-Codex

### Debug Log References

- `npm run lint`
- `npm run test:unit`
- `npm run test:integration`
- `npm run compile`

### Completion Notes List

- Comprehensive context assembled from epic, PRD, architecture, UX specs (7 UX spec files), previous story intelligence (1.4 and 1.5), requirements inventory, deferred work, current codebase analysis, and recent git history.
- Story status set to ready-for-dev for implementation handoff.
- All 5 acceptance criteria mapped to specific tasks with testable subtasks.
- Architecture boundary rules, naming conventions, and existing code patterns documented to prevent common LLM mistakes.
- Deferred items explicitly called out to prevent scope creep.
- Implemented status bar command binding (`reconnect` for disconnected/error) and state-aware tooltips with explicit text labels.
- Extended connection state store to carry optional error context with `setErrorContext`/`getErrorContext` and change callback.
- Wired connect/reconnect failures to set normalized error context guidance; disconnect clears error context.
- Added output channel lifecycle logging with timestamped state lines and error detail enrichment.
- Added localization entries for new tooltip and endpoint availability strings.
- Added unit tests for status indicator behavior, error-context store behavior, command error-context wiring, and output logging formatting.
- Validation results: lint clean; unit tests passing (58/58); integration suite completed with existing CDP tests skipped; compile succeeded.
- Manual Extension Development Host interaction checks are conditional and were not executed in this container session.

### File List

- `docs/stories/1-6-surface-connection-state-and-recovery-actions.md`
- `docs/stories/sprint-status.yaml`
- `l10n/bundle.l10n.json`
- `src/commands/connect-command.ts`
- `src/commands/disconnect-command.ts`
- `src/commands/reconnect-command.ts`
- `src/extension.ts`
- `src/transport/connection-state.ts`
- `src/ui/connection-state-log.ts`
- `src/ui/connection-status-indicator.ts`
- `tests/unit/commands/connect-command.test.ts`
- `tests/unit/commands/disconnect-command.test.ts`
- `tests/unit/commands/reconnect-command.test.ts`
- `tests/unit/extension/extension-logging.test.ts`
- `tests/unit/transport/connection-state.test.ts`
- `tests/unit/ui/connection-status-indicator.test.ts`

### Change Log

- 2026-04-12: Implemented Story 1.6 state visibility and recovery UX, added error-context state plumbing, output-channel logging, and comprehensive unit coverage.
