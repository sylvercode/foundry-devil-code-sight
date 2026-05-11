import test from "node:test";
import assert from "node:assert/strict";

import type * as vscode from "vscode";

import { createBreakpointMirror } from "../../../src/debugger/breakpoint-mirror.js";
import type { BrowserDebuggerSession } from "../../../src/transport/browser-connect.js";

type BreakpointsChangeEventLike = {
  added: vscode.Breakpoint[];
  removed: vscode.Breakpoint[];
  changed: vscode.Breakpoint[];
};

interface FakeDebugApi {
  breakpoints: vscode.Breakpoint[];
  onDidChangeBreakpoints: (
    listener: (event: vscode.BreakpointsChangeEvent) => void,
  ) => vscode.Disposable;
  fireChange: (event: BreakpointsChangeEventLike) => Promise<void>;
}

function createBreakpoint(
  id: string,
  uri: string,
  line: number,
  enabled = true,
  condition?: string,
): vscode.Breakpoint {
  const parsedUri = new URL(uri);

  return {
    id,
    enabled,
    condition,
    location: {
      uri: {
        scheme: parsedUri.protocol.replace(":", ""),
        toString: () => uri,
      },
      range: {
        start: {
          line,
        },
      },
    },
  } as never;
}

function createFunctionBreakpoint(id: string): vscode.Breakpoint {
  return {
    id,
    enabled: true,
  } as never;
}

function createFakeDebugApi(): FakeDebugApi {
  const listeners = new Set<(event: vscode.BreakpointsChangeEvent) => void>();

  return {
    breakpoints: [],
    onDidChangeBreakpoints: (listener) => {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    fireChange: async (event) => {
      for (const listener of listeners) {
        listener(event as vscode.BreakpointsChangeEvent);
      }
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

interface FakeDebuggerSessionState {
  setCalls: Array<{ url: string; lineNumber: number; condition?: string }>;
  removeCalls: Array<{ breakpointId: string }>;
  resumeCalls: number;
  pauseListeners: Array<(event: unknown) => void>;
  failingSetUrls: Set<string>;
  failingResume: boolean;
  nextBreakpointNumber: number;
}

function createFakeDebuggerSession(
  state: FakeDebuggerSessionState,
): BrowserDebuggerSession {
  return {
    setBreakpointByUrl: async (params) => {
      const url = String(params.url ?? "");
      state.setCalls.push({
        url,
        lineNumber: params.lineNumber,
        condition: params.condition,
      });

      if (state.failingSetUrls.has(url)) {
        throw new Error(`set failed for ${url}`);
      }

      state.nextBreakpointNumber += 1;
      return {
        breakpointId: `cdp-${state.nextBreakpointNumber}`,
        locations: [],
      };
    },
    removeBreakpoint: async (params) => {
      state.removeCalls.push(params);
    },
    resume: async () => {
      state.resumeCalls += 1;
      if (state.failingResume) {
        throw new Error("resume failed");
      }
    },
    onPaused: (listener) => {
      state.pauseListeners.push(listener as (event: unknown) => void);
      return {
        dispose: () => {
          const index = state.pauseListeners.indexOf(
            listener as (event: unknown) => void,
          );
          if (index >= 0) {
            state.pauseListeners.splice(index, 1);
          }
        },
      };
    },
  };
}

function createDebuggerState(): FakeDebuggerSessionState {
  return {
    setCalls: [],
    removeCalls: [],
    resumeCalls: 0,
    pauseListeners: [],
    failingSetUrls: new Set<string>(),
    failingResume: false,
    nextBreakpointNumber: 0,
  };
}

test("syncFromVsCode with no breakpoints leaves mirror empty", async () => {
  const debugApi = createFakeDebugApi();
  const sessionState = createDebuggerState();

  const mirror = createBreakpointMirror({
    debugApi,
    getDebuggerSession: () => createFakeDebuggerSession(sessionState),
  });

  await mirror.syncFromVsCode();

  assert.equal(sessionState.setCalls.length, 0);
  assert.equal(sessionState.removeCalls.length, 0);

  mirror.dispose();
});

test("syncFromVsCode mirrors enabled notebook-cell source breakpoints", async () => {
  const debugApi = createFakeDebugApi();
  debugApi.breakpoints = [
    createBreakpoint(
      "bp-1",
      "vscode-notebook-cell://test-authority/test.ipynb#cell0",
      1,
    ),
    createBreakpoint(
      "bp-2",
      "vscode-notebook-cell://test-authority/test.ipynb#cell1",
      2,
    ),
    createBreakpoint(
      "bp-3",
      "vscode-notebook-cell://test-authority/test.ipynb#cell2",
      3,
      true,
      "x > 0",
    ),
  ];

  const sessionState = createDebuggerState();
  const session = createFakeDebuggerSession(sessionState);

  const mirror = createBreakpointMirror({
    debugApi,
    getDebuggerSession: () => session,
  });

  await mirror.syncFromVsCode();

  assert.equal(sessionState.setCalls.length, 3);
  assert.deepEqual(sessionState.setCalls[0], {
    url: "vscode-notebook-cell://test-authority/test.ipynb#cell0",
    lineNumber: 1,
    condition: undefined,
  });
  assert.deepEqual(sessionState.setCalls[2], {
    url: "vscode-notebook-cell://test-authority/test.ipynb#cell2",
    lineNumber: 3,
    condition: "x > 0",
  });

  mirror.dispose();
});

test("syncFromVsCode ignores non-notebook and disabled breakpoints", async () => {
  const debugApi = createFakeDebugApi();
  debugApi.breakpoints = [
    createBreakpoint(
      "bp-1",
      "vscode-notebook-cell://test-authority/test.ipynb#cell0",
      0,
    ),
    createBreakpoint("bp-2", "file:///tmp/test.ts", 10),
    createFunctionBreakpoint("bp-3"),
    createBreakpoint(
      "bp-4",
      "vscode-notebook-cell://test-authority/test.ipynb#cell2",
      2,
      false,
    ),
  ];

  const sessionState = createDebuggerState();

  const mirror = createBreakpointMirror({
    debugApi,
    getDebuggerSession: () => createFakeDebuggerSession(sessionState),
  });

  await mirror.syncFromVsCode();

  assert.equal(sessionState.setCalls.length, 1);
  assert.equal(
    sessionState.setCalls[0]?.url,
    "vscode-notebook-cell://test-authority/test.ipynb#cell0",
  );

  mirror.dispose();
});

test("added, removed, and changed events translate into CDP calls", async () => {
  const debugApi = createFakeDebugApi();
  const sessionState = createDebuggerState();
  const session = createFakeDebuggerSession(sessionState);

  const bp1 = createBreakpoint(
    "bp-1",
    "vscode-notebook-cell://test-authority/test.ipynb#cell0",
    1,
  );
  const bp1Changed = createBreakpoint(
    "bp-1",
    "vscode-notebook-cell://test-authority/test.ipynb#cell0",
    4,
  );

  const mirror = createBreakpointMirror({
    debugApi,
    getDebuggerSession: () => session,
  });

  await debugApi.fireChange({ added: [bp1], removed: [], changed: [] });
  assert.equal(sessionState.setCalls.length, 1);

  await debugApi.fireChange({ added: [], removed: [], changed: [bp1Changed] });
  assert.equal(sessionState.removeCalls.length, 1);
  assert.equal(sessionState.setCalls.length, 2);
  assert.equal(sessionState.setCalls[1]?.lineNumber, 4);

  await debugApi.fireChange({ added: [], removed: [bp1Changed], changed: [] });
  assert.equal(sessionState.removeCalls.length, 2);

  mirror.dispose();
});

test("changed event for disabled breakpoint removes without re-adding", async () => {
  const debugApi = createFakeDebugApi();
  const sessionState = createDebuggerState();
  const session = createFakeDebuggerSession(sessionState);

  const bp = createBreakpoint(
    "bp-1",
    "vscode-notebook-cell://test-authority/test.ipynb#cell0",
    1,
  );
  const disabledChanged = createBreakpoint(
    "bp-1",
    "vscode-notebook-cell://test-authority/test.ipynb#cell0",
    2,
    false,
  );

  const mirror = createBreakpointMirror({
    debugApi,
    getDebuggerSession: () => session,
  });

  await debugApi.fireChange({ added: [bp], removed: [], changed: [] });
  await debugApi.fireChange({
    added: [],
    removed: [],
    changed: [disabledChanged],
  });

  assert.equal(sessionState.removeCalls.length, 1);
  assert.equal(sessionState.setCalls.length, 1);

  mirror.dispose();
});

test("remove event without mapping is a no-op", async () => {
  const debugApi = createFakeDebugApi();
  const sessionState = createDebuggerState();

  const mirror = createBreakpointMirror({
    debugApi,
    getDebuggerSession: () => createFakeDebuggerSession(sessionState),
  });

  const neverSeen = createBreakpoint(
    "bp-404",
    "vscode-notebook-cell://test-authority/test.ipynb#cell404",
    404,
  );

  await debugApi.fireChange({ added: [], removed: [neverSeen], changed: [] });

  assert.equal(sessionState.removeCalls.length, 0);

  mirror.dispose();
});

test("syncFromVsCode isolates failures and keeps mirroring other breakpoints", async () => {
  const debugApi = createFakeDebugApi();
  const firstUrl = "vscode-notebook-cell://test-authority/test.ipynb#cell0";
  const secondUrl = "vscode-notebook-cell://test-authority/test.ipynb#cell1";

  debugApi.breakpoints = [
    createBreakpoint("bp-1", firstUrl, 1),
    createBreakpoint("bp-2", secondUrl, 2),
  ];

  const sessionState = createDebuggerState();
  sessionState.failingSetUrls.add(firstUrl);

  const logs: string[] = [];

  const mirror = createBreakpointMirror({
    debugApi,
    getDebuggerSession: () => createFakeDebuggerSession(sessionState),
    logger: (message, error) => {
      logs.push(`${message} :: ${String(error)}`);
    },
  });

  await assert.doesNotReject(async () => {
    await mirror.syncFromVsCode();
  });

  assert.equal(sessionState.setCalls.length, 2);
  assert.equal(logs.length, 1);
  assert.match(
    logs[0] ?? "",
    /Failed to mirror notebook-cell breakpoint to browser/,
  );

  mirror.dispose();
});

test("Debugger.paused triggers unconditional auto-resume", async () => {
  const debugApi = createFakeDebugApi();
  const sessionState = createDebuggerState();
  const session = createFakeDebuggerSession(sessionState);

  const mirror = createBreakpointMirror({
    debugApi,
    getDebuggerSession: () => session,
  });

  await mirror.syncFromVsCode();
  assert.equal(sessionState.pauseListeners.length, 1);

  const pausedListener = sessionState.pauseListeners[0];
  pausedListener?.({ reason: "other", hitBreakpoints: ["bp"] });
  pausedListener?.({ reason: "other", hitBreakpoints: [] });

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(sessionState.resumeCalls, 2);

  mirror.dispose();
});

test("auto-resume failure is logged and future pauses still resume", async () => {
  const debugApi = createFakeDebugApi();
  const sessionState = createDebuggerState();
  sessionState.failingResume = true;
  const session = createFakeDebuggerSession(sessionState);

  const logs: string[] = [];

  const mirror = createBreakpointMirror({
    debugApi,
    getDebuggerSession: () => session,
    logger: (message, error) => {
      logs.push(`${message} :: ${String(error)}`);
    },
  });

  await mirror.syncFromVsCode();
  const pausedListener = sessionState.pauseListeners[0];

  pausedListener?.({ reason: "other" });
  pausedListener?.({ reason: "other" });

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(sessionState.resumeCalls, 2);
  assert.equal(logs.length, 2);
  assert.match(
    logs[0] ?? "",
    /Failed to auto-resume browser debugger after pause/,
  );

  mirror.dispose();
});

test("dispose tears down listeners and does not issue removeBreakpoint", async () => {
  const debugApi = createFakeDebugApi();
  const sessionState = createDebuggerState();
  const session = createFakeDebuggerSession(sessionState);

  const bp = createBreakpoint(
    "bp-1",
    "vscode-notebook-cell://test-authority/test.ipynb#cell0",
    1,
  );

  const mirror = createBreakpointMirror({
    debugApi,
    getDebuggerSession: () => session,
  });

  await debugApi.fireChange({ added: [bp], removed: [], changed: [] });
  assert.equal(sessionState.setCalls.length, 1);

  mirror.dispose();

  await debugApi.fireChange({ added: [bp], removed: [], changed: [] });

  assert.equal(sessionState.setCalls.length, 1);
  assert.equal(sessionState.removeCalls.length, 0);
});
