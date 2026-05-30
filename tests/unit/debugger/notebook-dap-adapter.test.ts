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
  sentMessages: DebugProtocol.ProtocolMessage[];
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
    const requestSeq = sequence + 1;
    sequence = requestSeq;

    const request: DebugProtocol.Request = {
      seq: requestSeq,
      type: "request",
      command,
      arguments: args as Record<string, unknown> | undefined,
    };

    adapter.handleMessage(request);

    for (let step = 0; step < 20; step += 1) {
      const response = sentMessages.find((message) => {
        if (message.type !== "response") {
          return false;
        }

        const typedResponse = message as DebugProtocol.Response;
        return typedResponse.request_seq === requestSeq;
      }) as DebugProtocol.Response | undefined;

      if (response) {
        return response;
      }

      await Promise.resolve();
    }

    throw new Error(`No response captured for ${command}`);
  };

  return {
    adapter,
    sendRequest,
    sentMessages,
  };
}

function createSessionManager(
  overrides: Partial<DebugSessionManager>,
): DebugSessionManager {
  return {
    launch: async () => undefined,
    disconnect: async () => undefined,
    terminate: async () => undefined,
    getBreakpointRegistry: () => undefined,
    recordSetBreakpoints: (_url: string, _desired: DesiredBreakpoint[]) =>
      undefined,
    onDidTerminate: () => ({ dispose: () => undefined }),
    onDidBreakpointResolved: () => ({ dispose: () => undefined }),
    dispose: () => undefined,
    ...overrides,
  };
}

test("initialize returns expected capability snapshot", async () => {
  const harness = createHarness(createSessionManager({}));

  const response = await harness.sendRequest("initialize", {
    adapterID: "jupyter-browser-kernel",
    pathFormat: "path",
  });

  assert.equal(response.success, true);
  const body = (response as DebugProtocol.InitializeResponse).body;

  assert.deepEqual(body, {
    supportsBreakpointLocationsRequest: true,
    supportsConfigurationDoneRequest: true,
    supportsTerminateRequest: true,
    supportTerminateDebuggee: false,
    supportsEvaluateForHovers: true,
    supportsConditionalBreakpoints: true,
    supportsHitConditionalBreakpoints: false,
    supportsLogPoints: false,
  });

  harness.adapter.dispose();
});

test("launch failure returns ErrorResponse with localized message", async () => {
  const harness = createHarness(
    createSessionManager({
      launch: async () => {
        throw new Error(
          "Cannot start debug session: connect to a browser target first.",
        );
      },
    }),
  );

  const response = await harness.sendRequest("launch", {});

  assert.equal(response.success, false);
  assert.match(response.message ?? "", /Cannot start debug session/);

  harness.adapter.dispose();
});

test("threads returns the single notebook-cells thread", async () => {
  const harness = createHarness(createSessionManager({}));

  const response = await harness.sendRequest("threads", {});

  assert.equal(response.success, true);
  const body = (response as DebugProtocol.ThreadsResponse).body;
  assert.equal(body?.threads.length, 1);
  assert.equal(body?.threads[0]?.id, 1);
  assert.equal(body?.threads[0]?.name, "Notebook cells");

  harness.adapter.dispose();
});

test("terminate emits terminated event so one stop cleanly ends session", async () => {
  let terminateCalls = 0;

  const harness = createHarness(
    createSessionManager({
      terminate: async () => {
        terminateCalls += 1;
      },
    }),
  );

  const response = await harness.sendRequest("terminate", {});

  assert.equal(response.success, true);
  assert.equal(terminateCalls, 1);

  const terminatedEvents = harness.sentMessages.filter(
    (message) =>
      message.type === "event" &&
      (message as DebugProtocol.Event).event === "terminated",
  );

  assert.equal(terminatedEvents.length, 1);

  harness.adapter.dispose();
});

test("connection-lost followed by terminate emits terminated event exactly once", async () => {
  let terminationListener: ((reason: "connection-lost") => void) | undefined;

  const harness = createHarness(
    createSessionManager({
      onDidTerminate: (listener) => {
        terminationListener = listener;
        return { dispose: () => undefined };
      },
    }),
  );

  assert.ok(terminationListener, "adapter must subscribe to onDidTerminate");
  terminationListener?.("connection-lost");

  const response = await harness.sendRequest("terminate", {});
  assert.equal(response.success, true);

  const terminatedEvents = harness.sentMessages.filter(
    (message) =>
      message.type === "event" &&
      (message as DebugProtocol.Event).event === "terminated",
  );

  assert.equal(terminatedEvents.length, 1);

  harness.adapter.dispose();
});
