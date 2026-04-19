import type * as vscode from "vscode";
import type { Localize } from "../config/endpoint-config";
import {
  executeCell,
  createKernelRuntime,
  type ExecutionFailure,
} from "../kernel";

let executionOrder = 0;

export interface NotebookApi {
  notebooks: Pick<typeof vscode.notebooks, "createNotebookController">;
  NotebookCellOutput: typeof vscode.NotebookCellOutput;
  NotebookCellOutputItem: typeof vscode.NotebookCellOutputItem;
}

export interface LocalizationApi {
  t: Localize;
}

export interface KernelControllerApi extends NotebookApi {
  l10n: LocalizationApi;
}

export interface KernelControllerOptions {
  onTransportError?:
    | ((failure: ExecutionFailure) => Promise<void>)
    | ((failure: ExecutionFailure) => void);
}

export function registerKernelController(
  api: KernelControllerApi,
  options?: KernelControllerOptions,
): vscode.NotebookController {
  const controller = api.notebooks.createNotebookController(
    "jupyter-browser-kernel",
    "jupyter-notebook",
    api.l10n.t("Browser Kernel"),
  );

  controller.supportedLanguages = ["javascript"];

  const runtime = createKernelRuntime(
    {
      NotebookCellOutput: api.NotebookCellOutput,
      NotebookCellOutputItem: api.NotebookCellOutputItem,
    },
    api.l10n.t,
    undefined,
    options?.onTransportError,
  );

  controller.executeHandler = async (cells, _notebook, executionController) => {
    for (const cell of cells) {
      executionOrder += 1;
      const wasCancelled = await executeCell({
        cell,
        controller: executionController,
        executionOrder,
        runtime,
      });

      if (wasCancelled) {
        break;
      }
    }
  };

  return controller;
}

export function resetExecutionOrderForTests(): void {
  executionOrder = 0;
}
