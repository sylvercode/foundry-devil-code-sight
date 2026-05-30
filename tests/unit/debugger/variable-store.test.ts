import test from "node:test";
import assert from "node:assert/strict";

import { createVariableStore } from "../../../src/debugger/variable-store.js";
import type { BrowserDebuggerSession } from "../../../src/transport/browser-connect.js";

function createDebuggerSession(
  releaseCalls: string[],
  failRelease = false,
): BrowserDebuggerSession {
  return {
    enable: async () => undefined,
    disable: async () => undefined,
    setBreakpointByUrl: async () => ({ breakpointId: "bp", locations: [] }),
    removeBreakpoint: async () => undefined,
    getProperties: async () => ({ result: [] }),
    evaluateOnCallFrame: async () => ({ result: { type: "undefined" } }),
    releaseObject: async ({ objectId }) => {
      releaseCalls.push(objectId);
      if (failRelease) {
        throw new Error("release failed");
      }
    },
    evaluate: async () => ({ result: { type: "undefined" } }),
    resume: async () => undefined,
    onPaused: () => ({ dispose: () => undefined }),
    onBreakpointResolved: () => ({ dispose: () => undefined }),
  };
}

test("allocates sequential handles starting at 1000", () => {
  const store = createVariableStore({
    debuggerSession: createDebuggerSession([]),
    logger: () => undefined,
  });

  const first = store.reserve({ objectId: "obj-1", kind: "object" });
  const second = store.reserve({ objectId: "obj-2", kind: "array" });

  assert.equal(first, 1000);
  assert.equal(second, 1001);
  assert.deepEqual(store.resolve(first), { objectId: "obj-1", kind: "object" });
});

test("clearForPause releases all tracked object ids once and resets handles", async () => {
  const released: string[] = [];
  const store = createVariableStore({
    debuggerSession: createDebuggerSession(released),
    logger: () => undefined,
  });

  const first = store.reserve({ objectId: "obj-1", kind: "scope" });
  store.reserve({ objectId: "obj-2", kind: "object" });

  await store.clearForPause();

  assert.deepEqual(released.sort(), ["obj-1", "obj-2"]);
  assert.equal(store.resolve(first), undefined);
  assert.equal(store.reserve({ objectId: "obj-3", kind: "object" }), 1000);
});

test("clearForPause resolves even when all releaseObject calls fail", async () => {
  const logs: string[] = [];
  const store = createVariableStore({
    debuggerSession: createDebuggerSession([], true),
    logger: (message) => {
      logs.push(message);
    },
  });

  store.reserve({ objectId: "obj-1", kind: "scope" });
  store.reserve({ objectId: "obj-2", kind: "object" });

  await assert.doesNotReject(async () => {
    await store.clearForPause();
  });

  assert.equal(logs.length, 2);
});

test("dispose releases tracked objects and future lookups return undefined", async () => {
  const released: string[] = [];
  const store = createVariableStore({
    debuggerSession: createDebuggerSession(released),
    logger: () => undefined,
  });

  const handle = store.reserve({ objectId: "obj-1", kind: "object" });
  await store.dispose();

  assert.deepEqual(released, ["obj-1"]);
  assert.equal(store.resolve(handle), undefined);
});
