---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments:
  - docs/prd.md
  - docs/epics/epic-2-execute-javascript-cells-no-intentional-capture.md
  - spike/cdp-multiplex-findings.md
workflowType: "research"
lastStep: 6
research_type: "technical"
research_topic: "CDP //# sourceURL behavior, per-cell source identity, line-preserving wrappers, and Debugger.enable coexistence with Edge DevTools (Stories 2.4 / 2.5)"
research_goals: "Confirm feasibility and choose an implementation approach for per-cell sourceURL identity, breakpoint binding via Debugger.enable on a per-target flat session, line-number preservation under wrapping lambdas, and an evaluation path that preserves both top-level await (Story 2.2) and breakpoint binding — without displacing Edge DevTools."
user_name: Sylvercode
date: "2026-04-19"
web_research_enabled: true
source_verification: true
---

# Research Report: technical

**Date:** 2026-04-19
**Author:** Sylvercode
**Research Type:** technical

---

## Research Overview

Feasibility and implementation-approach study for `//# sourceURL` directive behavior, per-cell source identity, line-preserving wrapping lambdas, and `Debugger.enable` interaction with Edge DevTools coexistence — in support of **Story 2.4 (Fast Rerun and Iteration Patterns)** and **Story 2.5 (Source-Level Breakpoint Debugging)**.

Methodology: parallel web research with multi-source verification (CDP docs, V8/Chromium source and issues, `chrome-remote-interface`, prior art from Jupyter/notebook tooling and DevTools), recorded with citations and confidence levels.

---

## Executive Summary

Stories 2.4 and 2.5 are **feasible**, but six unresolved questions about V8/CDP behavior and multi-client `Debugger`-domain coexistence cannot be answered from public documentation. The recommended path is **spike-then-implement**: a small two-mode harness (interactive + headless integration-test) under `spike/` resolves the gaps in days, locks the architectural choices, and de-risks Story 2.5 — which under the recommended posture becomes nearly trivial because Story 2.4 has already done the writer-side work.

**Top findings:**

- **Per-cell `//# sourceURL` is the entire breakpoint contract** the extension owes. The extension is a **passive script provider**; the user, via Edge DevTools, is the breakpoint client. This corrects the original Story 2.5 framing.
- **Identity must derive from `notebook-uri` + `cell-index`, not content hash** — otherwise every edit orphans the user's breakpoint.
- **Line-number 1:1 preservation is achievable** by same-line wrapper concatenation (safe baseline) or by inline source maps (preferred _if_ Spike Q6 confirms DevTools honors them).
- **Recommended `Debugger`-domain posture: Passive Provider** — the extension never calls `Debugger.enable`. This is the lowest-risk DevTools-coexistence stance and likely satisfies Story 2.5 without modification, but Spike Q2 must confirm DevTools-set breakpoints fire under our `Runtime.evaluate`.
- **Recommended evaluation path: `Runtime.evaluate` + async-IIFE wrapper, no `replMode`** — the well-trodden combination, no EXPERIMENTAL flag dependency. Promote `replMode` only if the spike shows a concrete, breakpoint-compatible advantage.
- **Transport-layer multiplexing is already solved** by the existing browser-level + flat-session attach pattern ([spike/cdp-multiplex-findings.md](spike/cdp-multiplex-findings.md)). All remaining coexistence risk is at the `Debugger`-domain state layer.

**Top recommendations:**

1. **Run the spike before implementing Story 2.5.** Six questions, two run modes, output is a markdown findings file mirroring the existing multiplex spike.
2. **Reconsider Story 2.5 AC #1** (“`Debugger.enable` is invoked on the per-target session”) once Spike Q2 is answered — it may become vacuous under the Passive Provider posture.
3. **Land Story 2.4 first**; it is independently shippable and gives users better stack traces immediately.
4. **Add a `sourceURL`-stability snapshot test** as the regression guard for the breakpoint contract before any production wrapper-builder code lands.
5. **Document the cell-reorder sharp edge** — index-based identity will silently re-target user breakpoints on cell move/insert. Acceptable for v1; revisit if reorder becomes a common operation.

---

## Table of Contents

1. [Technical Research Scope Confirmation](#technical-research-scope-confirmation)
2. [Technology Stack Analysis](#technology-stack-analysis) — languages, libraries, CDP domains, role split, CDP findings A–G, critical documentation gaps
3. [Integration Patterns Analysis](#integration-patterns-analysis) — protocol framing, message routing, identity contract, multi-client coexistence, failure modes
4. [Architectural Patterns and Design](#architectural-patterns-and-design) — source-identity pattern, wrapper-transformation pattern, evaluation-path selection, Debugger-domain posture, failure-domain boundaries
5. [Implementation Approaches and Spike Plan](#implementation-approaches-and-spike-plan) — spike-then-implement strategy, harness design, spike-question → test mapping, tooling, testing, risks, implementation order, success metrics

---

## Technical Research Scope Confirmation

**Research Topic:** CDP `//# sourceURL` behavior, per-cell source identity, line-preserving wrappers, and `Debugger.enable` coexistence with Edge DevTools (Stories 2.4 / 2.5)

**Research Goals:**

- Confirm `//# sourceURL` registers a stable script identity in the browser's Sources panel across cell reruns.
- Determine the correct evaluation path that preserves both top-level `await` (Story 2.2) **and** breakpoint binding: `Runtime.evaluate { replMode: true }` vs. `Runtime.compileScript` + `Runtime.runScript` vs. alternatives.
- Verify wrapping-lambda transformations can preserve 1:1 user-visible line numbers (no synthesized lines shifting offsets).
- Confirm `Debugger.enable` on a per-target flat session does **not** displace Edge DevTools' own debugger (NFR8).
- Identify failure modes (reload/navigation invalidating scriptIds, breakpoint resolution race, source map collisions, REPL-mode debugger limitations).

**Technical Research Scope:**

- Architecture Analysis — CDP Runtime/Debugger domain semantics, script lifecycle, target-session multiplexing implications
- Implementation Approaches — `replMode` vs `compileScript`/`runScript`, line-preserving wrappers, sourceURL formatting conventions
- Technology Stack — `chrome-remote-interface`, V8 debugger protocol, Edge/Chromium DevTools frontend behavior
- Integration Patterns — Per-target flat-session attach, debugger-domain coexistence with concurrent DevTools client
- Edge Cases & Failure Modes — Reload/navigation invalidating scriptIds, breakpoint resolution race, source map collisions

**Research Methodology:**

- Current web data with rigorous source verification
- Multi-source validation for critical technical claims
- Confidence-level framework for uncertain information
- Comprehensive technical coverage with architecture-specific insights

**Scope Confirmed:** 2026-04-19

---

<!-- Subsequent steps will append below -->

## Technology Stack Analysis

> Adapted from the generic "technology stack" template to focus on the runtime/protocol surface area relevant to Stories 2.4 and 2.5. Source citations and confidence labels (High / Medium / Low) accompany every claim. Where official documentation is silent, this is recorded as a gap rather than inferred.

### Programming Languages

- **TypeScript (extension host)** — strict mode, ESM bundle to `dist/extension.mjs` (project constraint, see [.github/copilot-instructions.md](.github/copilot-instructions.md)). _Confidence: High._
- **JavaScript (runtime target)** — code authored in cells is JavaScript-only for v1 (PRD constraint). _Confidence: High._
- **V8 / JavaScriptCore parity** — V8 is the only engine in scope (Edge/Chromium); no cross-engine concerns. _Confidence: High._

### Development Frameworks and Libraries

- **`chrome-remote-interface`** — selected CDP client. Supports per-target flat sessions and arbitrary domain method invocation. _Source: project constraint; library on npm._ _Confidence: High._
- **VS Code Notebook API** — `vscode.notebooks.createNotebookController` is a core API; `ms-toolsai.jupyter` is intentionally NOT an `extensionDependency` (would force container workspace host and block CDP). _Source: [.github/copilot-instructions.md](.github/copilot-instructions.md)._ _Confidence: High._
- **No alternative CDP libraries are in scope** (e.g., Puppeteer not used as a transport).

### Database and Storage Technologies

Not applicable to this research topic. The notebook stores evaluation results transiently and persists nothing of relevance to Stories 2.4 / 2.5. Recorded for template completeness.

### Development Tools and Platforms

- **Edge / Chromium DevTools** — primary coexistence target. NFR8 requires the extension's CDP client and DevTools to coexist on the same target.
- **VS Code Extension Development Host** — F5 launch path (project constraint).
- **esbuild** — single-bundle ESM extension build (project constraint).
- **`Debugger` and `Runtime` CDP domains** — the two protocol surfaces that bound this research. _Source: [Chrome DevTools Protocol — Runtime](https://chromedevtools.github.io/devtools-protocol/tot/Runtime), [Debugger](https://chromedevtools.github.io/devtools-protocol/tot/Debugger)._ _Confidence: High._

### Cloud Infrastructure and Deployment

Not applicable. Local-only execution model; no cloud surface area.

### Role Split — Who Sets Breakpoints (Scope Correction)

This research's framing was corrected mid-step. The extension is **not** a breakpoint client. Roles are:

- **The extension (this project)** — emits cells with a stable per-cell `//# sourceURL=<url>`. That is the entire contract on the breakpoint side. The extension does **not** call `Debugger.setBreakpointByUrl`.
- **The user, via Edge DevTools** — opens the cell's named script in the Sources panel and clicks the gutter to set a breakpoint. DevTools internally issues `Debugger.setBreakpointByUrl` on its **own** session.
- **V8 / the page** — when the cell is re-evaluated under the same `sourceURL`, V8 emits `Debugger.scriptParsed`; DevTools' pre-existing breakpoint matches by URL and binds. This is exactly the "logical breakpoint survives parsing of new matching scripts" semantic documented for [Debugger.setBreakpointByUrl](https://chromedevtools.github.io/devtools-protocol/tot/Debugger/#method-setBreakpointByUrl). _Confidence: High._

Therefore the extension's _only_ breakpoint-relevant obligation is **emit the same `sourceURL` for the same cell, every time**. `Debugger.setBreakpointByUrl` appears in this report solely as the underlying mechanism that explains _why_ a stable `sourceURL` is sufficient.

#### Re-examining Story 2.5 AC #1 — does our session need `Debugger.enable`?

Story 2.5's AC #1 currently states: _"`Debugger.enable` is invoked on the per-target session."_ Given the role split above, this requirement deserves reconsideration:

- **Argument against calling `Debugger.enable` on our session:**
  - Multi-client `Debugger.enable` semantics are the **least-specified, highest-risk** part of CDP coexistence (NFR8). Staying `Debugger`-quiet is the safest posture.
  - V8's debugger state is process-wide. DevTools having `Debugger.enable` **should** be sufficient to make user-set breakpoints fire even during scripts evaluated by _our_ `Runtime.evaluate` call.
  - The extension does not need `Debugger.scriptParsed` events to satisfy any documented Story 2.4/2.5 acceptance criterion.

- **Possible reasons our session _might_ need `Debugger.enable`:**
  - Diagnostics / observability — confirming a cell's script registered, mapping `scriptId` ↔ `sourceURL` for our own logging.
  - Surfacing a normalized error if the Debugger domain is unavailable on the target (to satisfy AC #1's failure-mode clause).
  - **Unverified hypothesis:** that breakpoints set by _another_ client only fire when our evaluating client also has Debugger enabled. The protocol does not state this; practical behavior must be confirmed by spike.

- **Recommendation:** Treat AC #1 as **provisional**. The minimum spike (see "Critical Documentation Gaps" below) should answer: _Do user-set DevTools breakpoints fire during our `Runtime.evaluate` calls when our session has not enabled Debugger?_ If yes, AC #1 should be reframed (or removed) so the extension's debugger-domain footprint stays minimal — improving coexistence safety. If no, AC #1 stands as written.

### CDP Findings (organized by the questions Stories 2.4 / 2.5 force the architecture to answer)

#### A. `//# sourceURL` directive — script identity in DevTools Sources

- **Behavior:** The `//# sourceURL=<url>` magic comment causes a script evaluated via `Runtime.evaluate` (or compiled via `Runtime.compileScript`) to appear in the DevTools Sources panel labelled with that URL, and to surface in stack traces under that URL.
- **Documentation status:** The directive itself is **not formally documented** in the CDP spec or v8.dev. It is a de-facto V8/Chromium feature widely relied upon (Jupyter, CodeSandbox, Node.js internals).
- **Stability across reruns of the same `sourceURL`:** Behavior is **not authoritatively specified**. Practical reports indicate Chromium creates a new script entry per evaluation; the _URL grouping_ is what gives a stable label in the Sources panel and what `Debugger.setBreakpointByUrl` matches against — not the underlying scriptId.
- **Page navigation:** All evaluated scripts are invalidated on navigation; CDP emits `Runtime.executionContextsCleared`. _Source: [Runtime.executionContextsCleared](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#event-executionContextsCleared)._ _Confidence: High._
- **Implication for Story 2.4:** A stable per-cell URL (e.g., derived from notebook URI + cell index) is the correct identity contract. Stability is provided by the URL string we choose, not by anything CDP guarantees about scriptId reuse. _Confidence: Medium-High._

#### B. `Runtime.evaluate` parameters relevant to debugging

- **`replMode: true`** (EXPERIMENTAL) — "enables `let` re-declaration and top-level `await`." _Source: [Runtime.evaluate](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-evaluate)._ _Confidence: High._
  - **Caveat:** EXPERIMENTAL flag — subject to change without notice.
  - **Caveat — debugger interaction:** It is **not documented** whether `replMode` scripts are visible to the Debugger domain or whether breakpoints bind reliably to them. This is a critical gap for Story 2.5.
- **`awaitPromise`, `returnByValue`, `generatePreview`, `disableBreaks`, `silent`, `throwOnSideEffect`, `timeout`, `serializationOptions`** — all available; `disableBreaks: false` (default) is required for breakpoints to fire. _Source: same._ _Confidence: High._
- **No `lineOffset` / `columnOffset` on `Runtime.evaluate`** — these are not part of the method signature. _Confidence: High._

#### C. Alternative path — `Runtime.compileScript` + `Runtime.runScript`

- `Runtime.compileScript` accepts an explicit `sourceURL` parameter and returns a `scriptId`; `Runtime.runScript` then executes it. _Source: [Runtime.compileScript](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-compileScript), [Runtime.runScript](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-runScript)._ _Confidence: High._
- **Top-level await:** Not documented as supported on this path. Practical reports suggest top-level await requires `replMode` semantics; `compileScript` operates under classic-script rules. _Confidence: Medium._
- **Sources-panel visibility & breakpoint binding:** Strongly expected (the `sourceURL` parameter exists for this purpose), but not exhaustively documented. _Confidence: Medium._

#### D. `Debugger` domain — mechanism, not extension obligation

> Re-scoped per the "Role Split" section above. The extension does **not** call `Debugger.setBreakpointByUrl`. The mechanism is documented here only because it is what makes a stable per-cell `sourceURL` _sufficient_ for DevTools-set breakpoints to bind across reruns.

- **`Debugger.setBreakpointByUrl`** (issued by DevTools, not by us) — supports `url` (exact) or `urlRegex`. Once issued, "all existing parsed scripts will have breakpoints resolved" and subsequent matching scripts emit `Debugger.breakpointResolved`. "This logical breakpoint will survive page reloads." _Source: [Debugger.setBreakpointByUrl](https://chromedevtools.github.io/devtools-protocol/tot/Debugger/#method-setBreakpointByUrl)._ _Confidence: High._
  - **Implication for us:** as long as our cell's `sourceURL` is identical across reruns, a breakpoint the user already placed in DevTools will rebind to the next-parsed script under that URL automatically. No coordination with our extension is required.
- **`Debugger.enable` on our session — open question.** See "Re-examining Story 2.5 AC #1" above. The `debuggerId` returned by `Debugger.enable` suggests per-client tracking, but the protocol does not specify whether breakpoints set by one client fire under script evaluations issued by another. _Source: [Debugger.enable](https://chromedevtools.github.io/devtools-protocol/tot/Debugger/#method-enable)._ _Confidence: Low (key spike question)._

#### E. Multi-client / Edge DevTools coexistence

- **Documentation status:** CDP does **not** authoritatively specify multi-client `Debugger.enable` semantics on the same target.
- **Per-target flat sessions** (the project's chosen multiplexing model — see [spike/cdp-multiplex-findings.md](spike/cdp-multiplex-findings.md)) give each client its own `sessionId` and isolate request/response framing.
- **Practical concern:** Two `Debugger.enable` calls on the same target may lead to one client's pause/breakpoint state affecting the other's UI, even with separate sessions. This is the central NFR8 risk for Story 2.5 and is not resolvable from public docs alone — it requires a targeted spike with Edge DevTools attached to the same page (any page — the behavior is generic to CDP, not Foundry-specific). _Confidence: Low (risk classification: Medium-High)._

#### F. Line-preserving wrapping lambdas

- **No CDP `lineOffset` mechanism** for `Runtime.evaluate`. Compare: Node.js `vm.Script` exposes `lineOffset`/`columnOffset`. _Source: [Node vm.Script](https://nodejs.org/docs/latest/api/vm.html#class-vmscript)._ _Confidence: High._
- **Practical preservation pattern:** keep wrapper prefix and suffix on the **same lines** as the user code's first/last lines (no embedded newlines in the wrapper). Concretely: prefix `(async () => {` (no trailing newline) followed by user code starting at column 1 on what V8 reports as line 1 means user line numbers shift by 0 if the prefix is concatenated **without** a newline; or the prefix sits on line 1 with user code on line 2 — in which case Stories 2.4's "1:1" requirement requires the prefix-on-same-line concatenation. Suffix `})()` must similarly be appended with no leading newline.
- **Alternative under active investigation — inline source maps:** an inline `//# sourceMappingURL=data:application/json;base64,...` could let the wrapper occupy its own lines while still mapping `Debugger.paused` line numbers back to user-visible cell-editor lines. CDP's behavior with source maps on `Runtime.evaluate` is **not explicitly documented**, so this is a spike question (see Spike Q6 below), not a fallback to defer.
- **Recommendation:** the same-line wrapper concatenation pattern is the **safe baseline**; the source-map approach is the **investigated alternative** — if Spike Q6 confirms DevTools honors inline source maps for `Runtime.evaluate` scripts, it becomes the preferred pattern (cleaner generated code, no wrapper-line entanglement with user code).

#### G. Prior art — survey

- **`vscode-js-debug`** (microsoft/vscode-js-debug) — the canonical browser/Node debug adapter; uses CDP heavily but does not publicly document a notebook-cell `sourceURL` convention. Worth code-reading if/when implementation needs concrete patterns.
- **Jupyter VS Code extension (`microsoft/vscode-jupyter`)** — IPython kernel architecture; not directly comparable (no CDP path).
- **`donjayamanne/typescript-notebook`** — JavaScript/TypeScript notebooks in VS Code; closest published analog. No public design notes located on per-cell `sourceURL` + browser-debugger pairing.
- **Observable / Hex / CodeSandbox / Replit** — proprietary or partially open; no public documentation found describing per-cell sourceURL + breakpoint binding strategy.
- **General finding:** The combination this project pursues (per-cell `sourceURL` from a VS Code notebook with breakpoint binding via the browser's own DevTools, while DevTools is itself attached) appears to be **novel public territory**. Most prior art either (a) drives execution from Node-side `vm` (server-side notebooks) or (b) embeds its own debugger UI rather than coexisting with the browser's DevTools.

### Critical Documentation Gaps (must be resolved by spike, not by reading docs)

1. **`replMode` + Debugger visibility.** Does `replMode: true` produce a script visible in DevTools' Sources panel under our `//# sourceURL`, such that a breakpoint set there by the user binds and fires?
2. **Cross-client breakpoint firing (the AC #1 question).** Do user-set DevTools breakpoints fire during scripts evaluated by **our** `Runtime.evaluate` call when **our** session has _not_ called `Debugger.enable`? (If yes → keep our session Debugger-quiet, revise Story 2.5 AC #1.)
3. **Multi-client `Debugger.enable` coexistence.** Only relevant if (2) is "no." If we must call `Debugger.enable`, does doing so alongside Edge DevTools' own enabled Debugger destabilize either client (lost breakpoints, ghost pause events, UI desync)?
4. **First-evaluation binding.** When the user has placed a breakpoint in DevTools _before_ a cell is first run, does it bind on the first `Runtime.evaluate`? (Docs cover the "survives reload" path; first-time-evaluated-script path is implied but not explicit.)
5. **Line-number fidelity under wrapping.** With wrapper-on-same-line concatenation (`(async()=>{` prefix and `})()` suffix on the same lines as the user's first/last line), do `Debugger.paused` `location.lineNumber` values match the user-visible cell-editor line?
6. **Inline source-map honoring.** Does DevTools (and the underlying V8 / `Debugger.paused` event stream) honor an inline `//# sourceMappingURL=data:application/json;base64,...` directive on a script delivered via `Runtime.evaluate`? Specifically: (a) does the Sources panel display the _original_ (mapped) source, (b) do `Debugger.paused` line numbers report the _original_ line numbers, and (c) does a user-set breakpoint in the mapped view bind and fire on rerun?

These six questions are the **minimum spike scope** that should precede implementation of Story 2.5. Question (2) is the highest-leverage one — its answer can simplify or eliminate Story 2.5 AC #1 entirely. Question (6) decides whether Pattern B (Same-Line Concatenation Wrapper) remains the implementation choice or is replaced by a source-map-based wrapper.

---

**Source consolidation:**

- [CDP Runtime.evaluate](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-evaluate)
- [CDP Runtime.compileScript](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-compileScript)
- [CDP Runtime.runScript](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-runScript)
- [CDP Runtime.executionContextsCleared](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#event-executionContextsCleared)
- [CDP Debugger.enable](https://chromedevtools.github.io/devtools-protocol/tot/Debugger/#method-enable)
- [CDP Debugger.setBreakpointByUrl](https://chromedevtools.github.io/devtools-protocol/tot/Debugger/#method-setBreakpointByUrl)
- [Node vm.Script (line offset reference pattern)](https://nodejs.org/docs/latest/api/vm.html#class-vmscript)
- [vscode-js-debug](https://github.com/microsoft/vscode-js-debug)
- [vscode-jupyter](https://github.com/microsoft/vscode-jupyter)
- Local: [spike/cdp-multiplex-findings.md](spike/cdp-multiplex-findings.md), [docs/prd.md](docs/prd.md), [docs/epics/epic-2-execute-javascript-cells-no-intentional-capture.md](docs/epics/epic-2-execute-javascript-cells-no-intentional-capture.md)

---

## Integration Patterns Analysis

> Scoped narrowly to this topic. The CDP integration surface for Stories 2.4 / 2.5 is a single WebSocket-framed protocol with per-target flat sessions; generic API-design / microservices / event-driven / OAuth template subsections do not apply here and have been omitted rather than padded with "N/A."

### CDP Protocol Framing and Per-Target Flat Sessions

- **Single WebSocket carries all sessions.** The browser-level WebSocket (`/devtools/browser/<id>` from `/json/version`) accepts unlimited clients; each client multiplexes per-target sessions over its own connection by tagging messages with `sessionId`. _Source: [spike/cdp-multiplex-findings.md](spike/cdp-multiplex-findings.md), [Target.attachToTarget](https://chromedevtools.github.io/devtools-protocol/tot/Target/#method-attachToTarget)._ _Confidence: High._
- **`flatten: true` is required** on `Target.attachToTarget` to get the flat-session framing CRI demultiplexes; the legacy nested `Target.receivedMessageFromTarget` framing is not handled. _Source: [spike/cdp-multiplex-findings.md](spike/cdp-multiplex-findings.md)._ _Confidence: High._
- **Implication for coexistence with Edge DevTools:** Edge DevTools attaches its own page-level session; our extension attaches an independent flat session via the browser endpoint. The transport-layer multiplexing is solved. The remaining coexistence risk is **at the domain-state level** (specifically `Debugger`), not at the transport level. _Confidence: High._

### Message Routing for Story 2.4 / 2.5 Specifically

- **Outbound (extension → page):** `Runtime.evaluate` (with `expression`, optional `replMode`, `awaitPromise`, `returnByValue`, `serializationOptions`, `contextId`) sent through `browser.send(method, params, sessionId)`. The domain-shorthand (`browser.Runtime.evaluate(...)`) does **not** accept `sessionId` and must be avoided once multiplexing is in play. _Source: [spike/cdp-multiplex-findings.md](spike/cdp-multiplex-findings.md)._ _Confidence: High._
- **Inbound events of interest:**
  - `Runtime.executionContextCreated` / `Runtime.executionContextDestroyed` / `Runtime.executionContextsCleared` — track when the cell's evaluation context is invalidated by navigation/reload.
  - `Debugger.scriptParsed` — only relevant if we choose to enable our own Debugger domain (provisional, see Step 2 §"Re-examining Story 2.5 AC #1"). Otherwise we do not subscribe.
- **No protocol-level routing concerns** between our session and DevTools' session — events are tagged by `sessionId` and delivered only to the originating client.

### Data Format and Identity Contract

- **Per-cell `sourceURL` is the inter-system identity contract** between three independent components: the extension (writer), V8 (registrar), and DevTools (consumer). It is the only shared key.
- **Recommended format:** stable, deterministic, derived from notebook URI + cell index, not from cell content hash (so reruns of an edited cell preserve the breakpoint identity).
  - Candidate scheme: `notebook-cell:<notebook-id>/<cell-index>` or a `vscode-notebook-cell://` URI variant.
  - **Open detail:** whether DevTools URL parsing prefers an http/https-shaped string. _Confidence: Low — empirical check during spike._
- **No serialization/format choice for evaluation results** is in Story 2.4 / 2.5 scope — that is Story 2.3 / 4.1 territory.

### Multi-Client Domain-State Coexistence (the actual integration risk)

The transport-level multi-client story is settled. The integration risk is concentrated in one place:

- **`Debugger` domain enable-state is per-client, but breakpoint-firing semantics across clients are not specified.** This is the same gap recorded in Step 2 (Critical Documentation Gaps #2 and #3) and is the architectural reason this research recommends a spike before implementing Story 2.5.

### Failure Modes at the Integration Layer

- **Page navigation** invalidates execution contexts and all evaluated scripts; the next cell run will require a fresh `contextId` (or reliance on the default context). The user's DevTools breakpoint, being keyed by `sourceURL`, "survives reload" per [Debugger.setBreakpointByUrl](https://chromedevtools.github.io/devtools-protocol/tot/Debugger/#method-setBreakpointByUrl) — meaning when our cell is re-run after reload and re-emits the same `sourceURL`, the breakpoint should rebind. _Confidence: High (docs); Medium (end-to-end behavior, untested in our setup)._
- **Target detach** (page closed, target gone) — our session terminates; the extension must surface a normalized failure rather than leaking a transport error (consistent with Story 2.3's contract).
- **Session-stealing scenario** (regression risk) — if anything in the extension reverts to attaching directly to the page-level WebSocket instead of the browser-level one, DevTools and the extension will kick each other off. The spike findings document is the authoritative guard against this regression.

### Cross-Reference Back to Stories

- **Story 2.4 (per-cell `sourceURL` + line preservation)** is fully a _writer-side_ concern for the extension. Integration touchpoints: V8's `//# sourceURL` parsing (passive); DevTools' Sources panel (display only). No protocol negotiation is required.
- **Story 2.5 (breakpoint debugging)** sits entirely on the **`Debugger` domain coexistence** question. Everything else (sourceURL identity, line numbers, evaluation path) is settled by Story 2.4 plus Step 2 findings.

---

## Architectural Patterns and Design

> Scoped to architectural decisions this research must surface for Stories 2.4 / 2.5. Generic enterprise template subsections (deployment architecture, data architecture at rest, security architecture beyond the existing CDP-local trust boundary) do not apply and are omitted.

### A. Per-Cell Source-Identity Pattern (Story 2.4)

**Pattern:** _Stable Synthetic Identifier_ — the extension synthesizes a deterministic per-cell URL and embeds it as `//# sourceURL=<url>` so that downstream observers (V8, DevTools) can group reruns of "the same cell" under one identity.

- **Identity key:** `notebook-uri` + `cell-index` (NOT cell-content hash). Editing the cell must NOT change the identity, otherwise the user's DevTools breakpoint is orphaned on every edit — defeating the purpose.
- **URL shape (candidate):** `notebook-cell:<encoded-notebook-uri>/<cell-index>`. The exact scheme is a spike micro-question (does DevTools display non-http(s) URLs cleanly in the Sources tree?).
- **Lifetime:** as long as the notebook document exists in the VS Code session. Persistence across VS Code restarts is desirable but not required by Story 2.4 ACs.
- **Trade-off:** stability across edits vs. "what if the user moves a cell?" — cell-index identity will silently re-target a breakpoint to the wrong cell on cell move/insert. **Acceptable for v1**; reorder is a known sharp edge to document.
- _Confidence: High (pattern), Medium (URL-scheme detail)._

### B. Wrapper-Transformation Pattern (Story 2.4 line preservation)

**Pattern:** _Same-Line Concatenation Wrapper_ — wrapper prefix and suffix occupy the same source lines as the user's first and last lines, respectively, so V8-reported line numbers match cell-editor line numbers 1:1.

- **Concrete shape:**
  ```
  (async()=>{<USER LINE 1>
  <USER LINE 2>
  ...
  <USER LAST LINE>})()
  //# sourceURL=<stable-per-cell-url>
  ```
  Note: no newline between `(async()=>{` and user line 1; no newline between user last line and `})()`. The `//# sourceURL` directive sits on its own line _after_ the wrapped body — V8 attributes it to the script as a whole, not to a particular line.
- **Why not `Runtime.compileScript` + `Runtime.runScript`:** that path lacks documented top-level await support and adds a round-trip with no offsetting benefit for our identity contract (we already control the `sourceURL` string).
- **Source-map alternative — in scope for spike (not deferred):** an inline `//# sourceMappingURL=data:application/json;base64,...` could replace the same-line concatenation discipline by mapping wrapper-shifted lines back to user-editor lines. Whether DevTools honors this for `Runtime.evaluate`-delivered scripts is **Spike Q6**. If confirmed, the wrapper can be emitted on its own lines (more readable generated code, easier to extend with future preamble such as namespace setup) and Pattern B above becomes a _fallback_ rather than the default.
- **Failure mode if violated:** off-by-one breakpoints — the user clicks line 5 in the cell editor, the breakpoint fires on line 6 of their code (or doesn't fire at all). High UX-corrosive.
- _Confidence: High (pattern), needs spike confirmation for `Debugger.paused` line numbers._

### C. Evaluation-Path Selection (Stories 2.2 / 2.4 / 2.5 intersection)

Three candidate paths and their fit:

| Path                                                  | Top-level await                    | sourceURL → Sources panel        | Breakpoint binding    | EXPERIMENTAL flag | Verdict                                                     |
| ----------------------------------------------------- | ---------------------------------- | -------------------------------- | --------------------- | ----------------- | ----------------------------------------------------------- |
| `Runtime.evaluate` + `replMode: true`                 | Yes (documented)                   | Likely (undocumented)            | Likely (undocumented) | Yes               | **Provisional default** — pending spike                     |
| `Runtime.evaluate` + async-IIFE wrapper (no replMode) | Yes (via wrapper + `awaitPromise`) | Yes (well-trodden)               | Yes (well-trodden)    | No                | **Safe fallback** if (1) fails                              |
| `Runtime.compileScript` + `Runtime.runScript`         | Not documented                     | Yes (explicit `sourceURL` param) | Yes (well-trodden)    | No                | Adds round-trip; loses TLA — rejected unless TLA is dropped |

- **Architectural decision posture:** prefer Path 2 (async-IIFE wrapper without `replMode`) as the **safer baseline**, because it relies on no EXPERIMENTAL flags and on the well-trodden combination that prior art (Puppeteer, Playwright, manual DevTools usage) exercises every day. Promote Path 1 to default only if a spike shows it offers a concrete advantage (e.g., `let` re-declaration across cells) AND that breakpoints bind under it.
- _Confidence: High for the comparative analysis; Medium for the recommendation pending Spike Q1._

### D. Debugger-Domain Posture (Story 2.5)

**Pattern candidates:**

1. **Passive Provider** (recommended pending spike) — extension never calls `Debugger.enable`. It only emits scripts with stable `sourceURL`. DevTools is the sole `Debugger` client. This is the **minimum-coexistence-risk** posture.
2. **Diagnostic Observer** — extension calls `Debugger.enable` only to subscribe to `Debugger.scriptParsed` for its own logging/diagnostics, never sets breakpoints, never pauses. Adds one debugger client to the target.
3. **Active Debugger Client** — extension calls `Debugger.enable` and treats the domain as part of its execution contract. Highest coexistence risk; not justified by current Story 2.5 ACs once the role split is made explicit.

- **Architectural decision:** **Passive Provider is the default**. Promote to Diagnostic Observer only if Spike Q2 shows that user-set DevTools breakpoints do _not_ fire under our `Runtime.evaluate` calls without our session enabling Debugger — and even then, prefer the minimum surface that makes them fire.
- _Confidence: Medium-High for posture; Low for whether Spike Q2 will validate it._

### E. Failure-Domain Boundaries

- **Transport failures** (WebSocket drop, target gone) → wrapped into normalized failure contract (Story 2.3 territory). The Story 2.5 AC #1 clause about "session attach failure for the Debugger domain surfaces as a normalized error" only matters if posture is Diagnostic Observer or Active Debugger Client. Under Passive Provider, the AC clause becomes vacuous — one more reason to prefer the passive posture.
- **`sourceURL` parse failures** (e.g., V8 rejects an unusual URL string) → silent: the script still evaluates, just lands as `VM<id>` in DevTools. Recoverable; user notices via missing label. Not error-path-worthy.
- **Page navigation mid-run** → execution context cleared; pending `Runtime.evaluate` returns an error; wrapped into normalized failure contract. Subsequent runs land in the new context with the same `sourceURL` and re-bind the user's breakpoint.

### F. What's Explicitly NOT in the Architectural Scope of This Research

- Variable/value-presentation rendering (Story 4.x).
- Intentional output/log capture (Stories 3.x).
- Reconnect/recovery sequencing (Story 1.6 / Epic 6).
- Companion-module handshake (Epic 7).

These are listed only to make scope boundaries unambiguous for downstream story-prep work.

---

## Implementation Approaches and Spike Plan

> Scoped to the concrete experiment that resolves the six Critical Documentation Gaps. Generic implementation-research subsections (team organization, cost optimization, deployment ops) do not apply to a single-developer feasibility spike and are omitted.

### Adoption Strategy: Spike-Then-Implement

The research has identified six unresolved questions that documentation cannot answer. Implementation strategy is therefore:

1. **Spike first** — a small, throwaway harness against any Edge target with DevTools attached (e.g., `about:blank` — these are generic V8/CDP behaviors, no Foundry context needed) to answer Q1–Q6.
2. **Lock the architectural choices** based on spike outcomes (evaluation path, debugger posture, wrapper strategy).
3. **Implement Story 2.4 then Story 2.5** with the locked choices.

The spike output is a markdown findings file (mirroring [spike/cdp-multiplex-findings.md](spike/cdp-multiplex-findings.md)) plus a small reproducible script under `spike/`. No production code is shipped from the spike.

### Spike Harness Design

**Location:** `spike/cdp-sourceurl-debugger.{js,md}` (parallel to the existing multiplexing spike).

**Reuses:** the existing browser-level connection + `flatten:true` flat-session attach pattern from [spike/cdp-multiplex-findings.md](spike/cdp-multiplex-findings.md). No new transport machinery.

**Preconditions for the operator running the spike:**

- A Chromium-based browser launched with `--remote-debugging-port=9222`. Either:
  - **Interactive mode** — Edge/Chrome via existing [scripts/Start-EdgeDebug.ps1](scripts/Start-EdgeDebug.ps1) with the GUI open.
  - **Headless mode** — `chrome --headless=new --remote-debugging-port=9222 about:blank` (or equivalent Edge invocation). Headless Chromium ships with the DevTools frontend and exposes the same CDP surface, so the spike can be scripted as an integration test.
- Any page open — `about:blank` is sufficient. The spike questions concern generic V8/CDP behavior (`//# sourceURL`, `Runtime.evaluate`, `Debugger.*`, source maps); none of them depend on Foundry being present.
- **DevTools attached to the same target.** Critical: every spike question is about behavior _while another Debugger client is attached_.
  - In interactive mode: open DevTools (F12) on the page.
  - In headless mode: a second CDP client (e.g., a second `chrome-remote-interface` connection from the spike harness itself) plays the role of “DevTools” — it calls `Debugger.enable` and `Debugger.setBreakpointByUrl`, and asserts on `Debugger.paused` events. This is exactly the multi-client scenario Q2/Q3 are about, just with both clients automated.

**Harness shape (sketch):**

```js
// 1. Connect to browser endpoint, attach flat session to any page target (about:blank is fine).
// 2. Define a stable test sourceURL: "notebook-cell:spike/cell-A".
// 3. Define wrapped expression with same-line concatenation:
//      `(async()=>{const x=1;debugger;return x+1;})()\n//# sourceURL=notebook-cell:spike/cell-A`
// 4. Runtime.evaluate with awaitPromise:true, returnByValue:true.
// 5. Operator inspects DevTools Sources panel and reports observations.
// 6. Repeat with replMode:true variant.
// 7. Repeat with inline source-map variant (multi-line wrapper + sourceMappingURL=data:...).
// 8. Operator sets a breakpoint in DevTools, then re-runs step 4. Confirms pause.
// 9. Repeat step 8 without our session calling Debugger.enable.
// 10. Repeat step 8 with our session calling Debugger.enable.
```

The harness should be **observation-driven**, with two run modes:

- **Interactive mode** — a human operator inspects DevTools UI for questions where the assertion is visual (Sources-panel rendering, source-mapped view display, URL-scheme presentation in the tree). Records findings to markdown.
- **Headless integration-test mode** — the harness opens _two_ CDP sessions to a headless Chromium target: a “DevTools surrogate” session that drives `Debugger.enable` + `Debugger.setBreakpointByUrl` and observes `Debugger.paused` events, plus an “extension surrogate” session that drives `Runtime.evaluate`. Most pass criteria (Q2, Q3, Q4, Q5, parts of Q1 and Q6) reduce to assertions on `Debugger.paused` events and `Debugger.scriptParsed` payloads, which are CDP-introspectable. Only the Sources-panel UI questions in Q1 and Q6 (“does the panel _display_ the script/mapped source”) require interactive verification.

The headless mode is preferred because it makes Q2/Q3/Q4/Q5 automatable, repeatable, and CI-eligible — directly matching how the existing [spike/spike-cdp-multiplex.js](spike/spike-cdp-multiplex.js) operates against a live target.

### Spike Question → Test Mapping

| Spike Q                                                           | Test Procedure                                                                                 | Pass Criterion                                                                                                    | Architectural Decision Locked                                                                                             |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Q1 — `replMode` + Sources visibility                              | Steps 6+8 above with `replMode:true`                                                           | Script appears in Sources under our `sourceURL`; breakpoint binds and fires on rerun                              | If pass: `replMode` is viable. If fail: lock to async-IIFE wrapper (Pattern C Path 2)                                     |
| Q2 — Cross-client breakpoint firing without our `Debugger.enable` | Step 9 above                                                                                   | User-set DevTools breakpoint fires during our `Runtime.evaluate`                                                  | If pass: lock Debugger Posture to **Passive Provider**, revise Story 2.5 AC #1                                            |
| Q3 — Multi-client `Debugger.enable` coexistence                   | Step 10 above; observe DevTools UI for ghost pauses, lost breakpoints                          | DevTools' debugger UI remains stable; no breakpoints lost; our session also receives sane events                  | Only relevant if Q2 fails                                                                                                 |
| Q4 — First-evaluation binding                                     | Set DevTools breakpoint _before_ first `Runtime.evaluate` of a new `sourceURL`; run cell once  | Breakpoint fires on first run                                                                                     | Determines whether docs need a UX note about "run cell once first"                                                        |
| Q5 — Line-number fidelity (same-line wrapper)                     | Steps 4+8 with a multi-line wrapped body containing `debugger;` on a known line                | `Debugger.paused.location.lineNumber` matches the user-visible line                                               | Confirms Pattern B is sufficient                                                                                          |
| Q6 — Inline source-map honoring                                   | Step 7 above with multi-line wrapper + base64 inline source map mapping wrapper-line→user-line | (a) Sources panel shows mapped source; (b) `Debugger.paused` reports original line; (c) breakpoint binds on rerun | If pass: source-map approach becomes default; Pattern B becomes fallback. If fail: Pattern B locks as the implementation. |

### Development Workflow & Tooling for the Spike

- **Language:** plain JS (matches [spike/spike-cdp-multiplex.js](spike/spike-cdp-multiplex.js) precedent).
- **Dependencies:** only `chrome-remote-interface` (already a project dep).
- **No build step** — run with `node spike/cdp-sourceurl-debugger.js`.
- **Inline source-map generation:** use the [`source-map`](https://www.npmjs.com/package/source-map) npm package (Mozilla) for Q6 only — if Q6 fails, the dependency is not pulled into the production extension. If Q6 passes, evaluate whether to add `source-map` (or a smaller alternative) to the extension's runtime deps.
- **Output:** a `spike/cdp-sourceurl-debugger-findings.md` document recording each Q's observed behavior, screenshots if useful, and the locked architectural decision.

### Testing & Quality Considerations (post-spike, for production code)

- **Unit-testable:** the cell-to-script wrapper builder — pure function `(notebookUri, cellIndex, userCode) → { script: string, sourceURL: string, sourceMap?: string }`. Stable contract regardless of Q1–Q6 outcome.
- **Integration-testable** (against a headless Edge in CI, future): roundtripping `Runtime.evaluate` and asserting result shape. Source-panel behavior cannot be asserted in CI; that remains operator-verified.
- **Regression-test for sourceURL stability:** snapshot test confirming the wrapper builder emits identical `sourceURL` across two calls with same `(notebookUri, cellIndex)` regardless of `userCode` content. This guards the breakpoint-stability contract directly.

### Risk Assessment & Mitigation

| Risk                                                               | Likelihood                                 | Impact                                                      | Mitigation                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `replMode` deprecated/changed (EXPERIMENTAL flag)                  | Medium                                     | High if we depend on it                                     | Spike Q1 selects whether to depend on it; Pattern C Path 2 fallback exists                                                                                                                                            |
| Cross-client `Debugger.enable` destabilizes Edge DevTools          | Medium-High (if posture forces it)         | Critical (NFR8 violation)                                   | Spike Q2 + Passive Provider posture default; only escalate if forced                                                                                                                                                  |
| Inline source maps not honored by DevTools for `Runtime.evaluate`  | Unknown                                    | Medium (loses UX win, no functional break)                  | Pattern B same-line wrapper is the safe fallback; Q6 isolates the failure                                                                                                                                             |
| Cell reorder mis-targets user breakpoint                           | Certain (inherent to index-based identity) | Medium (UX surprise, not data loss)                         | Documented sharp edge; revisit only if reorder becomes a common operation                                                                                                                                             |
| Headless Chromium behavior diverges from interactive Edge DevTools | Low-Medium                                 | Medium (false positive in CI)                               | Run interactive-mode confirmation pass on Edge for any Q whose pass criterion involves visual rendering (Q1 panel visibility, Q6 mapped-source display); CDP-event-level assertions are engine-level and should match |
| `notebook-cell:` URL scheme rejected/garbled by DevTools           | Low-Medium                                 | Low (visual only; functionally still binds by string match) | Spike Q5/Q6 sub-check: try `notebook-cell:`, `vscode-notebook-cell://`, and an `https://`-shaped variant; pick the one with cleanest Sources tree display                                                             |

### Implementation Order (post-spike)

1. **Land Story 2.4 first.** Wrapper-builder + per-cell `sourceURL` emission. No `Debugger`-domain changes. This is independently shippable and gives the user better stack traces immediately, even before breakpoints are validated.
2. **Land Story 2.5 second.** Whatever Debugger posture the spike locks (Passive Provider expected). If posture is Passive Provider, Story 2.5 implementation is **trivially small** — essentially documentation + a smoke test — because Story 2.4 has already done all the writer-side work.
3. **Update Story 2.5 ACs** based on spike outcome before writing code (the AC #1 reconsideration in Step 2).

### Success Metrics

- All six spike questions answered with recorded observations in `spike/cdp-sourceurl-debugger-findings.md`.
- Story 2.5 AC #1 either confirmed-as-written or revised based on Spike Q2.
- Wrapper-builder unit tests in place before any Story 2.4 implementation code lands.
- A user can: open a Foundry page in Edge → open DevTools → find their cell in the Sources tree under the per-cell URL → set a breakpoint → rerun the cell → hit the breakpoint at the expected line. End-to-end demo is the single integration acceptance bar for Story 2.5.
