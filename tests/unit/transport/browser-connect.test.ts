import test from "node:test";
import assert from "node:assert/strict";

import {
  connectToBrowserTarget,
  createBrowserDebuggerSession,
  createAttachToTargetParams,
  disconnectActiveBrowserConnection,
  getActiveBrowserConnection,
  safeDetachFromTarget,
  toSessionScopedEventName,
} from "../../../src/transport/browser-connect.js";
import { coreTargetProfile } from "../../../src/profile/core-target-profile.js";
import { createLocalizeMock } from "../test-utils/localize-mock.js";

test("createAttachToTargetParams always enforces flatten mode", () => {
  assert.deepEqual(createAttachToTargetParams("target-1"), {
    targetId: "target-1",
    flatten: true,
  });
});

test("toSessionScopedEventName builds isolated event keys", () => {
  assert.equal(
    toSessionScopedEventName("Runtime.consoleAPICalled", "session-1"),
    "Runtime.consoleAPICalled.session-1",
  );
});

test("safeDetachFromTarget detaches an attached session", async () => {
  const detachCalls: Array<{ sessionId: string }> = [];

  await safeDetachFromTarget(
    {
      Target: {
        detachFromTarget: async (params: { sessionId: string }) => {
          detachCalls.push(params);
          return undefined;
        },
      },
    } as never,
    "session-1",
  );

  assert.deepEqual(detachCalls, [{ sessionId: "session-1" }]);
});

test("safeDetachFromTarget swallows detach cleanup errors", async () => {
  await assert.doesNotReject(async () => {
    await safeDetachFromTarget(
      {
        Target: {
          detachFromTarget: async () => {
            throw new Error("detach failed");
          },
        },
      } as never,
      "session-2",
    );
  });
});

test("createBrowserDebuggerSession forwards setBreakpointByUrl to the scoped session", async () => {
  const sendCalls: Array<{
    method: string;
    params: unknown;
    sessionId?: string;
  }> = [];

  const session = createBrowserDebuggerSession(
    {
      send: async (method: string, params: unknown, sessionId?: string) => {
        sendCalls.push({ method, params, sessionId });
        if (method === "Debugger.setBreakpointByUrl") {
          return {
            breakpointId: "bp-1",
            locations: [],
          };
        }

        return undefined;
      },
      on: () => undefined,
      off: () => undefined,
    } as never,
    "session-1",
  );

  const result = await session.setBreakpointByUrl({
    url: "vscode-notebook-cell://test/notebook.ipynb#cell0",
    lineNumber: 1,
  });

  assert.equal(result.breakpointId, "bp-1");
  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0]?.method, "Debugger.setBreakpointByUrl");
  assert.equal(sendCalls[0]?.sessionId, "session-1");
});

test("createBrowserDebuggerSession forwards removeBreakpoint to the scoped session", async () => {
  const sendCalls: Array<{
    method: string;
    params: unknown;
    sessionId?: string;
  }> = [];

  const session = createBrowserDebuggerSession(
    {
      send: async (method: string, params: unknown, sessionId?: string) => {
        sendCalls.push({ method, params, sessionId });
        return undefined;
      },
      on: () => undefined,
      off: () => undefined,
    } as never,
    "session-2",
  );

  await session.removeBreakpoint({ breakpointId: "bp-remove" });

  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0]?.method, "Debugger.removeBreakpoint");
  assert.deepEqual(sendCalls[0]?.params, { breakpointId: "bp-remove" });
  assert.equal(sendCalls[0]?.sessionId, "session-2");
});

test("createBrowserDebuggerSession resume swallows CDP errors", async () => {
  const session = createBrowserDebuggerSession(
    {
      send: async () => {
        throw new Error("resume failed");
      },
      on: () => undefined,
      off: () => undefined,
    } as never,
    "session-3",
  );

  await assert.doesNotReject(async () => {
    await session.resume();
  });
});

test("createBrowserDebuggerSession onPaused subscribes and disposes by session-scoped event name", () => {
  const calls: Array<{ action: "on" | "off"; eventName: string }> = [];
  let capturedListener: ((event: unknown) => void) | undefined;

  const session = createBrowserDebuggerSession(
    {
      send: async () => undefined,
      on: (eventName: string, listener: (event: unknown) => void) => {
        calls.push({ action: "on", eventName });
        capturedListener = listener;
      },
      off: (eventName: string) => {
        calls.push({ action: "off", eventName });
      },
    } as never,
    "session-4",
  );

  const events: unknown[] = [];
  const subscription = session.onPaused((event) => {
    events.push(event);
  });

  capturedListener?.({ reason: "other" });
  subscription.dispose();

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    action: "on",
    eventName: "Debugger.paused.session-4",
  });
  assert.deepEqual(calls[1], {
    action: "off",
    eventName: "Debugger.paused.session-4",
  });
  assert.equal(events.length, 1);
});

test("connectToBrowserTarget enables Debugger after Runtime probe and before exposing active connection", async () => {
  await disconnectActiveBrowserConnection();

  const sendCalls: Array<{ method: string; sessionId?: string }> = [];
  const fakeClient = {
    Target: {
      getTargets: async () => ({
        targetInfos: [
          {
            targetId: "target-1",
            type: "page",
            title: "page",
            url: "http://localhost/game",
            attached: false,
            canAccessOpener: false,
            browserContextId: "default",
          },
        ],
      }),
      attachToTarget: async () => ({ sessionId: "session-attach" }),
      detachFromTarget: async () => undefined,
    },
    send: async (method: string, params: unknown, sessionId?: string) => {
      sendCalls.push({ method, sessionId });

      if (method === "Runtime.evaluate") {
        return {
          result: { value: 2 },
        };
      }

      if (method === "Debugger.enable") {
        return {};
      }

      return {};
    },
    close: async () => undefined,
    on: () => undefined,
    off: () => undefined,
  };

  const result = await connectToBrowserTarget(
    { host: "localhost", port: 9222 },
    coreTargetProfile,
    createLocalizeMock(),
    undefined,
    {
      resolveWebSocketUrl: async () => "ws://127.0.0.1/devtools/browser/mock",
      createBrowserClient: async () => fakeClient as never,
    },
  );

  assert.equal(result.ok, true);

  const runtimeIndex = sendCalls.findIndex(
    (entry) => entry.method === "Runtime.evaluate",
  );
  const debuggerEnableIndex = sendCalls.findIndex(
    (entry) => entry.method === "Debugger.enable",
  );

  assert.equal(runtimeIndex >= 0, true);
  assert.equal(debuggerEnableIndex > runtimeIndex, true);

  const activeConnection = getActiveBrowserConnection();
  assert.ok(activeConnection);
  assert.equal(
    typeof activeConnection?.debugger.setBreakpointByUrl,
    "function",
  );

  await disconnectActiveBrowserConnection();
});

test("connectToBrowserTarget returns normalized failure and detaches when Debugger.enable fails", async () => {
  await disconnectActiveBrowserConnection();

  let detachCalls = 0;
  const fakeClient = {
    Target: {
      getTargets: async () => ({
        targetInfos: [
          {
            targetId: "target-2",
            type: "page",
            title: "page",
            url: "http://localhost/game",
            attached: false,
            canAccessOpener: false,
            browserContextId: "default",
          },
        ],
      }),
      attachToTarget: async () => ({ sessionId: "session-fail" }),
      detachFromTarget: async () => {
        detachCalls += 1;
      },
    },
    send: async (method: string) => {
      if (method === "Runtime.evaluate") {
        return {
          result: { value: 2 },
        };
      }

      if (method === "Debugger.enable") {
        throw new Error("debugger exploded");
      }

      return {};
    },
    close: async () => undefined,
    on: () => undefined,
    off: () => undefined,
  };

  const result = await connectToBrowserTarget(
    { host: "localhost", port: 9222 },
    coreTargetProfile,
    createLocalizeMock(),
    undefined,
    {
      resolveWebSocketUrl: async () => "ws://127.0.0.1/devtools/browser/mock",
      createBrowserClient: async () => fakeClient as never,
    },
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.category, "transport-failure");
    assert.match(result.failure.message, /Debugger\.enable/i);
  }

  assert.equal(detachCalls, 1);
  assert.equal(getActiveBrowserConnection(), undefined);
});

test("connectToBrowserTarget performs only Debugger.enable during attach", async () => {
  await disconnectActiveBrowserConnection();

  const debuggerMethodCalls: string[] = [];
  const fakeClient = {
    Target: {
      getTargets: async () => ({
        targetInfos: [
          {
            targetId: "target-3",
            type: "page",
            title: "page",
            url: "http://localhost/game",
            attached: false,
            canAccessOpener: false,
            browserContextId: "default",
          },
        ],
      }),
      attachToTarget: async () => ({ sessionId: "session-debugger-only" }),
      detachFromTarget: async () => undefined,
    },
    send: async (method: string) => {
      if (method.startsWith("Debugger.")) {
        debuggerMethodCalls.push(method);
      }

      if (method === "Runtime.evaluate") {
        return {
          result: { value: 2 },
        };
      }

      return {};
    },
    close: async () => undefined,
    on: () => undefined,
    off: () => undefined,
  };

  const result = await connectToBrowserTarget(
    { host: "localhost", port: 9222 },
    coreTargetProfile,
    createLocalizeMock(),
    undefined,
    {
      resolveWebSocketUrl: async () => "ws://127.0.0.1/devtools/browser/mock",
      createBrowserClient: async () => fakeClient as never,
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(debuggerMethodCalls, ["Debugger.enable"]);

  await disconnectActiveBrowserConnection();
});
