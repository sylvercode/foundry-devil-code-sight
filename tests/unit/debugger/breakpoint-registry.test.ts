import test from "node:test";
import assert from "node:assert/strict";

import {
  createBreakpointRegistry,
  type DesiredBreakpoint,
} from "../../../src/debugger/breakpoint-registry.js";
import type { BrowserDebuggerSession } from "../../../src/transport/browser-connect.js";

interface SessionState {
  setCalls: Array<{
    url?: string;
    lineNumber: number;
    columnNumber?: number;
    condition?: string;
  }>;
  removeCalls: string[];
  nextId: number;
  failSetForLineNumbers: Set<number>;
  failRemove: boolean;
}

function createState(overrides?: Partial<SessionState>): SessionState {
  return {
    setCalls: [],
    removeCalls: [],
    nextId: 1,
    failSetForLineNumbers: new Set<number>(),
    failRemove: false,
    ...overrides,
  };
}

function createSession(state: SessionState): BrowserDebuggerSession {
  return {
    enable: async () => undefined,
    disable: async () => undefined,
    setBreakpointByUrl: async (params) => {
      state.setCalls.push({
        url: params.url,
        lineNumber: params.lineNumber,
        columnNumber: params.columnNumber,
        condition: params.condition,
      });

      if (state.failSetForLineNumbers.has(params.lineNumber)) {
        throw new Error("set failed");
      }

      const id = `bp-${state.nextId}`;
      state.nextId += 1;

      return {
        breakpointId: id,
        locations: [
          {
            scriptId: String(state.nextId),
            lineNumber: params.lineNumber,
            columnNumber: params.columnNumber ?? 0,
          },
        ],
      };
    },
    removeBreakpoint: async ({ breakpointId }) => {
      state.removeCalls.push(breakpointId);
      if (state.failRemove) {
        throw new Error("remove failed");
      }
    },
    resume: async () => undefined,
    onPaused: () => ({ dispose: () => undefined }),
  };
}

const localize = ((message: string, ...args: unknown[]): string => {
  let rendered = message;
  for (const [index, value] of args.entries()) {
    rendered = rendered.replace(`{${index}}`, String(value));
  }
  return rendered;
}) as (typeof import("vscode"))["l10n"]["t"];

test("replace with empty current and three desired adds all breakpoints", async () => {
  const state = createState();
  const registry = createBreakpointRegistry({
    debuggerSession: createSession(state),
    logger: () => undefined,
    localize,
  });

  const desired: DesiredBreakpoint[] = [{ line: 1 }, { line: 2 }, { line: 3 }];
  const result = await registry.replace(
    "vscode-notebook-cell://test/cell-1.js",
    desired,
  );

  assert.equal(state.setCalls.length, 3);
  assert.equal(state.removeCalls.length, 0);
  assert.equal(result.length, 3);
  assert.equal(
    result.every((entry) => entry.verified),
    true,
  );
});

test("replace computes add/remove diff without churn for unchanged breakpoints", async () => {
  const state = createState();
  const registry = createBreakpointRegistry({
    debuggerSession: createSession(state),
    logger: () => undefined,
    localize,
  });

  const url = "vscode-notebook-cell://test/cell-2.js";
  await registry.replace(url, [{ line: 1 }, { line: 2 }, { line: 3 }]);
  const initialSetCallCount = state.setCalls.length;

  await registry.replace(url, [{ line: 1 }, { line: 3 }, { line: 4 }]);

  assert.equal(state.setCalls.length, initialSetCallCount + 1);
  assert.equal(state.removeCalls.length, 1);
});

test("replace returns unverified entry when a single add fails", async () => {
  const state = createState({ failSetForLineNumbers: new Set([4]) });
  const registry = createBreakpointRegistry({
    debuggerSession: createSession(state),
    logger: () => undefined,
    localize,
  });

  const result = await registry.replace(
    "vscode-notebook-cell://test/cell-3.js",
    [{ line: 5 }, { line: 8 }],
  );

  assert.equal(result.length, 2);
  assert.equal(result[0]?.verified, false);
  assert.match(result[0]?.message ?? "", /Breakpoint could not be bound/);
  assert.equal(result[1]?.verified, true);
});

test("replace converts lines DAP 1-based to CDP 0-based and back", async () => {
  const state = createState();
  const registry = createBreakpointRegistry({
    debuggerSession: {
      ...createSession(state),
      setBreakpointByUrl: async (params) => {
        state.setCalls.push({
          url: params.url,
          lineNumber: params.lineNumber,
          columnNumber: params.columnNumber,
          condition: params.condition,
        });

        return {
          breakpointId: "bp-1",
          locations: [
            {
              scriptId: "1",
              lineNumber: 22,
              columnNumber: 0,
            },
          ],
        };
      },
    },
    logger: () => undefined,
    localize,
  });

  const result = await registry.replace(
    "vscode-notebook-cell://test/cell-4.js",
    [{ line: 11 }],
  );

  assert.equal(state.setCalls[0]?.lineNumber, 10);
  assert.equal(result[0]?.line, 23);
});

test("replace wraps conditional expressions to guard evaluation errors", async () => {
  const state = createState();
  const registry = createBreakpointRegistry({
    debuggerSession: createSession(state),
    logger: () => undefined,
    localize,
  });

  await registry.replace("vscode-notebook-cell://test/cell-guard.js", [
    { line: 4, condition: "x === 2" },
  ]);

  assert.equal(
    state.setCalls[0]?.condition,
    "(function(){try{return (x === 2);}catch{return false;}})()",
  );
});

test("clearAll removes each runtime breakpoint exactly once", async () => {
  const state = createState();
  const registry = createBreakpointRegistry({
    debuggerSession: createSession(state),
    logger: () => undefined,
    localize,
  });

  await registry.replace("vscode-notebook-cell://test/cell-5.js", [
    { line: 1 },
    { line: 2 },
  ]);
  await registry.replace("vscode-notebook-cell://test/cell-6.js", [
    { line: 3 },
  ]);

  await registry.clearAll();

  assert.equal(state.removeCalls.length, 3);
  assert.equal(new Set(state.removeCalls).size, 3);
});

test("clearAll resolves even when all removeBreakpoint calls reject", async () => {
  const logs: string[] = [];
  const state = createState({ failRemove: true });
  const registry = createBreakpointRegistry({
    debuggerSession: createSession(state),
    logger: (message) => {
      logs.push(message);
    },
    localize,
  });

  await registry.replace("vscode-notebook-cell://test/cell-7.js", [
    { line: 10 },
    { line: 11 },
  ]);

  await assert.doesNotReject(async () => {
    await registry.clearAll();
  });

  assert.equal(logs.length >= 2, true);
});
