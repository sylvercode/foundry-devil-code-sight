import test from "node:test";
import assert from "node:assert/strict";

import {
  registerToggleCellIsolationCommand,
  toggleCellIsolationMetadata,
} from "../../../src/commands/toggle-cell-isolation-command.js";

interface FakeCellEdit {
  index: number;
  metadata: unknown;
}

class FakeWorkspaceEdit {
  public readonly updates: Array<{ uri: string; edits: FakeCellEdit[] }> = [];

  set(uri: { toString(): string } | string, edits: FakeCellEdit[]): void {
    const renderedUri = typeof uri === "string" ? uri : uri.toString();
    this.updates.push({ uri: renderedUri, edits });
  }
}

function createFakeCell(metadata: unknown) {
  const uri = "vscode-notebook://workspace/test.ipynb";
  const notebook = {
    uri: {
      toString: () => uri,
    },
    cellCount: 1,
    cellAt: () => cell,
  };

  const cell = {
    index: 0,
    metadata,
    notebook,
  };

  return cell;
}

function createHarness(activeCell?: ReturnType<typeof createFakeCell>) {
  const commandHandlers = new Map<string, (cell?: unknown) => Promise<void>>();
  const applyEditCalls: FakeWorkspaceEdit[] = [];

  const context = {
    subscriptions: [] as Array<{ dispose: () => void }>,
  };

  const api = {
    commands: {
      registerCommand: (
        commandId: string,
        handler: (cell?: unknown) => Promise<void>,
      ) => {
        commandHandlers.set(commandId, handler);
        return { dispose: () => undefined };
      },
      executeCommand: async () => undefined,
    },
    workspace: {
      applyEdit: async (edit: FakeWorkspaceEdit) => {
        applyEditCalls.push(edit);
        return true;
      },
      onDidChangeNotebookDocument: () => ({ dispose: () => undefined }),
    },
    window: {
      activeNotebookEditor: activeCell
        ? {
            notebook: activeCell.notebook,
            selections: [{ start: 0, end: 1 }],
          }
        : undefined,
      onDidChangeActiveNotebookEditor: () => ({ dispose: () => undefined }),
      onDidChangeNotebookEditorSelection: () => ({ dispose: () => undefined }),
    },
    NotebookEdit: {
      updateCellMetadata: (index: number, metadata: unknown) => ({
        index,
        metadata,
      }),
    },
    WorkspaceEdit: FakeWorkspaceEdit,
  };

  registerToggleCellIsolationCommand(context as never, api as never);

  return {
    commandHandlers,
    applyEditCalls,
  };
}

test("toggleCellIsolationMetadata sets jupyterBrowserKernel.isolated=true and preserves unrelated keys", () => {
  const result = toggleCellIsolationMetadata({
    tags: ["sample"],
    jupyterBrowserKernel: {
      mode: "custom",
    },
  });

  assert.deepEqual(result, {
    tags: ["sample"],
    jupyterBrowserKernel: {
      mode: "custom",
      isolated: true,
    },
  });
});

test("toggleCellIsolationMetadata removes isolated key when currently isolated", () => {
  const result = toggleCellIsolationMetadata({
    jupyterBrowserKernel: {
      isolated: true,
      mode: "custom",
    },
  });

  assert.deepEqual(result, {
    jupyterBrowserKernel: {
      mode: "custom",
    },
  });
});

test("toggleCellIsolationMetadata removes jupyterBrowserKernel object when isolated is the only key", () => {
  const result = toggleCellIsolationMetadata({
    jupyterBrowserKernel: {
      isolated: true,
    },
    tags: ["t"],
  });

  assert.deepEqual(result, {
    tags: ["t"],
  });
});

test("toggleCellIsolationMetadata does not mutate the original metadata object", () => {
  const metadata = Object.freeze({
    tags: ["frozen"],
    jupyterBrowserKernel: Object.freeze({
      isolated: false,
      preserved: true,
    }),
  });

  const result = toggleCellIsolationMetadata(metadata);

  assert.deepEqual(result, {
    tags: ["frozen"],
    jupyterBrowserKernel: {
      isolated: true,
      preserved: true,
    },
  });
});

test("toggle command updates metadata when invoked on an unisolated cell", async () => {
  const cell = createFakeCell({ tags: ["x"] });
  const { commandHandlers, applyEditCalls } = createHarness(cell);

  const handler = commandHandlers.get(
    "jupyterBrowserKernel.toggleCellIsolation",
  );
  assert.ok(handler);
  await handler?.(cell);

  assert.equal(applyEditCalls.length, 1);
  assert.equal(applyEditCalls[0]?.updates.length, 1);
  assert.equal(applyEditCalls[0]?.updates[0]?.edits.length, 1);
  assert.deepEqual(applyEditCalls[0]?.updates[0]?.edits[0]?.metadata, {
    tags: ["x"],
    jupyterBrowserKernel: {
      isolated: true,
    },
  });
});

test("toggle command is no-op when invoked without a cell and no active notebook editor", async () => {
  const { commandHandlers, applyEditCalls } = createHarness(undefined);

  const handler = commandHandlers.get(
    "jupyterBrowserKernel.toggleCellIsolation",
  );
  assert.ok(handler);
  await handler?.(undefined);

  assert.equal(applyEditCalls.length, 0);
});

test("toggle command applies exactly one edit per invocation", async () => {
  const cell = createFakeCell({
    jupyterBrowserKernel: {
      isolated: true,
    },
  });
  const { commandHandlers, applyEditCalls } = createHarness(cell);

  const handler = commandHandlers.get(
    "jupyterBrowserKernel.toggleCellIsolation",
  );
  assert.ok(handler);
  await handler?.(cell);

  assert.equal(applyEditCalls.length, 1);
  assert.equal(applyEditCalls[0]?.updates.length, 1);
});
