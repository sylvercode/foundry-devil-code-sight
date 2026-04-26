# CDP `//# sourceURL`, Line Preservation, and Debugger-Domain Coexistence — Findings

## Summary

All six Critical Documentation Gaps (Q1–Q6) recorded in [docs/archives/technical-cdp-sourceurl-debugger-research-2026-04-19.md](../docs/archives/technical-cdp-sourceurl-debugger-research-2026-04-19.md) have been answered empirically against headless Chromium 147 via the harness in [spike/spike-cdp-sourceurl-debugger.js](spike-cdp-sourceurl-debugger.js).

**Headline outcomes:**

- **Story 2.5 AC #1 (extension calls `Debugger.enable` on the per-target session) is REVISED → REMOVED.** Q2 proved that user-set DevTools breakpoints fire under `Runtime.evaluate` issued by a session that never called `Debugger.enable`. The recommended posture is **Passive Provider**.
- **`Runtime.evaluate { replMode: true }` is retained as the default evaluation path.** Q1 proved it produces a `Debugger.scriptParsed` event under our `//# sourceURL` and that breakpoints set against that URL bind and fire.
- **Pattern B (same-line wrapper concatenation) is locked as Story 2.4's only wrapper strategy.** Q5 proved CDP-protocol line numbers under Pattern B match user-visible lines exactly. Q6 proved V8 does NOT remap `Debugger.paused.callFrames[].location.lineNumber` through an inline `//# sourceMappingURL=` directive, so Pattern B-alt would silently report wrapped-script line numbers in protocol events even though DevTools UI would still display the mapped source.
- **First-evaluation breakpoint binding works (Q4).** No "run-then-break" UX caveat is needed.
- **Multi-client `Debugger.enable` coexists cleanly (Q3).** Posture **Diagnostic Observer** is technically safe if we ever need read-only event observation. We still default to Passive Provider per Q2.
- **All three URL schemes round-trip cleanly via CDP, and the debugger resource form has now been observed from real VS Code notebook breakpoints.** The final source identity should use the exact VS Code notebook-cell resource URI form, not a custom approximation. DevTools tree presentation is secondary evidence, not the deciding criterion.

The transport story validated by [cdp-multiplex-findings.md](cdp-multiplex-findings.md) (browser-level WebSocket + `Target.attachToTarget { flatten: true }` + `client.send(method, params, sessionId)` + `'<Domain>.<event>.<sessionId>'` listeners) was reused without modification, and a third surrogate-session evaluation continued to succeed while two `Debugger.enable` clients were attached (multiplex regression PASS).

---

## Test Environment

| Item                      | Value                                                                          |
| ------------------------- | ------------------------------------------------------------------------------ |
| Browser                   | Chromium 147.0.7727.55 (Debian Bookworm, headless)                             |
| `chrome-remote-interface` | 0.34.0                                                                         |
| `source-map`              | 0.7.6 (devDependency, used only by Q6)                                         |
| Harness                   | [spike/spike-cdp-sourceurl-debugger.js](spike-cdp-sourceurl-debugger.js)       |
| Page target               | `about:blank` (Foundry not required, per AC 1)                                 |
| Run mode                  | Headless / non-interactive (operator UI checks not yet performed against Edge) |

Reproduce: `node spike/spike-cdp-sourceurl-debugger.js`. Optional flags: `INTERACTIVE=1`, `EXTERNAL_BROWSER=1`, `KEEP_OPEN=1`, `CDP_HOST`, `CDP_PORT`.

---

## Q1 — `replMode` + Sources visibility + breakpoint binding → ✅ PASS

**Procedure.** A "DevTools surrogate" flat session called `Debugger.enable` and `Debugger.setBreakpointByUrl({ url, lineNumber: 2 })` against `notebook-cell:spike%3A%2F%2Fq1/0`. An "extension surrogate" then issued `Runtime.evaluate({ expression, replMode: true, awaitPromise: true, returnByValue: true })` for a 3-line cell ending in `debugger;`, terminated with `//# sourceURL=...`.

**Observed events** (devtools surrogate session): `Debugger.scriptParsed` → `Debugger.breakpointResolved` → `Debugger.paused` → `Debugger.resumed`. The `Debugger.paused.callFrames[0].location.lineNumber` was `2` (0-based) and `hitBreakpoints` contained `1:2:0:notebook-cell:spike%3A%2F%2Fq1/0` — the exact URL and line we requested.

```text
scriptParsed = { url: "notebook-cell:spike%3A%2F%2Fq1/0", scriptId: "5", startLine: 0, endLine: 4, hasSourceURL: true, hasSourceMapURL: false }
paused       = { reason: "other", hitBreakpoints: ["1:2:0:notebook-cell:spike%3A%2F%2Fq1/0"], lineNumber: 2, scriptId: "5" }
```

**Note on `bp.locations`.** `Debugger.setBreakpointByUrl` returned `locations: []` because the script had not yet been parsed at the time the breakpoint was set. The breakpoint was nonetheless retained by V8 and resolved on `Debugger.scriptParsed` (we saw the matching `Debugger.breakpointResolved` event during evaluation). Implementations should NOT treat an empty `locations` array from `setBreakpointByUrl` as failure.

**Answer.** Yes — `replMode: true` scripts emit `Debugger.scriptParsed` under our `//# sourceURL` and breakpoints set against that URL bind and fire.

**Decision locked.** `Runtime.evaluate { replMode: true }` is retained as the default evaluation path. Story 2.5 may keep `replMode: true` (no need to switch to async-IIFE-only).

---

## Q2 — Cross-client breakpoint firing without our `Debugger.enable` → ✅ PASS

**Procedure.** Identical to Q1 except the extension surrogate did **NOT** call `Debugger.enable`. Only the devtools surrogate had `Debugger` enabled and only it set the breakpoint.

**Observed.** `Debugger.paused` fired on the devtools surrogate, with `hitBreakpoints` containing the expected URL+line. The extension surrogate received `Runtime.evaluate`'s response normally after the auto-resume.

```text
paused = { reason: "other", hitBreakpoints: ["1:2:0:notebook-cell:spike%3A%2F%2Fq2/0"], lineNumber: 2, scriptId: "7" }
extensionSessionEnabledDebugger = false
```

**Answer.** Yes — DevTools-set breakpoints fire under `Runtime.evaluate` from a session that never called `Debugger.enable`.

**Decision locked.**

- **Debugger-domain posture: Passive Provider.** The extension does NOT call `Debugger.enable` on the per-target session. It only calls `Runtime.enable` and `Runtime.evaluate`. The user's debugger of choice (Edge DevTools, the Edge DevTools VS Code extension) owns the `Debugger` domain.
- **Story 2.5 AC #1 → REMOVED.** The original AC required the extension to enable the `Debugger` domain on its per-target session; this is unnecessary and would only add coexistence risk for no functional gain.

---

## Q3 — Multi-client `Debugger.enable` coexistence → ✅ PASS (informational; Q2 made this non-blocking)

Per the spike spec, Q3 was conditional on Q2 failing. Q2 passed, so Q3 was run for completeness so that, if a future feature requires our extension to observe `Debugger` events read-only, we know the cost.

**Procedure.** Both the devtools surrogate AND the extension surrogate called `Debugger.enable`. Only the devtools surrogate set a breakpoint. The same cell was evaluated twice.

**Observed.** Both sessions received `Debugger.scriptParsed` and `Debugger.paused` events (visible in the diagnostic event log as `<devtools>` and `<extension>` rows), `Debugger.breakpointResolved` was reported on the devtools surrogate twice (once per evaluation, with two different `scriptId`s `8` and `9`), and the devtools surrogate paused twice and resumed twice. No protocol errors and no lost events on the devtools surrogate's breakpoint.

```text
pausedCount (devtools session) = 2
breakpointResolutions (devtools session) = [
  { breakpointId: "1:2:0:...spike://q3/0", lineNumber: 2, scriptId: "8" },
  { breakpointId: "1:2:0:...spike://q3/0", lineNumber: 2, scriptId: "9" },
]
```

**Answer.** Multi-client `Debugger.enable` is stable in headless Chromium. No breakpoints lost, no error responses, both sessions receive their own session-scoped event stream.

**Decision locked.** **Diagnostic Observer** is a safe posture if we ever need read-only `Debugger` event observation. We still default to Passive Provider (Q2 made this strictly safer with no functional cost).

**Caveat for Edge.** The `Debugger.paused` event being delivered to two sessions implies V8 holds the JS thread paused for ALL enabled debugger clients until each one issues `Debugger.resume`. If an extension surrogate ever called `Debugger.enable`, every paused event would require us to issue `Debugger.resume` on our session too — otherwise the user's DevTools would appear to "hang" because the JS thread stays paused waiting for our resume. This is another reason to default to Passive Provider.

---

## Q4 — First-evaluation breakpoint binding → ✅ PASS

**Procedure.** Used a fresh URL nonce so the script had never been registered before. Set the breakpoint, then evaluated the cell exactly once.

**Observed.** The first evaluation produced `Debugger.scriptParsed` → `Debugger.breakpointResolved` → `Debugger.paused`, with `hitBreakpoints` matching the nonce URL.

```text
nonce = "1776640627477-r7wsyi"
paused.hitBreakpoints = ["1:2:0:notebook-cell:spike%3A%2F%2Fq4/0?n=1776640627477-r7wsyi"]
```

**Answer.** Yes — a breakpoint placed BEFORE the first evaluation binds and fires on first run.

**Decision locked.** No "run-then-break" UX caveat is needed in Story 2.5 documentation.

---

## Q5 — Line-number fidelity under same-line wrapper (Pattern B) → ✅ PASS

**Procedure.** Wrapped 4 lines of user code with `(async()=>{` prefix on the same line as user line 1 and `})()` suffix on the same line as user line 4. Issued `Runtime.evaluate` and observed `Debugger.paused` from the user's `debugger;` on user line 3.

```text
wrapped script:
(async()=>{globalThis.__q5 = "line1";
globalThis.__q5 = "line2";
debugger;
globalThis.__q5 = "line4";})()
//# sourceURL=notebook-cell:spike%3A%2F%2Fq5/0

paused = { lineNumber: 2 (0-based), scriptId: "11", url: "notebook-cell:spike%3A%2F%2Fq5/0" }
```

**Answer.** Yes — `debugger;` on user-visible line 3 reports CDP `lineNumber: 2` (0-based), which is exactly the user-visible line. The same-line wrapper preserves line fidelity perfectly.

**Decision locked.** **Pattern B (same-line concatenation) is sufficient for Story 2.4's wrapper builder.** No source map needed for line-number correctness.

---

## Q6 — Inline source-map honoring → ❌ "fail" (the answer is NO; this locks Pattern B)

**Procedure.** Wrapped 4 lines of user code with `(async () => {\n` prefix and `\n})();\n` suffix on their own lines (so user line N lives on script line N+1). Generated a v3 source map mapping each generated line back to its original user line and inlined it via `//# sourceMappingURL=data:application/json;base64,...`. Followed by `//# sourceURL=...`.

First evaluation observed:

```text
paused = { url: "notebook-cell:spike%3A%2F%2Fq6/0", lineNumber: 3 (0-based), scriptId: "12" }
```

The `debugger;` lives on script line 4 (1-based) = line 3 (0-based) of the wrapped script. CDP reported `lineNumber: 3`, which is the **wrapped-script line, NOT the user-original line 2 (0-based)**. Inline source maps are NOT honored by V8 when reporting `Debugger.paused` event locations.

Second evaluation, with `Debugger.setBreakpointByUrl({ url, lineNumber: 2 })`:

```text
breakpointResolved = { lineNumber: 2 (script-relative, 0-based), scriptId: "13" }
paused (breakpoint hit) = { lineNumber: 2, hitBreakpoints: ["1:2:0:..."] }
paused (debugger;)      = { lineNumber: 3 }
```

The breakpoint we set at `lineNumber: 2` bound to wrapped-script line 2 — that's `globalThis.__q6 = "line2";`, NOT user line 3. If the user expected "set a breakpoint on user line 3", they would actually break on user line 2 (which corresponds to wrapped-script line 2). The DevTools UI's source-map remapping is a UI-only convenience and does NOT propagate into `Debugger.setBreakpointByUrl` semantics or `Debugger.paused` event payloads.

**Answer.** No. V8 does NOT remap `Debugger.paused.callFrames[].location.lineNumber` through `//# sourceMappingURL=` directives delivered via `Runtime.evaluate`. Source-map honoring is, at best, a DevTools UI feature; it is not part of the runtime/debugger protocol contract.

**Interactive Edge operator note (2026-04-22).** For the `notebook-cell:spike%3A%2F%2Fq6/0` variant, Edge showed both the generated source (`notebook-cell:.../0`) and a separate authored-source entry (`notebook-cell:.../0.user`) containing the original 4-line user code. The generated-source view also showed a banner: `Source map skipped for this file. DevTools can't show authored sources, but you can debug the deployed code.` This reinforces the main conclusion: even when authored-source UI is partially visible, the source-map experience is setting-dependent and must not be treated as a reliable debugger contract.

**Decision locked.** **Pattern B (same-line concatenation) is Story 2.4's ONLY wrapper strategy.** Pattern B-alt (multi-line wrapper + inline source map) is rejected because:

1. It silently mis-reports line numbers in `Debugger.paused` event payloads (off by exactly the wrapper-prefix line count).
2. `Debugger.setBreakpointByUrl({ lineNumber })` is interpreted as a script-relative line, not a user-source line, so user-set breakpoints would fire on the wrong line.

**`source-map` dev dependency:** retain in `devDependencies` because the harness uses it to build the Pattern B-alt fixture for this finding. Do NOT promote to runtime `dependencies` — production code should never need it under the locked Pattern B strategy.

---

## URL-scheme sub-probe — ℹ️ INFO

All three candidate schemes round-tripped via CDP without errors:

| Scheme                                         | URL produced                                          | `scriptParsed.url` round-trips | `setBreakpointByUrl` accepted |
| ---------------------------------------------- | ----------------------------------------------------- | ------------------------------ | ----------------------------- |
| `notebook-cell:<encoded-uri>/<index>`          | `notebook-cell:spike%3A%2F%2Furl-scheme/0`            | ✅                             | ✅                            |
| `vscode-notebook-cell://<encoded-uri>/<index>` | `vscode-notebook-cell://spike%3A%2F%2Furl-scheme/0`   | ✅                             | ✅                            |
| `https://spike.local/<encoded-uri>/cell/<i>`   | `https://spike.local/spike%3A%2F%2Furl-scheme/cell/0` | ✅                             | ✅                            |

**Conclusion.** This spike now locks the per-cell source-identity direction:

- All three candidate schemes round-trip cleanly via `Debugger.scriptParsed.url`.
- All three are accepted by `Debugger.setBreakpointByUrl`.
- Real notebook breakpoints supplied by VS Code use `vscode-notebook-cell://<authority>/<notebook-path>#<opaque-fragment>` resource URIs.
- The final scheme must be derived from notebook-resource identity, not from DevTools label aesthetics.

**Decision locked.** Story 2.4 should use the exact VS Code notebook cell document URI string as the per-cell source identity, i.e. the same `vscode-notebook-cell://...#...` resource form that VS Code uses for notebook breakpoints. In implementation terms, use `NotebookCell.document.uri.toString()` as the `//# sourceURL` value. Do NOT synthesize a custom `notebook-cell:` or simplified `vscode-notebook-cell://<encoded-uri>/<index>` shape in production code. This recommendation has already been actioned in production code; see [`src/kernel/execution-kernel.ts`](../src/kernel/execution-kernel.ts) line 103 for the implementation that uses the exact runtime cell document URI.

**Observed breakpoint resource note.** The sampled breakpoint URIs captured from VS Code for `test1.ipynb` used `vscode-notebook-cell://<remote-authority>/<notebook-path>#<opaque-fragment>`. The notebook-path segment reflected the notebook location at breakpoint-creation time, which reinforces the rule above: production code must use the exact runtime cell URI provided by VS Code rather than reconstructing it from workspace path + cell index.

---

## Multiplex Regression Sanity Check — ✅ PASS

While two `Debugger.enable` clients were attached (Q3 setup), a third surrogate session was attached, called `Runtime.enable`, and evaluated `1 + 1` — successfully. The multiplex transport story from [cdp-multiplex-findings.md](cdp-multiplex-findings.md) is not regressed by adding `Debugger.enable` callers.

---

## Decisions Locked (consolidated)

1. **Evaluation path:** `Runtime.evaluate({ expression, replMode: true, awaitPromise: true, returnByValue: true })` on the extension's per-target flat session. (Q1)
2. **Debugger-domain posture:** **Passive Provider.** The extension does NOT call `Debugger.enable` on the per-target session. (Q2)
3. **Wrapper strategy:** **Pattern B — same-line concatenation.** Prefix `(async()=>{` is on the same line as user line 1; suffix `})()` is on the same line as user's last line. (Q5, Q6)
4. **`//# sourceURL`:** Append `\n//# sourceURL=<url>\n` to the wrapped expression. (Q1)
5. **URL-scheme status:** locked to the VS Code notebook cell resource form. The per-cell `sourceURL` should use the exact `vscode-notebook-cell://<authority>/<notebook-path>#<opaque-fragment>` cell document URI string that VS Code uses for notebook breakpoints. In implementation terms, that means using `NotebookCell.document.uri.toString()` as the source identity value. The spike's CDP probe proved that this scheme family is acceptable to `Debugger.setBreakpointByUrl`; the observed breakpoint URIs resolved the exact resource-identity question. (URL-scheme sub-probe)
6. **First-evaluation breakpoint binding:** Works without UX caveat. (Q4)
7. **Source-map fallback:** Rejected for production. `source-map` stays a `devDependency`. (Q6)

---

## Story 2.5 AC Adjustments

When Story 2.5 is created, apply these deltas:

| Original AC                                                                                                    | Adjustment                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC #1** — Extension calls `Debugger.enable` on its per-target session.                                       | **REMOVE.** Q2 proved DevTools-set breakpoints fire under our `Runtime.evaluate` without our session enabling Debugger. Document the **Passive Provider** posture instead.                                          |
| **AC #2** — Per-cell `//# sourceURL` is emitted such that DevTools shows the script and breakpoints bind.      | **KEEP, REWORD.** Confirmed feasible in Q1. Reword to clarify that the AC is satisfied by the wrapper from Story 2.4 plus the user's own DevTools/Debugger client setting the breakpoint.                           |
| **AC** — Line numbers in `Debugger.paused` match user-visible lines.                                           | **KEEP.** Q5 confirms with Pattern B.                                                                                                                                                                               |
| **AC** — User can set a breakpoint before first evaluation.                                                    | **KEEP.** Q4 confirms.                                                                                                                                                                                              |
| **AC (new)** — Coexistence with Edge DevTools is preserved when our extension is connected to the same target. | **ADD.** Q3 + the multiplex regression sanity check together establish this. Story 2.5 should include a regression check that the user can drive Edge DevTools breakpoints unimpeded while our session is attached. |
| **AC (new)** — The extension MUST NOT call `Debugger.enable` on the per-target session.                        | **ADD.** Locks the Passive Provider posture as an enforceable invariant.                                                                                                                                            |

---

## CI Eligibility & Headless-vs-Interactive Divergence

| Question                                                            | CI-eligible? | Reason                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1 (event flow under `replMode`)                                    | ✅           | All assertions are CDP-event payload checks.                                                                                                                                                                                                                           |
| Q2 (Passive Provider validity)                                      | ✅           | All assertions are CDP-event payload checks.                                                                                                                                                                                                                           |
| Q3 (multi-client `Debugger.enable` stability)                       | ✅           | All assertions are CDP-event payload checks; the regression sanity probe is also automatable.                                                                                                                                                                          |
| Q4 (first-eval binding)                                             | ✅           | All assertions are CDP-event payload checks.                                                                                                                                                                                                                           |
| Q5 (Pattern B line fidelity)                                        | ✅           | Asserts `Debugger.paused.location.lineNumber`.                                                                                                                                                                                                                         |
| Q6 (source-map honoring)                                            | ✅           | Asserts `Debugger.paused.location.lineNumber` against expected user-line. The "fail" outcome is the lock-in for Pattern B; a future CI run should keep asserting it as a guard against silent V8 behavior change.                                                      |
| URL-scheme compatibility with notebook breakpoint resource identity | ✅           | Observed from real VS Code notebook breakpoints: the resource form is `vscode-notebook-cell://<authority>/<notebook-path>#<opaque-fragment>`. Production source identity should reuse the exact cell document URI string, i.e. `NotebookCell.document.uri.toString()`. |

**Headless-vs-interactive divergence only partially measured.** The original run was headless Chromium 147. A later interactive Edge observation was captured for Q6 on the `notebook-cell:` scheme, and real VS Code notebook breakpoint URIs were later captured separately. Remaining interactive-only sub-checks:

- **Q6 visual sub-check** — partially answered. Edge surfaced an authored `.user` sibling for `notebook-cell:` while also showing a "Source map skipped" banner on the generated source. This is exactly the kind of "UI may surface authored code while protocol semantics still target deployed code" trap that Story 2.4 must avoid by simply not using Pattern B-alt.

These are recorded as follow-up tasks for UI validation only. They no longer block locking the exact per-cell `sourceURL` format.

---

## References

- [docs/archives/technical-cdp-sourceurl-debugger-research-2026-04-19.md](../docs/archives/technical-cdp-sourceurl-debugger-research-2026-04-19.md) — origin of the six gaps.
- [docs/archives/sprint-change-proposal-2026-04-19.md](../docs/archives/sprint-change-proposal-2026-04-19.md) — origin of FR38 and the constraint that Story 2.4 must be debugger-aware.
- [spike/cdp-multiplex-findings.md](cdp-multiplex-findings.md) — transport pattern this spike reuses.
- [spike/spike-cdp-multiplex.js](spike-cdp-multiplex.js) — harness pattern this spike mirrors.
- [docs/stories/2-spike-cdp-sourceurl-debugger.md](../docs/stories/2-spike-cdp-sourceurl-debugger.md) — story driving this spike.
