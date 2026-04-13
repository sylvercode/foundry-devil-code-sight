---
storyId: "1.6"
storyKey: "1-6-surface-connection-state-and-recovery-actions"
title: "Surface Connection State and Recovery Actions"
status: "ready-for-dev"
created: "2026-04-12"
epic: "1"
priority: "p0"
---

# Story 1.6: Surface Connection State and Recovery Actions

**Status:** ready-for-dev

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

- [ ] Update `src/ui/connection-status-indicator.ts` to accept a `command` on the status bar item.
  - [ ] Set `statusBarItem.command` to `jupyterBrowserKernel.reconnect` when state is `disconnected` or `error`.
  - [ ] Clear `statusBarItem.command` (set to `undefined`) when state is `connecting` or `connected`.
- [ ] Add state-aware tooltips with recovery guidance.
  - [ ] `disconnected`: Tooltip shows "Click to reconnect" (or "Run Reconnect command") plus current endpoint summary.
  - [ ] `connecting`: Tooltip shows "Connection attempt in progress…".
  - [ ] `connected`: Tooltip shows "Connected to browser target" plus current endpoint summary.
  - [ ] `error`: Tooltip shows last failure category and actionable next step (reconnect or check settings).
- [ ] Extend the `ConnectionStatusIndicator` interface to accept an optional error context for tooltip enrichment.
  - [ ] Add `setErrorContext: (context: { category: string; guidance: string } | undefined) => void` to the interface.
  - [ ] When `setState("error")` is called, tooltip uses the error context if available; otherwise shows generic "Error — run Reconnect or check settings."
- [ ] Use `vscode.ThemeColor` for semantic status bar background to leverage theme compatibility.
  - [ ] `error` state: set `statusBarItem.backgroundColor` to `new vscode.ThemeColor("statusBarItem.errorBackground")`.
  - [ ] `connected`/`disconnected`/`connecting`: clear `statusBarItem.backgroundColor` (set to `undefined`).
  - [ ] Text label always remains visible regardless of background color (AC 3, AC 5).
- [ ] Verify status label format remains `"Jupyter Browser: {State}"` — concise and truncation-resistant in narrow panes.

### 2. Wire Error Context from Commands to Status Indicator (AC: 2, 5)

- [ ] Update `ConnectionStoreHandler` to include an optional `onErrorContextChanged` callback (or extend the existing `onConnectionStateChanged` to pass error context alongside state).
  - [ ] Design: add a `setErrorContext` method on `ConnectionStateStore` that the indicator can consume.
  - [ ] Store error context (category + guidance string) alongside connection state.
- [ ] Update `connect-command.ts`: on connect failure, pass failure category and formatted guidance to state store error context.
  - [ ] Reuse `formatConnectFailureMessage` output for the guidance string, or extract a shorter tooltip-friendly summary.
- [ ] Update `reconnect-command.ts`: on reconnect failure, pass failure context similarly.
- [ ] Update `disconnect-command.ts`: clear error context on explicit disconnect (state becomes `disconnected`, error context is `undefined`).
- [ ] Update `extension.ts` activation wiring to connect `onErrorContextChanged` from state store to `statusIndicator.setErrorContext`.

### 3. Ensure Keyboard-Only Operation for All Primary Actions (AC: 4)

- [ ] Verify all three connection commands (`connect`, `disconnect`, `reconnect`) are registered in `package.json` `contributes.commands` and executable via Command Palette.
  - [ ] Confirm commands have user-friendly titles in `package.nls.json` for Command Palette display.
- [ ] Verify `statusBarItem.command` (set in Task 1) makes reconnect triggerable by keyboard focus + Enter on the status bar item.
- [ ] Verify command outcomes produce observable feedback:
  - [ ] State update reflected in status bar text (implicit keyboard-accessible feedback).
  - [ ] Error/success notification via `showInformationMessage` or `showErrorMessage` (screen-reader announced by VS Code).

### 4. Add Output Channel Logging for State Transitions and Diagnostics (AC: 2, 4, 5)

- [ ] Create an output channel: `vscode.window.createOutputChannel("Jupyter Browser Kernel")` in `extension.ts`.
  - [ ] Register in `context.subscriptions` for proper disposal.
- [ ] Log each connection state transition to the output channel with timestamp and explicit text label.
  - [ ] Format: `[HH:MM:SS] Connection state: {State}`.
  - [ ] On error state, append failure category and actionable guidance.
- [ ] Wire state change logging via the `onConnectionStateChanged` callback (alongside status indicator update).
- [ ] Ensure diagnostics written to output channel redact sensitive details per NFR17 (reuse `summarizeEndpointForDisplay` for endpoint references).

### 5. Add Unit Tests for Enhanced Status Indicator (AC: 1, 2, 3, 5)

- [ ] Add tests for status bar `command` assignment by state:
  - [ ] `disconnected` → command is `jupyterBrowserKernel.reconnect`.
  - [ ] `error` → command is `jupyterBrowserKernel.reconnect`.
  - [ ] `connecting` → command is `undefined`.
  - [ ] `connected` → command is `undefined`.
- [ ] Add tests for tooltip content by state:
  - [ ] `disconnected` tooltip includes reconnect guidance.
  - [ ] `error` tooltip includes failure category and guidance when error context is set.
  - [ ] `error` tooltip shows generic guidance when no error context is available.
  - [ ] `connected` tooltip shows connected message.
  - [ ] `connecting` tooltip shows in-progress message.
- [ ] Add tests for `backgroundColor` semantic theming:
  - [ ] `error` state applies `statusBarItem.errorBackground` theme color.
  - [ ] Other states clear `backgroundColor`.
- [ ] Add tests for `setErrorContext` behavior:
  - [ ] Setting error context updates tooltip on next `setState("error")`.
  - [ ] Clearing error context reverts to generic error tooltip.

### 6. Add Unit Tests for Error Context Wiring in Commands (AC: 2, 5)

- [ ] Add tests for `connect-command.ts`: on connect failure, error context includes failure category and guidance.
- [ ] Add tests for `reconnect-command.ts`: on reconnect failure, error context includes failure category and guidance.
- [ ] Add tests for `disconnect-command.ts`: on explicit disconnect, error context is cleared.
- [ ] Add tests for output channel logging:
  - [ ] State transitions produce timestamped log entries.
  - [ ] Error transitions include failure category.
  - [ ] Endpoint details in logs use redacted `summarizeEndpointForDisplay` format.

### 7. Run Full Validation Suite (AC: 1, 2, 3, 4, 5)

- [ ] Run `npm run lint` — no new warnings or errors.
- [ ] Run `npm run test:unit` — all unit tests pass including new tests.
- [ ] Run `npm run test:integration` — no regressions in existing integration tests.
- [ ] Run `npm run compile` — clean compilation with no type errors.
- [ ] Manually verify (if Extension Development Host available):
  - [ ] Status bar shows correct label for each state.
  - [ ] Clicking status bar in `disconnected` or `error` state triggers reconnect.
  - [ ] Tooltip shows state-appropriate recovery guidance.
  - [ ] Output channel logs state transitions with timestamps.
  - [ ] All actions accessible via Command Palette (keyboard-only).

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

Claude Opus 4.6

### Debug Log References

### Completion Notes List

- Comprehensive context assembled from epic, PRD, architecture, UX specs (7 UX spec files), previous story intelligence (1.4 and 1.5), requirements inventory, deferred work, current codebase analysis, and recent git history.
- Story status set to ready-for-dev for implementation handoff.
- All 5 acceptance criteria mapped to specific tasks with testable subtasks.
- Architecture boundary rules, naming conventions, and existing code patterns documented to prevent common LLM mistakes.
- Deferred items explicitly called out to prevent scope creep.

### File List

### Change Log
