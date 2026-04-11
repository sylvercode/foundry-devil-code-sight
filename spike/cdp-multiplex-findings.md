# CDP Multiplexing Findings

## Summary

**Yes — `chrome-remote-interface` (CRI) fully supports browser-level WebSocket
multiplexing with `Target.attachToTarget` session IDs.** No alternative library
is required for the `jupyter-browser-kernel` extension.

---

## Background: the two WebSocket modes

Chrome's DevTools Protocol exposes two kinds of WebSocket endpoints:

| Endpoint           | URL pattern                                                        | Limit                                                                                 |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| **Page target**    | `ws://localhost:9222/devtools/page/<id>`                           | **One client at a time** — a second connection kicks the first                        |
| **Browser target** | `ws://localhost:9222/devtools/browser/<id>` (from `/json/version`) | **Unlimited clients** — each creates independent sessions via `Target.attachToTarget` |

The extension currently connects directly to a page target. This means
`ms-edgedevtools.vscode-edge-devtools` opening the same tab **would** kick the
extension off, and vice-versa. Switching to the browser-level target and using
session IDs fixes this.

---

## Can CRI support this? Yes — here's how

CRI `0.33.x` has **native session-ID support** baked in to its `send()` and event
APIs. No patching, monkey-patching, or alternative library is needed.

### 1. Connect to the browser target, not a page target

```ts
import CDP from "chrome-remote-interface";
import http from "http";

// Fetch the browser-level WebSocket URL from /json/version
const info = await new Promise<any>((resolve, reject) => {
  http
    .get(`http://${host}:${port}/json/version`, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve(JSON.parse(d)));
    })
    .on("error", reject);
});

// Pass the raw WS URL as `target` — CRI skips its /json/list logic and
// connects directly to the browser-level WebSocket.
const browser = await CDP({ target: info.webSocketDebuggerUrl, local: true });
```

### 2. Discover the FoundryVTT page target

```ts
const { targetInfos } = await browser.Target.getTargets();
const foundryTarget = targetInfos.find(
  (t) => t.type === "page" && t.url.includes("/game"),
);
```

### 3. Create a session with `Target.attachToTarget` (flat mode)

```ts
const { sessionId } = await browser.Target.attachToTarget({
  targetId: foundryTarget.targetId,
  flatten: true, // required — enables flat-session multiplexing
});
```

`flatten: true` is required. Without it, Chrome uses the legacy nested
`Target.receivedMessageFromTarget` framing which CRI does **not** demultiplex.

Multiple callers (the extension + vscode-edge-devtools) can each call
`attachToTarget` on the same `targetId` and receive distinct `sessionId`s.
Chrome delivers events and responses on the shared WebSocket, tagged with the
correct `sessionId`, so they never interfere.

### 4. Send commands scoped to the session

```ts
// CRI's send() signature: send(method, [params], [sessionId], [callback])
const result = await browser.send(
  "Runtime.evaluate",
  { expression: "1 + 1", returnByValue: true, awaitPromise: true },
  sessionId, // <-- third arg routes the command through this session
);
```

The domain-style shorthand (`browser.Runtime.evaluate(...)`) does **not**
accept a session ID — always use `browser.send()` when you need to target a
specific session.

### 5. Receive session-scoped events

CRI emits events under three keys:

```
'event'                                  — every event (all sessions)
'<Domain>.<method>'                      — all sessions for this method
'<Domain>.<method>.<sessionId>'          — only this session
```

Use the third form to scope listeners to a single session:

```ts
browser.on(`Runtime.consoleAPICalled.${sessionId}`, (params) => {
  // Only fires for events belonging to `sessionId`
});
```

### 6. Graceful browser shutdown (optional)

```ts
await browser.send("Browser.close").catch(() => {});
await browser.close();
```

---

## Spike results

Spike script: `spike/spike-cdp-multiplex.js`  
Browser: Chromium 146.0.7680.71 (headless, Linux x86_64)  
CRI version: 0.33.2

| Step                                              | Result                  |
| ------------------------------------------------- | ----------------------- |
| Connect CRI to browser-level WS                   | ✅                      |
| `Target.attachToTarget` × 2 → distinct sessionIds | ✅                      |
| `Runtime.evaluate` via Session A                  | ✅ (returned `2`)       |
| `Runtime.evaluate` via Session B                  | ✅ (returned UA string) |
| Session-scoped `consoleAPICalled` event routing   | ✅                      |
| No cross-session leakage                          | ✅                      |

All assertions passed. Exit code 0.

---

## Recommended pattern for `src/cdp/client.ts`

```ts
import CDP from "chrome-remote-interface";
import http from "http";

export interface CdpSession {
  sessionId: string;
  send<T = unknown>(method: string, params?: object): Promise<T>;
  on(event: string, handler: (params: unknown) => void): void;
  detach(): Promise<void>;
}

export class CdpClient {
  private browser: CDP.Client | null = null;

  /** Connect to the browser-level WebSocket */
  async connect(host: string, port: number): Promise<void> {
    const info = await this._getVersionInfo(host, port);
    // Rewrite localhost/127.0.0.1 when the client runs remotely from the browser host
    // (for example devcontainer/WSL -> host machine).
    const wsUrl = info.webSocketDebuggerUrl
      .replace("127.0.0.1", host)
      .replace("localhost", host);
    this.browser = await CDP({ target: wsUrl, local: true });
  }

  /** Open an independent session on the FoundryVTT page target */
  async attachToTarget(targetId: string): Promise<CdpSession> {
    if (!this.browser) throw new Error("Not connected");
    const { sessionId } = await this.browser.Target.attachToTarget({
      targetId,
      flatten: true,
    });
    const browser = this.browser;
    return {
      sessionId,
      send: (method, params) => browser.send(method, params, sessionId),
      on: (event, handler) => browser.on(`${event}.${sessionId}`, handler),
      detach: () => browser.Target.detachFromTarget({ sessionId }),
    };
  }

  /** List page targets; filter for FoundryVTT */
  async getFoundryTarget(host: string): Promise<string | undefined> {
    if (!this.browser) throw new Error("Not connected");
    const { targetInfos } = await this.browser.Target.getTargets();
    return targetInfos.find((t) => t.type === "page" && t.url.includes("/game"))
      ?.targetId;
  }

  async disconnect(): Promise<void> {
    await this.browser?.send("Browser.close").catch(() => {});
    await this.browser?.close();
    this.browser = null;
  }

  private _getVersionInfo(host: string, port: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const req = http.get(`http://${host}:${port}/json/version`, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(d));
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on("error", reject);
    });
  }
}
```

---

## Key requirements and caveats

| Requirement                               | Detail                                                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRI version                               | `^0.33.x` (current) — `sessionId` support has been present since at least 0.31                                                                              |
| `flatten: true`                           | **Mandatory** on `attachToTarget`. Without it, events arrive wrapped in `Target.receivedMessageFromTarget` and CRI won't demultiplex them                   |
| Use `browser.send()` for session commands | The `browser.Runtime.evaluate(...)` domain shorthand does not accept a `sessionId` argument                                                                 |
| Event scoping                             | Use `'<Domain>.<method>.<sessionId>'` listener keys for session isolation                                                                                   |
| `local: true`                             | Pass `local: true` to `CDP()` to avoid an HTTP round-trip to fetch the protocol descriptor (browser may not serve it when connecting to the browser target) |
| Chrome version                            | `Target.attachToTarget` with `flatten` has been stable since Chrome 64                                                                                      |

---

## Why no alternative library is needed

| Library                            | Notes                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **`chrome-remote-interface` 0.33** | ✅ Fully supports browser-target + sessionId multiplexing. Already in `package.json`. Use this.              |
| `puppeteer-core`                   | ✅ Supports multiplexing but adds ~5 MB and has a high-level API that conflicts with direct CDP access needs |
| `playwright-core`                  | ✅ Supports multiplexing but adds ~25 MB and is oriented toward automation, not extension use                |
| Raw WebSocket                      | ✅ Works but requires reimplementing CRI's ID tracking, error handling, and event routing manually           |

**Recommendation: stay with `chrome-remote-interface`.** Switch from connecting
to the page-level WebSocket to the browser-level WebSocket + `Target.attachToTarget`.
