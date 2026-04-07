---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: []
session_topic: "Preparing for the planning phase of JupyterBrowserKernel"
session_goals: "Uncover technical risks and unknowns to investigate before planning"
selected_approach: "ai-recommended"
techniques_used:
  ["Reverse Brainstorming", "Assumption Reversal", "Constraint Mapping"]
ideas_generated: []
context_file: ""
---

# Brainstorming Session Results

**Facilitator:** Sylvercode
**Date:** 2026-03-14

## Session Overview

**Topic:** Preparing for the planning phase of JupyterBrowserKernel
**Goals:** Uncover technical risks and unknowns to investigate before planning

### Session Setup

_Fresh session initialized to explore ideas and possibilities for the project planning phase._

## Technique Selection

**Approach:** AI-Recommended Techniques
**Analysis Context:** Preparing for the planning phase of `JupyterBrowserKernel` with focus on uncovering technical risks and unknowns before planning

**Recommended Techniques:**

- **Reverse Brainstorming:** Surface failure modes and dangers by asking "how could this break?" before planning
- **Assumption Reversal:** Challenge core architectural assumptions that were never explicitly validated
- **Constraint Mapping:** Catalog real vs. imagined limits (VS Code API, CDP protocol, esbuild) to bound the solution space

**AI Rationale:** This sequence moves from surfacing hidden dangers → challenging what we think we know → mapping hard limits. Designed to stress-test the project before any commitments are made in the planning document.

---

## Technique Execution Results

**Approach:** AI-Facilitated — Reverse Brainstorming → Assumption Reversal → Constraint Mapping
**Note:** Session organically followed the risk discovery thread rather than strict technique sequence; all three techniques were implicitly applied throughout.

---

## Idea Organization and Prioritization

### Theme 1 🔴 — Architecture Foundation Risks

_The non-negotiable decisions that shape everything else_

**[Risk #24 — ❗ SPIKE REQUIRED]**: CDP Exclusive WebSocket Connection
_Concept:_ Each browser tab exposes a single WebSocket endpoint. Only one client can hold the connection. If both the VS Code extension and Edge DevTools try to connect to the same page target, one will kick the other out — no error, just disconnection.
_Novelty:_ This isn't a bug — it's the protocol's design. Affects every feature simultaneously.

**[Idea #21]**: Browser-Level WebSocket + `Target.attachToTarget` Multiplexing
_Concept:_ Connect `chrome-remote-interface` to the browser-level WebSocket and use `Target.attachToTarget` to create a named session for the page target. Chrome supports multiple sessions over the browser WebSocket — Edge DevTools and the extension coexist without conflict.
_Novelty:_ A single architectural change in `cdp/client.ts` unlocks full coexistence with any other DevTools client.

**[Risk #25]**: `chrome-remote-interface` multiplexing support is unverified — may need a custom wrapper or alternative library.

---

### Theme 2 🟡 — CDP Serialization & Data Model

_What CDP can and can't give you_

**[Idea #1]**: Shallow Watch + Watch Chaining
_Concept:_ The watcher only evaluates and displays the immediate value of an expression. Reference objects show a primitive identifier (UUID). Users create additional watch expressions to drill in.
_Novelty:_ Turns a serialization limitation into a deliberate UX pattern — like a debugger's variable inspector.

**[Idea #2]**: UUID as the Navigation Primitive
_Concept:_ When a watch returns a reference object, display its UUID. User creates a new watch using `(await fromUUID("Actor.abc123")).system.hp.value`. `fromUUID` is FoundryVTT's universal accessor — works for any document type.
_Novelty:_ Leverages FoundryVTT's own navigation API. Zero serialization magic needed.

**[Idea #10]**: Unified `EvalResult` Type in `runtime.ts`
_Concept:_ The `Runtime.evaluate` wrapper normalizes both error paths — CDP `exceptionDetails` (syntax errors) and `__fdcs_error` envelope (runtime errors) — into a single typed result: `{ ok: true, value } | { ok: false, name, message, stack }`.
_Novelty:_ Error normalization lives in the CDP layer. All consumers (watcher, cells, actions) share one contract.

---

### Theme 3 🟢 — Notebook Cell Architecture

_How cells run, isolate, and share state_

**[Idea #3]**: IIFE Cell Isolation + Explicit Global Namespace
_Concept:_ Every cell wrapped in `(async () => { ... })()`. Variables never leak. Re-runnable without "can't redeclare". Shared state via `window.$foundryNotebook` (`$f`) — opt-in, explicit.
_Novelty:_ Isolation by default, sharing by intention. Mirrors how ES modules work.

**[Idea #4]**: Structured IIFE Wrapper with Error Envelope
_Concept:_ The IIFE includes a try/catch returning `{ __fdcs_error: true, message, name, stack }` on failure. The NotebookController inspects the return value to decide output MIME type.
_Novelty:_ Error handling moves from CDP protocol layer into JS layer — cleaner, more predictable across Chrome versions.

**[Idea #6]**: Module-Provided `$f.out(value)` Output Convention
_Concept:_ Instead of auto-detecting last expressions, users call `$f.out(value)` explicitly in cells. The IIFE wrapper checks if `$f.__lastOutput` was set during execution and returns it.
_Novelty:_ Output is a first-class API, not a JS parsing hack.

**[Risk #9 — Handled]**: Syntax errors escape try/catch via CDP `exceptionDetails`. The unified `EvalResult` type (Idea #10) handles both paths.

---

### Theme 4 🔵 — Companion FoundryVTT Module

_The runtime foundation on the Foundry side_

**[Idea #5]**: Companion Module as Runtime Foundation
_Concept:_ A FoundryVTT module initializes `window.$foundryNotebook` on every `Hooks.once("ready")` — solving page-reload wipes and init races. Provides `$f.out()`, `$f.log()`, and `__version`.
_Novelty:_ Clean split: module owns Foundry-side runtime, extension owns VS Code-side tooling.

**[Idea #11]**: Thin Module Strategy
_Concept:_ v1 module only does: namespace init + `__version` + `$f.out()` + `$f.log()`. Zero Foundry API convenience wrappers. Version surface is near-zero.
_Novelty:_ Version risk scales with module ambition, not Foundry itself.

**[Idea #14]**: Three-State Module Handshake
_Concept:_ Evaluates `{ exists: !!window.$foundryNotebook, version: window.$foundryNotebook?.__version ?? null }`. Maps to: missing → install instructions; legacy (exists, no version) → update prompt; version mismatch → version warning; OK → silent proceed.
_Novelty:_ Distinguishes "never installed" from "installed but stale."

**[Idea #7]**: Connect-Time Handshake with Guided Install
_Concept:_ On connect, run the handshake. If module missing, `showWarningMessage` includes a "Show Install Instructions" button opening a WebviewPanel with the manifest URL and step-by-step Foundry install screenshots.
_Novelty:_ The extension becomes its own onboarding guide at the exact moment the user needs it.

**[Idea #9]**: Configurable Connect Retry Settings
_Concept:_ `jupyterBrowserKernel.connectRetryInterval` (default: 2000ms) + `jupyterBrowserKernel.connectRetryTimeout` (default: 30000ms). Polls `game?.ready === true` before running the handshake. Set `connectRetryInterval: 0` to disable.
_Novelty:_ User-controlled resilience — devcontainer users set longer timeouts; local users set 0.

**[Idea #13]**: GitHub Release as Distribution Contract
_Concept:_ Module published as a GitHub release. Manifest URL is stable per release. Extension hardcodes this URL and surfaces it in install instructions. No official listing needed for v1.

---

### Theme 5 🟣 — Actions & Parameterization

_Saved reusable function calls_

**[Idea #15]**: Cell-to-Action Promotion
_Concept:_ VS Code command on any notebook cell: "Save as Foundry Action" → prompts for name → appends to `.foundry-actions.json`. Actions panel executes via same IIFE wrapper as cells.
_Novelty:_ The notebook graduates successful experiments into reusable tools.

**[Idea #16]**: Workspace-Scoped `.foundry-actions.json`
_Concept:_ Actions live in `.foundry-actions.json` at workspace root — not in VS Code settings. Project-specific, committable, shareable with the team.

**[Idea #17]**: Bidirectional Cell ↔ Action Flow
_Concept:_ "Save as Foundry Action" (cell → action) + "Open Action as Cell" (action → cell for editing). The cycle: run action → needs fixing → open as cell → iterate → re-promote.
_Novelty:_ The notebook is both scratchpad AND editor for saved actions.

**[Idea #18]**: `$prompt()` Pre-Execution Substitution
_Concept:_ `$prompt("label", "default")` in cell or action source triggers VS Code `showInputBox` before CDP eval. Extension substitutes values into source; CDP receives plain JS. Works for cells and actions alike.
_Novelty:_ Runtime parameters without browser-side plumbing. `$prompt` is a source-level macro.

---

### Theme 6 ⚪ — Log Viewer (Rescoped)

_Deliberate script output, not a console mirror_

**[Idea #19]**: Sentinel-Prefixed `$f.log()` in Companion Module
_Concept:_ `$f.log(value)` does `console.log("__FDCS_OUT_v1__", value)`. Extension's `Runtime.consoleAPICalled` listener filters for the sentinel prefix only — everything else ignored.
_Novelty:_ Turns an existing CDP event stream into a selective output channel with zero new infrastructure.

**[Idea #20]**: Log Panel → VS Code `OutputChannel`
_Concept:_ Replace `logPanel.ts` WebviewPanel with a `vscode.OutputChannel` named "FoundryVTT Script Output". Simpler, native, sufficient for the narrow use case.
_Novelty:_ Eliminates WebviewPanel complexity entirely for this feature.

---

## Prioritization

| Priority                | Item                                         | Rationale                                                                                          |
| ----------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 🔴 **#1 — Spike first** | CDP multiplexing feasibility (Risk #24/25)   | Blocks everything — if `chrome-remote-interface` can't do it, `cdp/client.ts` architecture changes |
| 🟡 **#2**               | Companion module v1 (thin)                   | Unblocks cells, watcher, log, and handshake simultaneously                                         |
| 🟢 **#3**               | IIFE wrapper + error envelope + `EvalResult` | Core cell/watcher execution contract                                                               |
| 🔵 **#4**               | Three-state handshake + retry settings       | User-facing robustness on connect                                                                  |
| 🟣 **#5**               | Shallow watch + UUID chaining                | Watcher feature completeness                                                                       |
| ⚪ **#6**               | Actions + `$prompt()` + bidirectional flow   | Powerful but non-blocking for v1                                                                   |

---

## Session Summary and Insights

**Key Achievements:**

- 20 ideas and 25 risks surfaced and resolved across all major feature areas
- One critical spike identified (CDP multiplexing) that must precede planning
- The companion FoundryVTT module emerged as an unplanned but essential architectural component
- Feature scope clarified: watcher (shallow + UUID chaining), cells (IIFE isolated), actions (cell↔action bidirectional), log (OutputChannel only)
- Edge DevTools integration reframed: the extension complements Edge DevTools, does not replace it

**Breakthrough Moments:**

- `fromUUID()` as the navigation primitive resolves the serialization problem elegantly without custom object inspection
- The companion module solving multiple risks at once (page reload, init race, version detection, `$f.out()`, `$f.log()`)
- `$prompt()` as a source-level macro — no browser-side plumbing needed
- The log viewer rescoping from full console mirror to deliberate `$f.log()` output channel

**Immediate Next Steps:**

1. **Spike this week:** Test `chrome-remote-interface` with `Target.attachToTarget` + multiple simultaneous sessions. If blocked, evaluate `puppeteer-core` or a custom WebSocket multiplexer
2. **Only after spike resolves:** Begin planning `cdp/client.ts` architecture
3. **Plan companion module in parallel:** Structure, `module.json`, `Hooks.once("ready")` init, `__version`, `$f.out()`, `$f.log()`
4. **Plan IIFE wrapper + `EvalResult` type** as the shared execution contract
