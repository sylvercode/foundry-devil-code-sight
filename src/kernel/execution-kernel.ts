import type * as vscode from "vscode";
import type { Localize } from "../config/endpoint-config";
import {
  getActiveBrowserConnection,
  type ActiveBrowserConnection,
} from "../transport/browser-connect";
import {
  normalizeEvaluationResult,
  normalizeTransportError,
  type ExecutionFailure,
  type ExecutionResult,
} from "./execution-result";
import {
  getKernelFailureCellOutputMessage,
  getNoActiveSessionMessage,
} from "./execution-messages";

export interface NotebookOutputApi {
  NotebookCellOutput: typeof vscode.NotebookCellOutput;
  NotebookCellOutputItem: typeof vscode.NotebookCellOutputItem;
}

export interface KernelRuntime {
  notebookOutputApi: NotebookOutputApi;
  localize: Localize;
  getActiveConnection: () => ActiveBrowserConnection | undefined;
  reportTransportError?: (failure: ExecutionFailure) => Promise<void> | void;
}

export interface ExecuteCellRequest {
  cell: vscode.NotebookCell;
  controller: vscode.NotebookController;
  executionOrder: number;
  runtime: KernelRuntime;
}

export function createKernelRuntime(
  notebookOutputApi: NotebookOutputApi,
  localize: Localize,
  getActiveConnection: () =>
    | ActiveBrowserConnection
    | undefined = getActiveBrowserConnection,
  reportTransportError?: (failure: ExecutionFailure) => Promise<void> | void,
): KernelRuntime {
  return {
    notebookOutputApi,
    localize,
    getActiveConnection,
    reportTransportError,
  };
}

export async function executeCell({
  cell,
  controller,
  executionOrder,
  runtime,
}: ExecuteCellRequest): Promise<void> {
  const execution = controller.createNotebookCellExecution(cell);
  execution.start(Date.now());
  execution.executionOrder = executionOrder;

  const connection = runtime.getActiveConnection();
  if (!connection) {
    const noSessionFailure = createNoSessionFailure(runtime.localize);
    reportFailureAsync(runtime, noSessionFailure);
    await clearCellOutput(execution);
    execution.end(false, Date.now());
    return;
  }

  const expression = cell.document.getText();

  const result = await evaluateCellExpression(connection, expression);

  if (result.ok) {
    const renderedValue =
      result.value.length > 0 ? result.value : runtime.localize("undefined");
    await writeSuccessOutput(
      execution,
      renderedValue,
      runtime.notebookOutputApi,
    );
    execution.end(true, Date.now());
    return;
  }

  if (shouldReportFailure(result)) {
    reportFailureAsync(runtime, result);
  }

  await writeFailureOutput(
    execution,
    result,
    runtime.notebookOutputApi,
    runtime.localize,
  );
  execution.end(false, Date.now());
}

function createNoSessionFailure(localize: Localize): ExecutionFailure {
  return {
    ok: false,
    name: "NoActiveSessionError",
    kind: "no-session",
    message: getNoActiveSessionMessage(localize),
  };
}

function shouldReportFailure(failure: ExecutionFailure): boolean {
  return failure.kind === "transport-error" || failure.kind === "no-session";
}

function reportFailureAsync(
  runtime: KernelRuntime,
  failure: ExecutionFailure,
): void {
  const reportPromise = runtime.reportTransportError?.(failure);

  if (!reportPromise) {
    return;
  }

  void Promise.resolve(reportPromise).catch(() => undefined);
}

async function evaluateCellExpression(
  connection: ActiveBrowserConnection,
  expression: string,
): Promise<ExecutionResult> {
  try {
    const expressionWithLabel = addSourceLabeling(expression);
    const rawResponse = await connection.evaluate(expressionWithLabel);
    return normalizeEvaluationResult(rawResponse);
  } catch (error) {
    return normalizeTransportError(error);
  }
}

function addSourceLabeling(expression: string): string {
  // Adding a sourceURL label to the expression allows browser devtools to
  // associate the evaluated code with a "file",
  // which can improve debugging and error stack traces.
  const sourceLabel = `//# sourceURL=cell.js`;
  return `${expression}\n${sourceLabel}`;
}

async function writeSuccessOutput(
  execution: vscode.NotebookCellExecution,
  value: string,
  notebookOutputApi: NotebookOutputApi,
): Promise<void> {
  await execution.replaceOutput([
    new notebookOutputApi.NotebookCellOutput([
      notebookOutputApi.NotebookCellOutputItem.text(value, "text/plain"),
    ]),
  ]);
}

async function clearCellOutput(
  execution: vscode.NotebookCellExecution,
): Promise<void> {
  await execution.replaceOutput([]);
}

async function writeFailureOutput(
  execution: vscode.NotebookCellExecution,
  failure: ExecutionFailure,
  notebookOutputApi: NotebookOutputApi,
  localize: Localize,
): Promise<void> {
  if (failure.kind === "transport-error" || failure.kind === "no-session") {
    const message = getKernelFailureCellOutputMessage(localize, failure.kind);

    await execution.replaceOutput([
      new notebookOutputApi.NotebookCellOutput([
        notebookOutputApi.NotebookCellOutputItem.text(message, "text/plain"),
      ]),
    ]);
    return;
  }

  const error = toErrorObject(failure);

  await execution.replaceOutput([
    new notebookOutputApi.NotebookCellOutput([
      notebookOutputApi.NotebookCellOutputItem.error(error),
    ]),
  ]);
}

function toErrorObject(failure: ExecutionFailure): Error {
  const error = new Error(failure.message);
  error.name = failure.name;

  if (failure.stack) {
    error.stack = failure.stack;
  }

  return error;
}
