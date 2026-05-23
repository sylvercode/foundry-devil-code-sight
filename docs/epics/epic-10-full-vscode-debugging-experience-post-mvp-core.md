# Epic 10: Full VS Code Debugging Experience (Post-MVP Core)

**Goal:** Deliver a first-class VS Code notebook-cell debugging workflow via a dedicated Debug Adapter Protocol (DAP) adapter while preserving CDP multiplexing and browser DevTools coexistence.

**Dependencies:** Epic 1, Epic 2

**Stories:**

## Story 10.1: Register and Bootstrap Notebook-Cell DAP Session

As a developer,
I want notebook-cell execution to start an extension-owned debug session,
So that VS Code can treat notebook-cell code as a debuggable program surface.

**Acceptance Criteria:**

**Given** a notebook containing JavaScript cells
**When** the user starts a debug run for a cell
**Then** the extension starts a DAP session that owns notebook-cell debug lifecycle
**And** session startup failures surface as clear, actionable diagnostics.

**Given** an active debug session
**When** the session ends
**Then** adapter resources are disposed deterministically
**And** subsequent debug starts can reconnect without VS Code reload.

## Story 10.2: Verify and Bind Notebook-Cell Breakpoints in VS Code UI

As a developer,
I want notebook-cell gutter breakpoints to be verified and bound by the adapter,
So that breakpoint state in VS Code matches actual runtime behavior.

**Acceptance Criteria:**

**Given** one or more notebook-cell breakpoints in VS Code
**When** debug session initialization completes
**Then** `setBreakpoints` requests are translated to the runtime debugger backend
**And** VS Code receives verified breakpoint responses with accurate line mapping.

**Given** a breakpoint is edited, added, removed, enabled, or disabled
**When** breakpoint synchronization runs
**Then** adapter state remains consistent with editor breakpoint state
**And** stale runtime breakpoints are removed.

## Story 10.3: Surface Stack Frames, Scopes, and Variables in VS Code

As a developer,
I want paused execution context in VS Code debug panes,
So that I can inspect stack and state without switching to browser DevTools.

**Acceptance Criteria:**

**Given** execution pauses on a notebook-cell breakpoint
**When** VS Code requests stack frames
**Then** the adapter returns frame locations mapped to notebook-cell sources
**And** frame ordering reflects runtime call depth.

**Given** VS Code requests scopes and variables for a frame
**When** data is resolved from the runtime backend
**Then** variables are returned with stable handles for expansion
**And** unsupported values fail gracefully with explicit diagnostics.

## Story 10.4: Implement Stepping Controls and Pause Lifecycle Synchronization

As a developer,
I want continue, step in, step out, and next to work from VS Code,
So that execution control stays fully in the editor.

**Acceptance Criteria:**

**Given** a paused debug session
**When** the user triggers continue or step actions in VS Code
**Then** corresponding runtime debugger commands are issued
**And** resulting pause or resume events are reflected back to VS Code reliably.

**Given** runtime pause events occur rapidly
**When** event synchronization is processed
**Then** adapter event ordering remains deterministic
**And** no duplicate or orphan stopped-state UI remains in VS Code.

## Story 10.5: Validate Dual-Client Coexistence and Reliability

As a developer,
I want VS Code debugging to coexist with browser DevTools attachments,
So that advanced debugging tools can run side-by-side without deadlock or forced disconnect behavior.

**Acceptance Criteria:**

**Given** VS Code debug session and browser DevTools are attached to the same target
**When** breakpoints are hit and stepping occurs
**Then** both clients remain responsive
**And** no client requires forced detach to recover execution.

**Given** deterministic fixture tests for debugger lifecycle
**When** CI validation runs
**Then** adapter startup, breakpoint binding, pause inspection, stepping, and teardown pass consistently
**And** regressions fail with actionable test diagnostics.
