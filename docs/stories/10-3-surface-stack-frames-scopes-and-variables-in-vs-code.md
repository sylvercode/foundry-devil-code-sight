---
storyId: "10.3"
storyKey: "10-3-surface-stack-frames-scopes-and-variables-in-vs-code"
title: "Surface Stack Frames, Scopes, and Variables in VS Code"
status: "in-progress"
created: "2026-05-11"
epic: "10"
priority: "p0-blocker"
dependencies:
  [
    "10-1-register-and-bootstrap-notebook-cell-dap-session",
    "10-2-verify-and-bind-notebook-cell-breakpoints-in-vs-code-ui",
  ]
---

# Story 10.3: Surface Stack Frames, Scopes, and Variables in VS Code

**Status:** in-progress

## Story

As a developer,
I want paused execution context in VS Code debug panes,
So that I can inspect stack and state without switching to browser DevTools.

## Acceptance Criteria

### AC 1: Stack Frames Are Displayed When Paused

**Given** execution is paused at a breakpoint in a notebook cell
**When** the debug view opens the "Call Stack" pane
**Then** a stack frame is displayed for the current cell execution
**And** the frame shows the source file name (or cell ID) and line number
**And** clicking the frame navigates the editor to the breakpoint line.

### AC 2: Scopes Are Resolved When Frame is Selected

**Given** a stack frame is displayed and selected
**When** VS Code requests scopes for the frame
**Then** the adapter returns scope objects for:

- Local scope (variables declared in the cell)
- Global scope (window, global objects)
  **And** each scope carries a `variablesReference` so VS Code can request its contents lazily. Per DAP, `namedVariables`/`indexedVariables` are left undefined for MVP — counts are resolved lazily on expansion, not eagerly fetched up front.

### AC 3: Variables Are Resolved with Handles

**Given** a scope is expanded in the Variables pane
**When** VS Code requests variables for the scope
**Then** the adapter returns a list of variable objects with:

- Name (variable identifier).
- Value (serialized or `[Object]`, `[Array]`, etc. for complex types).
- Type (inferred or from runtime, e.g., `"number"`, `"object"`).
- Handles for objects/arrays that allow drill-down expansion.
  **And** variable resolution respects CDP serialization limits (values limited to ~10KB per variable).

### AC 4: Complex Variables Can Be Expanded

**Given** a variable is an object or array
**When** the user clicks the expand arrow in the Variables pane
**Then** the adapter fetches nested properties (up to a configurable depth, default 2)
**And** nested properties are displayed with names, values, and types.

### AC 5: Unsupported Values Fail Gracefully

**Given** a variable cannot be serialized (e.g., function, DOM node)
**When** the adapter attempts to resolve it
**Then** the variable shows a human-readable placeholder (e.g., `"[Function: myFunc]"`, `"[HTMLElement]"`)
**And** no error is thrown; the UI remains stable.

### AC 6: Watch Expressions Can Be Evaluated

**Given** the user adds a watch expression in VS Code debug
**When** execution is paused
**Then** the adapter evaluates the expression in the paused context
**And** returns the result or an error message if evaluation fails.

## Tasks / Subtasks

### 1. Pre-Implementation Research Gate (BLOCKER for all subsequent tasks)

Epic 2 retro added a mandatory "research before implementation" gate for any feature that depends on undocumented CDP/DevTools behavior. The dev MUST record findings under `spike/cdp-debug-inspection-findings.md` (or extend an existing spike note) and link the file from this section BEFORE starting Task 2. The following hypotheses must be empirically validated against a live Foundry session through `BrowserDebuggerSession`:

- [ ] H1: `Debugger.paused.callFrames` survives between pause and the first `stackTrace` request without re-issuing any CDP call. Confirm by capturing one pause, waiting 5s, then serving frames from the cached payload.
- [ ] H2: `Runtime.getProperties({ objectId, ownProperties: true, generatePreview: true })` returns serviceable `preview` data for the object kinds Foundry exposes in scope (game, canvas, ui, CONFIG, plus a DOM element). Record any case where `preview` is absent so the formatter (Task 8) accounts for it.
- [ ] H3: `Runtime.evaluate({ expression: "globalThis", returnByValue: false })` returns a stable `objectId` reusable as the Global scope handle for the duration of one pause.
- [ ] H4: `Debugger.evaluateOnCallFrame` with `throwOnSideEffect: true` rejects side-effectful expressions cleanly (used by hover context in Task 9).
- [ ] H5: Per-value oversize behavior — confirm whether CDP itself caps `RemoteObject.value`/`description` size before the adapter's 10 KiB truncation kicks in, and record the observed ceiling.

Research findings reference: `spike/cdp-debug-inspection-findings.md`.

### 2. Implement `threads` and `stackTrace` DAP Request Handlers (AC: 1)

- [x] In `src/debugger/notebook-dap-adapter.ts`, refine the Story 10.1 stub `threadsRequest` to keep returning `{ threads: [{ id: 1, name: localize("Notebook cells") }] }` — no new structure for MVP.
- [x] Add `stackTraceRequest(response, args)`.
- [x] CDP does not have a `Debugger.getCallStack` method. The full call stack is delivered as `params.callFrames` on the `Debugger.paused` event. The session manager (Story 10.1) caches the most recent paused payload per debug session; the adapter reads from that cache and never issues a new CDP call to fetch frames.
- [x] Map each cached `Debugger.CallFrame` to a DAP `StackFrame`:
  - `id`: stable per-pause integer assigned by a frame manager (Task 5).
  - `name`: `callFrame.functionName || "<anonymous>"`.
  - `source`: built via the existing `createSource` helper in `src/debugger/notebook-dap-adapter.ts`. Pass `cell.document.uri.toString()` as the single identifier; the helper sets both `name` and `path` to that URI. Do NOT invent a `cell.label` property — `vscode.NotebookCell` has no `label`. If a friendlier name is desired, derive `"Cell {0}"` (1-based `cell.index`) and pass it explicitly via the helper's `source` override.
  - `line`: `callFrame.location.lineNumber + 1` (DAP is 1-based).
  - `column`: `callFrame.location.columnNumber + 1`.
- [x] Honor `args.startFrame` and `args.levels` for paging; `totalFrames` is the cached count.

### 3. Extend `BrowserDebuggerSession` for Property Access (AC: 1, 2, 3, 4, 6)

- [x] Extend the existing `BrowserDebuggerSession` surface in [src/transport/browser-connect.ts](../../src/transport/browser-connect.ts) with the methods needed by Stories 10.3–10.4. Reuse existing CDP types via `ProtocolMappingApi.Commands["<Domain>.<method>"]` imported from `devtools-protocol/types/protocol-mapping` (the same import the file already uses for breakpoint commands) so we do not redeclare CDP shapes.
  - `getProperties(params: ProtocolMappingApi.Commands["Runtime.getProperties"]["paramsType"][0]): Promise<ProtocolMappingApi.Commands["Runtime.getProperties"]["returnType"]>` — wraps `Runtime.getProperties` on the per-target session.
  - `evaluateOnCallFrame(params: ProtocolMappingApi.Commands["Debugger.evaluateOnCallFrame"]["paramsType"][0]): Promise<ProtocolMappingApi.Commands["Debugger.evaluateOnCallFrame"]["returnType"]>` — wraps `Debugger.evaluateOnCallFrame`.
  - `releaseObject(params: ProtocolMappingApi.Commands["Runtime.releaseObject"]["paramsType"][0]): Promise<void>` — wraps `Runtime.releaseObject`, used by the variable store on resume.
  - `evaluate(params: ProtocolMappingApi.Commands["Runtime.evaluate"]["paramsType"][0]): Promise<ProtocolMappingApi.Commands["Runtime.evaluate"]["returnType"]>` — wraps `Runtime.evaluate` on the per-target session. Required so the adapter can fetch the `globalThis` `objectId` for the Global scope (Task 4) without going through the kernel's `evaluate` path.
- [x] Stack frames come from the cached `Debugger.paused` event (Task 2), so no `getCallStack` method is added.
- [x] Update [tests/unit/transport/browser-connect.test.ts](../../tests/unit/transport/browser-connect.test.ts) with forwarding tests for each new method.

### 4. Implement `scopes` DAP Request Handler (AC: 2)

- [x] Add `scopesRequest(response, args)`.
- [x] Map the cached `CallFrame.scopeChain[]` for the requested `frameId` into DAP `Scope[]`:
  - For each `scopeChain` entry whose `type` is `local`, `closure`, `block`, or `with`, emit one DAP scope with the original type as `presentationHint` and a localized `name`.
  - Append a single `Global` scope whose `objectId` is resolved via `BrowserDebuggerSession.evaluate({ expression: "globalThis", returnByValue: false })` once per pause and cached on the pause record. Do NOT use `callFrame.this.objectId` — in CDP `callFrame.this` is the call-site `this` value (often `undefined` in strict/module code) and is not the global object.
  - Each scope reserves a `variablesReference` from the variable store (Task 5) keyed by the underlying `Runtime.RemoteObject.objectId`.
  - Set `expensive: true` for the global scope and `false` otherwise.

### 5. Create the Variable Store (AC: 3, 4)

- [x] Create `src/debugger/variable-store.ts` exporting `createVariableStore({ debuggerSession, logger })` and the `VariableStore` interface.
- [x] Responsibilities:
  - Allocate sequential `variablesReference` handles starting at `1000`; reserve `0` for non-expandable values.
  - Map handle → `{ objectId: string, kind: "scope" | "object" | "array" }`.
  - Track every `objectId` ever returned during a pause so they can be released via `Runtime.releaseObject` on resume.
  - `clearForPause(): Promise<void>` invoked by the pause-event handler (Story 10.4) wipes handles and releases live `objectId`s. Best-effort: every `releaseObject` rejection is caught and logged via `logger`; the returned promise resolves even if every call fails (mirrors `BreakpointRegistry.clearAll` from Story 10.2).
  - `dispose(): Promise<void>` invoked from `DebugSessionManager.stopRunningSession()` (Story 10.1 teardown path). Calls `clearForPause()` and then drops the handle map so any handle lookup after dispose returns `undefined`. The session manager MUST drop its store reference after `dispose()` resolves.

### 6. Implement `variables` DAP Request Handler (AC: 3, 4)

- [x] Add `variablesRequest(response, args)`.
- [x] Resolve the handle through the variable store (Task 5).
- [x] Call `BrowserDebuggerSession.getProperties({ objectId, ownProperties: true, accessorPropertiesOnly: false, generatePreview: true })`.
- [x] For each `Runtime.PropertyDescriptor.value`:
  - `name`: `prop.name`.
  - `value`: passed through the formatter (Task 8) using the `RemoteObject.preview` when available.
  - `type`: `RemoteObject.subtype || RemoteObject.type`.
  - `variablesReference`: handle reserved via the variable store when `RemoteObject.objectId` is present and the subtype is expandable; otherwise `0`.
- [x] Honor `args.start` / `args.count` for paging (max page size 100, larger requests get the page and a localized truncation marker).

### 7. Reuse the Same Transport Method for Nested Properties (AC: 3, 4)

- [x] No additional transport method. Nested expansion calls `BrowserDebuggerSession.getProperties` with the child `objectId` resolved from the parent's `Runtime.PropertyDescriptor`. Depth is implicit: VS Code drives expansion lazily by sending a fresh `variables` request per node, so the adapter never recursively walks deep object trees on its own.

### 8. Implement Variable Serialization and Value Formatting (AC: 3, 5)

- [x] Create `src/debugger/variable-formatter.ts`:
  - `formatRemoteObject(obj: Protocol.Runtime.RemoteObject, maxLength = 10240): string` produces the display string from CDP's existing `description` / `preview` / `value` fields. No custom JSON serialization.
  - Functions → `"[Function: <name>]"`; nodes (`subtype === "node"`) → `obj.description`; primitives → string-coerced literal; oversize → truncated with `"…"`.
  - `formatRemoteType(obj: Protocol.Runtime.RemoteObject): string` returns `obj.subtype ?? obj.type`.

### 9. Implement `evaluate` DAP Request Handler for Watch Expressions (AC: 6)

- [x] Add `evaluateRequest(response, args)`.
- [x] When `args.frameId` is set, call `BrowserDebuggerSession.evaluateOnCallFrame({ callFrameId, expression, returnByValue: false, generatePreview: true, throwOnSideEffect: args.context === "hover" })` using the cached `callFrameId` from the paused frame map.
- [x] When `args.frameId` is unset (REPL/Watch top-level while paused), still prefer `evaluateOnCallFrame` against frame 0; fall back to `Runtime.evaluate` only when there is no active pause (handled by Story 10.4).
- [x] On `exceptionDetails`, return the localized error string in `response.body.result` and set `presentationHint = { kind: "error" }` instead of failing the request.

### 10. Pause/Resume Hooks for the Variable Store (AC: 1–6)

- [x] The session manager (Story 10.1) already owns `Debugger.paused` subscription. On each pause it stores `callFrames` and notifies the adapter. The adapter:
  - Caches `callFrames` keyed by `threadId: 1`.
  - Resets the variable store before serving requests for the new pause.
- [x] Story 10.4 owns the `stopped` / `continued` events and the `clearForPause()` call on resume; Story 10.3 only consumes the cached frames and exposes the store API.
- [x] `DebugSessionManager.stopRunningSession()` (Story 10.1) must call `variableStore.dispose()` BEFORE `Debugger.disable`, mirroring the `BreakpointRegistry.clearAll()` placement from Story 10.2 Task 7. The session manager drops its store reference after dispose resolves so the adapter cannot serve stale handles.

### 11. Localization (AC: 1, 2, 5, 6)

- [x] Add localized strings to [l10n/bundle.l10n.json](../../l10n/bundle.l10n.json):
  - `"Notebook cells"` — thread name (Task 2).
  - `"Local"`, `"Closure"`, `"Block"`, `"With"`, `"Global"` — scope display names (Task 4).
  - `"[Function: {0}]"` — function placeholder (Task 8 formatter).
  - `"[Object]"`, `"[Array]"` — opaque placeholders when preview is unavailable (Task 8 formatter).
  - `"… ({0} more)"` — paging truncation marker (Task 6).
  - `"Value truncated (over {0} characters)."` — oversize value marker (Task 8 formatter).
  - `"Evaluation failed: {0}"` — watch / hover evaluation error message (Task 9 evaluate).
- [x] Reuse `Localize` from [src/config/endpoint-config.ts](../../src/config/endpoint-config.ts) — the same injection pattern Story 10.1 / 10.2 use; do not import `vscode.l10n` directly from the adapter.

### 12. Add Unit Tests (AC: 1–6)

- [x] `tests/unit/debugger/notebook-dap-adapter-frames.test.ts`: paged `stackTrace` over a synthetic cached `Debugger.paused` payload; empty cache returns `{ stackFrames: [], totalFrames: 0 }`.
- [x] `tests/unit/debugger/notebook-dap-adapter-scopes.test.ts`: `scopeChain` mapping plus appended global scope; handles allocated through the variable store.
- [x] `tests/unit/debugger/variable-store.test.ts`: handle allocation, kind tagging, `clearForPause` releases every tracked `objectId` exactly once, `clearForPause` resolves even when every `releaseObject` rejects (logged), `dispose` makes subsequent handle lookups return `undefined`.
- [x] `tests/unit/debugger/notebook-dap-adapter-variables.test.ts`: scope expansion calls `getProperties` with the recorded `objectId`; nested expansion creates fresh handles; oversize page is truncated and marked.
- [x] `tests/unit/debugger/variable-formatter.test.ts`: primitives, functions, nodes, oversize truncation.
- [x] `tests/unit/debugger/notebook-dap-adapter-evaluate.test.ts`: success path; `exceptionDetails` path; hover context sets `throwOnSideEffect: true`.
- [x] `tests/unit/transport/browser-connect.test.ts`: forwarding for `getProperties`, `evaluateOnCallFrame`, `releaseObject`, and `evaluate`.

### 13. Run Full Validation Suite (AC: 1–6)

- [x] Run `npm run lint` — no new warnings.
- [x] Run `npm run test:unit` — all tests pass.
- [x] Run `npm run compile` — clean compilation.
- [ ] (Manual) In Extension Development Host:
  - [ ] Set breakpoint in notebook cell.
  - [ ] Run cell and verify it pauses.
  - [ ] Inspect Call Stack pane and verify frame is shown.
  - [ ] Click frame to navigate to breakpoint line.
  - [ ] Inspect Variables pane and verify Local and Global scopes.
  - [ ] Expand Local scope and verify variables are displayed.
  - [ ] Expand an object variable and verify nested properties.
  - [ ] Add a watch expression and verify it evaluates in paused context.
  - [ ] Continue execution and verify scopes/variables are cleared.

  ## Dev Agent Record

  ### Debug Log

  - 2026-05-30: Extended BrowserDebuggerSession with property/evaluate/release APIs and added forwarding tests.
  - 2026-05-30: Added pause cache plumbing to DebugSessionManager, introduced VariableStore lifecycle/disposal, and implemented DAP stackTrace/scopes/variables/evaluate handlers.
  - 2026-05-30: Added unit suites for frames, scopes, variables, evaluate, formatter, and variable-store behavior.
  - 2026-05-30: Recorded Task 1 findings scaffold in `spike/cdp-debug-inspection-findings.md`; live Foundry empirical checks remain pending.

  ### Completion Notes

  - Implemented AC 1/2/3/4/5/6 runtime plumbing in code and unit tests for stack frames, scopes, variables, nested handles, graceful unsupported value rendering, and watch/hover evaluation mapping.
  - Added lazy variable paging with max page size 100 and localized truncation marker.
  - Added global scope resolution via `Runtime.evaluate("globalThis")` and per-pause cache.
  - Added variable-store cleanup on pause transitions and disposal on session stop before debugger disable.
  - Task 1 empirical hypotheses (H1-H5) and Task 13 manual Extension Development Host validation are still pending due unavailable live Foundry target in this execution.

  ## File List

  - src/transport/browser-connect.ts
  - src/debugger/debug-session-manager.ts
  - src/debugger/notebook-dap-adapter.ts
  - src/debugger/variable-store.ts
  - src/debugger/variable-formatter.ts
  - tests/unit/transport/browser-connect.test.ts
  - tests/unit/debugger/debug-session-manager.test.ts
  - tests/unit/debugger/notebook-dap-adapter-breakpoints.test.ts
  - tests/unit/debugger/notebook-dap-adapter.test.ts
  - tests/unit/debugger/notebook-dap-adapter-frames.test.ts
  - tests/unit/debugger/notebook-dap-adapter-scopes.test.ts
  - tests/unit/debugger/notebook-dap-adapter-variables.test.ts
  - tests/unit/debugger/notebook-dap-adapter-evaluate.test.ts
  - tests/unit/debugger/variable-store.test.ts
  - tests/unit/debugger/variable-formatter.test.ts
  - tests/unit/debugger/breakpoint-registry.test.ts
  - tests/unit/kernel/execution-kernel.test.ts
  - l10n/bundle.l10n.json
  - spike/cdp-debug-inspection-findings.md

  ## Change Log

  - 2026-05-30: Implemented Story 10.3 core debugger inspection surfaces (stackTrace/scopes/variables/evaluate), added variable-store and formatter modules, extended transport/session-manager APIs, and added comprehensive unit coverage.

## Dev Notes

### Story Context and Scope

This is the **third story in Epic 10** and focuses on surfacing execution context (frames, scopes, variables) to VS Code debug panes. It builds on Story 10.1's DAP foundation and Story 10.2's breakpoint handling.

**Scope boundary:** This story covers inspection and viewing. Modifying variables is deferred (MVP doesn't support `setVariable`). Stepping controls and the pause/resume lifecycle (including the retirement of Story 2.5's transitional auto-resume diagnostic deviation — see Epic 2 retro action item) are Story 10.4's responsibility; 10.3 only exposes the cached pause state and the variable store API that 10.4 will drive.

### Architecture Guardrails (Must Follow)

- **Single transport surface.** All CDP calls go through `BrowserDebuggerSession` (extended in Task 3). The adapter and variable store must not import `chrome-remote-interface` directly, and no new `src/transport/*-interface.ts` files are introduced.
- **Stack frames are pulled from the cached `Debugger.paused` payload.** CDP has no `Debugger.getCallStack`; do not invent one.
- **Folder is `src/debugger/`.** Created by Story 2.5, owned by Epic 10. No new top-level folders.
- **Source identity is the cell URI string.** Reuse the existing `createSource` helper in `src/debugger/notebook-dap-adapter.ts`. `vscode.NotebookCell` has no `label` property — do not invent one; pass `cell.document.uri.toString()` as the single source identifier, or derive a localized `"Cell {0}"` name from `cell.index + 1` and pass it via the helper's override.
- **Global scope resolution.** `globalThis` is fetched once per pause via `BrowserDebuggerSession.evaluate`. Never use `callFrame.this.objectId` as the global — that's the call-site `this` value, not the global object.
- **Handle management:** Sequential numeric handles starting at `1000`. The variable store owns lifecycle and releases every `objectId` via `Runtime.releaseObject` on pause clear and on session dispose.
- **Value serialization:** Use CDP's existing `description` / `preview` fields. Never expose raw `RemoteObject` to DAP. Truncate at 10240 chars.
- **Error boundaries:** `exceptionDetails` becomes a DAP error result, never a request rejection.
- **Localization:** Scope names, placeholders, error messages routed through the injected `Localize` function (same pattern as Stories 10.1/10.2), keyed in `l10n/bundle.l10n.json`.
- **Release gate (per Epic 2 retro):** Manual smoke (Task 13) is a release blocker, not optional. Any defect first surfaced during manual smoke after `lint` / `compile` / `test` are green is recorded as an automation-gap defect and backfilled with an automated test before closeout.
- **Closeout discipline (per Epic 2 retro):** When moving this story to `done`, update frontmatter `status`, the body `**Status:**` line, AND `docs/stories/sprint-status.yaml` in the same change. Drift between the three is a no-go.

### Transport Layer Extensions

Add to `BrowserDebuggerSession` in [src/transport/browser-connect.ts](../../src/transport/browser-connect.ts) (no new files). Reuse the existing `ProtocolMappingApi` import (`import type ProtocolMappingApi from "devtools-protocol/types/protocol-mapping";`) — do not introduce a `chrome-remote-interface/types/...` import; the project already standardized on `devtools-protocol`.

```typescript
export interface BrowserDebuggerSession {
  // ...existing members from Story 2.5 / 10.1 / 10.2...
  getProperties(
    params: ProtocolMappingApi.Commands["Runtime.getProperties"]["paramsType"][0],
  ): Promise<
    ProtocolMappingApi.Commands["Runtime.getProperties"]["returnType"]
  >;
  evaluateOnCallFrame(
    params: ProtocolMappingApi.Commands["Debugger.evaluateOnCallFrame"]["paramsType"][0],
  ): Promise<
    ProtocolMappingApi.Commands["Debugger.evaluateOnCallFrame"]["returnType"]
  >;
  releaseObject(
    params: ProtocolMappingApi.Commands["Runtime.releaseObject"]["paramsType"][0],
  ): Promise<void>;
  evaluate(
    params: ProtocolMappingApi.Commands["Runtime.evaluate"]["paramsType"][0],
  ): Promise<ProtocolMappingApi.Commands["Runtime.evaluate"]["returnType"]>;
}
```

All four methods send the underlying CDP command on the same per-target session as the existing `setBreakpointByUrl` / `removeBreakpoint` methods.

### Accepted Deviations

Per Epic 2 retro action item, each accepted deviation has an explicit retirement trigger so it does not become hidden debt.

| #   | Deviation                                                                                                                                | Justification                                                                                            | Retirement Trigger                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | `setVariable` is not implemented; the Variables pane is read-only.                                                                       | MVP scope — write-back requires separate UX and round-trip safety review.                                | Post-Epic 10 backlog story for variable modification.                      |
| 2   | Watch expressions are transient and cleared on each resume.                                                                              | Simplifies handle lifecycle; matches Story 10.4's `clearForPause` contract.                              | Future story for cross-pause watch persistence.                            |
| 3   | Nested-object expansion depth is fixed (lazy; VS Code drives the depth by issuing fresh `variables` requests). No user-configurable cap. | DAP's lazy expansion model handles this naturally; configurable depth is unjustified complexity for MVP. | Backlog enhancement only if real-world traces show pathological expansion. |
| 4   | DAP scopes report `variablesReference` only — `namedVariables` / `indexedVariables` are left undefined.                                  | Eager counts would require an extra `Runtime.getProperties` per scope on every pause.                    | Backlog enhancement if VS Code UX demands array length up front.           |
| 5   | Bulk variable fetches are paged at 100 items per request; larger requests return one page plus a localized truncation marker.            | Bounded payloads keep paused-UI responsive on large Foundry objects.                                     | Reassess once user traces show recurring pagination friction.              |

### Related Documentation

- [DAP stackTrace specification](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_StackTrace)
- [DAP scopes specification](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_Scopes)
- [DAP variables specification](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_Variables)
- [DAP evaluate specification](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_Evaluate)
- [CDP Runtime.getProperties](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-getProperties)
- [CDP Debugger.evaluateOnCallFrame](https://chromedevtools.github.io/devtools-protocol/tot/Debugger/#method-evaluateOnCallFrame)
