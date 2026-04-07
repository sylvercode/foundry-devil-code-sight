# Connection Troubleshooting Summary (2026-04-06)

## Context

The extension originally failed to connect to Edge CDP with this error family:

- `transport-failure`
- `socket hang up`
- all fallbacks failing (`CRI`, raw `ws`, target selection, known browser path, direct target)

Status: resolved.

## What We Verified Works

### Host browser endpoint is alive

PowerShell on Windows host returns a valid CDP browser endpoint:

- Browser: `Edg/146.0.3856.97`
- Protocol-Version: `1.3`
- webSocketDebuggerUrl: `ws://[::1]:9222/devtools/browser/<browser-id>`

### Host-level WebSocket handshake works (outside extension host)

A native PowerShell/.NET `ClientWebSocket` test successfully reaches `Open` state for the browser WebSocket URL.

Important host behavior observed:

- `127.0.0.1` does not work for this Edge debug session
- `localhost` works in PowerShell because it resolves to IPv6 loopback for this case
- Edge logs report: `DevTools listening on ws://[::1]:9222/devtools/browser/...`

### Edge launch flags are present

Edge was launched with:

- `--remote-debugging-port=9222`
- `--remote-allow-origins=*`
- other expected startup flags

### Extension activation issue was isolated and addressed

The earlier activation failure (`Dynamic require of "events" is not supported`) was traced to stale artifact loading and debug/package path mismatch. Clean-first builds were added, and transport dependencies remained externalized so the ESM bundle does not emit unsupported dynamic require shims.

## Changes Tried In Code/Build

### Build and packaging

- Reintroduced `ws` as external dependency in build config.
- Kept `chrome-remote-interface` and `ws` external to the bundle.
- Restored extension build output to ESM (`dist/extension.mjs`).
- Updated extension `main` entry to `./dist/extension.mjs`.
- Added clean script to remove `dist` and `out`.
- Made compile/package scripts clean before build.
- Updated debug launch/task wiring to compile fresh and map to `dist/**/*.mjs`.
- Added `.vscodeignore` guard for stale `dist/extension.js`.

### Transport connection logic

- Adjusted raw `ws` origin strategy to try no-origin first.
- Simplified raw `ws` handshake options.
- Added native WebSocket fallback path before `ws` fallback.

## Confirmed Root Cause

The failure was caused by loopback address normalization mismatching Edge's binding mode:

- Edge was bound to IPv6 loopback (`[::1]`)
- The extension normalized/rewrote to `localhost` or bare `::1` in ways that led to invalid or IPv4-biased connection attempts
- Node.js URL/host handling requires bracketed IPv6 (`[::1]`) in URL string contexts

This produced `socket hang up` despite the endpoint being alive.

Note: a prior proxy-agent hypothesis was tested and disproven (`http.proxySupport: off` still reproduced the issue).

## Fix Implemented

File: `src/transport/browser-connect.ts`

1. `normalizeEndpointHost("localhost")` now returns `[::1]` (bracketed IPv6)
2. Loopback detection expanded to include both `::1` and `[::1]`
3. `rewriteBrowserWebSocketUrl` now preserves browser-reported loopback host when both configured and reported hosts are loopback

Why this works:

- Prevents malformed URL construction such as `ws://::1:9222/...`
- Aligns extension transport with Edge's actual listener address
- Keeps browser-provided loopback hostname authoritative for local sessions

## Verification

- `npm run compile` succeeds
- `npm run lint` succeeds
- Unit tests pass (`29/29`)
- User runtime check succeeds: `Connected to target ... at localhost:9222`

## Current State

Connection path is now functioning end-to-end for the reported scenario.

## Follow-up Recommendations

1. Add a regression unit test covering URL construction for known browser path with configured `localhost` and expected bracketed IPv6 output.
2. Keep this summary aligned with `_bmad-output/planning-artifacts/research/technical-cdp-websocket-socket-hang-up-research-2026-04-06.md` correction note.
3. Include one manual reconnect check in release validation to catch loopback normalization regressions early.
