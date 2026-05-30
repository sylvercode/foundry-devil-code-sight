import test from "node:test";
import assert from "node:assert/strict";

import { createDebugSessionManager } from "../../../src/debugger/debug-session-manager.js";
import type { DesiredBreakpoint } from "../../../src/debugger/breakpoint-registry.js";
import { createConnectionStateStore } from "../../../src/transport/connection-state.js";
import type { BrowserDebuggerSession } from "../../../src/transport/browser-connect.js";

interface FakeSessionState {
  sequence: string[];
  pauseListener?: (event: unknown) => void;
  breakpointResolvedListener?: (event: {
    breakpointId: string;
    location: { lineNumber: number; columnNumber?: number; scriptId: string };
  }) => void;
  failEnable: boolean;
  setBreakpointCalls: Array<{
    url?: string;
    lineNumber: number;
    columnNumber?: number;
    condition?: string;
  }>;
  removeBreakpointCalls: string[];
}

function createState(overrides?: Partial<FakeSessionState>): FakeSessionState {
  return {
    sequence: [],
    failEnable: false,
    setBreakpointCalls: [],
    removeBreakpointCalls: [],
    ...overrides,
  };
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
    setBreakpointByUrl: async (params) => {
      state.sequence.push("setBreakpointByUrl");
      state.setBreakpointCalls.push({
        url: params.url,
        lineNumber: params.lineNumber,
        columnNumber: params.columnNumber,
        condition: params.condition,
      });

      return {
        breakpointId: `bp-${state.setBreakpointCalls.length}`,
        locations: [
          {
            scriptId: "1",
            lineNumber: params.lineNumber,
            columnNumber: params.columnNumber ?? 0,
          },
        ],
      };
    },
    removeBreakpoint: async ({ breakpointId }) => {
      state.sequence.push("removeBreakpoint");
      state.removeBreakpointCalls.push(breakpointId);
    },
    getProperties: async () => ({ result: [] }),
    evaluateOnCallFrame: async () => ({
      result: {
        type: "undefined",
      },
    }),
    releaseObject: async () => undefined,
    evaluate: async () => ({
      result: {
        type: "undefined",
      },
    }),
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
    onBreakpointResolved: (listener) => {
      state.sequence.push("onBreakpointResolved");
      state.breakpointResolvedListener = listener as (event: {
        breakpointId: string;
        location: {
          lineNumber: number;
          columnNumber?: number;
          scriptId: string;
        };
      }) => void;
      return {
        dispose: () => {
          state.sequence.push("disposeBreakpointResolved");
          state.breakpointResolvedListener = undefined;
        },
      };
    },
  };
}

test("launch enables debugger and subscribes paused listener", async () => {
  createConnectionStateStore();

  const state = createState();

  const manager = createDebugSessionManager({
    getDebuggerSession: () => createFakeDebuggerSession(state),
    logger: () => undefined,
  });

  await manager.launch();

  assert.deepEqual(state.sequence, [
    "enable",
    "onPaused",
    "onBreakpointResolved",
  ]);

  manager.dispose();
});

test("terminate clears registry before disabling debugger", async () => {
  createConnectionStateStore();

  const state = createState();

  const manager = createDebugSessionManager({
    getDebuggerSession: () => createFakeDebuggerSession(state),
    logger: () => undefined,
  });

  const desired: DesiredBreakpoint[] = [
    {
      line: 3,
      condition: "x > 1",
    },
  ];
  manager.recordSetBreakpoints(
    "vscode-notebook-cell://test/cell-1.js",
    desired,
  );

  await manager.launch();
  await manager.terminate();

  assert.deepEqual(state.sequence, [
    "enable",
    "onPaused",
    "onBreakpointResolved",
    "setBreakpointByUrl",
    "disposePaused",
    "disposeBreakpointResolved",
    "removeBreakpoint",
    "disable",
  ]);
  assert.equal(manager.getBreakpointRegistry(), undefined);

  manager.dispose();
});

test("enable failure is logged and re-thrown for DAP launch path", async () => {
  createConnectionStateStore();

  const state = createState({ failEnable: true });

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

  const state = createState();

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

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (reasons.length > 0) {
      break;
    }
    await Promise.resolve();
  }

  assert.deepEqual(reasons, ["connection-lost"]);

  subscription.dispose();
  manager.dispose();
});

test("connection lost during enable rejects launch and disables session without leaving running state", async () => {
  const connectionStateStore = createConnectionStateStore();

  const state = createState();

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

test("launch creates registry and replays each cached payload once", async () => {
  createConnectionStateStore();

  const state = createState();

  const manager = createDebugSessionManager({
    getDebuggerSession: () => createFakeDebuggerSession(state),
    logger: () => undefined,
  });

  manager.recordSetBreakpoints("vscode-notebook-cell://test/cell-a.js", [
    { line: 2 },
  ]);
  manager.recordSetBreakpoints("vscode-notebook-cell://test/cell-b.js", [
    { line: 6, condition: "flag" },
  ]);

  await manager.launch();

  assert.ok(manager.getBreakpointRegistry());
  assert.equal(state.setBreakpointCalls.length, 2);
  assert.deepEqual(
    state.setBreakpointCalls.map((call) => call.url),
    [
      "vscode-notebook-cell://test/cell-a.js",
      "vscode-notebook-cell://test/cell-b.js",
    ],
  );

  manager.dispose();
});

test("terminate survives removeBreakpoint failures and still disables", async () => {
  createConnectionStateStore();

  const state = createState();

  const base = createFakeDebuggerSession(state);
  const session: BrowserDebuggerSession = {
    ...base,
    removeBreakpoint: async ({ breakpointId }) => {
      state.sequence.push("removeBreakpoint");
      state.removeBreakpointCalls.push(breakpointId);
      throw new Error("remove failed");
    },
  };

  const manager = createDebugSessionManager({
    getDebuggerSession: () => session,
    logger: () => undefined,
  });

  manager.recordSetBreakpoints("vscode-notebook-cell://test/cell-1.js", [
    { line: 4 },
  ]);

  await manager.launch();
  await manager.terminate();

  assert.equal(state.sequence.includes("disable"), true);
  assert.equal(manager.getBreakpointRegistry(), undefined);

  manager.dispose();
});

test("runtime breakpointResolved is propagated through manager event", async () => {
  createConnectionStateStore();

  const state = createState();
  const manager = createDebugSessionManager({
    getDebuggerSession: () => createFakeDebuggerSession(state),
    logger: () => undefined,
  });

  manager.recordSetBreakpoints("vscode-notebook-cell://test/cell-r.js", [
    { line: 7 },
  ]);

  const resolvedEvents: Array<{ url: string; line: number }> = [];
  const subscription = manager.onDidBreakpointResolved((event) => {
    resolvedEvents.push({ url: event.url, line: event.line });
  });

  await manager.launch();

  state.breakpointResolvedListener?.({
    breakpointId: "bp-1",
    location: { scriptId: "1", lineNumber: 8, columnNumber: 0 },
  });

  assert.deepEqual(resolvedEvents, [
    { url: "vscode-notebook-cell://test/cell-r.js", line: 9 },
  ]);

  subscription.dispose();
  manager.dispose();
});
