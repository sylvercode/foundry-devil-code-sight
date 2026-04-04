---
storyId: "1.2"
storyKey: "1-2-configure-browser-endpoint"
title: "Configure Browser Endpoint"
status: "review"
created: "2026-04-04"
epic: "1"
priority: "p0"
---

# Story 1.2: Configure Browser Endpoint

**Status:** review

## Story

As a developer,
I want to set and validate the browser endpoint in extension settings,
So that the extension can target the correct runtime safely.

## Acceptance Criteria

### AC 1: Endpoint Settings Are Discoverable and Clear

**Given** the extension is installed
**When** I open settings
**Then** I can set host and port or equivalent endpoint fields
**And** the settings UI explains expected format.

### AC 2: Invalid Endpoint Input Produces Field-Specific Guidance

**Given** invalid endpoint input
**When** I save settings
**Then** I see field-specific validation
**And** one concrete corrective action is provided.

### AC 3: Valid Endpoint Input Persists and Is Used by Connect

**Given** valid endpoint input
**When** I save settings
**Then** configuration persists for subsequent commands
**And** connect commands read the saved endpoint.

## Tasks / Subtasks

### 1. Configuration Schema Hardening (AC: 1, 2)

- [x] Keep and refine endpoint settings in `package.json` under `contributes.configuration.properties`
  - [x] `jupyterBrowserKernel.cdpHost`: keep `type: string`, add explicit format guidance in description/markdownDescription
  - [x] `jupyterBrowserKernel.cdpPort`: keep `type: number`, add `minimum` and `maximum` bounds (CDP-safe TCP range)
  - [x] Confirm settings remain in `jupyterBrowserKernel.*` namespace only
  - [x] Ensure labels/descriptions are profile-agnostic and deterministic (no Foundry-specific wording)

### 2. Runtime Validation + Corrective Messaging (AC: 2)

- [x] Add endpoint validation logic in a dedicated config module (recommended: `src/config/endpoint-config.ts`)
  - [x] Validate host is non-empty and not whitespace-only
  - [x] Validate port is integer and in allowed bounds
  - [x] Return structured validation result with field-level error identity (`host` or `port`)
  - [x] Include one concrete corrective action per failure (for example: "Set `jupyterBrowserKernel.cdpPort` to a value between 1 and 65535")
- [x] Make connect command fail fast on invalid config before any transport work
  - [x] Surface a concise error message to user
  - [x] Include deterministic next step (open settings or correct specific field)

### 3. Persisted Settings Read Path for Connect (AC: 3)

- [x] Implement config accessor that reads from `vscode.workspace.getConfiguration("jupyterBrowserKernel")`
  - [x] Read `cdpHost` and `cdpPort` from current effective configuration
  - [x] Normalize and return typed endpoint object
- [x] Wire `jupyterBrowserKernel.connect` command to use this accessor
  - [x] Build endpoint string only from user-configured values
  - [x] Include endpoint summary in diagnostic/info output with safe redaction policy when needed

### 4. Tests and Regression Coverage (AC: 2, 3)

- [x] Add unit tests for endpoint validation behavior
  - [x] Valid host/port case
  - [x] Empty host case
  - [x] Non-integer / out-of-range port case
  - [x] Field-specific error and corrective action assertion
- [x] Add command-level test (or extension-host test if harness exists)
  - [x] Connect command reads persisted endpoint values
  - [x] Invalid settings block connect path with actionable message

## Dev Notes

### Story Context and Scope

- This story is the first endpoint-specific implementation after scaffold completion.
- `package.json` already contains `jupyterBrowserKernel.cdpHost` and `jupyterBrowserKernel.cdpPort`; this story should harden behavior and complete validation/use-path, not reinvent config plumbing.
- Keep MVP scope profile-agnostic. Do not add Foundry-specific target rules in this story.

### Architecture Guardrails (Must Follow)

- Keep JavaScript runtime focus only (no TypeScript runtime transpilation work).
- Preserve command activation scope on `onCommand:jupyterBrowserKernel.connect`.
- Keep CDP endpoint user-controlled (NFR15): do not introduce fallback outbound endpoints.
- Treat transport lifecycle ownership as future transport-layer responsibility; this story is config and pre-connect validation only.
- Preserve deterministic messaging and explicit next-step guidance for failure paths.

### UX Guardrails (Must Follow)

- Field-specific validation means users can identify exactly which input is invalid (`host` vs `port`).
- Every validation failure must include one concrete corrective action.
- Prefer low-noise feedback: concise state-first message, details in output/log when needed.
- Keep text labels explicit; do not depend on color-only cues.

### File Structure Requirements

- Current repo is still early (`src/extension.ts` only). Add minimal new modules needed for endpoint config/validation.
- Recommended additions:
  - `src/config/endpoint-config.ts` for typed read + validate helpers.
  - `src/config/endpoint-config.test.ts` only if project test strategy permits colocated tests; otherwise place tests under a top-level `tests/` tree.
- Do not refactor unrelated architecture placeholders in this story.

### Testing Requirements

- Prefer deterministic unit tests for validation function behavior first.
- If extension-host tests are added, keep them focused on command behavior with mocked configuration.
- Validate manually via:
  - user/workspace settings edits,
  - command invocation,
  - expected fail-fast messaging for invalid values.

### Manual Test Checklist

- [x] Open Settings and verify the extension metadata is localized through `package.json`, `package.nls.json`, and `l10n/bundle.l10n.json`. Confirm the command title and the `cdpHost` / `cdpPort` setting descriptions render correctly.
- [x] Set `jupyterBrowserKernel.cdpHost` to `localhost` and `jupyterBrowserKernel.cdpPort` to `9222`, then run the `Jupyter Browser Kernel: Connect via CDP` command. Confirm a success info message shows `localhost:9222`.
- [x] Set `jupyterBrowserKernel.cdpHost` to `127.0.0.1` and `jupyterBrowserKernel.cdpPort` to `9333`, then run connect again. Confirm the message reflects `127.0.0.1:9333` and uses saved values rather than defaults.
- [x] Set `jupyterBrowserKernel.cdpHost` to whitespace only and run connect. Confirm the command fails before any connection attempt, shows a host-specific error, and offers `Open Settings`.
- [x] From the invalid-host error, click `Open Settings`. Confirm VS Code opens filtered settings for `jupyterBrowserKernel.cdpHost`.
- [x] Restore a valid host, then set `jupyterBrowserKernel.cdpPort` to `0` and run connect. Confirm the command fails with a port-specific error telling the user to use a whole number between `1` and `65535`.
- [x] Repeat with `65536` as the port. Confirm the same fail-fast behavior and corrective guidance appears.
- [x] Repeat with a non-integer port value in JSON settings, such as `9222.5`. Confirm the command blocks execution with the same port validation message.
- [x] Set host to a non-loopback value such as `example.internal` and a valid port, then run connect. Confirm the success message redacts the host and shows `[redacted-host]:<port>` rather than the raw hostname.
- [x] Switch VS Code to a non-English or pseudo-localized language pack and reload the window. Re-run the connect command and confirm runtime strings still resolve through the l10n pipeline without breaking placeholders.
- [x] Open the command palette and confirm the command label is still discoverable and readable after the localization changes.
- [x] Edit user settings, then workspace settings, with different endpoint values. Run connect from the workspace and confirm effective configuration resolution behaves as expected.

### Previous Story Intelligence (Story 1.1)

- Reuse established extension identifiers and namespace:
  - command: `jupyterBrowserKernel.connect`
  - settings namespace: `jupyterBrowserKernel.*`
- Build and lint scripts are already wired and should remain the default validation path.
- Existing implementation intentionally leaves connection unimplemented; this story should improve config correctness and connect preconditions, not full CDP session logic.

### Git Intelligence Summary (Recent Commits)

- Recent changes concentrated in:
  - `package.json` and `package-lock.json`
  - `src/extension.ts`
  - `.vscode/*`
  - `docs/stories/*`
- Pattern indicates incremental story-driven delivery with docs + status updates in lockstep. Continue that pattern.

### Latest Technical Information

- Current dependency in repo: `chrome-remote-interface@^0.33.2`.
- Latest npm release observed during story creation: `0.34.0`.
- Guidance for this story:
  - Do not force a transport dependency upgrade unless needed for endpoint/config validation work.
  - If endpoint implementation touches transport initialization signatures, verify compatibility before any version bump.
- VS Code configuration contribution supports JSON schema constraints like `minimum`, `maximum`, `pattern`, and `patternErrorMessage`; use these to strengthen settings-level validation.

## References

- `docs/epics/epic-1-connect-and-control-browser-sessions.md` (Story 1.2 requirements + AC)
- `docs/prd.md` (FR1, FR2, FR4, NFR15, NFR17)
- `docs/architecture.md` (endpoint security boundary, transport/profile separation, naming/pattern constraints)
- `docs/ux-spec/11-ux-consistency-patterns.md` (settings and validation language)
- `docs/ux-spec/10-component-strategy.md` (state and feedback consistency)
- `docs/stories/1-1-initialize-extension-from-starter-template.md` (prior-story learnings and established conventions)
- `package.json` (current settings schema and command contribution)

## Dev Agent Record

### Agent Model Used

GPT-5.3-Codex

### Debug Log References

- Created via create-story workflow execution on 2026-04-04.

### Completion Notes List

- Comprehensive context assembled from epic, PRD, architecture, UX, prior story, repo reality, and recent git history.
- Story status set to `ready-for-dev`.
- Hardened configuration schema for `jupyterBrowserKernel.cdpHost` and `jupyterBrowserKernel.cdpPort` with explicit guidance and numeric bounds.
- Added typed endpoint configuration access and validation with field-specific failures and concrete corrective actions.
- Wired `jupyterBrowserKernel.connect` to fail fast on invalid settings and provide deterministic next-step guidance (open settings).
- Added deterministic endpoint summary output with host redaction for non-loopback hosts.
- Placed all tests in top-level `tests/` folders to align with architecture constraints.
- Added unit and command-level tests; validated with `npx tsc -p tsconfig.test.json`, `node --test out/tests/**/*.test.js`, `npm run lint`, `npm run typecheck`, and `npm run compile`.

### File List

- docs/stories/1-2-configure-browser-endpoint.md
- docs/stories/sprint-status.yaml
- package.json
- src/commands/connect-command.ts
- src/config/endpoint-config.ts
- src/extension.ts
- tests/unit/commands/connect-command.test.ts
- tests/unit/config/endpoint-config.test.ts
- tsconfig.test.json

### Review Findings

- [x] [Review][Patch] NFR15 defaults — `readEndpointConfig` silently falls back to `localhost:9222` when settings are unset. Remove programmatic defaults; treat missing/empty host and NaN/zero port as validation failures so the user is always in explicit control of the endpoint. [`src/config/endpoint-config.ts`]
- [x] [Review][Dismissed] AC2 scope — port schema constraints (`minimum: 1`, `maximum: 65535`) prevent saving an out-of-range port in the settings UI. Host connect-time field-specific validation is sufficient (no practical pattern constraint for arbitrary hostnames). AC2 met.
- [x] [Review][Patch] `field` ternary has no fallback for future variants — `validation.error.field === "host" ? "cdpHost" : "cdpPort"` silently opens the wrong settings pane if `EndpointValidationField` gains a third value. Use a Record lookup with an explicit fallback. [`src/commands/connect-command.ts`]
- [x] [Review][Patch] `cdpPort` missing `multipleOf: 1` — JSON schema `"type": "number"` with only `minimum`/`maximum` allows `9222.5` in the settings UI. Add `"multipleOf": 1` to the `cdpPort` property. [`package.json`]
- [x] [Review][Patch] No test for user-dismissal path — when `showErrorMessage` returns `undefined` (user closes the dialog without clicking "Open Settings"), `openSettings` must NOT be called. This behavioral contract is entirely untested. [`tests/unit/commands/connect-command.test.ts`]
- [x] [Review][Patch] `summarizeEndpointForDisplay` has zero test coverage — loopback vs. non-loopback branching and port formatting are untested despite being observable behaviors. [`tests/unit/config/endpoint-config.test.ts`]
- [x] [Review][Patch] Unhandled rejection from VS Code API calls — `showErrorMessage` and `openSettings` are awaited inside `executeConnectCommand` with no try/catch. A VS Code API rejection propagates to the extension host as an uncaught error. [`src/commands/connect-command.ts`]
- [x] [Review][Patch] `createDefaultConnectCommandRuntime` inline structural type — replace 30-line hand-rolled parameter type with `typeof import("vscode")`, eliminating duplication and gaining breaking-change detection. [`src/commands/connect-command.ts`]
- [x] [Review][Patch] `ConnectCommandRuntime` return types use `PromiseLike<unknown> | Promise<unknown> | unknown` which collapses to `unknown` — replace with `Thenable<string | undefined>` for message methods and `Thenable<void>` for `openSettings` to match VS Code API types. [`src/commands/connect-command.ts`]
- [x] [Review][Defer] `isLoopbackHost` incomplete loopback detection — `127.x.x.x` block and IPv6 variants (`::ffff:127.0.0.1`, long-form `0:0:0:0:0:0:0:1`) are shown as `[redacted-host]`. [`src/config/endpoint-config.ts`] — deferred, expanded display safety is post-MVP
- [x] [Review][Defer] `watchAutoRefreshInterval` missing `markdownDescription` and min/max — sibling numeric setting lacks format guidance and range constraints. [`package.json`] — deferred, outside Story 1.2 task scope
- [x] [Review][Defer] Generic `"{0} {1}"` l10n key limits targeted translations — any two-argument composition shares this key. [`l10n/bundle.l10n.json`] — deferred, not a functional bug
- [x] [Review][Superseded] Hand-rolled vscode API structural interface — superseded by patch findings for inline type replacement and `Thenable<T>` return types. [`src/commands/connect-command.ts`]
- [x] [Review][Resolved] `format` test helper re-implements `vscode.l10n.t` substitution — replaced with direct import of `@vscode/l10n` (the canonical standalone package). [`tests/unit/commands/connect-command.test.ts`]
- [x] [Review][Defer] `config.get` returning a non-string object for `cdpHost` results in `"[object Object]"` passing host validation. [`src/config/endpoint-config.ts`] — deferred, configuration corruption scenario prevented by VS Code settings infrastructure

## Change Log

- 2026-04-04: Implemented endpoint configuration schema hardening, runtime validation, connect fail-fast behavior, and test coverage for Story 1.2.
- 2026-04-04: Moved Story 1.2 tests from source folders to top-level tests folders to satisfy architecture test-organization rules.
- 2026-04-04: Code review complete — findings written above.
