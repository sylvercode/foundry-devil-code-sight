# User Journey Flows

### Journey 1: Rapid Snippet Iteration

Goal: move from idea to validated execution behavior with minimal cycle time.

Flow:

1. Open notebook and verify connection state.
2. If not connected, run Connect or Reconnect.
3. Write or edit a JavaScript cell.
4. Run the cell.
5. Inspect structured result or structured error.
6. If behavior is not as intended, edit and rerun.
7. Keep validated revision in notebook history.

### Journey 2: Safe Experimentation and Reversal

Goal: enable risky changes with immediate rollback capability.

Flow:

1. Write a forward-operation cell.
2. Write a rollback cell directly below it.
3. Run forward-operation cell and inspect outcomes.
4. If accepted, continue iteration.
5. If rejected, run rollback cell and verify restoration.
6. Patch rollback logic if restoration is incomplete.

### Journey 3: Connection and Target Recovery

Goal: restore runnable state quickly after reload or disconnect.

Flow:

1. User sees non-ready connection state.
2. User triggers Reconnect.
3. If reconnect fails, show actionable endpoint or target guidance.
4. User adjusts configuration and retries.
5. If reconnect succeeds, run validation cell.
6. Resume notebook workflow.

### Journey 4: Diagnosing Unexpected Behavior

Goal: isolate logic mismatch without leaving the notebook loop.

Flow:

1. Run a narrow diagnostic cell.
2. Inspect structured result and intentional output.
3. Compare expected and actual intermediate values.
4. Patch snippet assumptions.
5. Rerun until behavior converges.

### Journey 5 (Post-MVP): Debug in VS Code

Goal: perform breakpoint-driven debugging directly in VS Code notebook-cell surfaces.

Flow:

1. Set breakpoint in notebook-cell gutter.
2. Start notebook-cell debug session.
3. Run cell until paused-line highlight appears.
4. Inspect Variables, Watch, and Call Stack panes.
5. Use step in/over/out or continue.
6. Validate behavior and return to normal edit-run loop.

### Journey Patterns

Navigation patterns:

- Notebook remains the primary action surface.
- Recovery commands route users back to the same loop quickly.

Decision patterns:

- State check before run.
- Outcome branch after run: keep, edit, rollback, or recover.

Feedback patterns:

- Inline semantic output for immediate meaning.
- Output-channel chronology for multi-step diagnostics.

### Flow Optimization Principles

- Minimize time between edit and rerun.
- Keep recovery actions explicit and reversible.
- Prefer deterministic labels over inferred state.
- Preserve session-scoped history for comparison across revisions.
