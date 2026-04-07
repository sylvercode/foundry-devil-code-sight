import test from "node:test";
import assert from "node:assert/strict";

import { rewriteBrowserWebSocketUrl } from "../../../src/transport/browser-connect.js";

test("rewriteBrowserWebSocketUrl uses configured endpoint host and port", () => {
  const rewritten = rewriteBrowserWebSocketUrl(
    "ws://localhost:9222/devtools/browser/browser-id",
    { host: "host.docker.internal", port: 9333 },
  );

  assert.equal(
    rewritten,
    "ws://host.docker.internal:9333/devtools/browser/browser-id",
  );
});

test("rewriteBrowserWebSocketUrl preserves browser-reported loopback host", () => {
  const rewritten = rewriteBrowserWebSocketUrl(
    "ws://localhost:9222/devtools/browser/browser-id",
    { host: "localhost", port: 9222 },
  );

  assert.equal(rewritten, "ws://localhost:9222/devtools/browser/browser-id");
});

test("rewriteBrowserWebSocketUrl preserves IPv6 loopback from browser", () => {
  const rewritten = rewriteBrowserWebSocketUrl(
    "ws://[::1]:9222/devtools/browser/browser-id",
    { host: "localhost", port: 9222 },
  );

  assert.equal(rewritten, "ws://[::1]:9222/devtools/browser/browser-id");
});

test("rewriteBrowserWebSocketUrl preserves IPv6 loopback with IPv6 endpoint", () => {
  const rewritten = rewriteBrowserWebSocketUrl(
    "ws://[::1]:9222/devtools/browser/browser-id",
    { host: "::1", port: 9222 },
  );

  assert.equal(rewritten, "ws://[::1]:9222/devtools/browser/browser-id");
});
