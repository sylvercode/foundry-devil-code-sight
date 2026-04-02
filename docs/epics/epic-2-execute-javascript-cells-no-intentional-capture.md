# Epic 2: Execute JavaScript Cells (No Intentional Capture)

**Goal:** Enable reliable JavaScript cell execution against a live browser execution target, with normalized result contracts and fast iteration patterns.

**Stories:**

## Story 2.1: Run Synchronous JavaScript Cells

As a developer,
I want to execute synchronous JavaScript cells against the active browser target,
So that I can validate browser state and behavior directly from notebook cells.

**Acceptance Criteria:**

**Given** an active session with a valid browser execution target
**When** I run a synchronous JavaScript cell
**Then** the code executes in the browser context
**And** the primitive or serializable return value is shown inline.

**Given** a cell that throws synchronously
**When** execution completes
**Then** the error message and type are shown inline
**And** no uncaught exception leaks to the extension host.

**Given** no active session
**When** I attempt to run a cell
**Then** execution is blocked
**And** a clear reconnect prompt is shown in the cell output.

**Scope Note (FR10 boundary):** Story 2.1 establishes baseline inline return-value visibility for successful synchronous execution. Story 4.1 extends this with structured rendering and explicit value-presentation semantics.

## Story 2.2: Run Asynchronous JavaScript Cells

As a developer,
I want async and Promise-based cell code to resolve correctly,
So that notebook execution supports real Foundry runtime workflows that use async APIs.

**Acceptance Criteria:**

**Given** a cell that returns a Promise or uses top-level await
**When** execution completes
**Then** the resolved value is shown inline
**And** resolution is deterministic within the CDP evaluation timeout.

**Given** a cell whose Promise rejects
**When** rejection propagates
**Then** the rejection reason is shown as a structured error
**And** the failure is classified separately from synchronous throws.

**Given** any async cell
**When** the run starts
**Then** the cell shows an in-progress indicator until the Promise settles
**And** no timeout or hangup occurs without surfacing diagnostics.

## Story 2.3: Normalize Success and Failure Output Contracts

As a developer,
I want consistent result shapes for every cell run,
So that success and failure are interpretable regardless of transport internals.

**Acceptance Criteria:**

**Given** a cell that executes successfully
**When** the result is serialized
**Then** it follows the normalized success contract (value, type metadata)
**And** no raw CDP protocol fields are visible in cell output.

**Given** any execution failure
**When** the error result is produced
**Then** it includes message, error type, and stack where available
**And** it follows the normalized failure contract consistently.

**Given** a transport-level error (e.g., session drop mid-run)
**When** execution fails
**Then** the error is wrapped in the normalized failure contract
**And** no protocol-level detail leaks directly to the cell output.

**Given** both sync and async execution paths
**When** results are produced
**Then** classification parity holds — the same contract shapes are used
**And** downstream rendering code does not branch on transport type.

**Traceability Note:** Validates NFR5 (no silent failure) and NFR6 (classification parity across execution paths).

## Story 2.4: Support Fast Rerun and Iteration Patterns

As a developer,
I want to rerun edited cells quickly with predictable execution state,
So that I can iterate rapidly without connection overhead or state confusion.

**Acceptance Criteria:**

**Given** an active session
**When** I rerun an edited cell
**Then** execution begins without a reconnect cycle
**And** the result reflects the current cell content.

**Given** default kernel semantics
**When** multiple cells run in sequence
**Then** state accumulates within the session as expected
**And** no unintended isolation occurs unless explicitly requested.

**Given** intentional namespace isolation is desired
**When** a cell opts into isolation (per kernel contract)
**Then** it executes without inheriting prior cell state
**And** the isolation boundary is visible from cell output or metadata.

**Given** any cell run outcome
**When** execution completes
**Then** success or failure is visible inline without navigating away
**And** the next edit-run cycle requires no additional navigation steps.

---
