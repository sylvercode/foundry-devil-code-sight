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
  type ExecutionFailureKind,
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

export type GetActiveConnection = () => ActiveBrowserConnection | undefined;

type EvaluationCompletion =
  | { kind: "result"; result: ExecutionResult }
  | { kind: "cancelled" };

export type ReportTransportError = (
  failure: ExecutionFailure,
) => Promise<void> | void;

export interface KernelRuntime {
  notebookOutputApi: NotebookOutputApi;
  localize: Localize;
  getActiveConnection: GetActiveConnection;
  reportTransportError?: ReportTransportError;
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
  getActiveConnection: GetActiveConnection = getActiveBrowserConnection,
  reportTransportError?: ReportTransportError,
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
}: ExecuteCellRequest): Promise<boolean> {
  const execution = controller.createNotebookCellExecution(cell);
  let executionEnded = false;
  const endExecution = (success: boolean): void => {
    if (executionEnded) {
      return;
    }

    execution.end(success, Date.now());
    executionEnded = true;
  };

  execution.start(Date.now());
  execution.executionOrder = executionOrder;

  if (execution.token.isCancellationRequested) {
    endExecution(false);
    return true;
  }

  try {
    const connection = runtime.getActiveConnection();
    if (!connection) {
      const noSessionFailure = createNoSessionFailure(runtime.localize);
      reportFailureAsync(runtime, noSessionFailure);
      await writeFailureOutput(
        execution,
        noSessionFailure,
        runtime.notebookOutputApi,
        runtime.localize,
      );
      endExecution(false);
      return false;
    }

    const expression = cell.document.getText();
    const sourceUri = cell.document.uri.toString();
    let resolveCancellationSignal: (() => void) | undefined;
    const cancellationSignal = new Promise<void>((resolve) => {
      resolveCancellationSignal = resolve;
    });

    const cancellationListener = execution.token.onCancellationRequested(() => {
      void connection.terminateExecution();
      endExecution(false);
      resolveCancellationSignal?.();
    });

    const evaluationPromise = evaluateCellExpression(
      connection,
      expression,
      sourceUri,
    );
    const completion: EvaluationCompletion = await Promise.race([
      evaluationPromise.then(
        (result): EvaluationCompletion => ({ kind: "result", result }),
      ),
      cancellationSignal.then(
        (): EvaluationCompletion => ({ kind: "cancelled" }),
      ),
    ]);
    cancellationListener.dispose();

    if (completion.kind === "cancelled") {
      return true;
    }

    const result = completion.result;

    if (execution.token.isCancellationRequested) {
      endExecution(false);
      return true;
    }

    if (result.ok) {
      const renderedValue =
        result.value.length > 0 ? result.value : runtime.localize("undefined");
      await writeSuccessOutput(
        execution,
        renderedValue,
        runtime.notebookOutputApi,
      );
      endExecution(true);
      return false;
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
    endExecution(false);
    return false;
  } catch {
    endExecution(false);
    return execution.token.isCancellationRequested;
  }
}

function createNoSessionFailure(localize: Localize): ExecutionFailure {
  return {
    ok: false,
    name: "NoActiveSessionError",
    kind: "no-session",
    message: getNoActiveSessionMessage(localize),
  };
}

function isInfrastructureFailure(kind: ExecutionFailureKind): boolean {
  return (
    kind === "transport-error" || kind === "no-session" || kind === "timeout"
  );
}

function shouldReportFailure(failure: ExecutionFailure): boolean {
  return isInfrastructureFailure(failure.kind);
}

function reportFailureAsync(
  runtime: KernelRuntime,
  failure: ExecutionFailure,
): void {
  let reportPromise: Promise<void> | void;
  try {
    reportPromise = runtime.reportTransportError?.(failure);
  } catch {
    return;
  }

  if (!reportPromise) {
    return;
  }

  void Promise.resolve(reportPromise).catch(() => undefined);
}

async function evaluateCellExpression(
  connection: ActiveBrowserConnection,
  expression: string,
  sourceUri: string,
): Promise<ExecutionResult> {
  try {
    const expressionWithLabel = addSourceLabeling(expression, sourceUri);
    const rawResponse = await connection.evaluate(expressionWithLabel);
    return normalizeEvaluationResult(rawResponse);
  } catch (error) {
    return normalizeTransportError(error);
  }
}

function addSourceLabeling(expression: string, sourceUri: string): string {
  // Adding a sourceURL label to the expression allows browser devtools to
  // associate the evaluated code with a "file",
  // which can improve debugging and error stack traces.
  const sourceLabel = `//# sourceURL=${sourceUri}`;
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

async function writeFailureOutput(
  execution: vscode.NotebookCellExecution,
  failure: ExecutionFailure,
  notebookOutputApi: NotebookOutputApi,
  localize: Localize,
): Promise<void> {
  if (isInfrastructureFailure(failure.kind)) {
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
