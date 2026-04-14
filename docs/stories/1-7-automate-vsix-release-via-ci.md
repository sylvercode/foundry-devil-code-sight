---
storyId: "1.7"
storyKey: "1-7-automate-vsix-release-via-ci"
title: "Automate VSIX Release via CI"
status: "review"
created: "2026-04-13"
epic: "1"
priority: "p1"
---

# Story 1.7: Automate VSIX Release via CI

**Status:** review

## Story

As a developer,
I want a GitHub Actions workflow that builds and publishes a VSIX artifact when a release tag is pushed,
So that I can install the extension manually from a known-good packaged build.

## Acceptance Criteria

### AC 1: CI Triggers on Version Tag Push

**Given** a release tag prefixed with `v` (e.g., `v0.1.0`) is pushed to the repository
**When** the CI workflow triggers
**Then** it builds the extension, packages it as a `.vsix` file, and attaches it to the GitHub Release
**And** the workflow completes without manual intervention.

### AC 2: VSIX Installs and Activates Cleanly

**Given** the generated VSIX artifact
**When** a user downloads and installs it via `code --install-extension`
**Then** the extension activates and registers its commands
**And** no runtime load errors occur.

### AC 3: Build Failure Prevents Corrupt Artifact

**Given** a build failure during the CI workflow
**When** packaging or compilation fails
**Then** the workflow exits with a clear failure status
**And** no partial or corrupt VSIX is attached to the release.

## Tasks / Subtasks

### 1. Create GitHub Actions Workflow File (AC: 1, 3)

- [x] Create `.github/workflows/release.yml`.
- [x] Configure trigger: `on: push: tags: ['v*']` — fires only when a tag prefixed by `v` (like `v0.1.0`) is pushed.
- [x] Define a single job (`release`) running on `ubuntu-latest`.
- [x] Use `actions/checkout@v4` to check out the tagged commit.
- [x] Use `actions/setup-node@v4` with `node-version: 20` and `cache: 'npm'` to match the project's Node 20 target.
- [x] Run `npm ci` for deterministic dependency install.
- [x] Run `npm run lint` — fail the workflow on lint errors.
- [x] Run `npm run test:compile && npm run test:unit` — fail on test failures. Integration tests are excluded (they require a live browser).
- [x] Run `npm run compile` — fail on build errors (esbuild step that produces `dist/extension.mjs`).
- [x] Run `npx vsce package` to produce the `.vsix` artifact.
- [x] Verify the `.vsix` file exists after packaging (glob `*.vsix`). Fail if missing.

### 2. Attach VSIX to GitHub Release (AC: 1, 2)

- [x] Use `softprops/action-gh-release@v2` to create/update the GitHub Release associated with the pushed tag.
  - Set `files: '*.vsix'` to attach the packaged VSIX.
  - Set `fail_on_unmatched_files: true` so the job fails if no VSIX was produced.
  - Set `generate_release_notes: true` for automatic release notes from commits since last tag.
- [x] Ensure the workflow has `permissions: contents: write` so the release action can create releases and upload assets.

### 3. Add VSIX to `.gitignore` (AC: 3)

- [x] Add `*.vsix` pattern to `.gitignore` to prevent accidentally committing packaged artifacts.

### 4. Validate Workflow Locally (AC: 1, 2, 3)

- [x] Verify the workflow YAML is valid (no syntax errors).
- [x] Verify `npm run package:vsix` works locally and produces a `.vsix` file in the project root.
- [x] Verify the locally-produced `.vsix` installs in VS Code via `code --install-extension *.vsix` (if Extension Development Host available).
- [x] Review that the workflow does NOT trigger on branch pushes or PRs — only on `v*` tags.

## Dev Notes

### Story Context and Scope

- This is the final story in Epic 1 (Connect and Control Browser Sessions). All prior stories (1.1–1.6) are done or in review.
- This story is purely CI/CD infrastructure — no changes to extension runtime code.
- The architecture document states: "Distribution: Local/dev only for MVP — no Marketplace publishing" and "CI can be introduced with compile, lint, and test gates, but marketplace release automation is deferred." [Source: docs/architecture.md#Infrastructure-and-Deployment]
- This story implements the "compile, lint, and test gates" CI that architecture anticipated, plus VSIX artifact attachment for manual installation. It does NOT publish to the VS Code Marketplace.

### Architecture Guardrails (Must Follow)

- **Build system:** esbuild produces `dist/extension.mjs` (ESM output). The `npm run compile` command runs `npm run clean` then `node esbuild.config.js`. [Source: package.json scripts, esbuild.config.js]
- **Packaging command:** `npx vsce package` is the canonical packaging command. It's also available as `npm run package:vsix` (which runs compile first). [Source: package.json scripts]
- **External dependencies:** `chrome-remote-interface` and `ws` are externalized in esbuild and must be in `dependencies` (not `devDependencies`) so `vsce` bundles them into the VSIX `node_modules`. [Source: esbuild.config.js external array, package.json dependencies]
- **`.vscodeignore`:** Already correctly configured to exclude source, tests, docs, build configs, and sourcemaps from the VSIX package. Only `dist/`, `l10n/`, `package.json`, `package.nls.json`, `LICENSE`, `README.md`, and runtime `node_modules` should be included. [Source: .vscodeignore]
- **Node version:** Target is Node 20 (`target: 'node20'` in esbuild.config.js). CI must use Node 20.
- **Test runner:** Unit tests use Node's built-in test runner — `npm run test:unit` runs `npm run test:compile && node --test "out/tests/unit/**/*.test.js"`. The `test:compile` step uses `tsconfig.test.json`. [Source: package.json scripts]
- **No secrets required:** This workflow produces a publicly-attachable artifact. No Marketplace PAT or signing keys are needed.

### Key Design Decisions

- **Trigger on `v*` tags only:** The user explicitly requires the CI to trigger on tags prefixed by `v` like `v0.1.0`. This ensures releases are intentional and version-correlated.
- **No Marketplace publishing:** Architecture explicitly defers this. The VSIX is attached to a GitHub Release for manual sideload installation.
- **Lint + unit test gates:** Run before packaging to catch regressions. Integration tests are excluded because they require a live browser with CDP.
- **`softprops/action-gh-release`:** Well-maintained GitHub Action for creating releases and uploading assets. Avoids hand-rolling the GitHub API.
- **Single job, not matrix:** There is only one target platform (Node 20 on ubuntu-latest). No need for matrix builds.

### Workflow File Structure

The workflow file should be placed at `.github/workflows/release.yml` and follow this structure:

```yaml
name: Release VSIX

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "npm"
      - run: npm ci
      - run: npm run lint
      - run: npm run test:compile
      - run: npm run test:unit
      - run: npm run compile
      - run: npx vsce package
      - uses: softprops/action-gh-release@v2
        with:
          files: "*.vsix"
          fail_on_unmatched_files: true
          generate_release_notes: true
```

### Files to Create/Modify

| File                            | Action     | Purpose                                                |
| ------------------------------- | ---------- | ------------------------------------------------------ |
| `.github/workflows/release.yml` | **Create** | GitHub Actions workflow for tag-triggered VSIX release |
| `.gitignore`                    | **Modify** | Add `*.vsix` pattern to prevent committing artifacts   |

### What NOT to Do

- Do NOT publish to the VS Code Marketplace — that is explicitly deferred by architecture.
- Do NOT add `VSCE_PAT` or any secrets — no marketplace tokens needed.
- Do NOT run integration tests in CI — they require a live browser and CDP connection.
- Do NOT use `npm run package:vsix` in the workflow — it redundantly runs compile again. Run compile and vsce package as separate steps so failures are attributable.
- Do NOT add complex matrix builds — single Node 20 / ubuntu-latest is sufficient.
- Do NOT modify any extension source code (`src/`) — this story is purely CI infrastructure.

### Previous Story Intelligence (Story 1.6)

- Story 1.6 is in `review` status. It added output channel logging, status bar enhancements, and error context wiring. No CI-relevant changes.
- All existing unit tests pass (`npm run test:unit`). The test infrastructure is stable.
- The `npm run compile` pipeline is clean — last verified by the compile terminal in the current session.

### Git Intelligence

- Branch: `surface-connection-state-and-recovery-actions` (1.6 work).
- Recent commits are all 1.5/1.6 implementation — no CI-related changes have been made.
- No `.github/workflows/` directory exists yet — this story creates the first workflow.

### Project Structure Notes

- `.github/` directory exists (contains copilot instructions and skills) but has no `workflows/` subdirectory.
- The workflow file at `.github/workflows/release.yml` follows standard GitHub Actions conventions.
- No conflicts with existing project structure.

### References

- [Source: docs/architecture.md#Infrastructure-and-Deployment] — CI gates and distribution scope
- [Source: docs/architecture.md#Starter-Template-Evaluation] — Packaging with `@vscode/vsce@3.7.1`
- [Source: docs/epics/epic-1-connect-and-control-browser-sessions.md#Story-1.7] — AC definitions
- [Source: package.json#scripts] — Build, test, and packaging commands
- [Source: esbuild.config.js] — Bundle configuration and externals
- [Source: .vscodeignore] — VSIX content exclusion rules
- [Source: .github/copilot-instructions.md] — Build and dev commands

## Dev Agent Record

### Agent Model Used

GPT-5.3-Codex

### Debug Log References

- Workflow YAML validation: `npx --yes js-yaml .github/workflows/release.yml >/dev/null`
- Local validation: `npm run lint && npm run test:compile && npm run test:unit && npm run compile && npm run package:vsix`
- VSIX artifact verification: `ls -1 *.vsix`
- Local install verification: `code --install-extension jupyter-browser-kernel-0.0.1.vsix`

### Completion Notes List

- Implemented `.github/workflows/release.yml` with `v*` tag trigger, Node 20 setup, lint/test/compile gates, VSIX packaging, and release asset upload.
- Added explicit VSIX existence verification step prior to release publishing to prevent empty release assets.
- Confirmed `permissions: contents: write` is set for release creation/upload.
- Verified local gates pass: lint, test compile, unit tests, compile, and VSIX packaging.
- Verified local VSIX install succeeds via `code --install-extension jupyter-browser-kernel-0.0.1.vsix`.
- Confirmed `.gitignore` already included `*.vsix`; no additional ignore-file change required.

### File List

- .github/workflows/release.yml (created)
- docs/stories/1-7-automate-vsix-release-via-ci.md (updated)

## Change Log

- 2026-04-13: Implemented Story 1.7 CI workflow and validated local VSIX packaging/install.
