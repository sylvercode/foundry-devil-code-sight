import test from "node:test";
import assert from "node:assert/strict";

import {
  registerKernelController,
  resetExecutionOrderForTests,
} from "../../../src/notebook/kernel-controller.js";
import { createLocalizeMock } from "../test-utils/localize-mock.js";

class FakeNotebookCellOutputItem {
  private constructor(
    public readonly kind: "text" | "error",
    public readonly value: string | Error,
    public readonly mime?: string,
  ) {}

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

type FakeNotebookCell = { document: { getText: () => string } };

type FakeNotebookExecutionController = {
  createNotebookCellExecution: (cell: unknown) => unknown;
};

function createToken(isCancellationRequested = false): {
  readonly isCancellationRequested: boolean;
  onCancellationRequested: (listener: () => void) => { dispose: () => void };
} {
  return {
    isCancellationRequested,
    onCancellationRequested: () => ({
      dispose: () => undefined,
    }),
  };
}

type FakeExecuteHandler = (
  cells: FakeNotebookCell[],
  notebook: unknown,
  controller: FakeNotebookExecutionController,
) => Promise<void> | void;

interface FakeNotebookController {
  id: string;
  notebookType: string;
  label: string;
  supportedLanguages: string[];
  executeHandler?: FakeExecuteHandler;
}

test("registerKernelController creates expected notebook controller", () => {
  const created: { id?: string; notebookType?: string; label?: string } = {};
  const controller: FakeNotebookController = {
    id: "",
    notebookType: "",
    label: "",
    supportedLanguages: [],
  };

  const api = {
    notebooks: {
      createNotebookController: (
        id: string,
        notebookType: string,
        label: string,
      ) => {
        created.id = id;
        created.notebookType = notebookType;
        created.label = label;

        controller.id = id;
        controller.notebookType = notebookType;
        controller.label = label;

        return controller;
      },
    },
    l10n: {
      t: createLocalizeMock(),
    },
    NotebookCellOutput: FakeNotebookCellOutput,
    NotebookCellOutputItem: FakeNotebookCellOutputItem,
  };

  const registered = registerKernelController(api as never);

  assert.equal(created.id, "jupyter-browser-kernel");
  assert.equal(created.notebookType, "jupyter-notebook");
  assert.equal(created.label, "Browser Kernel");
  assert.deepEqual(controller.supportedLanguages, ["javascript"]);
  assert.equal(registered, controller);
});

test("executeHandler dispatches each cell to kernel execution", async () => {
  resetExecutionOrderForTests();

  const controller: FakeNotebookController = {
    id: "",
    notebookType: "",
    label: "",
    supportedLanguages: [],
  };

  const api = {
    notebooks: {
      createNotebookController: () => controller,
    },
    l10n: {
      t: createLocalizeMock(),
    },
    NotebookCellOutput: FakeNotebookCellOutput,
    NotebookCellOutputItem: FakeNotebookCellOutputItem,
  };

  registerKernelController(api as never);

  const executionOrders: number[] = [];

  const executionController = {
    createNotebookCellExecution: () => ({
      start: () => undefined,
      end: () => undefined,
      replaceOutput: async () => undefined,
      token: createToken(),
      set executionOrder(order: number) {
        executionOrders.push(order);
      },
    }),
  };

  await controller.executeHandler?.(
    [
      { document: { getText: () => "1 + 1" } },
      { document: { getText: () => "2 + 2" } },
    ],
    {},
    executionController,
  );

  assert.deepEqual(executionOrders, [1, 2]);
});

test("executeHandler stops dispatching remaining cells after cancellation", async () => {
  resetExecutionOrderForTests();

  const controller: FakeNotebookController = {
    id: "",
    notebookType: "",
    label: "",
    supportedLanguages: [],
  };

  const api = {
    notebooks: {
      createNotebookController: () => controller,
    },
    l10n: {
      t: createLocalizeMock(),
    },
    NotebookCellOutput: FakeNotebookCellOutput,
    NotebookCellOutputItem: FakeNotebookCellOutputItem,
  };

  registerKernelController(api as never);

  let executionCount = 0;
  const executionOrders: number[] = [];

  const executionController = {
    createNotebookCellExecution: () => {
      executionCount += 1;

      return {
        start: () => undefined,
        end: () => undefined,
        replaceOutput: async () => undefined,
        token: createToken(true),
        set executionOrder(order: number) {
          executionOrders.push(order);
        },
      };
    },
  };

  await controller.executeHandler?.(
    [
      { document: { getText: () => "1 + 1" } },
      { document: { getText: () => "2 + 2" } },
    ],
    {},
    executionController,
  );

  assert.equal(executionCount, 1);
  assert.deepEqual(executionOrders, [1]);
});
