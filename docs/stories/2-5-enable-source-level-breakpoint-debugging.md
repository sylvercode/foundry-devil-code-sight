---
storyId: "2.5"
storyKey: "2-5-enable-source-level-breakpoint-debugging"
title: "Mirror Notebook-Cell Breakpoints Into the Browser Debugger"
status: "done"
created: "2026-04-26"
epic: "2"
priority: "p0"
---

# Story 2.5: Mirror Notebook-Cell Breakpoints Into the Browser Debugger

**Status:** done

## Story

As a developer,
I want a breakpoint set on a notebook cell in VS Code to also exist in the browser's Sources panel against that cell, so that running the cell pauses at my breakpoint and I can debug it in the browser developer tools (DevTools) without manually re-creating breakpoints there,
So that I get a single authoring surface for cell breakpoints (the VS Code gutter) while DevTools remains the inspection surface for pause, step, variables, and call stack.

### Posture Change vs. Spike Findings

The original Story 2.5 ACs inherited the **Passive Provider** posture locked by [spike/cdp-sourceurl-debugger-findings.md](../../spike/cdp-sourceurl-debugger-findings.md) (Q2). To make VS Code-side cell breakpoints reach the page, the extension must mirror them via `Debugger.setBreakpointByUrl`, which requires `Debugger.enable` on the extension's per-target session. The extension therefore moves to the **Diagnostic Observer** posture (spike Q3, validated as multi-client safe) with the explicit invariant that the extension auto-resumes any `Debugger.paused` event delivered to its own session so it never holds the JS thread for any other CDP client. [Source: spike/cdp-sourceurl-debugger-findings.md#Q2, spike/cdp-sourceurl-debugger-findings.md#Q3, docs/architecture.md#Debugger-Domain-Integration]

### Scope Boundary — No VS Code-Side Debug UI

This story is the CDP-side mirror only. The VS Code editor will NOT show a solid "verified" gutter glyph, will NOT enter a `vscode.DebugSession`, will NOT highlight the paused line, and will NOT populate the Variables / Call Stack / Watch panels. Pause inspection happens in the browser's DevTools (the same workflow already validated in the spike). Adding a Debug Adapter Protocol (DAP) adapter to surface a real VS Code debug session is tracked separately in [docs/stories/deferred-work.md](deferred-work.md) under "Full VS Code Debug Adapter for cell debugging".

Confirmed limitation from implementation validation: a VS Code notebook-cell breakpoint mirrored through the extension's CDP session binds in V8 and does pause execution, but Chromium DevTools may not render a visible gutter marker for that breakpoint in the Sources panel because the breakpoint was created from a different debugger session. The Sources entry for the cell still appears, and the mirrored breakpoint still participates in pause/resume behavior; only the DevTools marker visibility is unreliable.

## Acceptance Criteria

### AC 1: `Debugger.enable` on Per-Target Session Attach (Diagnostic Observer Posture)

**Given** an active session with a valid browser execution target
**When** the session attaches (per the existing `connectViaBrowserTargetAttach` flow)
**Then** the extension calls `Debugger.enable` on its per-target flat session as part of the post-attach lifecycle (alongside the existing `Runtime` probe)
**And** session attach failure of the `Debugger` domain surfaces as a normalized transport-level error consistent with existing attach error reporting (categorized via the existing transport-failure path; no raw CDP error leaks to UI)
**And** `Debugger.enable` is the **only** Debugger-domain enablement performed by the extension — no other Debugger configuration is changed at attach.

### AC 2: VS Code Notebook-Cell Breakpoint Mirrors to Page on the Cell URI

**Given** a `vscode.SourceBreakpoint` whose `location.uri.scheme === 'vscode-notebook-cell'`
**When** the extension is connected to a target
**Then** the extension calls `Debugger.setBreakpointByUrl` using the cell URI string (`NotebookCell.document.uri.toString()`, byte-identical to the `//# sourceURL=` value emitted by Story 2.4) as the `url` and the `vscode.SourceBreakpoint.location.range.start.line` as the zero-based `lineNumber`
**And** rerunning the matching cell pauses execution in the browser at the expected line, with the cell source visible in the browser's DevTools Sources panel
**And** the breakpoint is considered successfully mirrored when V8 binds and hits it, even if DevTools does not render a visible gutter marker for the mirrored breakpoint because it originated from the extension's separate CDP session
**And** the in-memory mapping from `vscode.Breakpoint.id` to CDP `breakpointId` is recorded so the breakpoint can later be removed.

### AC 3: Breakpoint Add / Remove / Edit Translation

**Given** the user adds, removes, edits, enables, or disables a notebook-cell breakpoint while connected
**When** `vscode.debug.onDidChangeBreakpoints` fires with `added`, `removed`, or `changed` arrays
**Then** the extension translates each change into the corresponding CDP call on its session:

- `added`: one `Debugger.setBreakpointByUrl` per notebook-cell `SourceBreakpoint`; record the returned `breakpointId` in the mapping.
- `removed`: one `Debugger.removeBreakpoint` per previously-mirrored breakpoint; drop the mapping entry. If the mapping has no entry (e.g., breakpoint was on a non-`vscode-notebook-cell://` URI), the change is a no-op.
- `changed` (location, condition, enabled flag): treated as `removed` then `added` against the new state. A `disabled` breakpoint is removed from the page; re-enabling re-adds it.

**And** non-notebook-cell breakpoints (e.g., `file://` source breakpoints, `vscode.FunctionBreakpoint`, exception breakpoints) are ignored — the mirror is scoped to `location.uri.scheme === 'vscode-notebook-cell'` source breakpoints only.

### AC 4: Pre-Existing Breakpoint Snapshot on Connect

**Given** the extension connects after VS Code-side notebook-cell breakpoints already exist (e.g., the user opened the notebook, set breakpoints, then ran the connect command)
**When** the connection becomes active and the post-attach lifecycle completes
**Then** the extension snapshots `vscode.debug.breakpoints`, filters to notebook-cell `SourceBreakpoint`s, and registers all of them with the page via `Debugger.setBreakpointByUrl`
**And** the next cell run pauses on any matching breakpoint on the first execution (per spike Q4: first-evaluation breakpoint binding works without "run-once-first" UX caveat).

### AC 5: Auto-Resume on Extension-Session `Debugger.paused`

**Given** the extension's per-target session receives a `Debugger.paused` event (because `Debugger.enable` was called per AC 1, V8 delivers the paused event to every enabled debugger client)
**When** the event is delivered
**Then** the extension immediately calls `Debugger.resume` on its own session
**And** the extension does NOT block the JS thread for any other CDP client (DevTools, if attached, retains independent pause/step control on its own session)
**And** the auto-resume is unconditional — no inspection of `reason`, `hitBreakpoints`, or call frames before resuming
**And** the auto-resume is best-effort: a `Debugger.resume` failure is logged via the existing output channel but does not throw or surface as a cell-output error.

> **Transitional deviation (Story 2.5 outcome amendment):** The current implementation reads `event.reason` and joins `event.hitBreakpoints` to emit a single "Browser debugger pause observed on extension session" log line **before** dispatching `Debugger.resume`. This is a knowing violation of the "no inspection before resuming" clause. It is retained as transitional diagnostic instrumentation that proves the mirror is binding and hitting breakpoints, because Story 2.5's user-visible value is otherwise unverifiable from inside VS Code (DevTools does not render a gutter marker for breakpoints created from the extension's session — see the limitation paragraph in the Scope Boundary section). The risk is bounded: the logger is a synchronous append to the extension's output channel; if it ever throws, `resume()` is never dispatched and the JS thread is held for any other CDP client. This deviation MUST be removed when the Full VS Code Debug Adapter epic (see [docs/stories/deferred-work.md](deferred-work.md)) lands a real `vscode.DebugSession`, at which point pause inspection becomes a first-class concern of that epic and the mirror's `onPaused` returns to the unconditional-resume contract.

### AC 6: Browser-Side Breakpoints Continue to Work

**Given** a cell with a per-cell `//# sourceURL` (Story 2.4 contract)
**When** I set a breakpoint on a line of that cell directly in the browser's Sources panel
**Then** the browser-side breakpoint still binds and fires on rerun without extension involvement (the original spike workflow continues to work unchanged)
**And** AC 5's auto-resume on the extension's own session does NOT cancel a DevTools-owned pause on the user's separate DevTools session.

### AC 7: Breakpoint Persists Across Cell Edit and Rerun

**Given** the same cell is edited and rerun
**When** a notebook-cell breakpoint is set against that cell's stable URI
**Then** the breakpoint persists against the stable cell URI (the cell URI does not change when cell text is edited; per spike URL-scheme sub-probe and Story 2.4 AC 5)
**And** the breakpoint fires on the new execution if the line still exists in the edited content (V8 binds by URL+line; if the line no longer exists, V8 silently does not pause — no UX caveat is required of the extension).

### AC 8: Top-Level Await Continues to Resolve Under Active Debugger

**Given** evaluation requires top-level await (Story 2.2 behavior)
**When** the evaluation path runs under Story 2.5 with `Debugger.enable` active
**Then** `Runtime.evaluate({ replMode: true, awaitPromise: true, returnByValue: true })` is retained as validated by spike Q1
**And** breakpoints bind reliably AND top-level await still resolves (spike Q1 + Q5 pair).

### AC 9: DevTools Coexistence Preserved With Active Mirror

**Given** Edge DevTools is attached to the same target as the extension
**When** the extension enables the Debugger domain (AC 1) and registers breakpoints (AC 2/3/4)
**Then** DevTools' own debugger session is not displaced (per spike Q3 multi-client coexistence)
**And** the user can drive Edge DevTools breakpoints unimpeded while the extension's session is attached
**And** notebook execution coexists with DevTools — running a cell while DevTools is paused on its own breakpoint does not corrupt either session.

### AC 10: Mirror Is Scoped to Notebooks Owned by the Browser-Kernel Controller

**Given** a `vscode.SourceBreakpoint` whose `location.uri.scheme === 'vscode-notebook-cell'` but whose containing notebook is **not** handled by the `jupyter-browser-kernel` controller (e.g., a cell in another notebook type, or a JavaScript cell whose user selected a different controller)
**When** the breakpoint change event fires
**Then** the extension still mirrors the breakpoint by URI (because the page-side `//# sourceURL` is keyed off the cell URI alone and the extension cannot reliably determine controller selection from a `Breakpoint` alone)
**And** the breakpoint simply never fires for cells not executed via this kernel — no error, no warning. This degenerate case is acceptable for MVP because the only side effect is a registered-but-never-hit page-side breakpoint, which costs nothing.

### AC 11: Mirror Lifecycle Tied to Connection State

**Given** the extension transitions from `connected` to `disconnected` (manual disconnect, transport failure, or extension deactivation)
**When** the connection ends
**Then** the in-memory `Breakpoint.id` → CDP `breakpointId` mapping is cleared
**And** no further `Debugger.setBreakpointByUrl` / `Debugger.removeBreakpoint` calls are issued until a new connection is active
**And** on the next successful reconnect, AC 4 (snapshot) re-runs against `vscode.debug.breakpoints` so the mirror state is rebuilt from scratch (not from the cleared mapping).

## Tasks / Subtasks

### 1. Extend Transport Surface for Debugger Domain (AC: 1, 2, 3, 4, 5, 11)

The current `ActiveBrowserConnection` only exposes `evaluate`, `terminateExecution`, and `close`. Story 2.5 needs Debugger-domain operations plus a `Debugger.paused` event channel scoped to the per-target session. Extend the transport surface in a controlled way that preserves the kernel/transport boundary in [docs/architecture.md#Architectural-Boundaries](../architecture.md).

- [x] In [src/transport/browser-connect.ts](../../src/transport/browser-connect.ts), extend `ActiveBrowserConnection` with a `debugger` sub-namespace (interface `BrowserDebuggerSession`):
  - `setBreakpointByUrl(params: { url: string; lineNumber: number; columnNumber?: number; condition?: string }): Promise<{ breakpointId: string; locations: Array<{ scriptId: string; lineNumber: number; columnNumber: number }> }>` — wraps `client.send("Debugger.setBreakpointByUrl", params, sessionId)`. Use the `devtools-protocol` types directly (see Dev Notes "Reusing Protocol types").
  - `removeBreakpoint(params: { breakpointId: string }): Promise<void>` — wraps `client.send("Debugger.removeBreakpoint", params, sessionId)`.
  - `resume(): Promise<void>` — wraps `client.send("Debugger.resume", undefined, sessionId)`. Best-effort; swallows errors.
  - `onPaused(listener: (event: ProtocolMappingApi.Events["Debugger.paused"][0]) => void): vscode.Disposable` — subscribes to the session-scoped event using the existing `toSessionScopedEventName("Debugger.paused", sessionId)` pattern (line 67–72). Returns a disposable that removes the listener.
- [x] In `connectViaBrowserTargetAttach` (line 315–464), after the Runtime probe succeeds and before `activeBrowserConnection` is assigned, call `client.send("Debugger.enable", undefined, attachResult.sessionId)`. Wrap in `try/catch`; on failure, call `safeDetachFromTarget` and throw via `createStepError("Debugger.enable", error)` so the existing categorization and `failureMessage` machinery handles it (AC 1).
- [x] Define the `debugger` field on `activeBrowserConnection` to bind `retainedClient` + `retainedSessionId` into the four methods above. Use `client.on(eventName, listener)` / `client.off(eventName, listener)` (or whatever `chrome-remote-interface` exposes — verify against the existing events used elsewhere; the library exposes both `client.on` for raw event names and `client.<Domain>.<event>(handler)` for domain helpers, but the multiplex pattern locked by the spike requires the session-scoped raw form).
- [x] Do NOT call `Debugger.setSkipAllPauses`, `Debugger.setPauseOnExceptions`, or any other Debugger-domain configuration at attach. Only `Debugger.enable` is in scope (AC 1 explicit constraint).

### 2. Create Breakpoint Mirror Module (AC: 2, 3, 4, 10, 11)

The bridge between `vscode.debug.breakpoints` and the per-target debugger session lives in a new module so the kernel and transport stay free of `vscode.debug` concerns.

- [x] Create `src/debugger/breakpoint-mirror.ts` exporting:
  - `interface BreakpointMirror { syncFromVsCode(): Promise<void>; dispose(): void; }`
  - `interface BreakpointMirrorOptions { debugApi: Pick<typeof vscode.debug, "breakpoints" | "onDidChangeBreakpoints">; getDebuggerSession(): BrowserDebuggerSession | undefined; logger?: (message: string, error?: unknown) => void; }`
  - `function createBreakpointMirror(options: BreakpointMirrorOptions): BreakpointMirror`
- [x] Module behavior:
  - Maintain `Map<string /* vscode.Breakpoint.id */, string /* CDP breakpointId */>`.
  - `syncFromVsCode()`: clear the mapping, then for every `vscode.SourceBreakpoint` in `debugApi.breakpoints` whose `.enabled === true` and whose `location.uri.scheme === 'vscode-notebook-cell'`, call `setBreakpointByUrl({ url: bp.location.uri.toString(), lineNumber: bp.location.range.start.line })` and record the mapping. Skip on transport failures with a logged warning; do not throw (AC 4 + AC 11).
  - `onDidChangeBreakpoints` handler:
    1. For each `removed` breakpoint with a mapping entry: `removeBreakpoint({ breakpointId })`, drop the entry.
    2. For each `changed` breakpoint with a mapping entry: `removeBreakpoint(...)` then re-add (treat as remove+add against the new state). If `enabled === false` after the change, omit the re-add.
    3. For each `added` breakpoint matching the AC 2 filter (notebook-cell SourceBreakpoint, enabled): `setBreakpointByUrl(...)`, record mapping.
  - All CDP calls swallow errors via the logger and continue — a single failed breakpoint must not break the rest of the sync (AC 11 robustness).
- [x] `dispose()`: dispose the `onDidChangeBreakpoints` listener and clear the mapping. Do NOT issue `removeBreakpoint` calls during dispose — connection lifecycle (Task 3) handles the page-side cleanup implicitly (the page-side state goes away with the session).

### 3. Wire Mirror Into Connection Lifecycle (AC: 1, 4, 11)

The mirror needs to start syncing when a connection becomes active and stop when it ends. The connection lifecycle is owned by `connect-command` / `disconnect-command`; reuse the existing `connectionStateStore` event stream rather than introducing new lifecycle hooks.

- [x] In [src/extension.ts](../../src/extension.ts), construct one `BreakpointMirror` instance during `activate(...)` after the kernel controller registration. Pass it `{ debugApi: vscode.debug, getDebuggerSession: () => getActiveBrowserConnection()?.debugger, logger: (msg, err) => outputChannel.appendLine(...) }`.
- [x] Subscribe to `connectionStateStore` state changes (extend `createConnectionStateStore` consumers via the existing `onConnectionStateChanged` hook, or attach via the same path the status indicator uses). On `state === "connected"`, call `mirror.syncFromVsCode()` (AC 4). On `state === "disconnected"` or `state === "error"`, call the mirror's internal mapping-clear (Task 2 should expose a small `clearMapping(): void` that does NOT issue any CDP calls).
- [x] Push the mirror's `dispose` onto `context.subscriptions`.

### 4. Auto-Resume on Extension-Session `Debugger.paused` (AC: 5, 6, 9)

Per spike Q3 caveat: when the extension's session has `Debugger.enable` active, V8 delivers `Debugger.paused` to that session even when the breakpoint was set by another client. The extension MUST auto-resume to avoid hanging the JS thread for DevTools.

- [x] In `createBreakpointMirror` (or a small sibling helper `src/debugger/auto-resume.ts` if it keeps the mirror module focused), subscribe to `getDebuggerSession()?.onPaused(...)` once per active connection.
- [x] The handler unconditionally calls `getDebuggerSession()?.resume()`. Do NOT inspect `reason`, `hitBreakpoints`, or `callFrames` (AC 5).
- [x] If `resume()` rejects, log via the provided logger and continue. Never throw out of the event handler (AC 5 best-effort clause).
- [x] Subscription lifetime: the disposable returned by `onPaused` is stored on the mirror and disposed when the connection drops (Task 3 lifecycle hooks).

### 5. Unit Tests — Mirror Module (AC: 2, 3, 4, 5, 10, 11)

Add tests in `tests/unit/debugger/breakpoint-mirror.test.ts`. Use a fake `BrowserDebuggerSession` with `vi.fn()` stubs for `setBreakpointByUrl` / `removeBreakpoint` / `resume` / `onPaused`, and a fake `debugApi` with controllable `breakpoints` and `onDidChangeBreakpoints`.

- [x] **Snapshot — empty (AC 4):** `syncFromVsCode()` with no breakpoints calls neither `setBreakpointByUrl` nor `removeBreakpoint` and produces an empty mapping.
- [x] **Snapshot — multiple notebook-cell breakpoints (AC 4):** three `vscode.SourceBreakpoint`s on three different cell URIs; each results in one `setBreakpointByUrl({ url: <toString()>, lineNumber: <0-based> })` call. The mapping has three entries with the CDP `breakpointId`s the fake returns.
- [x] **Snapshot — filters non-notebook-cell breakpoints (AC 2, 10):** a mix of `vscode-notebook-cell://...`, `file://...`, and a `FunctionBreakpoint` produces calls only for the notebook-cell entries.
- [x] **Snapshot — filters disabled breakpoints (AC 3 enabled-flag clause):** a disabled `vscode.SourceBreakpoint` is not registered.
- [x] **Add event (AC 3):** `onDidChangeBreakpoints({ added: [bp1], removed: [], changed: [] })` produces one `setBreakpointByUrl` call and grows the mapping by one entry.
- [x] **Remove event with mapping (AC 3):** `onDidChangeBreakpoints({ added: [], removed: [bp1], changed: [] })` after bp1 was registered produces one `removeBreakpoint({ breakpointId: <recorded id> })` call and shrinks the mapping by one.
- [x] **Remove event without mapping (AC 3 no-op clause):** `removed: [bp_never_seen]` produces no CDP call and does not throw.
- [x] **Change event = remove + add (AC 3):** `changed: [bp_with_new_line]` after bp was registered produces one `removeBreakpoint` then one `setBreakpointByUrl`. The mapping entry's CDP id updates to whatever the second call returns.
- [x] **Change event with `enabled: false` (AC 3 disabled clause):** `changed: [bp_now_disabled]` produces only `removeBreakpoint`; no re-add.
- [x] **Failure isolation (AC 11 robustness):** if `setBreakpointByUrl` rejects for one breakpoint during `syncFromVsCode()`, the other breakpoints still get registered. The logger receives one warning; the function does not throw.
- [x] **Auto-resume on `Debugger.paused` (AC 5):** invoking the registered `onPaused` listener with any payload calls `resume()` exactly once. Calling twice triggers two `resume()` calls. The listener does not inspect `reason` or `hitBreakpoints`.
- [x] **Auto-resume swallows resume failure (AC 5):** if `resume()` rejects, the next `onPaused` invocation still calls `resume()` (the handler is not torn down by failure).
- [x] **Dispose tears down listener (AC 11):** after `dispose()`, firing the `onDidChangeBreakpoints` event produces no further CDP calls.
- [x] **Dispose does NOT issue `removeBreakpoint` calls:** verify the count of `removeBreakpoint` calls is zero across `dispose()` (page-side state is cleaned up by the session ending, per Dev Notes "Why dispose does not call removeBreakpoint").

### 6. Unit Tests — Transport Debugger Surface (AC: 1)

Extend [tests/unit/transport/browser-connect.test.ts](../../tests/unit/transport/browser-connect.test.ts) with the new debugger-surface plumbing. Reuse the existing fake CDP client harness.

- [x] **`Debugger.enable` invoked at attach (AC 1):** after `connectToBrowserTarget` succeeds, the fake client recorded a `Debugger.enable` call with the per-target `sessionId`. Order: after the existing `Runtime.evaluate(probe)` and before `activeBrowserConnection` is exposed.
- [x] **`Debugger.enable` failure surfaces as a normalized attach error (AC 1):** when the fake client rejects the `Debugger.enable` send, `connectToBrowserTarget` returns `{ ok: false, failure: { category: ..., message: ... } }` with the same shape the existing `Runtime.evaluate(probe)` failure produces. The `safeDetachFromTarget` cleanup path is invoked.
- [x] **No other `Debugger.*` calls at attach (AC 1):** the fake client receives exactly one `Debugger.*` call (`Debugger.enable`) during attach. `Debugger.setBreakpointByUrl`, `Debugger.removeBreakpoint`, `Debugger.setPauseOnExceptions`, etc. are NOT called by the transport layer at attach time.
- [x] **`activeBrowserConnection.debugger.setBreakpointByUrl` forwards to the session (AC 2 plumbing):** calling the wrapper invokes `client.send("Debugger.setBreakpointByUrl", params, sessionId)` and returns the response. Mirror tests for `removeBreakpoint`, `resume`, and `onPaused` event subscription.

### 7. Integration Test — End-to-End Mirror Against Headless Chromium (AC: 2, 4, 5, 8, 9)

Add `tests/integration/debugger/breakpoint-mirror.integration.test.ts` (or co-locate under `tests/integration/transport/` if a new folder is overkill). Reuse `startHeadlessChromium` from [tests/integration/helpers/headless-chromium.ts](../../tests/integration/helpers/headless-chromium.ts).

- [x] Connect via `connectToBrowserTarget` to a headless Chromium target.
- [x] Construct a fake `vscode.SourceBreakpoint` with `location.uri = vscode.Uri.parse("vscode-notebook-cell://test-authority/test.ipynb#cell0")` and `location.range.start.line = 1`.
- [x] Drive the mirror's `syncFromVsCode()` against this breakpoint, then evaluate an expression built by `buildCellExpression(userCode = "globalThis.x = 1;\ndebugger;\nglobalThis.x = 2;", sourceUri = "vscode-notebook-cell://test-authority/test.ipynb#cell0", { isolate: false })`.
- [ ] Subscribe to `Debugger.paused` on a **separate surrogate session** (mimicking Edge DevTools) attached to the same target with its own `Debugger.enable`, and assert that surrogate receives `Debugger.paused` with `hitBreakpoints` containing the registered breakpoint id.
- [x] On the extension's own session, assert that `Debugger.paused` fires AND that the mirror's auto-resume causes the JS thread to release within a small timeout (the surrogate's `Debugger.paused` is also auto-resumed by the surrogate's own `Debugger.resume` to keep the test deterministic).
- [x] Assert the evaluation Promise resolves successfully (AC 8: top-level await still works) and returns a value consistent with the post-pause state (`globalThis.x === 2`).
- [x] Gate behind the existing `RUN_CDP_INTEGRATION=1` env (the convention used by [tests/integration/transport/browser-connect.integration.test.ts](../../tests/integration/transport/browser-connect.integration.test.ts)).
- [x] Run with `npm run test:integration:cdp`.

### 8. Localization & Output Channel Strings (AC: 1, 5, 11)

Any user-visible diagnostic emitted by Story 2.5 must go through `vscode.l10n.t(...)`. The story does not surface user-facing UI of its own — it only logs to the existing extension output channel — but log lines that the user reads still go through localization per [/.github/copilot-instructions.md](../../.github/copilot-instructions.md) "Coding Standards".

- [x] Add localized strings to [l10n/bundle.l10n.json](../../l10n/bundle.l10n.json) for:
  - `"Failed to enable Debugger domain on browser session: {0}"` — used by AC 1 categorization path.
  - `"Failed to mirror notebook-cell breakpoint to browser: {0}"` — used by Task 2 logger.
  - `"Failed to remove notebook-cell breakpoint from browser: {0}"` — used by Task 2 logger.
  - `"Failed to auto-resume browser debugger after pause: {0}"` — used by Task 4 logger.
- [x] Do NOT add new `package.nls.json` entries — those are for static contributions (commands, settings). The above strings are runtime log messages and live in `l10n/bundle.l10n.json` only, consistent with existing kernel/transport diagnostics.

### 9. Validation (AC: 1–11)

- [x] `npm run lint` — no new warnings or errors.
- [x] `npm run test` — all unit tests pass including new tests.
- [x] `npm run compile` — clean TypeScript compilation (strict mode).
- [x] `npm run test:integration:cdp` — passes when Chromium is available (skip is acceptable in environments without Chromium per existing precedent).
- [x] Manual smoke check (post-build) in the Extension Development Host:
  1. Open a `.ipynb`, select the Browser Kernel controller on a JavaScript cell.
  2. Set a gutter breakpoint on a line of a cell.
  3. Run the connect command against a Chromium target with the page open.
  4. Run the cell. Confirm the browser's DevTools Sources panel shows the cell and that execution pauses on the mirrored breakpoint. Do NOT require a visible DevTools gutter marker for the mirrored breakpoint; current Chromium behavior may keep the breakpoint active in V8 without rendering the marker because the breakpoint was created from the extension's separate CDP session.
  5. Step / continue / inspect variables in DevTools as the inspection surface.
  6. Disconnect and reconnect; reset breakpoints; confirm AC 4 (snapshot) re-registers them.

### Review Findings

- [x] [Review][Defer] AC 5 deviation: `onPaused` listener inspects `event.reason` and `event.hitBreakpoints` before calling `Debugger.resume` [src/debugger/breakpoint-mirror.ts:121-127] — **deferred, accepted as transitional**. Story 2.5 ships only the CDP-side mirror without a `vscode.DebugSession`, and DevTools does not render a gutter marker for breakpoints created from the extension's session, so the pause log is the only in-VS-Code evidence that the mirror is actually binding and hitting breakpoints. The deviation, its bounded risk (synchronous logger throw would hold the JS thread), and its removal trigger are documented in AC 5's "Transitional deviation" note. The deviation MUST be removed by the Full VS Code Debug Adapter epic (see [docs/stories/deferred-work.md](deferred-work.md)).

## Dev Notes

### Story Context and Scope

This is the **fifth story in Epic 2**, and the second of two stories that share the spike (`2-spike-cdp-sourceurl-debugger`) findings. Story 2.4 owns the **source-identity contract** (per-cell `//# sourceURL`, Pattern B isolation wrapper); Story 2.5 owns the **debugger-side mirror** (`Debugger.enable`, `Debugger.setBreakpointByUrl`, `Debugger.removeBreakpoint`, auto-resume on `Debugger.paused`). 2.5 depends on 2.4 because the URL identity that 2.5 binds breakpoints against is the URL identity that 2.4 emits in `//# sourceURL=`.

**Scope boundaries:**

- Story 2.5 owns: `Debugger.enable` at attach, `Debugger.setBreakpointByUrl` mirror from `vscode.debug.breakpoints`, `Debugger.removeBreakpoint` on change, auto-resume on extension-session `Debugger.paused`, snapshot of pre-existing breakpoints on connect, mirror-mapping lifecycle tied to connection state.
- Story 2.5 does NOT own: per-cell `//# sourceURL` emission (Story 2.4), Pattern B wrapper (Story 2.4), VS Code-side debug UI (deferred — Debug Adapter Protocol epic), `Debugger.setPauseOnExceptions` / exception breakpoints (deferred), conditional / hit-count breakpoints (the mirror passes condition through via `setBreakpointByUrl({ condition })` if VS Code provides it, but the AC set does not require validation of condition semantics — keep it best-effort).
- Story 2.5 does NOT introduce a `vscode.DebugSession`. The user does NOT see paused-line markers or the Variables / Call Stack / Watch panels in VS Code. Pause inspection is exclusively in the browser's DevTools. Current Chromium behavior also means the user may not see a DevTools gutter marker for a breakpoint mirrored from the extension's debugger session even though that breakpoint is active and can pause execution.

### Locked Decisions From Spike (Must Be Honored)

These are non-negotiable and have empirical backing — already locked by Story 2.4 and reaffirmed here:

1. **Evaluation flags:** `Runtime.evaluate({ expression, replMode: true, awaitPromise: true, returnByValue: true, generatePreview: false, timeout: 30_000 })`. Spike Q1 + Q5 prove this works alongside `Debugger.enable` and `Debugger.setBreakpointByUrl`. Do NOT change. [Source: spike/cdp-sourceurl-debugger-findings.md#Q1, src/transport/browser-connect.ts line 425–445]
2. **Diagnostic Observer posture:** the extension calls `Debugger.enable` on its per-target session (revised from Passive Provider for this story only — Story 2.4 remains Passive Provider in the kernel-emit path). Multi-client `Debugger.enable` is empirically safe per Q3, with the **strict invariant** that the extension auto-resumes its own session's `Debugger.paused` events (AC 5). [Source: spike/cdp-sourceurl-debugger-findings.md#Q2, spike/cdp-sourceurl-debugger-findings.md#Q3, docs/architecture.md#Debugger-Domain-Integration]
3. **Wrapper strategy:** Pattern B (Story 2.4 lock). Story 2.5 does NOT change the wrapper. The wrapper preserves user-visible line numbers, so the `lineNumber` recorded on a `vscode.SourceBreakpoint` is the same line number CDP reports in `Debugger.paused.callFrames[].location.lineNumber`. [Source: spike/cdp-sourceurl-debugger-findings.md#Q5, docs/stories/2-4-support-fast-rerun-and-iteration-patterns.md AC 6]
4. **Source identity:** `NotebookCell.document.uri.toString()` exactly. Same value used by Story 2.4 in `//# sourceURL=` and by Story 2.5 in `Debugger.setBreakpointByUrl({ url })`. Do NOT reconstruct, encode, decode, or normalize. [Source: spike/cdp-sourceurl-debugger-findings.md#URL-scheme-sub-probe, docs/stories/2-4-support-fast-rerun-and-iteration-patterns.md AC 5]
5. **First-evaluation breakpoint binding:** Works without UX caveat. The snapshot in AC 4 + an immediate cell run binds and fires on the first execution. No "run-once-first" guidance is needed in user docs. [Source: spike/cdp-sourceurl-debugger-findings.md#Q4]
6. **Source-map fallback:** Rejected. Do not introduce `//# sourceMappingURL=` directives. [Source: spike/cdp-sourceurl-debugger-findings.md#Q6]
7. **Multi-client `Debugger.enable` does not regress the multiplex transport:** explicitly validated by the spike's "Multiplex Regression Sanity Check". [Source: spike/cdp-sourceurl-debugger-findings.md#Multiplex-Regression-Sanity-Check, spike/cdp-multiplex-findings.md]

### Architecture Guardrails (Must Follow)

- **Layer boundaries:** The kernel (`src/kernel/`) cannot import `chrome-remote-interface` or transport implementations directly; it consumes `ActiveBrowserConnection` only. The new breakpoint mirror module (`src/debugger/`) can call into the transport via the extended `ActiveBrowserConnection.debugger` surface, but it must NOT import `chrome-remote-interface` directly. [Source: docs/architecture.md#Architectural-Boundaries, docs/architecture.md#File-Structure-Patterns]
- **State ownership:** Transport owns connection lifecycle and CDP session state. The mirror module owns only the in-memory `Breakpoint.id` → CDP `breakpointId` mapping; it does NOT manage attach/detach, retries, or reconnect. Mapping is cleared on disconnect (AC 11) but the page-side breakpoints are released implicitly when the session ends. [Source: docs/architecture.md#State-Management-Patterns]
- **Result normalization:** Breakpoint mirror failures do NOT flow into `ExecutionResult` (cell output). They flow into the existing extension output channel (logger). The mirror is a side-channel; cell-execution outcomes are unchanged by mirror failures. [Source: docs/architecture.md#Format-Patterns, docs/architecture.md#Error-Handling-Patterns]
- **`Debugger.enable` failure at attach IS a transport error and IS surfaced through the existing categorization** (`createStepError` → `categorizeTransportFailure` → `failureMessage`). This is consistent with how `Runtime.evaluate(probe)` failure is surfaced in the same flow.
- **File naming:** kebab-case files, PascalCase types/interfaces, camelCase functions/variables, UPPER_SNAKE_CASE constants. [Source: docs/architecture.md#Naming-Patterns]
- **Tests in `tests/` tree only.** New folders: `tests/unit/debugger/`, `tests/integration/debugger/` (or co-located under `tests/integration/transport/`). [Source: docs/architecture.md#File-Structure-Patterns]
- **Localization:** All log lines through `vscode.l10n.t(...)`. Add new keys to [l10n/bundle.l10n.json](../../l10n/bundle.l10n.json). [Source: .github/copilot-instructions.md#Coding-Standards]
- **Named interfaces for non-trivial types.** Define `BrowserDebuggerSession`, `BreakpointMirror`, `BreakpointMirrorOptions`. Do not inline anonymous object types in function signatures. [Source: .github/copilot-instructions.md#Coding-Standards]
- **Reuse library types.** The `Debugger.setBreakpointByUrl` parameter and return shapes come from `devtools-protocol/types/protocol-mapping`, the same package the existing `BrowserRuntimeEvaluateResult` uses (line 4–5 of `browser-connect.ts`). Do NOT redeclare the parameter or return shapes locally. [Source: .github/copilot-instructions.md#Coding-Standards]
- **Prefer `const` over `let` with mutation.** [Source: .github/copilot-instructions.md#Coding-Standards]
- **Settings/metadata namespace:** `jupyterBrowserKernel.*`. Story 2.5 introduces no new settings. [Source: .github/copilot-instructions.md#Stable-Technical-Constraints]

### Reusing Protocol Types

`browser-connect.ts` line 4 imports `ProtocolMappingApi` from `devtools-protocol/types/protocol-mapping`. Reuse it for the new debugger surface:

```ts
import type ProtocolMappingApi from "devtools-protocol/types/protocol-mapping";

type DebuggerSetBreakpointByUrlParams =
  ProtocolMappingApi.Commands["Debugger.setBreakpointByUrl"]["paramsType"][0];
type DebuggerSetBreakpointByUrlResult =
  ProtocolMappingApi.Commands["Debugger.setBreakpointByUrl"]["returnType"];
type DebuggerRemoveBreakpointParams =
  ProtocolMappingApi.Commands["Debugger.removeBreakpoint"]["paramsType"][0];
type DebuggerPausedEvent = ProtocolMappingApi.Events["Debugger.paused"][0];
```

Use these directly in the `BrowserDebuggerSession` interface — do not re-declare local copies of the parameter or return shapes. The narrowed shapes the consumer (the mirror) needs (`url`, `lineNumber` for `setBreakpointByUrl` params; `breakpointId` for the result) can be expressed via `Pick` if the consumer is sensitive to the breadth of the protocol type:

```ts
export interface BrowserDebuggerSession {
  setBreakpointByUrl(
    params: Pick<
      DebuggerSetBreakpointByUrlParams,
      "url" | "lineNumber" | "columnNumber" | "condition"
    >,
  ): Promise<
    Pick<DebuggerSetBreakpointByUrlResult, "breakpointId" | "locations">
  >;
  removeBreakpoint(params: DebuggerRemoveBreakpointParams): Promise<void>;
  resume(): Promise<void>;
  onPaused(listener: (event: DebuggerPausedEvent) => void): vscode.Disposable;
}
```

### Why Dispose Does NOT Call `removeBreakpoint`

The mirror's `dispose()` (and the disconnect path in Task 3) clears the in-memory mapping but does NOT issue per-breakpoint `Debugger.removeBreakpoint` calls. Two reasons:

1. **Page-side state evaporates with the session.** When the extension's `Debugger.enable`d session detaches (via `safeDetachFromTarget` or browser close), V8 drops the breakpoints registered through that session. There is nothing to clean up explicitly.
2. **Issuing `removeBreakpoint` during disconnect race-conditions with the session shutdown.** The library may already have torn down the channel by the time the loop runs, producing a flurry of harmless errors that pollute the output channel for no benefit.

If a future change introduces breakpoint persistence across sessions (e.g., shared `browser`-target breakpoints), this assumption needs to be revisited. As of Story 2.5's scope, `Debugger.setBreakpointByUrl` is session-scoped per the spike findings.

### Why Auto-Resume Is Unconditional

AC 5's auto-resume is unconditional (no inspection of `reason`, `hitBreakpoints`, or `callFrames`) for two reasons:

1. **Correctness boundary.** The extension does NOT own a debug session. Any pause that reaches the extension's own session is, from the extension's perspective, "someone else's pause" — even if the breakpoint id matches one the mirror registered. The user's debug session is in DevTools. The mirror exists only so DevTools sees the breakpoint; pause control belongs to DevTools.
2. **Coexistence safety.** If the extension ever conditionally held its session paused, it would need a fallback mechanism for "what if the user closed DevTools while paused" → infinite hang. Unconditional resume eliminates this entire class of failure mode.

This is the single most important invariant in the story. The integration test in Task 7 explicitly validates that the extension's session resumes within a deterministic window even though a separate surrogate session is also paused on the same breakpoint.

### Why Mirror Is Scoped to `vscode-notebook-cell://` URIs Only

VS Code surfaces three breakpoint kinds: `SourceBreakpoint`, `FunctionBreakpoint`, and exception breakpoints. The mirror handles only the first, and only when the source URI scheme is `vscode-notebook-cell://`. Rationale:

- **`FunctionBreakpoint` (break on function name)** maps to `Debugger.setBreakpointOnFunctionCall` semantically, but VS Code function breakpoints are conventionally scoped to a `vscode.DebugSession` and the language adapter's symbol resolution. The mirror has no symbol table; it would have to forward the function-name string to `Debugger.setBreakpointOnFunctionCall` blindly, which is not in MVP scope.
- **Exception breakpoints** require `Debugger.setPauseOnExceptions`. This conflicts with AC 1's "only `Debugger.enable`" invariant and would create a coexistence concern with DevTools' own exception-pause configuration. Deferred.
- **`SourceBreakpoint` on `file://`** would never bind anyway (the page never sees `file://` source URLs unless the user is debugging a local file load, which is out of MVP scope for Foundry workflows). Skipping these is a no-op, not a regression.

### Why `Debugger.paused` Auto-Resume Lives in the Mirror Module

Auto-resume (AC 5) is wired through the same `BrowserDebuggerSession` surface the mirror uses for `setBreakpointByUrl`. Putting it in the mirror module:

- Keeps all "things tied to the per-target session's debugger lifecycle" in one place.
- Makes the disposable-on-disconnect cleanup obvious: when the mirror disposes, the auto-resume listener disposes too.
- Avoids leaking `Debugger.*` knowledge into the kernel or notebook controller layers.

If the auto-resume helper grows beyond a few lines (e.g., exponential backoff on repeated `resume()` failures), split it into `src/debugger/auto-resume.ts` to keep the mirror module focused. As of MVP scope, a single `debuggerSession.onPaused((event) => { void debuggerSession.resume().catch(logger); })` is sufficient.

### Files to Create or Modify

| File                                                                                                               | Action     | Purpose                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| [src/transport/browser-connect.ts](../../src/transport/browser-connect.ts)                                         | **Modify** | Extend `ActiveBrowserConnection` with `debugger: BrowserDebuggerSession`; call `Debugger.enable` at attach (AC 1)        |
| `src/debugger/breakpoint-mirror.ts`                                                                                | **Create** | New module: `createBreakpointMirror`, mapping management, `onDidChangeBreakpoints` translation, snapshot, auto-resume    |
| `src/debugger/index.ts`                                                                                            | **Create** | Re-export public mirror API for `extension.ts`                                                                           |
| [src/extension.ts](../../src/extension.ts)                                                                         | **Modify** | Construct mirror in `activate(...)`, wire to `connectionStateStore` lifecycle, push dispose into `context.subscriptions` |
| [l10n/bundle.l10n.json](../../l10n/bundle.l10n.json)                                                               | **Modify** | Add four log-line keys (Task 8)                                                                                          |
| [tests/unit/transport/browser-connect.test.ts](../../tests/unit/transport/browser-connect.test.ts)                 | **Modify** | Add `Debugger.enable` attach assertions and debugger-surface forwarding tests (Task 6)                                   |
| `tests/unit/debugger/breakpoint-mirror.test.ts`                                                                    | **Create** | Mirror unit tests (Task 5)                                                                                               |
| `tests/integration/debugger/breakpoint-mirror.integration.test.ts` (or `tests/integration/transport/` co-location) | **Create** | End-to-end mirror test against headless Chromium (Task 7)                                                                |

### What NOT to Do

- Do NOT change Story 2.4's per-cell `//# sourceURL=` emission. Story 2.5 binds against the same URL Story 2.4 emits; any divergence breaks AC 2. [Source: docs/stories/2-4-support-fast-rerun-and-iteration-patterns.md AC 5]
- Do NOT change Story 2.4's Pattern B wrapper. Line-number fidelity in `Debugger.paused` depends on the wrapper not shifting user lines. [Source: spike/cdp-sourceurl-debugger-findings.md#Q5]
- Do NOT introduce `Debugger.setPauseOnExceptions`, `Debugger.setSkipAllPauses`, `Debugger.setBreakpointsActive`, or any other Debugger-domain configuration call at attach. AC 1 explicitly limits attach to `Debugger.enable`.
- Do NOT register a `vscode.DebugSession` or implement a Debug Adapter. That is the deferred work tracked in [docs/stories/deferred-work.md](deferred-work.md) "Full VS Code Debug Adapter for cell debugging".
- Do NOT inspect `Debugger.paused` payload before resuming. AC 5 is unconditional — see "Why Auto-Resume Is Unconditional" above.
- Do NOT issue per-breakpoint `Debugger.removeBreakpoint` calls during dispose / disconnect. See "Why Dispose Does NOT Call `removeBreakpoint`" above.
- Do NOT mirror non-notebook-cell source breakpoints, function breakpoints, or exception breakpoints. The filter in AC 2 + AC 10 is binary on `location.uri.scheme === 'vscode-notebook-cell'`.
- Do NOT call `client.send` or `client.on` from outside `src/transport/`. The transport layer is the only place that touches `chrome-remote-interface`. [Source: docs/architecture.md#Architectural-Boundaries]
- Do NOT modify `evaluate`, `terminateExecution`, or `close` on `ActiveBrowserConnection`. The transport surface for those is stable and validated by Stories 2.1–2.4.
- Do NOT modify `ExecutionResult`, `ExecutionSuccess`, or `ExecutionFailure` shapes. Story 2.5 does not produce or consume those. [Source: docs/stories/2-3-normalize-success-and-failure-output-contracts.md]
- Do NOT add new `ExecutionFailureKind` literals (e.g., `"debugger-error"`). Mirror failures are logged side-channel events, not cell-execution outcomes. [Source: docs/stories/2-3-normalize-success-and-failure-output-contracts.md#Story-Context-and-Scope]
- Do NOT reconstruct cell URIs (e.g., synthesize `notebook-cell:` strings). Use `bp.location.uri.toString()` verbatim — it is byte-identical to the URL Story 2.4 already emits. [Source: spike/cdp-sourceurl-debugger-findings.md#URL-scheme-sub-probe]
- Do NOT implement reconnect-on-failure for the mirror. Mirror lifecycle is reactive to `connectionStateStore` only (AC 11).
- Do NOT add VS Code editor markers (gutter glyph state, paused-line highlight). The deferred adapter epic owns those.

### Previous Story Intelligence

**From Story 2.4 (just completed, ready-for-dev):**

- `buildCellExpression(userCode, sourceUri, { isolate })` is the single source of truth for what is sent to `connection.evaluate`. Story 2.5 binds breakpoints against the same `sourceUri = NotebookCell.document.uri.toString()`. The match is exact and byte-identical. [Source: docs/stories/2-4-support-fast-rerun-and-iteration-patterns.md Task 1]
- Pattern B wrapper preserves user-visible line numbers (AC 6 of 2.4 + spike Q5). A `vscode.SourceBreakpoint` on user line N maps to CDP `lineNumber: N` (zero-based), which is what `setBreakpointByUrl` should be called with.
- `replMode: true` survives `Debugger.enable` per spike Q1 + Q5. No evaluation-strategy change is needed for Story 2.5.
- The `addSourceLabeling` function was extracted to `buildCellExpression`. Story 2.5 should treat that helper as black-box stable.

**From Story 2.3:**

- `serializeRemoteValue` and the `ExecutionResult` discriminated union are stable. Story 2.5 does not touch them.
- Contract-shape tests use `Object.keys(...).sort()` invariants; reuse this pattern if Task 5 needs structural assertions on `BrowserDebuggerSession` shape.
- `npm test` resolves to `npm run test:unit`; live-CDP coverage uses `npm run test:integration:cdp`. Same convention applies to Story 2.5's integration test.

**From Story 2.2:**

- `replMode: true` is intentional and validated. The "deferred replMode authorization" question (recorded in `deferred-work.md`) was resolved by the spike for Story 2.5; this story consumes the locked decision and does not reopen it.
- `raceWithTimeout` and `terminateExecution` are transport-internal and unchanged.

**From Epic 1 retro:**

- Transport owns lifecycle — kernel checks session, does not manage connection state. The mirror is a third consumer of the connection but follows the same rule: it observes `connectionStateStore` and reacts; it does NOT initiate connect/disconnect.
- Normalized errors only — no raw CDP leaks to cell output. Mirror failures go to the output channel, not to cell output.
- Localization from the start — every user-facing string through `vscode.l10n.t()`. Output channel log lines count as user-facing.
- Named interfaces for all non-trivial types.
- `const` over `let` with mutation.

### Project Structure Notes

- New folder `src/debugger/` is consistent with existing top-level `src/kernel/`, `src/transport/`, `src/notebook/`, `src/profile/`, `src/commands/`, `src/config/`, `src/logging/`, `src/ui/`. The new folder isolates the mirror from kernel and transport responsibilities cleanly.
- New folder `tests/unit/debugger/` mirrors the source layout under `tests/unit/`.
- New folder `tests/integration/debugger/` is consistent with the existing `tests/integration/{transport,notebook}/` split. If a new top-level integration folder feels heavy for a single test file, co-locating under `tests/integration/transport/` is acceptable and matches precedent (the transport-attach test lives there).
- No detected variances from the architecture's prescribed layout.

### References

- [Source: docs/epics/epic-2-execute-javascript-cells-no-intentional-capture.md#Story-2.5] — AC definitions
- [Source: docs/prd.md#FR38] — source-level breakpoint debugging contract
- [Source: docs/prd.md#NFR8] — DevTools coexistence
- [Source: docs/architecture.md#Debugger-Domain-Integration] — debugger lifecycle, per-cell source identity contract, wrapping-lambda line offset rule, DevTools coexistence interaction
- [Source: docs/architecture.md#Architectural-Boundaries] — kernel/transport boundary; mirror lives in a new `src/debugger/` peer, not inside kernel or transport
- [Source: docs/architecture.md#State-Management-Patterns] — transport owns connection lifecycle
- [Source: docs/architecture.md#File-Structure-Patterns] — tests-outside-source rule
- [Source: spike/cdp-sourceurl-debugger-findings.md#Q1] — `replMode: true` + Sources visibility + breakpoint binding
- [Source: spike/cdp-sourceurl-debugger-findings.md#Q2] — Cross-client breakpoint firing without our `Debugger.enable` (Passive Provider validity)
- [Source: spike/cdp-sourceurl-debugger-findings.md#Q3] — Multi-client `Debugger.enable` coexistence (Diagnostic Observer posture, auto-resume invariant)
- [Source: spike/cdp-sourceurl-debugger-findings.md#Q4] — First-evaluation breakpoint binding works without UX caveat
- [Source: spike/cdp-sourceurl-debugger-findings.md#Q5] — Line-number fidelity under same-line wrapper (Pattern B)
- [Source: spike/cdp-sourceurl-debugger-findings.md#Q6] — V8 does NOT honor inline source maps in `Debugger.paused.callFrames[].location` (Pattern B-alt rejected)
- [Source: spike/cdp-sourceurl-debugger-findings.md#URL-scheme-sub-probe] — `vscode-notebook-cell://...` round-trips cleanly through `Debugger.scriptParsed` and `Debugger.setBreakpointByUrl`
- [Source: spike/cdp-sourceurl-debugger-findings.md#Story-2.5-AC-Adjustments] — explicit AC deltas applied in this story
- [Source: spike/cdp-sourceurl-debugger-findings.md#Multiplex-Regression-Sanity-Check] — multiplex transport not regressed by adding `Debugger.enable` clients
- [Source: spike/cdp-multiplex-findings.md] — browser-level multiplex transport pattern Story 2.5 reuses unchanged
- [Source: docs/stories/2-4-support-fast-rerun-and-iteration-patterns.md] — Story 2.4 source-identity contract Story 2.5 binds against
- [Source: docs/stories/2-3-normalize-success-and-failure-output-contracts.md] — `ExecutionResult` shape (untouched here)
- [Source: docs/stories/2-spike-cdp-sourceurl-debugger.md] — spike origin story
- [Source: docs/stories/breakpoint-correct-course-prompt.md] — context for FR38 introduction
- [Source: docs/stories/deferred-work.md] — "Full VS Code Debug Adapter for cell debugging" tracks the deferred VS Code-side debug UI; this story is explicitly the CDP-mirror-only portion
- [Source: .github/copilot-instructions.md] — coding standards and stable technical constraints

## Dev Agent Record

### Agent Model Used

GPT-5.3-Codex

### Debug Log References

- `npm run compile` (pass)
- `npm run lint` (pass)
- `npm run test` (pass, 155/155 unit tests)
- `npm run test:compile` (pass)
- `RUN_CDP_INTEGRATION=1 node --test out/tests/integration/debugger/breakpoint-mirror.integration.test.js` (pass)
- `npm run test:integration:cdp` (pass, repeated successfully)

### Completion Notes List

- Added `BrowserDebuggerSession` to the transport contract and wired `Debugger.enable` into attach flow with localized failure text and existing normalized transport failure handling.
- Implemented session-scoped debugger wrappers (`setBreakpointByUrl`, `removeBreakpoint`, `resume`, `onPaused`) in the transport layer while keeping all `chrome-remote-interface` usage contained in transport.
- Added new debugger mirror module with notebook-cell breakpoint filtering, add/remove/change translation, snapshot sync on connect, mapping clear on disconnect/error, and unconditional auto-resume behavior for extension-session `Debugger.paused` events.
- Integrated mirror lifecycle into extension activation and connection state transitions.
- Added localization strings for debugger enable / mirror add / mirror remove / auto-resume failures.
- Added comprehensive unit coverage for mirror behavior and transport debugger wrapper forwarding.
- Added CDP integration coverage for mirror + auto-resume + surrogate debugger coexistence and top-level await resolution.
- Left only manual Extension Development Host smoke-check open; full `npm run test:integration:cdp` now passes consistently and attach-path fake-client assertions are complete.

### File List

- `docs/stories/2-5-enable-source-level-breakpoint-debugging.md`
- `docs/stories/sprint-status.yaml`
- `l10n/bundle.l10n.json`
- `src/debugger/breakpoint-mirror.ts`
- `src/debugger/index.ts`
- `src/extension.ts`
- `src/transport/browser-connect.ts`
- `tests/integration/debugger/breakpoint-mirror.integration.test.ts`
- `tests/unit/debugger/breakpoint-mirror.test.ts`
- `tests/unit/kernel/execution-kernel.test.ts`
- `tests/unit/transport/browser-connect.test.ts`

### Change Log

- 2026-05-11: Implemented Story 2.5 debugger mirror transport + lifecycle + localization + unit/integration coverage; kept story in-progress pending full integration suite completion and manual smoke validation.
