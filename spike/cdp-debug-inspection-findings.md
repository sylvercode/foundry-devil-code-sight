# CDP Debug Inspection Findings (Story 10.3)

## Scope

Story 10.3 requires empirical validation of paused-frame and variable-inspection behavior through BrowserDebuggerSession against a live Foundry target.

## Environment Status

- Date: 2026-05-30
- Repository: jupyter-browser-kernel
- Live Foundry/CDP session availability in this execution: unavailable

## Hypothesis Tracking

- H1: `Debugger.paused.callFrames` survives between pause and first stackTrace request without re-fetching.
  - Status: pending live validation
  - Notes: adapter/session-manager implementation now serves stack frames from cached paused payload only.

- H2: `Runtime.getProperties({ ownProperties: true, generatePreview: true })` preview quality for Foundry objects (`game`, `canvas`, `ui`, `CONFIG`, DOM element).
  - Status: pending live validation
  - Notes: formatter includes preview-aware rendering and safe fallbacks (`[Object]`, `[Array]`, node descriptions).

- H3: `Runtime.evaluate({ expression: "globalThis", returnByValue: false })` returns reusable per-pause global `objectId`.
  - Status: pending live validation
  - Notes: adapter caches one global object id per pause version.

- H4: `Debugger.evaluateOnCallFrame` with `throwOnSideEffect: true` rejects side-effectful hover expressions cleanly.
  - Status: pending live validation
  - Notes: evaluate handler sets `throwOnSideEffect` for hover context and maps exceptionDetails to DAP error result.

- H5: CDP oversize behavior before adapter-level 10 KiB truncation.
  - Status: pending live validation
  - Notes: formatter enforces 10 KiB truncation with localized marker regardless of CDP-side ceiling.

## Interim Verification Completed

- Unit coverage added for stackTrace/scopes/variables/evaluate handling, variable store lifecycle, and transport forwarding.
- Lint, unit tests, and compile are passing in this branch.

## Next Step To Complete Gate

Run manual live-CDP validation against a connected Foundry `/game` target and replace each pending hypothesis with observed payload excerpts and pass/fail outcomes.
