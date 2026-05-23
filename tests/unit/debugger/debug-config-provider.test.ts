import test from "node:test";
import assert from "node:assert/strict";
import type * as vscode from "vscode";

import { DebugConfigProvider } from "../../../src/debugger/debug-config-provider.js";

test("resolveDebugConfiguration sets launch defaults", () => {
  const provider = new DebugConfigProvider();

  const resolved = provider.resolveDebugConfiguration(undefined, {
    type: "jupyter-browser-kernel",
  } as vscode.DebugConfiguration) as vscode.DebugConfiguration;

  assert.equal(resolved?.type, "jupyter-browser-kernel");
  assert.equal(resolved?.request, "launch");
  assert.equal(resolved?.name, "Browser Kernel Debug");
});

test("resolveDebugConfiguration preserves provided request and name", () => {
  const provider = new DebugConfigProvider();

  const resolved = provider.resolveDebugConfiguration(undefined, {
    type: "jupyter-browser-kernel",
    request: "attach",
    name: "Custom",
  } as vscode.DebugConfiguration) as vscode.DebugConfiguration;

  assert.equal(resolved?.request, "attach");
  assert.equal(resolved?.name, "Custom");
});

test("resolveDebugConfiguration does not reject when disconnected", () => {
  const provider = new DebugConfigProvider();

  const resolved = provider.resolveDebugConfiguration(undefined, {
    type: "jupyter-browser-kernel",
  } as vscode.DebugConfiguration) as vscode.DebugConfiguration;

  assert.equal(resolved.type, "jupyter-browser-kernel");
  assert.equal(resolved.request, "launch");
  assert.equal(resolved.name, "Browser Kernel Debug");
});
