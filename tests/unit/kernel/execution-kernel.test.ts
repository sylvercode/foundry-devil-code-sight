import test from "node:test";
import assert from "node:assert/strict";

import {
  createKernelRuntime,
  executeCell,
} from "../../../src/kernel/execution-kernel.js";
import type { ActiveBrowserConnection } from "../../../src/transport/browser-connect.js";
import { createLocalizeMock } from "../test-utils/localize-mock.js";

class FakeNotebookCellOutputItem {
  public readonly kind: "text" | "error";
  public readonly value: string | Error;
  public readonly mime?: string;

  private constructor(
    kind: "text" | "error",
    value: string | Error,
    mime?: string,
  ) {
    this.kind = kind;
    this.value = value;
    this.mime = mime;
  }

  static text(value: string, mime: string): FakeNotebookCellOutputItem {
    return new FakeNotebookCellOutputItem("text", value, mime);
  }

  static error(error: Error): FakeNotebookCellOutputItem {
    return new FakeNotebookCellOutputItem("error", error);
  }
}

class FakeNotebookCellOutput {
  constructor(public readonly items: FakeNotebookCellOutputItem[]) {}
}

interface RecordedExecution {
  startedAt?: number;
  endedAt?: number;
  success?: boolean;
  executionOrder?: number;
  outputs: FakeNotebookCellOutput[];
}

interface RecordedNotebookExecution {
  start: (startTime: number) => void;
  end: (success: boolean, endTime: number) => void;
  replaceOutput: (outputs: FakeNotebookCellOutput[]) => Promise<void>;
  executionOrder?: number;
  token: {
    readonly isCancellationRequested: boolean;
    onCancellationRequested: (listener: () => void) => { dispose: () => void };
  };
}

interface ExecutionRecorder {
  execution: RecordedExecution;
  notebookExecution: RecordedNotebookExecution;
  cancel: () => void;
}

const DEFAULT_FAKE_CELL_URI =
  "vscode-notebook-cell://test-authority/workspaces/foundry-devil-code-sight/tests/files/test1.ipynb#ch0000000000000";

function createExecutionRecorder(options?: {
  isCancellationRequested?: boolean;
}): ExecutionRecorder {
  const execution: RecordedExecution = {
    outputs: [],
  };

  let isCancellationRequested = options?.isCancellationRequested ?? false;
  const cancellationListeners = new Set<() => void>();

  const token = {
    get isCancellationRequested(): boolean {
      return isCancellationRequested;
    },
    onCancellationRequested: (listener: () => void) => {
      cancellationListeners.add(listener);

      return {
        dispose: () => {
          cancellationListeners.delete(listener);
        },
      };
    },
  };

  const notebookExecution: RecordedNotebookExecution = {
    start: (startTime: number) => {
      execution.startedAt = startTime;
    },
    end: (success: boolean, endTime: number) => {
      execution.success = success;
      execution.endedAt = endTime;
    },
    replaceOutput: async (outputs: FakeNotebookCellOutput[]) => {
      execution.outputs = outputs;
    },
    executionOrder: undefined as number | undefined,
    token,
  };

  return {
    execution,
    notebookExecution,
    cancel: () => {
      isCancellationRequested = true;
      for (const listener of cancellationListeners) {
        listener();
      }
    },
  };
}

function createFakeCell(
  text: string,
  sourceUri: string = DEFAULT_FAKE_CELL_URI,
  metadata?: unknown,
): {
  document: {
    getText: () => string;
    uri: { toString: () => string };
  };
  metadata?: unknown;
} {
  return {
    document: {
      getText: () => text,
      uri: {
        toString: () => sourceUri,
      },
    },
    metadata,
  };
}

function createFakeConnection(
  evaluate: ActiveBrowserConnection["evaluate"],
): ActiveBrowserConnection {
  return {
    targetId: "target-1",
    sessionId: "session-1",
    endpoint: { host: "localhost", port: 9222 },
    evaluate,
    terminateExecution: async () => undefined,
    close: async () => undefined,
  };
}

test("executeCell evaluates expression and writes success output", async () => {
  const sourceUri =
    "vscode-notebook-cell://test-authority/workspaces/foundry-devil-code-sight/tests/files/test1.ipynb#ch0000000000001";
  const evaluateCalls: string[] = [];
  const connection = createFakeConnection(async (expression) => {
    evaluateCalls.push(expression);
    return {
      result: {
        type: "number",
        value: 4,
      },
    } as never;
  });

  const { execution, notebookExecution } = createExecutionRecorder();

  const runtime = createKernelRuntime(
    {
      NotebookCellOutput: FakeNotebookCellOutput as never,
      NotebookCellOutputItem: FakeNotebookCellOutputItem as never,
    },
    createLocalizeMock(),
    () => connection,
  );

  await executeCell({
    cell: createFakeCell("2 + 2", sourceUri) as never,
    controller: {
      createNotebookCellExecution: () => notebookExecution,
    } as never,
    executionOrder: 7,
    runtime,
  });

  assert.deepEqual(evaluateCalls, [`2 + 2\n//# sourceURL=${sourceUri}\n`]);
  assert.equal(notebookExecution.executionOrder, 7);
  assert.equal(execution.success, true);
  assert.equal(execution.outputs.length, 1);
  assert.equal(execution.outputs[0]?.items[0]?.kind, "text");
  assert.equal(execution.outputs[0]?.items[0]?.value, "4");
  // Success output remains plain text with text/plain MIME.
  assert.equal(execution.outputs[0]?.items[0]?.mime, "text/plain");
});

test("executeCell exits before evaluation when cancellation was already requested", async () => {
  const evaluateCalls: string[] = [];
  const connection = createFakeConnection(async (expression) => {
    evaluateCalls.push(expression);
    return {
      result: {
        type: "number",
        value: 10,
      },
    } as never;
  });

  const { execution, notebookExecution } = createExecutionRecorder({
    isCancellationRequested: true,
  });

  const runtime = createKernelRuntime(
    {
      NotebookCellOutput: FakeNotebookCellOutput as never,
      NotebookCellOutputItem: FakeNotebookCellOutputItem as never,
    },
    createLocalizeMock(),
    () => connection,
  );

  const wasCancelled = await executeCell({
    cell: createFakeCell("5 + 5") as never,
    controller: {
      createNotebookCellExecution: () => notebookExecution,
    } as never,
    executionOrder: 8,
    runtime,
  });

  assert.equal(wasCancelled, true);
  assert.deepEqual(evaluateCalls, []);
  assert.equal(execution.success, false);
  assert.equal(execution.outputs.length, 0);
});

test("executeCell terminates runtime evaluation when cancellation is requested", async () => {
  let releaseEvaluation: (() => void) | undefined;
  const continueEvaluation = new Promise<void>((resolve) => {
    releaseEvaluation = resolve;
  });
  let markEvaluationStarted: (() => void) | undefined;
  const evaluationStarted = new Promise<void>((resolve) => {
    markEvaluationStarted = resolve;
  });

  let terminateCalls = 0;
  const connection = {
    ...createFakeConnection(async () => {
      markEvaluationStarted?.();
      await continueEvaluation;
      return {
        result: {
          type: "number",
          value: 99,
        },
      } as never;
    }),
    terminateExecution: async () => {
      terminateCalls += 1;
    },
  } satisfies ActiveBrowserConnection;

  const { execution, notebookExecution, cancel } = createExecutionRecorder();

  const runtime = createKernelRuntime(
    {
      NotebookCellOutput: FakeNotebookCellOutput as never,
      NotebookCellOutputItem: FakeNotebookCellOutputItem as never,
    },
    createLocalizeMock(),
    () => connection,
  );

  const runPromise = executeCell({
    cell: createFakeCell("await new Promise(() => {})") as never,
    controller: {
      createNotebookCellExecution: () => notebookExecution,
    } as never,
    executionOrder: 9,
    runtime,
  });

  await evaluationStarted;
  cancel();

  const wasCancelled = await runPromise;
  releaseEvaluation?.();

  assert.equal(wasCancelled, true);
  assert.equal(terminateCalls, 1);
  assert.equal(execution.success, false);
  assert.equal(execution.outputs.length, 0);
});

test("executeCell writes structured error output for runtime exception", async () => {
  const connection = createFakeConnection(async () => {
    return {
      result: {
        type: "undefined",
      },
      exceptionDetails: {
        text: "Uncaught TypeError: boom",
        exception: {
          className: "TypeError",
          description: "TypeError: boom\n    at <anonymous>:1:1",
        },
      },
    } as never;
  });

  const { execution, notebookExecution } = createExecutionRecorder();

  const runtime = createKernelRuntime(
    {
      NotebookCellOutput: FakeNotebookCellOutput as never,
      NotebookCellOutputItem: FakeNotebookCellOutputItem as never,
    },
    createLocalizeMock(),
    () => connection,
  );

  await executeCell({
    cell: createFakeCell("throw new TypeError('boom')") as never,
    controller: {
      createNotebookCellExecution: () => notebookExecution,
    } as never,
    executionOrder: 1,
    runtime,
  });

  assert.equal(execution.success, false);
  assert.equal(execution.outputs[0]?.items[0]?.kind, "error");

  const renderedError = execution.outputs[0]?.items[0]?.value;
  assert.ok(renderedError instanceof Error);
  assert.equal(renderedError.name, "TypeError");
  assert.equal(renderedError.message, "boom");
  // User-code errors are surfaced as Error objects without protocol-specific fields.
  assert.equal(typeof renderedError.name, "string");
  assert.equal(typeof renderedError.message, "string");
  assert.ok(!("kind" in renderedError));
  assert.ok(!("exceptionDetails" in renderedError));
  assert.ok(!("objectId" in renderedError));
  assert.ok(!("className" in renderedError));
});

test("executeCell reports reconnect prompt when no active session", async () => {
  const { execution, notebookExecution } = createExecutionRecorder();
  const reportedFailures: { kind: string; message: string }[] = [];

  const runtime = createKernelRuntime(
    {
      NotebookCellOutput: FakeNotebookCellOutput as never,
      NotebookCellOutputItem: FakeNotebookCellOutputItem as never,
    },
    createLocalizeMock(),
    () => undefined,
    (failure) => {
      reportedFailures.push({ kind: failure.kind, message: failure.message });
    },
  );

  await executeCell({
    cell: createFakeCell("2 + 2") as never,
    controller: {
      createNotebookCellExecution: () => notebookExecution,
    } as never,
    executionOrder: 2,
    runtime,
  });

  assert.equal(execution.success, false);
  assert.deepEqual(reportedFailures, [
    {
      kind: "no-session",
      message:
        "No active browser session. Run Jupyter Browser Kernel: Reconnect and try again.",
    },
  ]);
  assert.equal(execution.outputs.length, 1);
  assert.equal(execution.outputs[0]?.items[0]?.kind, "text");
  assert.match(
    String(execution.outputs[0]?.items[0]?.value),
    /No active browser session/,
  );
});

test("executeCell reports transport failures to callback and avoids stack-style cell output", async () => {
  const transportError = new Error("Session closed unexpectedly");
  transportError.name = "TargetClosedError";

  const connection = createFakeConnection(async () => {
    throw transportError;
  });

  const { execution, notebookExecution } = createExecutionRecorder();
  const reportedFailures: { kind: string; message: string }[] = [];

  const runtime = createKernelRuntime(
    {
      NotebookCellOutput: FakeNotebookCellOutput as never,
      NotebookCellOutputItem: FakeNotebookCellOutputItem as never,
    },
    createLocalizeMock(),
    () => connection,
    (failure) => {
      reportedFailures.push({ kind: failure.kind, message: failure.message });
    },
  );

  await executeCell({
    cell: createFakeCell("2 + 2") as never,
    controller: {
      createNotebookCellExecution: () => notebookExecution,
    } as never,
    executionOrder: 3,
    runtime,
  });

  assert.equal(execution.success, false);
  assert.deepEqual(reportedFailures, [
    {
      kind: "transport-error",
      message: "Session closed unexpectedly",
    },
  ]);
  assert.equal(execution.outputs[0]?.items[0]?.kind, "text");
  assert.equal(execution.outputs[0]?.items[0]?.mime, "text/plain");
  assert.match(
    String(execution.outputs[0]?.items[0]?.value),
    /Transport error while running this cell/,
  );
});

test("executeCell ends even while transport error reporting is still pending", async () => {
  const transportError = new Error("Session closed unexpectedly");
  transportError.name = "TargetClosedError";

  const connection = createFakeConnection(async () => {
    throw transportError;
  });

  const { execution, notebookExecution } = createExecutionRecorder();
  let resolveReporter: (() => void) | undefined;
  const reporterStarted = new Promise<void>((resolve) => {
    resolveReporter = resolve;
  });
  let reportedFailureKind: string | undefined;

  const runtime = createKernelRuntime(
    {
      NotebookCellOutput: FakeNotebookCellOutput as never,
      NotebookCellOutputItem: FakeNotebookCellOutputItem as never,
    },
    createLocalizeMock(),
    () => connection,
    async (failure) => {
      reportedFailureKind = failure.kind;
      await reporterStarted;
    },
  );

  await executeCell({
    cell: createFakeCell("2 + 2") as never,
    controller: {
      createNotebookCellExecution: () => notebookExecution,
    } as never,
    executionOrder: 4,
    runtime,
  });

  assert.equal(reportedFailureKind, "transport-error");
  assert.equal(execution.success, false);
  assert.equal(execution.outputs[0]?.items[0]?.kind, "text");

  resolveReporter?.();
});

test("executeCell writes structured error output for promise rejection", async () => {
  const connection = createFakeConnection(async () => {
    return {
      result: { type: "undefined" },
      exceptionDetails: {
        text: "Uncaught (in promise) TypeError: async boom",
        exception: {
          className: "TypeError",
          description: "TypeError: async boom\n    at <anonymous>:1:1",
        },
      },
    } as never;
  });

  const { execution, notebookExecution } = createExecutionRecorder();

  const runtime = createKernelRuntime(
    {
      NotebookCellOutput: FakeNotebookCellOutput as never,
      NotebookCellOutputItem: FakeNotebookCellOutputItem as never,
    },
    createLocalizeMock(),
    () => connection,
  );

  await executeCell({
    cell: createFakeCell(
      "Promise.reject(new TypeError('async boom'))",
    ) as never,
    controller: {
      createNotebookCellExecution: () => notebookExecution,
    } as never,
    executionOrder: 1,
    runtime,
  });

  assert.equal(execution.success, false);
  assert.equal(execution.outputs[0]?.items[0]?.kind, "error");

  const renderedError = execution.outputs[0]?.items[0]?.value;
  assert.ok(renderedError instanceof Error);
  assert.equal(renderedError.name, "TypeError");
  assert.equal(renderedError.message, "async boom");
});

test("executeCell writes text output and reports failure for timeout", async () => {
  const connection = createFakeConnection(async () => {
    return {
      result: { type: "undefined" },
      exceptionDetails: {
        text: "Script execution timed out.",
        lineNumber: 0,
        columnNumber: 0,
      },
    } as never;
  });

  const { execution, notebookExecution } = createExecutionRecorder();
  const reportedFailures: string[] = [];

  const runtime = createKernelRuntime(
    {
      NotebookCellOutput: FakeNotebookCellOutput as never,
      NotebookCellOutputItem: FakeNotebookCellOutputItem as never,
    },
    createLocalizeMock(),
    () => connection,
    (failure) => {
      reportedFailures.push(failure.kind);
    },
  );

  await executeCell({
    cell: createFakeCell("new Promise(() => {})") as never,
    controller: {
      createNotebookCellExecution: () => notebookExecution,
    } as never,
    executionOrder: 1,
    runtime,
  });

  assert.equal(execution.success, false);
  assert.equal(execution.outputs[0]?.items[0]?.kind, "text");
  assert.deepEqual(reportedFailures, ["timeout"]);
  // Infrastructure failures render localized plain text output.
  assert.equal(execution.outputs[0]?.items[0]?.mime, "text/plain");
});

test("executeCell still produces success output for resolved async value (regression)", async () => {
  const connection = createFakeConnection(async () => {
    return {
      result: { type: "number", value: 42 },
    } as never;
  });

  const { execution, notebookExecution } = createExecutionRecorder();

  const runtime = createKernelRuntime(
    {
      NotebookCellOutput: FakeNotebookCellOutput as never,
      NotebookCellOutputItem: FakeNotebookCellOutputItem as never,
    },
    createLocalizeMock(),
    () => connection,
  );

  await executeCell({
    cell: createFakeCell("Promise.resolve(42)") as never,
    controller: {
      createNotebookCellExecution: () => notebookExecution,
    } as never,
    executionOrder: 1,
    runtime,
  });

  assert.equal(execution.success, true);
  assert.equal(execution.outputs[0]?.items[0]?.kind, "text");
  assert.equal(execution.outputs[0]?.items[0]?.value, "42");
});

test("executeCell classifies transport-thrown timeout error as timeout kind with text output", async () => {
  // Simulates raceWithTimeout or CDP throwing "CDP evaluation timed out"
  // instead of returning exceptionDetails — the pipeline must classify it as
  // timeout, not transport-error.
  const connection = createFakeConnection(async () => {
    throw new Error("CDP evaluation timed out");
  });

  const { execution, notebookExecution } = createExecutionRecorder();
  const reportedFailures: string[] = [];

  const runtime = createKernelRuntime(
    {
      NotebookCellOutput: FakeNotebookCellOutput as never,
      NotebookCellOutputItem: FakeNotebookCellOutputItem as never,
    },
    createLocalizeMock(),
    () => connection,
    (failure) => {
      reportedFailures.push(failure.kind);
    },
  );

  await executeCell({
    cell: createFakeCell("new Promise(() => {})") as never,
    controller: {
      createNotebookCellExecution: () => notebookExecution,
    } as never,
    executionOrder: 5,
    runtime,
  });

  assert.equal(execution.success, false);
  // Timeout is an infrastructure failure — text output, not structured Error
  assert.equal(execution.outputs[0]?.items[0]?.kind, "text");
  assert.match(String(execution.outputs[0]?.items[0]?.value), /timed out/i);
  assert.deepEqual(reportedFailures, ["timeout"]);
});

test("executeCell keeps sourceURL bytes stable across reruns of the same cell", async () => {
  const sourceUri =
    "vscode-notebook-cell://test-authority/workspaces/foundry-devil-code-sight/tests/files/test1.ipynb#ch0000000000999";
  const evaluateCalls: string[] = [];
  const connection = createFakeConnection(async (expression) => {
    evaluateCalls.push(expression);
    return {
      result: {
        type: "number",
        value: 3,
      },
    } as never;
  });

  const { notebookExecution } = createExecutionRecorder();
  const runtime = createKernelRuntime(
    {
      NotebookCellOutput: FakeNotebookCellOutput as never,
      NotebookCellOutputItem: FakeNotebookCellOutputItem as never,
    },
    createLocalizeMock(),
    () => connection,
  );

  const cell = createFakeCell("1 + 2", sourceUri) as never;

  await executeCell({
    cell,
    controller: {
      createNotebookCellExecution: () => notebookExecution,
    } as never,
    executionOrder: 10,
    runtime,
  });

  await executeCell({
    cell,
    controller: {
      createNotebookCellExecution: () => notebookExecution,
    } as never,
    executionOrder: 11,
    runtime,
  });

  assert.equal(evaluateCalls.length, 2);
  assert.equal(evaluateCalls[0], evaluateCalls[1]);
  assert.match(String(evaluateCalls[0]), new RegExp(`${sourceUri}\\n$`));
});

test("executeCell assigns unique sourceURL bytes for distinct cell URIs", async () => {
  const uriA =
    "vscode-notebook-cell://test-authority/workspaces/foundry-devil-code-sight/tests/files/test1.ipynb#ch0000000000101";
  const uriB =
    "vscode-notebook-cell://test-authority/workspaces/foundry-devil-code-sight/tests/files/test1.ipynb#ch0000000000102";
  const evaluateCalls: string[] = [];
  const connection = createFakeConnection(async (expression) => {
    evaluateCalls.push(expression);
    return {
      result: {
        type: "number",
        value: 1,
      },
    } as never;
  });

  const { notebookExecution } = createExecutionRecorder();
  const runtime = createKernelRuntime(
    {
      NotebookCellOutput: FakeNotebookCellOutput as never,
      NotebookCellOutputItem: FakeNotebookCellOutputItem as never,
    },
    createLocalizeMock(),
    () => connection,
  );

  await executeCell({
    cell: createFakeCell("1", uriA) as never,
    controller: {
      createNotebookCellExecution: () => notebookExecution,
    } as never,
    executionOrder: 12,
    runtime,
  });

  await executeCell({
    cell: createFakeCell("1", uriB) as never,
    controller: {
      createNotebookCellExecution: () => notebookExecution,
    } as never,
    executionOrder: 13,
    runtime,
  });

  assert.equal(evaluateCalls.length, 2);
  assert.notEqual(evaluateCalls[0], evaluateCalls[1]);
  assert.match(String(evaluateCalls[0]), new RegExp(`sourceURL=${uriA}`));
  assert.match(String(evaluateCalls[1]), new RegExp(`sourceURL=${uriB}`));
});

test("executeCell routes metadata cases to wrapper only when isolated is boolean true", async () => {
  const evaluateCalls: string[] = [];
  const connection = createFakeConnection(async (expression) => {
    evaluateCalls.push(expression);
    return {
      result: {
        type: "number",
        value: 2,
      },
    } as never;
  });
  const runtime = createKernelRuntime(
    {
      NotebookCellOutput: FakeNotebookCellOutput as never,
      NotebookCellOutputItem: FakeNotebookCellOutputItem as never,
    },
    createLocalizeMock(),
    () => connection,
  );
  const metadataCases: unknown[] = [
    undefined,
    {},
    { jupyterBrowserKernel: { isolated: false } },
    { jupyterBrowserKernel: { isolated: "true" } },
    { jupyterBrowserKernel: { isolated: true } },
  ];

  for (const [index, metadata] of metadataCases.entries()) {
    const { notebookExecution } = createExecutionRecorder();
    await executeCell({
      cell: createFakeCell("1 + 1", undefined, metadata) as never,
      controller: {
        createNotebookCellExecution: () => notebookExecution,
      } as never,
      executionOrder: 20 + index,
      runtime,
    });
  }

  assert.equal(evaluateCalls.length, 5);
  assert.equal(evaluateCalls[0]?.startsWith("(async()=>{"), false);
  assert.equal(evaluateCalls[1]?.startsWith("(async()=>{"), false);
  assert.equal(evaluateCalls[2]?.startsWith("(async()=>{"), false);
  assert.equal(evaluateCalls[3]?.startsWith("(async()=>{"), false);
  assert.equal(evaluateCalls[4]?.startsWith("await (async()=>{"), true);
});

test("executeCell prepends isolated annotation in a single successful output", async () => {
  const connection = createFakeConnection(async () => {
    return {
      result: {
        type: "number",
        value: 7,
      },
    } as never;
  });

  const { execution, notebookExecution } = createExecutionRecorder();
  const runtime = createKernelRuntime(
    {
      NotebookCellOutput: FakeNotebookCellOutput as never,
      NotebookCellOutputItem: FakeNotebookCellOutputItem as never,
    },
    createLocalizeMock(),
    () => connection,
  );

  await executeCell({
    cell: createFakeCell("3 + 4", DEFAULT_FAKE_CELL_URI, {
      jupyterBrowserKernel: { isolated: true },
    }) as never,
    controller: {
      createNotebookCellExecution: () => notebookExecution,
    } as never,
    executionOrder: 30,
    runtime,
  });

  assert.equal(execution.success, true);
  assert.equal(execution.outputs.length, 1);
  assert.equal(execution.outputs[0]?.items.length, 1);
  assert.equal(execution.outputs[0]?.items[0]?.kind, "text");
  assert.equal(execution.outputs[0]?.items[0]?.value, "(isolated cell)\n7");
});

test("executeCell does not prepend isolated annotation for failure outputs", async () => {
  const connection = createFakeConnection(async () => {
    return {
      result: {
        type: "undefined",
      },
      exceptionDetails: {
        text: "Uncaught TypeError: boom",
        exception: {
          className: "TypeError",
          description: "TypeError: boom\n    at <anonymous>:1:1",
        },
      },
    } as never;
  });

  const { execution, notebookExecution } = createExecutionRecorder();
  const runtime = createKernelRuntime(
    {
      NotebookCellOutput: FakeNotebookCellOutput as never,
      NotebookCellOutputItem: FakeNotebookCellOutputItem as never,
    },
    createLocalizeMock(),
    () => connection,
  );

  await executeCell({
    cell: createFakeCell("throw new TypeError('boom')", DEFAULT_FAKE_CELL_URI, {
      jupyterBrowserKernel: { isolated: true },
    }) as never,
    controller: {
      createNotebookCellExecution: () => notebookExecution,
    } as never,
    executionOrder: 31,
    runtime,
  });

  assert.equal(execution.success, false);
  assert.equal(execution.outputs.length, 1);
  assert.equal(execution.outputs[0]?.items.length, 1);
  assert.equal(execution.outputs[0]?.items[0]?.kind, "error");
});

test("executeCell kernel path never invokes Debugger APIs (passive provider)", async () => {
  let debuggerEnableCalls = 0;
  const connection = {
    ...createFakeConnection(async () => {
      return {
        result: {
          type: "number",
          value: 1,
        },
      } as never;
    }),
    Debugger: {
      enable: async () => {
        debuggerEnableCalls += 1;
      },
    },
  };

  const { notebookExecution } = createExecutionRecorder();
  const runtime = createKernelRuntime(
    {
      NotebookCellOutput: FakeNotebookCellOutput as never,
      NotebookCellOutputItem: FakeNotebookCellOutputItem as never,
    },
    createLocalizeMock(),
    () => connection as never,
  );

  await executeCell({
    cell: createFakeCell("1") as never,
    controller: {
      createNotebookCellExecution: () => notebookExecution,
    } as never,
    executionOrder: 40,
    runtime,
  });

  assert.equal(debuggerEnableCalls, 0);
});
