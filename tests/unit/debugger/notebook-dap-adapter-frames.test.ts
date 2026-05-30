import test from "node:test";
import assert from "node:assert/strict";

import type { DebugProtocol } from "@vscode/debugprotocol";

import { NotebookDebugAdapter } from "../../../src/debugger/notebook-dap-adapter.js";
import type { DebugSessionManager } from "../../../src/debugger/debug-session-manager.js";
import type { DesiredBreakpoint } from "../../../src/debugger/breakpoint-registry.js";

interface Harness {
  adapter: NotebookDebugAdapter;
  sendRequest: (
    command: string,
    args?: unknown,
  ) => Promise<DebugProtocol.Response>;
}

function createHarness(sessionManager: DebugSessionManager): Harness {
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

    for (let index = 0; index < 30; index += 1) {
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

function createSessionManager(pausedEvent: unknown): DebugSessionManager {
  return {
    launch: async () => undefined,
    disconnect: async () => undefined,
    terminate: async () => undefined,
    getDebuggerSession: () => undefined,
    getBreakpointRegistry: () => undefined,
    getVariableStore: () => ({
      reserve: () => 0,
      resolve: () => undefined,
      clearForPause: async () => undefined,
      dispose: async () => undefined,
    }),
    getPausedEvent: () => pausedEvent as never,
    getPauseVersion: () => 1,
    recordSetBreakpoints: (_url: string, _desired: DesiredBreakpoint[]) =>
      undefined,
    onDidTerminate: () => ({ dispose: () => undefined }),
    onDidBreakpointResolved: () => ({ dispose: () => undefined }),
    dispose: () => undefined,
  };
}

test("stackTrace paginates cached paused callFrames", async () => {
  const pausedEvent = {
    callFrames: [
      {
        callFrameId: "cf-1",
        functionName: "first",
        location: { scriptId: "1", lineNumber: 4, columnNumber: 2 },
        scopeChain: [],
        this: { type: "undefined" },
        url: "vscode-notebook-cell://test/cell-a.js",
      },
      {
        callFrameId: "cf-2",
        functionName: "second",
        location: { scriptId: "1", lineNumber: 10, columnNumber: 0 },
        scopeChain: [],
        this: { type: "undefined" },
        url: "vscode-notebook-cell://test/cell-a.js",
      },
    ],
  };

  const harness = createHarness(createSessionManager(pausedEvent));
  const response = await harness.sendRequest("stackTrace", {
    threadId: 1,
    startFrame: 1,
    levels: 1,
  });

  assert.equal(response.success, true);
  const body = (response as DebugProtocol.StackTraceResponse).body;
  assert.equal(body?.totalFrames, 2);
  assert.equal(body?.stackFrames.length, 1);
  assert.equal(body?.stackFrames[0]?.name, "second");
  assert.equal(body?.stackFrames[0]?.line, 11);

  harness.adapter.dispose();
});

test("stackTrace returns empty payload when no pause is cached", async () => {
  const manager = createSessionManager(undefined);
  manager.getPausedEvent = () => undefined;
  manager.getPauseVersion = () => 0;

  const harness = createHarness(manager);
  const response = await harness.sendRequest("stackTrace", { threadId: 1 });

  assert.equal(response.success, true);
  const body = (response as DebugProtocol.StackTraceResponse).body;
  assert.deepEqual(body, { stackFrames: [], totalFrames: 0 });

  harness.adapter.dispose();
});
