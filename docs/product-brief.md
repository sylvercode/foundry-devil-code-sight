---
title: Product Brief — jupyter-browser-kernel
version: 0.2
date: 2026-03-21
status: Complete
owners:
  - Sylvercode
sources:
  - docs/prd.md
  - docs/brainstorming-session-2026-03-14-162248.md
  - spike/cdp-multiplex-findings.md
---

# Product Brief: jupyter-browser-kernel

## Executive Summary

jupyter-browser-kernel is a VS Code extension that provides a browser-backed JavaScript notebook execution kernel for fast iteration against live web applications. The MVP is intentionally profile-agnostic: it focuses on a deterministic write-run-inspect loop that works without requiring any app-specific profile.

The product solves a common developer-tooling gap. Browser-hosted automation and runtime scripting are often fragmented across page consoles, ad hoc scripts, and manual copy-paste loops. This slows iteration, hides execution history, and increases the cost of experimentation.

The core value is a stable, repeatable notebook workflow: run JavaScript cells against an active browser target, receive normalized success or failure output inline, and rerun quickly without rebuilding context. The architecture is designed for coexistence with browser debugging tools, including Edge DevTools, and for future profile expansion after core-kernel stability.

## The Problem

Developers iterating browser runtime logic face three recurring pain points:

1. Iteration friction: there is no durable notebook-first loop for rapid reruns against a live page.
2. Inconsistent outcomes: syntax, runtime, and transport-level failures are surfaced differently across tools.
3. Tooling conflicts: custom execution flows can interfere with active browser debugging sessions.

The status quo increases cycle time, makes risky experimentation harder to reverse, and discourages structured iterative workflows.

## The Solution

Build a profile-agnostic core kernel that delivers:

1. JavaScript cell execution from VS Code notebooks against a live browser target.
2. Shared result normalization for both successful execution and failures.
3. Intentional output capture that stays distinct from unrelated browser console noise.
4. Manual reconnect and explicit connection-state reporting for operational recovery.
5. Deterministic target-matching and target-eligibility diagnostics owned by the active profile boundary.

MVP scope is the core kernel only. App-specific profiles are layered post-MVP.

## What Makes This Different

1. Deterministic execution loop over ad hoc console scripting.
2. Coexistence-first architecture with browser debugging tools, rather than competitive attachment behavior.
3. Contract-first normalization: execution semantics remain stable even if transport choices evolve.
4. Explicit profile boundaries that allow app-specific behavior without rewriting platform core logic.

## Who This Serves

Primary users:

1. Power users and developers who iterate JavaScript logic against live browser applications.
2. Solo builders who need a repeatable notebook workflow with fast reruns and explicit failure diagnostics.

Post-MVP example profile audience:

1. Foundry VTT builders who want notebook-first macro iteration.

Foundry is the first example profile after MVP, not the platform definition.

## Success Criteria

1. A user can connect, execute a JavaScript notebook cell, and see structured inline output in VS Code.
2. Execution failures consistently surface with actionable details (message, stack, and source location when available).
3. Edge DevTools coexistence is maintained during active kernel use.
4. Manual reconnect restores usable execution when the target is available.
5. Core-kernel behavior is validated by deterministic fixture-based tests covering success, syntax error, runtime error, and serialization-boundary cases.

## Scope

### MVP In Scope (Core Kernel)

1. Browser-session connection lifecycle management.
2. JavaScript notebook execution for .ipynb cells, including async support.
3. Shared result contract with transport-boundary isolation.
4. Intentional output capture and execution-history retention.
5. Manual reconnect and explicit connection-state reporting.
6. Browser debugger coexistence as a non-negotiable platform behavior.
7. Extension-owned runtime envelope and structured output helper protocol.
8. Deterministic target-matching and target-eligibility diagnostics for the active profile boundary.

### Post-MVP Scope

1. Foundry profile examples, including token-state read and token update notebook flows.
2. Rich complex-object inspection and deeper app-aware diagnostics.
3. Optional companion-module enhancements for app-specific deep runtime integration.
4. Observation and parameterization extensions, including watcher-depth improvements and prompt-based cell inputs.
5. Workspace action promotion and action reuse workflows.

### Explicit MVP Non-Goals

1. Treating Foundry as a platform-level assumption.
2. Requiring a companion module for core kernel operation.
3. Full DevTools replacement or deep object-inspector parity.
4. Automatic reconnect behavior.
5. Marketplace hardening and broad onboarding polish.

## Vision

If successful, jupyter-browser-kernel becomes a reusable browser-execution platform with a stable core and thin app-specific profiles. Foundry serves as the first practical profile example, proving profile layering without coupling the platform to a single domain.

Long term, the product can expand profile coverage while preserving the same kernel contract, notebook experience, and coexistence guarantees.

## Key Risks and Mitigations

1. Session-routing and coexistence regressions across Chromium variants.
   - Mitigation: isolate orchestration logic and enforce fixture-based regression coverage.
2. Transport decisions locking the product too early.
   - Mitigation: preserve explicit transport boundaries and keep kernel contracts transport-agnostic.
3. Scope drift back into app-specific MVP commitments.
   - Mitigation: maintain strict separation of core platform vs profile-owned behavior in planning and implementation artifacts.
