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
}

interface ExecutionRecorder {
  execution: RecordedExecution;
  notebookExecution: RecordedNotebookExecution;
}

function createExecutionRecorder(): ExecutionRecorder {
  const execution: RecordedExecution = {
    outputs: [],
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
  };

  return { execution, notebookExecution };
}

function createFakeCell(text: string): { document: { getText: () => string } } {
  return {
    document: {
      getText: () => text,
    },
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
    close: async () => undefined,
  };
}

test("executeCell evaluates expression and writes success output", async () => {
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
    cell: createFakeCell("2 + 2") as never,
    controller: {
      createNotebookCellExecution: () => notebookExecution,
    } as never,
    executionOrder: 7,
    runtime,
  });

  assert.deepEqual(evaluateCalls, ["2 + 2\n//# sourceURL=cell.js"]);
  assert.equal(notebookExecution.executionOrder, 7);
  assert.equal(execution.success, true);
  assert.equal(execution.outputs.length, 1);
  assert.equal(execution.outputs[0]?.items[0]?.kind, "text");
  assert.equal(execution.outputs[0]?.items[0]?.value, "4");
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
