# Copilot Instructions

## Status

This file is an interim instruction set created after BMAD planning artifacts were added. Earlier versions of this file described a speculative implementation and architecture that are no longer canonical.

Until a dedicated architecture artifact exists, treat `docs/prd.md` as the primary source of truth for product scope and technical direction. Use `docs/product-brief.md` for supporting context and `spike/cdp-multiplex-findings.md` for CDP multiplexing research.

Do not assume that previously documented folders, files, panels, or flows already exist in code. Verify the workspace before making implementation decisions.

## Project Overview

`jupyter-browser-kernel` is a VS Code extension for rapid FoundryVTT macro iteration against a live Foundry browser session.

The current planned v1 direction is:

- JavaScript notebook scratchpad execution against a live Foundry page.
- Browser-level CDP connection with target-session multiplexing so the extension can coexist with Edge DevTools.
- A thin companion Foundry module that exposes namespace/version/output helpers.
- Lightweight value inspection and intentional output viewing.
- Manual reconnect and explicit module handshake states.

## Canonical Sources

When instructions conflict, use this precedence order:

1. Reality in the current codebase.
2. `docs/prd.md`.
3. `docs/product-brief.md`.
4. `spike/cdp-multiplex-findings.md`.
5. This file.

If the PRD and the existing code disagree, preserve working code unless the task is explicitly to realign implementation with planning artifacts.

## Stable Technical Constraints

- Language: TypeScript with strict mode.
- Runtime: VS Code extension APIs.
- CDP client library: `chrome-remote-interface`.
- Bundling: esbuild to a single ESM extension entry (`dist/extension.mjs`).
- Notebook dependency: `ms-toolsai.jupyter` is NOT in `extensionDependencies`. It was removed because no current code calls Jupyter APIs and the dependency forced the extension into the container workspace host, blocking CDP access. When the NotebookController is implemented (Epic 2), users need Jupyter installed, but it does not need to be a hard extension dependency — `vscode.notebooks.createNotebookController` is a core VS Code API.
- Activation event should remain scoped to `onCommand:jupyterBrowserKernel.connect` unless requirements change.
- Settings use the `jupyterBrowserKernel.*` namespace.

Current contributed settings from `package.json` are:

- `jupyterBrowserKernel.cdpHost`
- `jupyterBrowserKernel.cdpPort`
- `jupyterBrowserKernel.watchAutoRefreshInterval`

## Planning Constraints From The PRD

These are currently the most important planning constraints to preserve:

- Use browser-level CDP WebSocket multiplexing and per-target flat sessions for DevTools coexistence.
- Attach only to Foundry page targets whose URL contains `/game`.
- Treat DevTools coexistence as a first-class requirement, not a nice-to-have.
- Keep runtime execution JavaScript-only for v1.
- Normalize evaluation failures into a shared result contract instead of leaking raw CDP errors directly to each UI surface.
- Manual reconnect is in scope for MVP; automatic reconnect is deferred.
- Companion-module handshake states matter: missing, legacy, mismatch, and ok.
- Prefer intentional output capture over broad console mirroring.
- Respect CDP serialization limits; do not design around deep object mirroring unless planning artifacts change.

## Working Rules For Agents

- Do not reintroduce outdated assumptions from older versions of this file, especially speculative log-panel architecture, fixed file trees, or implementation details not backed by current docs or code.
- Do not invent a `src/` layout, module boundaries, or webview structure unless the task is explicitly to create them.
- Before implementing features, confirm whether they are MVP scope or post-MVP scope in `docs/prd.md`.
- Keep docs and planning artifacts aligned when code changes materially affect user workflows or architecture.
- If you need architectural detail that the PRD does not settle, call that out explicitly instead of guessing.

## Coding Standards For Agents

- Do not hardcode user-facing strings in source files. Route user-visible text through localization (`vscode.l10n.t(...)`) and keep message keys/content in localization resources.
- Do not define complex ad hoc object types directly in function signatures. Prefer named type aliases or interfaces for non-trivial shapes.
- Do not duplicate library-owned types in local code. Reuse source types directly; when a narrowed shape is needed, bind to the source type with utilities such as `Pick`, `Partial`, and indexed access types.
- Prefer single-assignment `const` initialization over `let` followed by mutation. If initialization requires multiple steps, prefer a small inline IIFE that still returns a `const` value.

## Build And Dev Commands

```bash
npm install
npm run compile
npm run watch
npm run lint
npm run test
```

Press `F5` in VS Code to launch the Extension Development Host.
