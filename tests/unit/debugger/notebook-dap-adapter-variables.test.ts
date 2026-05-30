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

test("variables resolves properties and allocates child handles", async () => {
  const getPropertiesCalls: Array<{ objectId: string }> = [];
  const reserved: Array<{ objectId: string }> = [];

  const handles = new Map<
    number,
    { objectId: string; kind: "scope" | "object" | "array" }
  >([[1000, { objectId: "scope-obj", kind: "scope" }]]);

  let nextReference = 1001;

  const variableStore: VariableStore = {
    reserve: (entry) => {
      reserved.push({ objectId: entry.objectId });
      const value = nextReference;
      handles.set(value, entry);
      nextReference += 1;
      return value;
    },
    resolve: (variablesReference) => handles.get(variablesReference),
    clearForPause: async () => undefined,
    dispose: async () => undefined,
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
      getProperties: async ({ objectId }) => {
        getPropertiesCalls.push({ objectId });
        return {
          result: [
            {
              name: "x",
              value: { type: "number", value: 2 },
            },
            {
              name: "obj",
              value: {
                type: "object",
                objectId: "child-obj",
                description: "Object",
              },
            },
          ],
        } as never;
      },
      evaluateOnCallFrame: async () => ({ result: { type: "undefined" } }),
      releaseObject: async () => undefined,
      evaluate: async () => ({ result: { type: "undefined" } }),
      resume: async () => undefined,
      onPaused: () => ({ dispose: () => undefined }),
      onBreakpointResolved: () => ({ dispose: () => undefined }),
    }),
    getBreakpointRegistry: () => undefined,
    getVariableStore: () => variableStore,
    getPausedEvent: () => undefined,
    getPauseVersion: () => 0,
    recordSetBreakpoints: (_url: string, _desired: DesiredBreakpoint[]) =>
      undefined,
    onDidTerminate: () => ({ dispose: () => undefined }),
    onDidPaused: () => ({ dispose: () => undefined }),
    onDidBreakpointResolved: () => ({ dispose: () => undefined }),
    dispose: () => undefined,
  };

  const harness = createHarness(manager);

  const response = await harness.sendRequest("variables", {
    variablesReference: 1000,
    start: 0,
    count: 2,
  });

  assert.equal(response.success, true);
  const variables =
    (response as DebugProtocol.VariablesResponse).body?.variables ?? [];
  assert.equal(variables.length, 2);
  assert.equal(variables[0]?.name, "x");
  assert.equal(variables[1]?.variablesReference > 0, true);
  assert.deepEqual(getPropertiesCalls, [{ objectId: "scope-obj" }]);
  assert.deepEqual(reserved, [{ objectId: "child-obj" }]);

  harness.adapter.dispose();
});

test("variables truncates oversized page requests with marker", async () => {
  const descriptors = Array.from({ length: 105 }, (_value, index) => ({
    name: `v${index}`,
    value: { type: "number", value: index },
  }));

  const variableStore: VariableStore = {
    reserve: () => 1001,
    resolve: () => ({ objectId: "scope-obj", kind: "scope" }),
    clearForPause: async () => undefined,
    dispose: async () => undefined,
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
      getProperties: async () => ({ result: descriptors as never[] }),
      evaluateOnCallFrame: async () => ({ result: { type: "undefined" } }),
      releaseObject: async () => undefined,
      evaluate: async () => ({ result: { type: "undefined" } }),
      resume: async () => undefined,
      onPaused: () => ({ dispose: () => undefined }),
      onBreakpointResolved: () => ({ dispose: () => undefined }),
    }),
    getBreakpointRegistry: () => undefined,
    getVariableStore: () => variableStore,
    getPausedEvent: () => undefined,
    getPauseVersion: () => 0,
    recordSetBreakpoints: (_url: string, _desired: DesiredBreakpoint[]) =>
      undefined,
    onDidTerminate: () => ({ dispose: () => undefined }),
    onDidPaused: () => ({ dispose: () => undefined }),
    onDidBreakpointResolved: () => ({ dispose: () => undefined }),
    dispose: () => undefined,
  };

  const harness = createHarness(manager);

  const response = await harness.sendRequest("variables", {
    variablesReference: 1000,
    start: 0,
    count: 150,
  });

  const variables =
    (response as DebugProtocol.VariablesResponse).body?.variables ?? [];
  assert.equal(variables.length, 101);
  assert.equal(variables[100]?.name, "… (5 more)");

  harness.adapter.dispose();
});
