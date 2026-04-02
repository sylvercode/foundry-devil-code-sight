# Requirements Inventory

## Functional Requirements

FR1: A user can configure the connection endpoint used by the extension.
FR2: A user can initiate a connection from VS Code to a live browser execution target.
FR3: The extension can identify and select a valid execution target according to the active profile's matching rules.
FR4: The extension can report current connection state to the user using defined platform states: disconnected, connecting, connected, and error.
FR5: A user can manually reconnect the extension after disconnection or target reload.
FR6: A user can disconnect the active execution session from VS Code.
FR7: The extension can preserve coexistence with active browser developer tools connected to the same target.
FR8: A user can run JavaScript notebook cells against the active browser target from VS Code.
FR9: The extension can execute asynchronous JavaScript cell logic and return resolved outcomes.
FR10: The extension can return successful execution values to notebook output.
FR11: The extension can surface syntax and runtime errors as notebook output with message, stack, and source location when available.
FR12: A user can rerun modified cells repeatedly in the same notebook workflow.
FR13: The extension can support execution isolation per cell while allowing explicit shared-runtime patterns such as a shared global namespace when the user chooses them.
FR14: The extension can normalize success and failure outcomes across supported transports and profiles through a shared result contract while preserving transport-boundary isolation from notebook execution semantics.
FR15: A user can inspect execution results inline in the notebook after each run.
FR16: The extension can capture output generated during cell execution and surface it as notebook output, distinguishable from unrelated browser console activity.
FR17: The extension can preserve session-scoped execution history so a user can compare the result of each cell revision within a working session.
FR18: A developer can verify the notebook execution pipeline and shared result contract against deterministic browser-test fixtures without any profile-specific runtime.
FR19: A user can maintain forward-operation and reversal-operation cells in the same notebook.
FR20: A user can execute reversal cells to restore state after experiments.
FR21: A user can iterate through at least two successive snippet versions in a single notebook session.
FR22: A user can install and use the extension through a manual VS Code workflow without requiring Marketplace distribution.
FR23: The extension can expose intentional script output through extension-owned runtime helpers providing intentional output capture, structured logging, and value inspection. Helper naming and calling conventions are architecture-scoped.
FR24 [Post-MVP]: A user can define watched expressions and refresh them manually or after execution events.
FR25 [Post-MVP]: A user can configure depth-limited property projections and expand nested references for watched values.
FR26 [Post-MVP]: A user can continue refreshing other watched values when one watcher evaluation fails.
FR27 [Post-MVP Foundry Profile]: The Foundry profile can identify valid execution targets using profile-owned matching rules.
FR28 [Post-MVP Foundry Profile]: The Foundry profile execution path can rely on extension-owned runtime envelope and helper injection.
FR29 [Post-MVP Foundry Profile]: The extension can inject a zero-boilerplate execution envelope that carries structured value and log output for each cell run.
FR30 [Post-MVP Foundry Profile]: The Foundry profile can classify target eligibility into states providing ready for execution, target mismatch, and connection-interrupted conditions; labels are architecture-scoped.
FR31 [Post-MVP Foundry Profile]: The Foundry profile can present actionable reconnect or target-selection guidance when target eligibility is not satisfied.
FR32 [Post-MVP Foundry Profile]: A user can proceed with Foundry execution whenever the current target is classified as eligible.
FR33 [Post-MVP Foundry Profile]: A Foundry power user can execute macro logic from notebook cells without using the Foundry macro editor during iteration.
FR34 [Post-MVP Foundry Profile]: The extension can provide a Foundry starter notebook demonstrating token-state read and token-value update.
FR35 [Post-MVP Foundry Profile]: A Foundry power user can save a notebook cell as a reusable action.
FR36 [Post-MVP Foundry Profile]: A Foundry power user can reopen or execute a saved action, including prompted inputs when required.
FR37 [Post-MVP Core]: A user can define $prompt() substitution placeholders in a notebook cell so that execution pauses and requests a value for each placeholder before running.

## NonFunctional Requirements

NFR1: Notebook execution feedback must render within 2 seconds for synchronous JavaScript cells, measured from run command to output render under normal local conditions.
NFR2: Manual reconnect must report success or failure within 5 seconds when the target browser and page are available.
NFR3: Intentional output or watched-value refresh behavior, when enabled, must render within 2 seconds after execution completion.
NFR4: Manual reconnect must restore execution capability within 5 seconds after target reload when reachable, validated by one successful cell execution without restarting VS Code.
NFR5: Runtime and syntax failures must always surface as explicit notebook outputs; silent failure is not acceptable.
NFR6: The shared result contract must preserve identical success and failure classification across supported transports for equivalent deterministic fixtures.
NFR7: The platform core must remain adapter-agnostic with zero profile-specific imports or literals in core modules.
NFR8: The extension must coexist with Edge DevTools without forced disconnect behavior.
NFR9: Each profile must implement deterministic target-eligibility diagnostics with explicit states and guidance.
NFR10 [Post-MVP]: The Foundry profile attaches only to targets classified as eligible by profile-owned matching rules.
NFR11 [Post-MVP]: The Foundry target-eligibility check must complete within a configurable timeout (default 5 seconds, bounds 1 to 30 seconds) and return eligible, target_mismatch, or disconnected.
NFR12: Core execution and result normalization must pass deterministic automated tests for success, syntax, runtime, and serialization-boundary cases.
NFR13: Automated platform tests must include reconnect state transitions and serialization boundaries (circular refs, null or undefined, large payloads).
NFR14: Any future profile must pass fixture-based target-matching and target-eligibility diagnostics tests before live integration testing.
NFR15: The extension must connect only to explicitly user-configured endpoints.
NFR16: The extension must not persist sensitive runtime secrets from evaluated cells unless explicitly saved by user action.
NFR17: User-facing diagnostics must include actionable root-cause category and next-step guidance while excluding sensitive environment details.

## Additional Requirements

- Starter template requirement: initialize as a TypeScript VS Code extension scaffold using Yeoman and generator-code with esbuild bundling, then validate ESM output compatibility early.
- Keep strict architectural separation between platform core and profile layer, with interfaces as the only cross-layer contract.
- Use transport-owned connection state machine and profile-owned readiness or eligibility state machine.
- Enforce normalized execution result discriminated-union contract across success and failure; raw transport errors must not leak past transport boundary.
- Maintain deterministic CDP coexistence behavior with active browser DevTools sessions.
- Preserve transport replaceability behind ITransport interface (CDP in MVP, other transports deferred).
- Use extension-owned canonical runtime envelope and controlled profile hooks for execution.
- Keep JavaScript-only runtime scope for v1.
- Require manual reconnect in MVP; automatic reconnect is explicitly deferred.
- Preserve intentional output identity conventions and stable logging/event naming semantics.
- Enforce security boundaries: user-configured endpoints only, diagnostics redaction, no secret persistence by default.
- Implement layered deterministic test strategy: unit, contract, integration, extension-host, and fixture suites.
- Keep tests outside runtime source tree; maintain dedicated test folders and fixtures.
- Structure project folders by architecture ownership, prevent cross-layer concrete imports.
- Keep profile-specific language and behavior additive, not hardcoded into core modules.

## UX Design Requirements

UX-DR1: Present one authoritative connection status indicator using explicit text states: Disconnected, Connecting, Connected, Error.
UX-DR2: Show connection and readiness state continuously with low visual noise in native VS Code surfaces.
UX-DR3: Render every cell run using a labeled semantic output envelope (success or error), never unlabeled free-form output.
UX-DR4: Ensure success output is inline and structured for immediate inspection.
UX-DR5: Ensure error output is inline and includes error type, message, stack, and source location when available.
UX-DR6: Keep error detail disclosure progressive (stack collapsed by default, expandable on demand).
UX-DR7: Keep run-edit-rerun flow frictionless for rapid micro-iteration.
UX-DR8: Preserve forward-operation and rollback-cell adjacency as a first-class reversible experimentation pattern.
UX-DR9: Keep reconnect as an explicit, repeatable, idempotent recovery action.
UX-DR10: On reconnect or eligibility failure, provide deterministic next-step guidance (endpoint fix, target fix, retry path).
UX-DR11: Distinguish intentional execution output from ambient browser noise in both notebook context and output channel context.
UX-DR12: Prefix intentional output lines with fixed core identity prefix JBK for filtering and searchability.
UX-DR13: Mirror inline feedback into chronological output logs to support multi-step troubleshooting.
UX-DR14: Use severity-consistent messaging (Error, Warning, Info, Success) with state-led first line.
UX-DR15: Keep core language profile-agnostic; move profile-specific guidance to profile-scoped UX artifacts.
UX-DR16: Keep all MVP interactions in native VS Code surfaces (status bar, notebook output, output channel, commands, settings), no custom webview dependency.
UX-DR17: Validate settings input with precise field-level error identification and one concrete corrective action.
UX-DR18: Preserve keyboard-first operation for primary actions (run, reconnect, settings access).
UX-DR19: Avoid color-only communication; all critical state and error messages must have text labels.
UX-DR20: Maintain host theme compatibility using semantic VS Code theming, with no hardcoded MVP palette.
UX-DR21: Preserve readability and scannability in narrow pane layouts using concise labels and truncation-resistant wording.
UX-DR22: Keep diagnostics concise, actionable, and copy-friendly.
UX-DR23: Preserve session-scoped execution history visibility to support revision comparison.
UX-DR24: Ensure journey continuity: each failure branch ends with a clear next action to return users to the write-run-inspect loop.

## FR Coverage Map

FR1: Epic 1 - endpoint configuration
FR2: Epic 1 - connect command and session start
FR3: Epic 1 - target selection by active profile rules
FR4: Epic 1 - connection state reporting
FR5: Epic 1 - manual reconnect
FR6: Epic 1 - manual disconnect
FR7: Epic 1 - DevTools coexistence
FR8: Epic 2 - JavaScript cell execution baseline
FR9: Epic 2 - asynchronous execution support
FR10: Epic 4 - intentional value capture and inline value visibility
FR11: Epic 2 - structured syntax and runtime error output
FR12: Epic 2 - rerun loop support
FR13: Epic 2 - execution isolation with explicit shared-runtime option
FR14: Epic 2 - shared normalized result contract
FR15: Epic 2 - inline run result inspection
FR16: Epic 3 - intentional log capture and discrimination from ambient noise across notebook and output-channel contexts
FR17: Epic 4 - session-scoped value-history continuity
FR18: Epic 6 - deterministic fixture-based core validation
FR19: Epic 6 - forward-operation experimentation pattern
FR20: Epic 6 - rollback restoration pattern
FR21: Epic 6 - multi-version iteration in one session
FR22: Epic 1 - scaffold bootstrap and CI VSIX release workflow
FR23: Epic 3 and Epic 4 - extension-owned output helpers (logging, output capture, value inspection)
FR24: Epic 5 - watched expressions and refresh behavior
FR25: Epic 5 - depth-limited projection and nested drill-down
FR26: Epic 5 - resilient watch refresh when one watch fails
FR27: Epic 7 - Foundry profile target matching
FR28: Epic 7 - Foundry profile runtime envelope and helper injection
FR29: Epic 7 - zero-boilerplate execution envelope for structured output
FR30: Epic 7 - Foundry eligibility state classification
FR31: Epic 7 - Foundry actionable guidance for non-eligible targets
FR32: Epic 7 - proceed when target is eligible
FR33: Epic 8 - notebook-first Foundry macro iteration
FR34: Epic 8 - Foundry starter notebook flow
FR35: Epic 8 - save reusable action
FR36: Epic 8 - reopen and execute saved action with prompts
FR37: Epic 9 - pre-execution parameter substitution via $prompt()

### UX-DR to FR Mapping Notes

- UX-DR13 (mirror inline feedback into chronological output logs): Covered by FR16 and FR23, delivered through Epic 3 output routing and helper-driven intentional output capture.
- UX-DR19 (no color-only communication): Covered by FR4 state-label requirements and Epic 1 Story 1.6 explicit acceptance criteria requiring text-first messaging.
