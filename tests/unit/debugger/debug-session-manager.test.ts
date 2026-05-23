import test from "node:test";
import assert from "node:assert/strict";

import { createDebugSessionManager } from "../../../src/debugger/debug-session-manager.js";
import { createConnectionStateStore } from "../../../src/transport/connection-state.js";
import type { BrowserDebuggerSession } from "../../../src/transport/browser-connect.js";

interface FakeSessionState {
  sequence: string[];
  pauseListener?: (event: unknown) => void;
  failEnable: boolean;
}

function createFakeDebuggerSession(
  state: FakeSessionState,
): BrowserDebuggerSession {
  return {
    enable: async () => {
      state.sequence.push("enable");
      if (state.failEnable) {
        throw new Error("enable failed");
      }
    },
    disable: async () => {
      state.sequence.push("disable");
    },
    setBreakpointByUrl: async () => ({ breakpointId: "bp", locations: [] }),
    removeBreakpoint: async () => undefined,
    resume: async () => undefined,
    onPaused: (listener) => {
      state.sequence.push("onPaused");
      state.pauseListener = listener as (event: unknown) => void;
      return {
        dispose: () => {
          state.sequence.push("disposePaused");
          state.pauseListener = undefined;
        },
      };
    },
  };
}

test("launch enables debugger and subscribes paused listener", async () => {
  createConnectionStateStore();

  const state: FakeSessionState = {
    sequence: [],
    failEnable: false,
  };

  const manager = createDebugSessionManager({
    getDebuggerSession: () => createFakeDebuggerSession(state),
    logger: () => undefined,
  });

  await manager.launch();

  assert.deepEqual(state.sequence, ["enable", "onPaused"]);

  manager.dispose();
});

test("terminate disposes paused listener before disabling debugger", async () => {
  createConnectionStateStore();

  const state: FakeSessionState = {
    sequence: [],
    failEnable: false,
  };

  const manager = createDebugSessionManager({
    getDebuggerSession: () => createFakeDebuggerSession(state),
    logger: () => undefined,
  });

  await manager.launch();
  await manager.terminate();

  assert.deepEqual(state.sequence, [
    "enable",
    "onPaused",
    "disposePaused",
    "disable",
  ]);

  manager.dispose();
});

test("enable failure is logged and re-thrown for DAP launch path", async () => {
  createConnectionStateStore();

  const state: FakeSessionState = {
    sequence: [],
    failEnable: true,
  };

  const logEntries: string[] = [];

  const manager = createDebugSessionManager({
    getDebuggerSession: () => createFakeDebuggerSession(state),
    logger: (message, error) => {
      logEntries.push(`${message} :: ${String(error)}`);
    },
  });

  await assert.rejects(async () => {
    await manager.launch();
  }, /Failed to enable Debugger domain on browser session: enable failed/);

  assert.equal(logEntries.length, 1);
  assert.match(logEntries[0] ?? "", /Failed to enable Debugger domain/);

  manager.dispose();
});

test("connection-state disconnected transition emits terminated exactly once", async () => {
  const connectionStateStore = createConnectionStateStore();

  const state: FakeSessionState = {
    sequence: [],
    failEnable: false,
  };

  const manager = createDebugSessionManager({
    getDebuggerSession: () => createFakeDebuggerSession(state),
    logger: () => undefined,
  });

  const reasons: string[] = [];
  const subscription = manager.onDidTerminate((reason) => {
    reasons.push(reason);
  });

  await manager.launch();

  connectionStateStore.setState("disconnected");
  connectionStateStore.setState("error");

  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(reasons, ["connection-lost"]);

  subscription.dispose();
  manager.dispose();
});

test("connection lost during enable rejects launch and disables session without leaving running state", async () => {
  const connectionStateStore = createConnectionStateStore();

  const state: FakeSessionState = {
    sequence: [],
    failEnable: false,
  };

  const baseSession = createFakeDebuggerSession(state);
  let resolveEnable: (() => void) | undefined;
  const session = {
    ...baseSession,
    enable: async () => {
      state.sequence.push("enable-start");
      await new Promise<void>((resolve) => {
        resolveEnable = resolve;
      });
      state.sequence.push("enable-end");
    },
  };

  const manager = createDebugSessionManager({
    getDebuggerSession: () => session,
    logger: () => undefined,
  });

  const reasons: string[] = [];
  const subscription = manager.onDidTerminate((reason) => {
    reasons.push(reason);
  });

  const launchPromise = manager.launch();

  await Promise.resolve();
  assert.ok(resolveEnable, "enable must be awaiting");

  connectionStateStore.setState("disconnected");
  resolveEnable!();

  await assert.rejects(
    launchPromise,
    /Browser connection lost; debug session terminated\./,
  );

  assert.deepEqual(state.sequence, ["enable-start", "enable-end", "disable"]);
  assert.deepEqual(reasons, []);

  connectionStateStore.setState("disconnected");
  await Promise.resolve();
  assert.deepEqual(reasons, []);

  subscription.dispose();
  manager.dispose();
});
