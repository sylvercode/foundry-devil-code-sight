# Epic 1: Connect and Control Browser Sessions

Users can configure endpoints, connect, reconnect, disconnect, and maintain a stable, visible session state while coexisting with DevTools.

## Story 1.1: Initialize Extension from Starter Template

As a platform developer,
I want to scaffold the extension project from the Yeoman generator-code template with esbuild bundling,
So that the project structure, build pipeline, and ESM output compatibility are validated before any feature work begins.

**Acceptance Criteria:**

**Given** the project is initialized
**When** the scaffold completes
**Then** a TypeScript VS Code extension project exists with esbuild bundling configured
**And** `npm run compile` produces valid output.

**Given** the scaffolded project
**When** esbuild bundles the extension
**Then** the output is a single ESM entry point compatible with VS Code extension host
**And** no CommonJS interop shims cause activation failures at load time.

**Given** the initial project structure
**When** reviewed against architecture constraints
**Then** folder layout follows architecture ownership boundaries
**And** strict TypeScript mode is enabled.

## Story 1.2: Configure Browser Endpoint

As a developer,
I want to set and validate the browser endpoint in extension settings,
So that the extension can target the correct runtime safely.

**Acceptance Criteria:**

**Given** the extension is installed
**When** I open settings
**Then** I can set host and port or equivalent endpoint fields
**And** the settings UI explains expected format.

**Given** invalid endpoint input
**When** I save settings
**Then** I see field-specific validation
**And** one concrete corrective action is provided.

**Given** valid endpoint input
**When** I save settings
**Then** configuration persists for subsequent commands
**And** connect commands read the saved endpoint.

## Story 1.3: Connect to a Valid Browser Target

As a developer,
I want to initiate connection from VS Code to a valid browser target,
So that I can begin notebook execution quickly.

**Acceptance Criteria:**

**Given** valid endpoint configuration
**When** I run Connect
**Then** state transitions deterministically from connecting to connected or error
**And** final state is visible in the status indicator.

**Given** multiple browser targets are present
**When** Connect executes
**Then** profile matching selects a valid target or returns target-mismatch
**And** the diagnostic names the failure category.

**Given** no valid target exists
**When** Connect completes
**Then** an actionable next-step message is shown
**And** suggested actions include target-selection or endpoint checks.

## Story 1.4: Disconnect and Manual Reconnect Lifecycle

As a developer,
I want explicit disconnect and reconnect controls,
So that I can recover from reloads or drops without restarting VS Code.

**Acceptance Criteria:**

**Given** an active session
**When** I run Disconnect
**Then** the session closes cleanly
**And** state becomes disconnected.

**Given** a disconnected or broken session
**When** I run Reconnect
**Then** the extension attempts recovery using current configuration
**And** reports success or failure within the reconnect SLA.

**Given** reconnect fails
**When** diagnostics are rendered
**Then** the root-cause category is explicit
**And** the next recovery step is clear.

**Traceability Note:** Validates NFR2 (reconnect response timing) and NFR4 (reconnect restores execution capability).

## Story 1.5: Preserve DevTools Coexistence

As a developer,
I want kernel connectivity to coexist with browser DevTools attachment,
So that I can debug and iterate notebooks at the same time.

**Acceptance Criteria:**

**Given** DevTools is attached to the same browser context
**When** kernel connection is active
**Then** forced disconnect does not occur
**And** execution capability remains available.

**Given** reconnect is invoked during active DevTools usage
**When** reconnect completes
**Then** session viability is preserved or explicit error is returned
**And** no silent failure path exists.

**Given** coexistence behavior regresses
**When** integration tests run
**Then** deterministic tests fail
**And** the regression is attributable to coexistence checks.

**Traceability Note:** Validates NFR8 (DevTools coexistence without forced disconnect).

## Story 1.6: Surface Connection State and Recovery Actions

As a developer,
I want one authoritative, low-noise state indicator with accessible labels,
So that I always know readiness and the next action.

**Acceptance Criteria:**

**Given** any lifecycle transition
**When** status updates
**Then** one authoritative label is shown (Disconnected, Connecting, Connected, Error)
**And** text remains the primary state channel.

**Given** error or disconnected state
**When** I inspect status details
**Then** reconnect and configuration guidance is available
**And** guidance is actionable and concise.

**Given** narrow panes or theme variation
**When** state is displayed
**Then** readability remains intact
**And** color is not the sole indicator.

**Given** keyboard-only interaction
**When** I execute connection controls
**Then** primary actions are reachable without pointer interaction
**And** command outcomes are announced in notebook or status feedback.

**Given** critical state or error messages are rendered
**When** I review status or diagnostics
**Then** each message includes explicit text labels
**And** color is supplemental and never the sole indicator.

## Story 1.7: Automate VSIX Release via CI

As a developer,
I want a GitHub Actions workflow that builds and publishes a VSIX artifact when a release tag is pushed,
So that I can install the extension manually from a known-good packaged build.

**Acceptance Criteria:**

**Given** a release tag (e.g., `v*`) is pushed to the repository
**When** the CI workflow triggers
**Then** it builds the extension, packages it as a `.vsix` file, and attaches it to the GitHub Release
**And** the workflow completes without manual intervention.

**Given** the generated VSIX artifact
**When** a user downloads and installs it via `code --install-extension`
**Then** the extension activates and registers its commands
**And** no runtime load errors occur.

**Given** a build failure during the CI workflow
**When** packaging or compilation fails
**Then** the workflow exits with a clear failure status
**And** no partial or corrupt VSIX is attached to the release.

---
