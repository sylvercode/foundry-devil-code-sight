import type * as vscode from "vscode";

const TOGGLE_CELL_ISOLATION_COMMAND =
  "jupyterBrowserKernel.toggleCellIsolation";
const TOGGLE_CELL_ISOLATION_ISOLATE_COMMAND =
  "jupyterBrowserKernel.toggleCellIsolation.isolate";
const TOGGLE_CELL_ISOLATION_SHARE_COMMAND =
  "jupyterBrowserKernel.toggleCellIsolation.share";
const ACTIVE_CELL_ISOLATED_CONTEXT_KEY =
  "jupyterBrowserKernel.activeCellIsolated";

type UnknownRecord = Record<string, unknown>;

export interface ToggleCellIsolationApi {
  commands: Pick<typeof vscode.commands, "registerCommand" | "executeCommand">;
  workspace: Pick<
    typeof vscode.workspace,
    "applyEdit" | "onDidChangeNotebookDocument"
  >;
  window: Pick<
    typeof vscode.window,
    | "activeNotebookEditor"
    | "onDidChangeActiveNotebookEditor"
    | "onDidChangeNotebookEditorSelection"
  >;
  NotebookEdit: typeof vscode.NotebookEdit;
  WorkspaceEdit: typeof vscode.WorkspaceEdit;
}

function isObjectRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function toMetadataRecord(metadata: unknown): UnknownRecord | undefined {
  return isObjectRecord(metadata) ? metadata : undefined;
}

function isCellIsolated(metadata: unknown): boolean {
  const metadataRecord = toMetadataRecord(metadata);
  const kernelMetadata = toMetadataRecord(
    metadataRecord?.jupyterBrowserKernel,
  ) as { isolated?: unknown } | undefined;

  return kernelMetadata?.isolated === true;
}

export function toggleCellIsolationMetadata(metadata: unknown): UnknownRecord {
  const nextMetadata = {
    ...(toMetadataRecord(metadata) ?? {}),
  };

  const existingKernelMetadata = {
    ...(toMetadataRecord(nextMetadata.jupyterBrowserKernel) ?? {}),
  };

  if (isCellIsolated(metadata)) {
    const { isolated: _omitted, ...restKernelMetadata } =
      existingKernelMetadata;

    if (Object.keys(restKernelMetadata).length === 0) {
      delete nextMetadata.jupyterBrowserKernel;
    } else {
      nextMetadata.jupyterBrowserKernel = restKernelMetadata;
    }

    return nextMetadata;
  }

  nextMetadata.jupyterBrowserKernel = {
    ...existingKernelMetadata,
    isolated: true,
  };

  return nextMetadata;
}

function getCellFromActiveEditor(
  editor: vscode.NotebookEditor | undefined,
): vscode.NotebookCell | undefined {
  if (!editor || editor.selections.length === 0) {
    return undefined;
  }

  const firstSelection = editor.selections[0];
  if (!firstSelection || firstSelection.start >= editor.notebook.cellCount) {
    return undefined;
  }

  return editor.notebook.cellAt(firstSelection.start);
}

function resolveTargetCell(
  cell: unknown,
  activeEditor: vscode.NotebookEditor | undefined,
): vscode.NotebookCell | undefined {
  if (cell && typeof cell === "object") {
    const maybeCell = cell as Partial<vscode.NotebookCell>;
    if (typeof maybeCell.index === "number" && !!maybeCell.notebook) {
      return maybeCell as vscode.NotebookCell;
    }
  }

  return getCellFromActiveEditor(activeEditor);
}

async function setActiveCellIsolationContext(
  api: ToggleCellIsolationApi,
): Promise<void> {
  const activeCell = getCellFromActiveEditor(api.window.activeNotebookEditor);
  const activeCellIsolated = isCellIsolated(activeCell?.metadata);
  await api.commands.executeCommand(
    "setContext",
    ACTIVE_CELL_ISOLATED_CONTEXT_KEY,
    activeCellIsolated,
  );
}

function registerToolbarContextSynchronization(
  api: ToggleCellIsolationApi,
): vscode.Disposable {
  const syncContext = (): void => {
    void setActiveCellIsolationContext(api);
  };

  syncContext();

  const selectionDisposable =
    api.window.onDidChangeNotebookEditorSelection(syncContext);
  const activeEditorDisposable =
    api.window.onDidChangeActiveNotebookEditor(syncContext);
  const notebookDisposable =
    api.workspace.onDidChangeNotebookDocument(syncContext);

  return {
    dispose: () => {
      selectionDisposable.dispose();
      activeEditorDisposable.dispose();
      notebookDisposable.dispose();
    },
  };
}

async function toggleIsolationForCell(
  api: ToggleCellIsolationApi,
  cell: unknown,
): Promise<void> {
  const targetCell = resolveTargetCell(cell, api.window.activeNotebookEditor);
  if (!targetCell) {
    await setActiveCellIsolationContext(api);
    return;
  }

  const newMetadata = toggleCellIsolationMetadata(targetCell.metadata);
  const edit = new api.WorkspaceEdit();
  edit.set(targetCell.notebook.uri, [
    api.NotebookEdit.updateCellMetadata(targetCell.index, newMetadata),
  ]);

  await api.workspace.applyEdit(edit);
  await setActiveCellIsolationContext(api);
}

export function registerToggleCellIsolationCommand(
  context: vscode.ExtensionContext,
  api: ToggleCellIsolationApi,
): vscode.Disposable {
  const toggleHandler = async (cell?: unknown): Promise<void> => {
    await toggleIsolationForCell(api, cell);
  };

  const toggleDisposable = api.commands.registerCommand(
    TOGGLE_CELL_ISOLATION_COMMAND,
    toggleHandler,
  );
  const isolateDisposable = api.commands.registerCommand(
    TOGGLE_CELL_ISOLATION_ISOLATE_COMMAND,
    toggleHandler,
  );
  const shareDisposable = api.commands.registerCommand(
    TOGGLE_CELL_ISOLATION_SHARE_COMMAND,
    toggleHandler,
  );
  const contextDisposable = registerToolbarContextSynchronization(api);

  const disposable: vscode.Disposable = {
    dispose: () => {
      toggleDisposable.dispose();
      isolateDisposable.dispose();
      shareDisposable.dispose();
      contextDisposable.dispose();
    },
  };
  context.subscriptions.push(disposable);
  return disposable;
}
