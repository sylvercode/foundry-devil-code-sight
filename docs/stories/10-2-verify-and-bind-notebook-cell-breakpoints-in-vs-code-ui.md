---
storyId: "10.2"
storyKey: "10-2-verify-and-bind-notebook-cell-breakpoints-in-vs-code-ui"
title: "Verify and Bind Notebook-Cell Breakpoints in VS Code UI"
status: "done"
created: "2026-05-11"
epic: "10"
priority: "p0-blocker"
dependencies: ["10-1-register-and-bootstrap-notebook-cell-dap-session"]
---

# Story 10.2: Verify and Bind Notebook-Cell Breakpoints in VS Code UI

**Status:** done

## Story

As a developer,
I want notebook-cell gutter breakpoints to be verified and bound by the adapter,
So that breakpoint state in VS Code matches actual runtime behavior.

## Acceptance Criteria

### AC 1: Breakpoints Can Be Set in Notebook-Cell Gutter

**Given** a notebook cell is open in the editor and a Browser Kernel debug session is active
**When** the user clicks the gutter (or presses F9) on a line in the cell
**Then** a breakpoint marker is displayed in the gutter
**And** VS Code sends a `setBreakpoints` DAP request to the adapter, with `source.path` (or `source.name`) carrying the notebook cell's `vscode-notebook-cell://` URI string.

### AC 2: Adapter Translates Breakpoints to the Runtime via `BrowserDebuggerSession`

**Given** a `setBreakpoints` request for a notebook cell
**When** the adapter receives the request
**Then** the adapter calls `BrowserDebuggerSession.setBreakpointByUrl({ url, lineNumber, columnNumber? })` where `url` is `cell.document.uri.toString()` (the same value the kernel emits as `//# sourceURL=` per Story 2.4)
**And** the adapter responds with verified breakpoints whose `line` reflects the actual location V8 bound (`Debugger.setBreakpointByUrl` returns `locations[]` with the resolved scriptId/lineNumber/columnNumber).

### AC 3: Breakpoint State Stays Synchronized

**Given** breakpoints are set and a debug session is active
**When** the user adds, removes, or toggles a breakpoint
**Then** the adapter receives a new `setBreakpoints` request that contains the full desired state for that source
**And** the adapter computes adds/removes against its per-URL registry, calls `setBreakpointByUrl` for adds and `removeBreakpoint(breakpointId)` for removes via `BrowserDebuggerSession`
**And** stale runtime breakpoints for that URL are removed before the response is returned.

### AC 4: Breakpoint Verification Failures Are Clear

**Given** `setBreakpointByUrl` returns no `locations[]` entry for a requested line, or the call rejects
**When** the adapter builds the response
**Then** that breakpoint is reported as `verified: false` with a localized `message`
**And** the adapter still resolves the request (one bad breakpoint never fails the whole batch).

### AC 5: Conditional Breakpoints Are Forwarded

**Given** a `setBreakpoints` entry includes `condition`
**When** the adapter sends `setBreakpointByUrl`
**Then** the `condition` is forwarded to V8 via the `Debugger.setBreakpointByUrl` `condition` param
**And** logpoints (`logMessage`) and hit-count breakpoints (`hitCondition`) are accepted but documented as deferred (treated as unconditional for MVP) with a one-line localized informational message.

### AC 6: Breakpoints Survive Kernel Re-Execution of the Cell

**Given** a verified breakpoint is bound for a cell
**When** the user re-runs the cell (Story 2.4 fast-rerun pattern emits the same `//# sourceURL=`)
**Then** the breakpoint hits in the new script without the user re-toggling it
**And** no duplicate runtime breakpoints accumulate for the same `(url, line, column)` triple.

## Tasks / Subtasks

### 1. Implement `setBreakpoints` DAP Request Handler (AC: 1, 2, 3, 4, 5)

- [x] In `src/debugger/notebook-dap-adapter.ts`, implement `setBreakpointsRequest(response, args)` in this order:
  1. **Resolve the source URL.** Prefer `args.source.path` then `args.source.name`. The value is the notebook cell URI string (`vscode-notebook-cell://...`) that VS Code carries through DAP because the adapter declares the source via `cell.document.uri.toString()`. Ignore `args.lines` (legacy fallback); only `args.breakpoints` is supported.
  2. **Look up the registry** via `sessionManager.getBreakpointRegistry()` (added in Task 2). If it returns `undefined` (no active DAP session yet, e.g. VS Code re-issued breakpoints between `initialized` and `configurationDone`, or after `connection-lost`), return one `Breakpoint` per input entry with `verified: false` and a localized message `"Debug session not active; breakpoint will be retried."`. The manager re-issues the latest payload per URL after a successful `launch()` (Task 5).
  3. **Build the desired list** as `DesiredBreakpoint[]` from `args.breakpoints ?? []`. Keep DAP 1-based lines as-is — the registry owns the conversion to CDP's 0-based lines.
  4. **Apply via `registry.replace(url, desired)`** (single call, per AC 3 "full desired state for that source"). The registry computes the add/remove diff internally.
  5. **Build the response.** Return `Breakpoint[]` in the same order as `args.breakpoints`. Each `Breakpoint` must include `verified`, the resolved `line` (1-based, converted from the first entry of `locations[]`), the original `source`, and an optional localized `message` for failures.
  - Logpoints (`logMessage`) and hit conditions (`hitCondition`) are accepted, the registry treats them as unconditional, and the response sets `message` to a localized note that they are not yet supported.

### 2. Create the Per-URL Breakpoint Registry (AC: 2, 3, 6)

- [x] Create `src/debugger/breakpoint-registry.ts` exporting `createBreakpointRegistry({ debuggerSession, logger })` and the `BreakpointRegistry` interface.
- [x] Internal state: `Map<url, Map<key, BoundBreakpoint>>` where `key = "<line>:<column ?? 0>:<condition ?? \"\">"` and `BoundBreakpoint = { breakpointId, line, column, condition, locations, verified, message? }`. The `locations` field reuses the `Pick<Protocol.Debugger.SetBreakpointByUrlResponse, "locations">["locations"]` shape already returned by `BrowserDebuggerSession.setBreakpointByUrl` (see [src/transport/browser-connect.ts](../../src/transport/browser-connect.ts)) — do not re-declare it.
- [x] API:
  - `replace(url, desired: DesiredBreakpoint[]): Promise<BoundBreakpoint[]>` — computes diff, issues `setBreakpointByUrl` and `removeBreakpoint` calls in parallel, returns the resulting bound state in input order. Lines AND columns are converted from DAP 1-based (input) to CDP 0-based (call) here, and from CDP 0-based (response) back to DAP 1-based (output) here. This is the only place in the codebase that performs the conversion.
  - `resolveRuntimeBreakpoint(breakpointId, location): { url, breakpointId, line, column? } | undefined` — looks up a registry entry by `breakpointId`, updates its bound `line`/`column`/`locations`/`verified` from the runtime `Debugger.breakpointResolved` event, and returns the resolved coordinates so the manager can emit a feedback event. Required so VS Code's gutter flips from unverified → verified once V8 actually resolves the URL after script load (see manual-test-plan TC-1).
  - `clear(url): Promise<void>` and `clearAll(): Promise<void>` for session teardown. Both MUST be best-effort: every `removeBreakpoint` rejection is caught and logged via `logger`; the returned promise resolves even if every call fails (required for the `connection-lost` teardown path — see Task 7).
- [x] No duplicate runtime breakpoints for the same `key` (AC 6) — the diff guarantees idempotence across rerun-driven refreshes.
- [x] Failure handling: a single failing add becomes a `BoundBreakpoint` with `verified: false` and a localized message built from `"Breakpoint could not be bound: {0}"`; the batch resolves.

### 3. Reuse `BrowserDebuggerSession` With One Additive Hook (AC: 2, 3)

- [x] No new transport file. `BrowserDebuggerSession` (introduced by Story 2.5, retained by Story 10.1) already exposes `enable`, `disable`, `setBreakpointByUrl` (returning `{ breakpointId, locations }`), `removeBreakpoint`, `resume`, and `onPaused` — verified in [src/transport/browser-connect.ts](../../src/transport/browser-connect.ts). The `condition` param is already on the accepted `Pick<…>` for `setBreakpointByUrl`, so AC 5 forwarding is a pass-through.
- [x] Extend `BrowserDebuggerSession` with a single additive method `onBreakpointResolved(listener)` that subscribes to V8's `Debugger.breakpointResolved` event via the session-scoped event name (`Debugger.breakpointResolved.<sessionId>`). This is the minimum transport surface needed for the registry's `resolveRuntimeBreakpoint` feedback path; no other transport-shape changes.
- [x] No bypass of `BrowserDebuggerSession`. Do not import `chrome-remote-interface` from `src/debugger/**`.

### 4. Source Identity (AC: 1, 6)

- [x] Source identity is `cell.document.uri.toString()` — the same value the kernel emits as `//# sourceURL=` in [src/kernel/build-cell-expression.ts](../../src/kernel/build-cell-expression.ts). No mapper module is needed; do not create one.
- [x] In the notebook adapter's helper that builds DAP `Source` payloads (used by Story 10.3 for stack frames too), set `source.name` to the cell label and `source.path` to the URI string directly. Do NOT call `URI.fsPath` — `vscode-notebook-cell://` URIs have no filesystem path and `fsPath` will mangle them.
- [x] Line mapping is 1:1 between the cell document and the V8 script because the kernel wraps user code with a `//# sourceURL=` directive that points at the cell URI (Story 2.4). The DAP↔CDP line conversion happens exactly once, inside the registry (Task 2).

### 5. Capability Update + Manager Wiring (AC: 3, 5)

- [x] Extend `initialize` capabilities returned by the adapter to exactly this snapshot (the Task 9 unit test pins it):

  ```ts
  {
    supportsBreakpointLocationsRequest: true,
    supportsConfigurationDoneRequest: true,
    supportsTerminateRequest: true,
    supportTerminateDebuggee: false,
    supportsEvaluateForHovers: true,
    supportsConditionalBreakpoints: true,
    supportsHitConditionalBreakpoints: false,
    supportsLogPoints: false,
  }
  ```

- [x] Extend `DebugSessionManager` (Story 10.1) so the adapter can reach the registry:
  - Create the `BreakpointRegistry` inside `launch()` after `session.enable()` resolves, bound to the active `BrowserDebuggerSession`. Tear it down inside `stopRunningSession()` (Task 7).
  - Expose `getBreakpointRegistry(): BreakpointRegistry | undefined` returning the live registry, or `undefined` before `launch()` and after teardown.
  - Subscribe to `session.onBreakpointResolved` and expose `onDidBreakpointResolved(listener)` so the adapter can emit a DAP `BreakpointEvent("changed", …)` when V8 resolves a previously unverified breakpoint. The subscription MUST be attached BEFORE the cached-payload replay loop so resolution events fired during replay are not lost.
  - Cache the most recent `setBreakpoints` payload **per URL** that the adapter has seen. After a successful `launch()` resolves (and before `InitializedEvent` is sent), replay each cached payload through `registry.replace(url, desired)` so that breakpoints toggled while no session was active become bound. Add a manager method `recordSetBreakpoints(url, desired)` the adapter calls from Task 1.

### 6. Implement `breakpointLocations` Request (AC: 4)

- [x] In the adapter, implement `breakpointLocationsRequest(response, args)` returning all lines in the requested range as candidate locations for MVP. This keeps VS Code's gutter responsive without requiring V8 introspection. Tighten in a follow-up if needed.

### 7. Session Teardown (AC: 3)

- [x] In `stopRunningSession()` (Story 10.1's `debug-session-manager`), call `breakpointRegistry.clearAll()` BEFORE `Debugger.disable`. `clearAll()` is best-effort (Task 2) and MUST NOT throw — otherwise the `connection-lost` path leaks the `onPaused` subscription and the `TerminatedEvent` never fires. After `clearAll()` resolves, drop the registry reference so `getBreakpointRegistry()` returns `undefined`.

### 8. Localization (AC: 4, 5)

- [x] Add localized strings to [l10n/bundle.l10n.json](../../l10n/bundle.l10n.json):
  - `"Breakpoint could not be bound: {0}"`
  - `"Logpoints and hit-count breakpoints are not yet supported by the Browser Kernel debugger; binding as unconditional."`
  - `"Debug session not active; breakpoint will be retried."`

### 9. Unit Tests (AC: 1–6)

- [x] `tests/unit/debugger/breakpoint-registry.test.ts`:
  - `replace` with empty current and three desired → three `setBreakpointByUrl` calls, no `removeBreakpoint`.
  - `replace` with current = {A,B,C} and desired = {A,C,D} → one add (D), one remove (B), no churn for A/C.
  - `replace` with one failing add → returned entry has `verified: false` with the localized `"Breakpoint could not be bound: {0}"` message, others are bound.
  - Line conversion is symmetric: DAP 1-based input becomes `lineNumber: input - 1` in the CDP call, and a CDP `locations[0].lineNumber: N` response becomes `Breakpoint.line: N + 1`.
  - `clearAll` removes every `breakpointId` exactly once.
  - `clearAll` resolves even when every `removeBreakpoint` rejects (logged via the injected `logger`).
- [x] `tests/unit/debugger/notebook-dap-adapter-breakpoints.test.ts`:
  - `setBreakpointsRequest` resolves the `vscode-notebook-cell://...` URI from `source.path`.
  - When `sessionManager.getBreakpointRegistry()` returns `undefined`, the response contains `verified: false` entries with the localized `"Debug session not active; breakpoint will be retried."` message and the manager records the payload via `recordSetBreakpoints(url, desired)`.
  - Conditional entries forward `condition` to the registry.
  - Logpoint entries set the localized informational `message` and bind unconditionally.
  - Capability snapshot matches Task 5 exactly.
- [x] `tests/unit/debugger/debug-session-manager.test.ts` (extend Story 10.1's file):
  - `launch()` creates a registry exposed via `getBreakpointRegistry()`, and replays every payload previously recorded via `recordSetBreakpoints` exactly once.
  - `stopRunningSession()` calls `registry.clearAll()` before `disable()` and clears the registry reference; survives a registry whose `clearAll` resolves on rejection.

### 10. Integration Test (AC: 2, 6)

- [x] `tests/integration/debugger/breakpoint-binding.integration.test.ts` (gated by `RUN_CDP_INTEGRATION=1`, reuses `tests/integration/helpers/headless-chromium.ts`):
  - Connect, start a DAP session via the adapter, evaluate a script that ends with `//# sourceURL=vscode-notebook-cell://test/cell-1.js`, send `setBreakpoints` for line 2, expect `verified: true` with a non-empty `locations[]`.
  - Re-evaluate the same script and expect the breakpoint to still hit on the next run without re-issuing `setBreakpoints`.

### 11. Validation

- [x] `npm run lint`.
- [x] `npm run test`.
- [x] `npm run compile`.
- [x] `npm run test:integration:cdp`.

### Review Findings

Code review run on 2026-05-30 against `main..verify-and-bind-notebook-cell-breakpoints`.

- [x] [Review][Patch] Fix `breakpointResolved` race + amend story scope — Implementation adds `Debugger.breakpointResolved` plumbing (transport `onBreakpointResolved`, registry `resolveRuntimeBreakpoint`, manager `onDidBreakpointResolved`, adapter `BreakpointEvent("changed", …)`) to flip the gutter from unverified to verified once V8 binds the URL — the actual fix for the TC-1 manual-test symptom ("breakpoint stays unbound until first run"). Two follow-ups: (a) **Fix the race** in [src/debugger/debug-session-manager.ts](src/debugger/debug-session-manager.ts#L218-L243) — currently the `onBreakpointResolved` subscription is attached AFTER the cached-payload replay loop, so any `breakpointResolved` events V8 fires during replay are dropped (re-introducing the TC-1 symptom after reconnect). Move the subscription and the `breakpointRegistry = nextRegistry` assignment BEFORE the replay loop. (b) **Amend Task 2 and Task 3** to formally cover the runtime-resolution feedback path (new transport method, new registry method, new manager event).
- [x] [Review][Patch] Dead unverified-fallback branch in registry [src/debugger/breakpoint-registry.ts:251-265] — Every `desiredByIndex` key is processed by the `desiredByKey` parallel loop, so `createdByKey.get(key)` always returns a value; the unverified fallback object at lines 254-265 is unreachable.
- [x] [Review][Patch] Hardcoded English string passed into localized template [src/debugger/breakpoint-registry.ts:225-227] — `"No runtime locations resolved."` is the `{0}` argument to `localize("Breakpoint could not be bound: {0}", …)`. The outer template is localized; the inner string is not, so translations are inconsistent.
- [x] [Review][Patch] Column number conversion not symmetric with line [src/debugger/breakpoint-registry.ts:108-117, 234-236] — Lines are converted DAP↔CDP (`±1`), but columns are passed through unchanged in both directions. DAP columns are 1-based by convention and CDP columns are 0-based, so column-precise breakpoints are off-by-one. Currently latent because the response does not populate `column`.
- [x] [Review][Patch] Debug-only log strings pollute the l10n bundle [src/debugger/notebook-dap-adapter.ts:~180-225] — `this.localize("true")`, `this.localize("false")`, `this.localize("(none)")`, `this.localize("(missing source)")` are wrapped in `localize()` even though they appear only in debug log lines. They add noise to translation work and mix localized/non-localized debug output. Replace with plain literals (or remove the verbose per-breakpoint debug log).
- [x] [Review][Patch] Redundant local `RemoveBreakpointParams` interface and `as` casts [src/debugger/breakpoint-registry.ts:3-5, 139, 177] — The transport's `removeBreakpoint` already accepts the proper CDP `DebuggerRemoveBreakpointParams` type. The local one-field interface plus the two `as RemoveBreakpointParams` casts are unnecessary; pass `{ breakpointId }` directly.
- [x] [Review][Defer] No defensive validation for missing `result.locations` from CDP [src/debugger/breakpoint-registry.ts:208] — deferred, low risk (CDP typing guarantees the field).
- [x] [Review][Defer] No validation for invalid DAP line/column inputs (≤0, negative) [src/debugger/breakpoint-registry.ts, src/debugger/notebook-dap-adapter.ts] — deferred, defensive; VS Code does not produce these.
- [x] [Review][Defer] Theoretical race: `recordSetBreakpoints` mutates `cachedBreakpointsByUrl` during `launch()` replay loop [src/debugger/debug-session-manager.ts:218-225] — deferred, narrow async window.
- [x] [Review][Defer] `removeBreakpoint` rejection still deletes registry entry via `finally`, potentially leaking runtime breakpoint [src/debugger/breakpoint-registry.ts:163-174] — deferred, intentional "best-effort" per Task 2 spec.
- [x] [Review][Defer] Integration polling fixed at 25 ms × 120 (≈3 s) may flake on slow CI [tests/integration/debugger/breakpoint-binding.integration.test.ts:113-129] — deferred, subjective.

## Dev Notes

### Story Context and Scope

This is the **second story in Epic 10**, building on Story 10.1's DAP plumbing. It implements the `setBreakpoints` and `breakpointLocations` request handlers and the per-URL breakpoint registry that talks to V8 through `BrowserDebuggerSession.setBreakpointByUrl` / `removeBreakpoint`.

Variable inspection at breakpoints is Story 10.3. Stepping controls are Story 10.4.

### Architecture Guardrails (Must Follow)

- **Source identity is the cell document URI.** Story 2.4 emits `//# sourceURL=<cell.document.uri.toString()>` and Story 10.1 sets `Source.path` to the same string. Do NOT invent a `notebook://cellId:line` or any other scheme.
- **Use `setBreakpointByUrl`, not `setBreakpoint`.** `Debugger.setBreakpoint(location)` requires a known `scriptId`, which the kernel does not stably expose. `setBreakpointByUrl` matches scripts by `url` and survives re-execution, which is exactly the Story 2.4 / 6.1 fast-rerun pattern.
- **Single transport surface.** All CDP debugger calls go through `BrowserDebuggerSession`. No new `src/transport/debugger-interface.ts`, no direct `client.send("Debugger.*", ...)` outside `src/transport/`.
- **Folder is `src/debugger/`.** Created by Story 2.5, owned by Epic 10 going forward.
- **Line indexing.** DAP is 1-based, CDP is 0-based. Convert at exactly one boundary (the registry).
- **Breakpoint id ownership.** The registry stores `breakpointId` per `(url, key)` and is the only thing that calls `removeBreakpoint`.
- **Localization.** All user-facing strings via `vscode.l10n.t()` keyed in `l10n/bundle.l10n.json`.

### Known Unknowns & Future Decisions

1. **Logpoints and hit conditions** are deferred. Capability flags stay `false`; the registry treats them as unconditional and the adapter surfaces a one-line note.
2. **`breakpointLocations` precision.** MVP returns all lines in the requested range. Tighten with V8's `getPossibleBreakpoints` if users complain about phantom valid lines.
3. **Multi-cell scripts.** Each cell evaluates as an independent script with a unique `sourceURL`. If future work wraps multiple cells in one script, the URL strategy must be revisited.

## Dev Agent Record

### Debug Log

- 2026-05-23: Implemented breakpoint synchronization pipeline across adapter, registry, and session manager.
- 2026-05-23: Added targeted unit coverage for registry diffing, adapter breakpoint handling, and manager launch/teardown replay behavior.
- 2026-05-23: Added CDP integration test coverage for breakpoint binding flow with explicit headless Chromium lifecycle and isolated ports to keep default integration runs stable.

### Completion Notes

- Implemented `setBreakPointsRequest` and `breakpointLocationsRequest` in the notebook DAP adapter, including inactive-session fallback, conditional forwarding, deferred logpoint/hit-condition messaging, and capability updates.
- Added `src/debugger/breakpoint-registry.ts` with per-URL diff/replace behavior, DAP/CDP line conversion boundaries, and best-effort `clear`/`clearAll` cleanup semantics.
- Extended `DebugSessionManager` with registry lifecycle management, cached payload replay on launch, and teardown ordering (`clearAll` before `disable`).
- Added localization entries for breakpoint binding failures, deferred feature notice, and inactive-session retry messaging.
- Added/updated tests across unit and integration layers; unit, lint, compile, and default CDP integration command are passing.

## File List

- src/debugger/breakpoint-registry.ts
- src/debugger/debug-session-manager.ts
- src/debugger/notebook-dap-adapter.ts
- l10n/bundle.l10n.json
- tests/unit/debugger/breakpoint-registry.test.ts
- tests/unit/debugger/notebook-dap-adapter-breakpoints.test.ts
- tests/unit/debugger/debug-session-manager.test.ts
- tests/unit/debugger/notebook-dap-adapter.test.ts
- tests/integration/debugger/breakpoint-binding.integration.test.ts

## Change Log

- 2026-05-23: Implemented Story 10.2 breakpoint binding/synchronization across adapter, manager, and new registry with supporting tests and localization.

### Related Documentation

- [DAP setBreakpoints specification](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_SetBreakpoints)
- [Chrome DevTools Protocol — Debugger.setBreakpointByUrl](https://chromedevtools.github.io/devtools-protocol/tot/Debugger/#method-setBreakpointByUrl)
- [Story 2.4 (per-cell sourceURL contract)](2-4-rerun-cells-with-fast-iteration.md)
- [Architecture: Debugger Domain Integration](../architecture.md#debugger-domain-integration)
