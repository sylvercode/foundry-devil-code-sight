import test from "node:test";
import assert from "node:assert/strict";

import { createKernelTransportFailureReporter } from "../../../src/logging/kernel-transport-failure-reporter.js";
import { createLocalizeMock } from "../test-utils/localize-mock.js";

test("kernel transport failure reporter logs timestamped output and shows notification", async () => {
  const lines: string[] = [];
  const shownMessages: string[] = [];
  const states: string[] = [];
  const errorContexts: Array<
    { category: string; guidance: string } | undefined
  > = [];
  let disconnectCalls = 0;

  const report = createKernelTransportFailureReporter({
    connectionStateStore: {
      setErrorContext: (context) => {
        errorContexts.push(context);
      },
      setState: (state) => {
        states.push(state);
      },
    },
    disconnectActiveConnection: async () => {
      disconnectCalls += 1;
    },
    outputChannel: {
      appendLine: (line) => {
        lines.push(line);
      },
    },
    localize: createLocalizeMock(),
    showErrorMessage: async (message) => {
      shownMessages.push(message);
    },
    now: () => new Date("2026-04-16T12:34:56.000Z"),
  });

  await report({
    ok: false,
    kind: "transport-error",
    name: "TargetClosedError",
    message: "Session closed unexpectedly",
  });

  assert.deepEqual(lines, [
    "[2026-04-16T12:34:56.000Z] Notebook transport error (TargetClosedError): Session closed unexpectedly",
  ]);
  assert.equal(disconnectCalls, 1);
  assert.deepEqual(errorContexts, [
    {
      category: "transport-failure",
      guidance:
        "Browser transport error while running a cell. Run Reconnect and try again.",
    },
  ]);
  assert.deepEqual(states, ["error"]);
  assert.deepEqual(shownMessages, [
    "Browser transport error while running a cell. Run Reconnect and try again.",
  ]);
});

test("kernel transport failure reporter handles missing session failures", async () => {
  const lines: string[] = [];
  const shownMessages: string[] = [];
  const states: string[] = [];
  const errorContexts: Array<
    { category: string; guidance: string } | undefined
  > = [];
  let disconnectCalls = 0;

  const report = createKernelTransportFailureReporter({
    connectionStateStore: {
      setErrorContext: (context) => {
        errorContexts.push(context);
      },
      setState: (state) => {
        states.push(state);
      },
    },
    disconnectActiveConnection: async () => {
      disconnectCalls += 1;
    },
    outputChannel: {
      appendLine: (line) => {
        lines.push(line);
      },
    },
    localize: createLocalizeMock(),
    showErrorMessage: async (message) => {
      shownMessages.push(message);
    },
    now: () => new Date("2026-04-16T12:34:56.000Z"),
  });

  await report({
    ok: false,
    kind: "no-session",
    name: "NoActiveSessionError",
    message:
      "No active browser session. Run Jupyter Browser Kernel: Reconnect and try again.",
  });

  assert.deepEqual(lines, [
    "[2026-04-16T12:34:56.000Z] Notebook session unavailable (NoActiveSessionError): No active browser session. Run Jupyter Browser Kernel: Reconnect and try again.",
  ]);
  assert.equal(disconnectCalls, 0);
  assert.deepEqual(errorContexts, []);
  assert.deepEqual(states, []);
  assert.deepEqual(shownMessages, [
    "No active browser session. Run Jupyter Browser Kernel: Reconnect and try again.",
  ]);
});
