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

function createStore(): VariableStore {
  return {
    reserve: () => 1234,
    resolve: () => undefined,
    clearForPause: async () => undefined,
    dispose: async () => undefined,
  };
}

test("evaluate success path uses evaluateOnCallFrame", async () => {
  const evaluateOnCallFrameCalls: Array<{ throwOnSideEffect?: boolean }> = [];

  const pausedEvent = {
    callFrames: [
      {
        callFrameId: "cf-1",
        functionName: "fn",
        location: { scriptId: "1", lineNumber: 1, columnNumber: 0 },
        url: "vscode-notebook-cell://test/cell-a.js",
        this: { type: "undefined" },
        scopeChain: [],
      },
    ],
  };

  const manager: DebugSessionManager = {
    launch: async () => undefined,
    resume: async () => undefined,
    disconnect: async () => undefined,
    terminate: async () => undefined,
    getDebuggerSession: () => ({
      enable: async () => undefined,
      disable: async () => undefined,
      setBreakpointByUrl: async () => ({ breakpointId: "bp", locations: [] }),
      removeBreakpoint: async () => undefined,
      getProperties: async () => ({ result: [] }),
      evaluateOnCallFrame: async (params) => {
        evaluateOnCallFrameCalls.push({
          throwOnSideEffect: params.throwOnSideEffect,
        });
        return {
          result: { type: "number", value: 99 },
        };
      },
      releaseObject: async () => undefined,
      evaluate: async () => ({ result: { type: "undefined" } }),
      resume: async () => undefined,
      onPaused: () => ({ dispose: () => undefined }),
      onBreakpointResolved: () => ({ dispose: () => undefined }),
    }),
    getBreakpointRegistry: () => undefined,
    getVariableStore: () => createStore(),
    getPausedEvent: () => pausedEvent as never,
    getPauseVersion: () => 1,
    recordSetBreakpoints: (_url: string, _desired: DesiredBreakpoint[]) =>
      undefined,
    onDidTerminate: () => ({ dispose: () => undefined }),
    onDidPaused: () => ({ dispose: () => undefined }),
    onDidBreakpointResolved: () => ({ dispose: () => undefined }),
    dispose: () => undefined,
  };

  const harness = createHarness(manager);

  const stack = await harness.sendRequest("stackTrace", { threadId: 1 });
  const frameId = (stack as DebugProtocol.StackTraceResponse).body
    ?.stackFrames[0]?.id;

  const response = await harness.sendRequest("evaluate", {
    expression: "x + 1",
    frameId,
    context: "hover",
  });

  assert.equal(response.success, true);
  const body = (response as DebugProtocol.EvaluateResponse).body;
  assert.equal(body?.result, "99");
  assert.equal(body?.variablesReference, 0);
  assert.equal(evaluateOnCallFrameCalls.length, 1);
  assert.equal(evaluateOnCallFrameCalls[0]?.throwOnSideEffect, true);

  harness.adapter.dispose();
});

test("evaluate returns localized error when exceptionDetails exist", async () => {
  const manager: DebugSessionManager = {
    launch: async () => undefined,
    resume: async () => undefined,
    disconnect: async () => undefined,
    terminate: async () => undefined,
    getDebuggerSession: () => ({
      enable: async () => undefined,
      disable: async () => undefined,
      setBreakpointByUrl: async () => ({ breakpointId: "bp", locations: [] }),
      removeBreakpoint: async () => undefined,
      getProperties: async () => ({ result: [] }),
      evaluateOnCallFrame: async () => ({
        result: { type: "undefined" },
        exceptionDetails: {
          exceptionId: 1,
          text: "boom",
          lineNumber: 0,
          columnNumber: 0,
        },
      }),
      releaseObject: async () => undefined,
      evaluate: async () => ({ result: { type: "undefined" } }),
      resume: async () => undefined,
      onPaused: () => ({ dispose: () => undefined }),
      onBreakpointResolved: () => ({ dispose: () => undefined }),
    }),
    getBreakpointRegistry: () => undefined,
    getVariableStore: () => createStore(),
    getPausedEvent: () =>
      ({
        callFrames: [
          {
            callFrameId: "cf-1",
            functionName: "fn",
            location: { scriptId: "1", lineNumber: 1, columnNumber: 0 },
            url: "vscode-notebook-cell://test/cell-a.js",
            this: { type: "undefined" },
            scopeChain: [],
          },
        ],
      }) as never,
    getPauseVersion: () => 1,
    recordSetBreakpoints: (_url: string, _desired: DesiredBreakpoint[]) =>
      undefined,
    onDidTerminate: () => ({ dispose: () => undefined }),
    onDidPaused: () => ({ dispose: () => undefined }),
    onDidBreakpointResolved: () => ({ dispose: () => undefined }),
    dispose: () => undefined,
  };

  const harness = createHarness(manager);

  const stack = await harness.sendRequest("stackTrace", { threadId: 1 });
  const frameId = (stack as DebugProtocol.StackTraceResponse).body
    ?.stackFrames[0]?.id;

  const response = await harness.sendRequest("evaluate", {
    expression: "bad()",
    frameId,
    context: "watch",
  });

  const body = (response as DebugProtocol.EvaluateResponse).body;
  assert.equal(body?.result, "Evaluation failed: boom");
  assert.equal(body?.presentationHint?.kind, "error");

  harness.adapter.dispose();
});
