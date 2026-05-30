import test from "node:test";
import assert from "node:assert/strict";

import type { DebugProtocol } from "@vscode/debugprotocol";

import { NotebookDebugAdapter } from "../../../src/debugger/notebook-dap-adapter.js";
import type { DebugSessionManager } from "../../../src/debugger/debug-session-manager.js";
import type { DesiredBreakpoint } from "../../../src/debugger/breakpoint-registry.js";
import type { VariableStore } from "../../../src/debugger/variable-store.js";

function createHarness(sessionManager: DebugSessionManager): {
  adapter: NotebookDebugAdapter;
  sendRequest: (
    command: string,
    args?: unknown,
  ) => Promise<DebugProtocol.Response>;
} {
  const adapter = new NotebookDebugAdapter({ sessionManager });
  const sentMessages: DebugProtocol.ProtocolMessage[] = [];
  adapter.onDidSendMessage((message) => {
    sentMessages.push(message as DebugProtocol.ProtocolMessage);
  });

  let sequence = 0;

  const sendRequest = async (
    command: string,
    args?: unknown,
  ): Promise<DebugProtocol.Response> => {
    sequence += 1;

    const request: DebugProtocol.Request = {
      seq: sequence,
      type: "request",
      command,
      arguments: args as Record<string, unknown> | undefined,
    };

    adapter.handleMessage(request);

    for (let index = 0; index < 40; index += 1) {
      const response = sentMessages.find((message) => {
        if (message.type !== "response") {
          return false;
        }

        return (message as DebugProtocol.Response).request_seq === sequence;
      }) as DebugProtocol.Response | undefined;

      if (response) {
        return response;
      }

      await Promise.resolve();
    }

    throw new Error(`No response captured for ${command}`);
  };

  return { adapter, sendRequest };
}

test("scopes maps scopeChain entries and appends global scope", async () => {
  const reserved: Array<{ objectId: string }> = [];
  let nextReference = 1000;

  const variableStore: VariableStore = {
    reserve: (entry) => {
      reserved.push({ objectId: entry.objectId });
      const value = nextReference;
      nextReference += 1;
      return value;
    },
    resolve: () => undefined,
    clearForPause: async () => undefined,
    dispose: async () => undefined,
  };

  const pausedEvent = {
    callFrames: [
      {
        callFrameId: "cf-1",
        functionName: "fn",
        location: { scriptId: "1", lineNumber: 1, columnNumber: 0 },
        url: "vscode-notebook-cell://test/cell-a.js",
        this: { type: "undefined" },
        scopeChain: [
          {
            type: "local",
            object: { type: "object", objectId: "local-obj" },
          },
          {
            type: "block",
            object: { type: "object", objectId: "block-obj" },
          },
        ],
      },
    ],
  };

  const manager: DebugSessionManager = {
    launch: async () => undefined,
    disconnect: async () => undefined,
    terminate: async () => undefined,
    getDebuggerSession: () => ({
      enable: async () => undefined,
      disable: async () => undefined,
      setBreakpointByUrl: async () => ({ breakpointId: "bp", locations: [] }),
      removeBreakpoint: async () => undefined,
      getProperties: async () => ({ result: [] }),
      evaluateOnCallFrame: async () => ({ result: { type: "undefined" } }),
      releaseObject: async () => undefined,
      evaluate: async () => ({
        result: {
          type: "object",
          objectId: "global-obj",
          description: "Window",
        },
      }),
      resume: async () => undefined,
      onPaused: () => ({ dispose: () => undefined }),
      onBreakpointResolved: () => ({ dispose: () => undefined }),
    }),
    getBreakpointRegistry: () => undefined,
    getVariableStore: () => variableStore,
    getPausedEvent: () => pausedEvent as never,
    getPauseVersion: () => 1,
    recordSetBreakpoints: (_url: string, _desired: DesiredBreakpoint[]) =>
      undefined,
    onDidTerminate: () => ({ dispose: () => undefined }),
    onDidBreakpointResolved: () => ({ dispose: () => undefined }),
    dispose: () => undefined,
  };

  const harness = createHarness(manager);

  const stack = await harness.sendRequest("stackTrace", { threadId: 1 });
  const frameId = (stack as DebugProtocol.StackTraceResponse).body
    ?.stackFrames[0]?.id;
  assert.equal(typeof frameId, "number");

  const response = await harness.sendRequest("scopes", {
    frameId,
  });

  assert.equal(response.success, true);
  const scopes = (response as DebugProtocol.ScopesResponse).body?.scopes ?? [];
  assert.equal(scopes.length, 3);
  assert.equal(scopes[0]?.name, "Local");
  assert.equal(scopes[1]?.name, "Block");
  assert.equal(scopes[2]?.name, "Global");
  assert.equal(scopes[2]?.expensive, true);
  assert.deepEqual(
    reserved.map((entry) => entry.objectId),
    ["local-obj", "block-obj", "global-obj"],
  );

  harness.adapter.dispose();
});
