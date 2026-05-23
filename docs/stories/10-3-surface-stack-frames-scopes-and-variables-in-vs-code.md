---
storyId: "10.3"
storyKey: "10-3-surface-stack-frames-scopes-and-variables-in-vs-code"
title: "Surface Stack Frames, Scopes, and Variables in VS Code"
status: "backlog"
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

**Status:** backlog

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
  **And** each scope includes an accurate variable count.

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

### 1. Implement `threads` DAP Request Handler (AC: 1)

- [ ] In `src/debugger/notebook-dap-adapter.ts`, refine the Story 10.1 stub `threadsRequest` to keep returning `{ threads: [{ id: 1, name: localized("Notebook cells") }] }`. No new structure for MVP.

### 2. Implement `stackTrace` DAP Request Handler (AC: 1)

- [ ] Add `stackTraceRequest(response, args)`.
- [ ] CDP does not have a `Debugger.getCallStack` method. The full call stack is delivered as `params.callFrames` on the `Debugger.paused` event. The session manager (Story 10.1) caches the most recent paused payload per debug session; the adapter reads from that cache and never issues a new CDP call to fetch frames.
- [ ] Map each cached `Debugger.CallFrame` to a DAP `StackFrame`:
  - `id`: stable per-pause integer assigned by a frame manager (Task 5).
  - `name`: `callFrame.functionName || "<anonymous>"`.
  - `source`: `{ name: cell.label, path: cell.document.uri.toString() }` (Story 10.2 source identity).
  - `line`: `callFrame.location.lineNumber + 1` (DAP is 1-based).
  - `column`: `callFrame.location.columnNumber + 1`.
- [ ] Honor `args.startFrame` and `args.levels` for paging; `totalFrames` is the cached count.

### 3. Extend `BrowserDebuggerSession` for Property Access (AC: 1, 2, 3, 4, 6)

- [ ] No `src/transport/debugger-interface.ts`. Extend the existing `BrowserDebuggerSession` surface in [src/transport/browser-connect.ts](../../src/transport/browser-connect.ts) with the methods needed by Stories 10.3–10.4. Reuse existing `chrome-remote-interface` types via `ProtocolMappingApi.Commands["Debugger.<method>"]` so we do not redeclare CDP shapes.
  - `getProperties(params: Protocol.Runtime.GetPropertiesRequest): Promise<Protocol.Runtime.GetPropertiesResponse>` — wraps `Runtime.getProperties` on the per-target session.
  - `evaluateOnCallFrame(params: Protocol.Debugger.EvaluateOnCallFrameRequest): Promise<Protocol.Debugger.EvaluateOnCallFrameResponse>` — wraps `Debugger.evaluateOnCallFrame`.
  - `releaseObject(params: Protocol.Runtime.ReleaseObjectRequest): Promise<void>` — wraps `Runtime.releaseObject`, used by the variable store on resume.
- [ ] Stack frames come from the cached `Debugger.paused` event (Task 2), so no `getCallStack` method is added.
- [ ] Update [tests/unit/transport/browser-connect.test.ts](../../tests/unit/transport/browser-connect.test.ts) with forwarding tests for each new method.

### 4. Implement `scopes` DAP Request Handler (AC: 2)

- [ ] Add `scopesRequest(response, args)`.
- [ ] Map the cached `CallFrame.scopeChain[]` for the requested `frameId` into DAP `Scope[]`:
  - For each `scopeChain` entry whose `type` is `local`, `closure`, `block`, or `with`, emit one DAP scope with the original type as `presentationHint` and a localized `name`.
  - Always append a `Global` scope backed by `callFrame.this.objectId` falling back to a session-scoped `globalThis` lookup (`Runtime.evaluate({ expression: "globalThis", returnByValue: false })` cached per pause).
  - Each scope reserves a `variablesReference` from the variable store (Task 5) keyed by the underlying `Runtime.RemoteObject.objectId`.
  - Set `expensive: true` for the global scope and `false` otherwise.

### 5. Create the Variable Store (AC: 3, 4)

- [ ] Create `src/debugger/variable-store.ts` exporting `createVariableStore({ debuggerSession })`.
- [ ] Responsibilities:
  - Allocate sequential `variablesReference` handles starting at `1000`; reserve `0` for non-expandable values.
  - Map handle → `{ objectId: string, kind: "scope" | "object" | "array" }`.
  - Track every `objectId` ever returned during a pause so they can be released via `Runtime.releaseObject` on resume.
  - `clearForPause()` invoked by the pause-event handler (Story 10.4) wipes handles and releases live `objectId`s.

### 6. Implement `variables` DAP Request Handler (AC: 3, 4)

- [ ] Add `variablesRequest(response, args)`.
- [ ] Resolve the handle through the variable store (Task 5).
- [ ] Call `BrowserDebuggerSession.getProperties({ objectId, ownProperties: true, accessorPropertiesOnly: false, generatePreview: true })`.
- [ ] For each `Runtime.PropertyDescriptor.value`:
  - `name`: `prop.name`.
  - `value`: passed through the formatter (Task 8) using the `RemoteObject.preview` when available.
  - `type`: `RemoteObject.subtype || RemoteObject.type`.
  - `variablesReference`: handle reserved via the variable store when `RemoteObject.objectId` is present and the subtype is expandable; otherwise `0`.
- [ ] Honor `args.start` / `args.count` for paging (max page size 100, larger requests get the page and a localized truncation marker).

### 7. Reuse the Same Transport Method for Nested Properties (AC: 3, 4)

- [ ] No additional transport method. Nested expansion calls `BrowserDebuggerSession.getProperties` with the child `objectId` resolved from the parent's `Runtime.PropertyDescriptor`. Depth is implicit: VS Code drives expansion lazily by sending a fresh `variables` request per node, so the adapter never recursively walks deep object trees on its own.

### 8. Implement Variable Serialization and Value Formatting (AC: 3, 5)

- [ ] Create `src/debugger/variable-formatter.ts`:
  - `formatRemoteObject(obj: Protocol.Runtime.RemoteObject, maxLength = 10240): string` produces the display string from CDP's existing `description` / `preview` / `value` fields. No custom JSON serialization.
  - Functions → `"[Function: <name>]"`; nodes (`subtype === "node"`) → `obj.description`; primitives → string-coerced literal; oversize → truncated with `"…"`.
  - `formatRemoteType(obj: Protocol.Runtime.RemoteObject): string` returns `obj.subtype ?? obj.type`.

### 9. Implement `evaluate` DAP Request Handler for Watch Expressions (AC: 6)

- [ ] Add `evaluateRequest(response, args)`.
- [ ] When `args.frameId` is set, call `BrowserDebuggerSession.evaluateOnCallFrame({ callFrameId, expression, returnByValue: false, generatePreview: true, throwOnSideEffect: args.context === "hover" })` using the cached `callFrameId` from the paused frame map.
- [ ] When `args.frameId` is unset (REPL/Watch top-level while paused), still prefer `evaluateOnCallFrame` against frame 0; fall back to `Runtime.evaluate` only when there is no active pause (handled by Story 10.4).
- [ ] On `exceptionDetails`, return the localized error string in `response.body.result` and set `presentationHint = { kind: "error" }` instead of failing the request.

### 10. (Folded into Task 3) Transport Methods Recap

- [ ] Confirm `BrowserDebuggerSession.evaluateOnCallFrame` (Task 3) is the only path used by Task 9. No `evaluateExpressionInFrame` wrapper exists.

### 11. Pause/Resume Hooks for the Variable Store (AC: 1–6)

- [ ] The session manager (Story 10.1) already owns `Debugger.paused` subscription. On each pause it stores `callFrames` and notifies the adapter. The adapter:
  - Caches `callFrames` keyed by `threadId: 1`.
  - Resets the variable store before serving requests for the new pause.
- [ ] Story 10.4 owns the `stopped` / `continued` events and the `clearForPause()` call on resume; Story 10.3 only consumes the cached frames and exposes the store API.

### 12. Add Unit Tests (AC: 1–6)

- [ ] `tests/unit/debugger/notebook-dap-adapter-frames.test.ts`: paged `stackTrace` over a synthetic cached `Debugger.paused` payload; empty cache returns `{ stackFrames: [], totalFrames: 0 }`.
- [ ] `tests/unit/debugger/notebook-dap-adapter-scopes.test.ts`: `scopeChain` mapping plus appended global scope; handles allocated through the variable store.
- [ ] `tests/unit/debugger/variable-store.test.ts`: handle allocation, kind tagging, `clearForPause` releases every tracked `objectId` exactly once.
- [ ] `tests/unit/debugger/notebook-dap-adapter-variables.test.ts`: scope expansion calls `getProperties` with the recorded `objectId`; nested expansion creates fresh handles; oversize page is truncated and marked.
- [ ] `tests/unit/debugger/variable-formatter.test.ts`: primitives, functions, nodes, oversize truncation.
- [ ] `tests/unit/debugger/notebook-dap-adapter-evaluate.test.ts`: success path; `exceptionDetails` path; hover context sets `throwOnSideEffect: true`.
- [ ] `tests/unit/transport/browser-connect.test.ts`: forwarding for `getProperties`, `evaluateOnCallFrame`, `releaseObject`.

### 13. Run Full Validation Suite (AC: 1–6)

- [ ] Run `npm run lint` — no new warnings.
- [ ] Run `npm run test:unit` — all tests pass.
- [ ] Run `npm run compile` — clean compilation.
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

## Dev Notes

### Story Context and Scope

This is the **third story in Epic 10** and focuses on surfacing execution context (frames, scopes, variables) to VS Code debug panes. It builds on Story 10.1's DAP foundation and Story 10.2's breakpoint handling.

**Scope boundary:** This story covers inspection and viewing. Modifying variables is deferred (MVP doesn't support `setVariable`). Stepping controls are Story 10.4.

### Architecture Guardrails (Must Follow)

- **Single transport surface.** The adapter must not import `chrome-remote-interface`. All CDP calls go through `BrowserDebuggerSession` (extended in Task 3). No `src/transport/debugger-interface.ts`.
- **Stack frames are pulled from the cached `Debugger.paused` payload.** CDP has no `Debugger.getCallStack`; do not invent one.
- **Folder is `src/debugger/`.** Created by Story 2.5, owned by Epic 10.
- **Handle management:** Sequential numeric handles starting at `1000`. The variable store owns lifecycle and releases every `objectId` via `Runtime.releaseObject` on pause clear.
- **Value serialization:** Use CDP's existing `description` / `preview` fields. Never expose raw `RemoteObject` to DAP. Truncate at 10240 chars.
- **Error boundaries:** `exceptionDetails` becomes a DAP error result, never a request rejection.
- **Localization:** Scope names, placeholders, error messages via `vscode.l10n.t()` keyed in `l10n/bundle.l10n.json`.

### Transport Layer Extensions

Add to `BrowserDebuggerSession` in [src/transport/browser-connect.ts](../../src/transport/browser-connect.ts) (no new files):

```typescript
import type ProtocolMappingApi from "chrome-remote-interface/types/protocol-mapping.d.ts";

export interface BrowserDebuggerSession {
  // ...existing members from Story 2.5 / 10.1...
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
}
```

All three methods send the underlying CDP command on the same per-target session as the existing `setBreakpointByUrl` / `removeBreakpoint` methods.

### Known Unknowns & Future Decisions

1. **Watch expression persistence:** Currently, watches are transient (cleared on resume). Future: persist watches across pause/resume cycles.
2. **Variable modification:** `setVariable` request is not supported in MVP. Future story.
3. **Depth limit:** Current MVP uses depth 2 for nested properties. Configurable depth is a future enhancement.
4. **Performance:** Fetching many variables may be slow. Consider lazy loading for large variable lists.

### Related Documentation

- [DAP stackTrace specification](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_StackTrace)
- [DAP scopes specification](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_Scopes)
- [DAP variables specification](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_Variables)
- [DAP evaluate specification](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_Evaluate)
- [CDP Runtime.getProperties](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-getProperties)
- [CDP Debugger.evaluateOnCallFrame](https://chromedevtools.github.io/devtools-protocol/tot/Debugger/#method-evaluateOnCallFrame)
