import * as vscode from "vscode";
import {
  createDefaultConnectCommandRuntime,
  executeConnectCommand,
} from "./commands/connect-command";
import {
  createDefaultDisconnectCommandRuntime,
  executeDisconnectCommand,
} from "./commands/disconnect-command";
import {
  createDefaultReconnectCommandRuntime,
  executeReconnectCommand,
} from "./commands/reconnect-command";
import {
  readAndValidateEndpointConfig,
  summarizeEndpointForDisplay,
} from "./config/endpoint-config";
import {
  ConnectionStoreHandler,
  createConnectionStateStore,
} from "./transport/connection-state";
import { createConnectionLogger } from "./logging/connection-logger";
import { createKernelTransportFailureReporter } from "./logging/kernel-transport-failure-reporter";
import { createConnectionStatusIndicator } from "./ui/connection-status-indicator";
import { disconnectActiveBrowserConnection } from "./transport/browser-connect";
import { registerKernelController } from "./notebook";
import { registerToggleCellIsolationCommand } from "./commands/toggle-cell-isolation-command";
import { DebugAdapterFactory, DebugConfigProvider } from "./debugger";

const ACTIVE_NOTEBOOK_USES_BROWSER_KERNEL_CONTEXT_KEY =
  "jupyterBrowserKernel.activeNotebookUsesBrowserKernel";

type SubscriptionInfo<T> = {
  command: string;
  runtimeFactory: (api: typeof vscode, handler: ConnectionStoreHandler) => T;
  callback: (runtime: T) => Promise<void>;
};

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel(
    "Jupyter Browser Kernel",
  );
  context.subscriptions.push(outputChannel);

  const statusIndicator = createConnectionStatusIndicator(vscode);
  context.subscriptions.push(statusIndicator);

  const logger = createConnectionLogger(outputChannel, () => {
    const validation = readAndValidateEndpointConfig(
      vscode.workspace.getConfiguration("jupyterBrowserKernel"),
      vscode.l10n.t,
    );
    return validation.ok
      ? summarizeEndpointForDisplay(validation.endpoint)
      : vscode.l10n.t("Endpoint unavailable (check settings).");
  });

  const connectionStateStore = createConnectionStateStore({
    onConnectionStateChanged: (state) => {
      statusIndicator.setState(state);
      logger.onConnectionStateChanged(state);
    },
    onErrorContextChanged: (context) => {
      statusIndicator.setErrorContext(context);
      logger.onErrorContextChanged(context);
    },
  });

  const registerCommand = <T>({
    command,
    runtimeFactory,
    callback,
  }: SubscriptionInfo<T>): void => {
    const runtime = runtimeFactory(vscode, { connectionStateStore });
    context.subscriptions.push(
      vscode.commands.registerCommand(command, async () => {
        await callback(runtime);
      }),
    );
  };

  registerCommand({
    command: "jupyterBrowserKernel.connect",
    runtimeFactory: createDefaultConnectCommandRuntime,
    callback: executeConnectCommand,
  });

  registerCommand({
    command: "jupyterBrowserKernel.disconnect",
    runtimeFactory: createDefaultDisconnectCommandRuntime,
    callback: executeDisconnectCommand,
  });

  registerCommand({
    command: "jupyterBrowserKernel.reconnect",
    runtimeFactory: createDefaultReconnectCommandRuntime,
    callback: executeReconnectCommand,
  });

  const reportKernelTransportFailure = createKernelTransportFailureReporter({
    connectionStateStore,
    disconnectActiveConnection: disconnectActiveBrowserConnection,
    outputChannel,
    localize: vscode.l10n.t,
    showErrorMessage: async (message) => {
      await vscode.window.showErrorMessage(message);
    },
  });

  const kernelController = registerKernelController(vscode, {
    onTransportError: reportKernelTransportFailure,
  });
  context.subscriptions.push(kernelController);

  const debugLogger = (message: string, error?: unknown): void => {
    outputChannel.appendLine(vscode.l10n.t(message, String(error ?? "")));
  };

  const debugConfigProvider = new DebugConfigProvider({
    localize: vscode.l10n.t,
  });
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(
      "jupyter-browser-kernel",
      debugConfigProvider,
    ),
  );

  const debugAdapterFactory = new DebugAdapterFactory({
    logger: debugLogger,
  });
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory(
      "jupyter-browser-kernel",
      debugAdapterFactory,
    ),
  );

  const selectedNotebookUris = new Set<string>();
  const syncActiveNotebookKernelContext = (): void => {
    const activeNotebookUri =
      vscode.window.activeNotebookEditor?.notebook.uri.toString();
    const activeUsesBrowserKernel =
      typeof activeNotebookUri === "string" &&
      selectedNotebookUris.has(activeNotebookUri);

    void vscode.commands.executeCommand(
      "setContext",
      ACTIVE_NOTEBOOK_USES_BROWSER_KERNEL_CONTEXT_KEY,
      activeUsesBrowserKernel,
    );
  };

  syncActiveNotebookKernelContext();

  context.subscriptions.push(
    kernelController.onDidChangeSelectedNotebooks(({ notebook, selected }) => {
      const notebookUri = notebook.uri.toString();

      if (selected) {
        selectedNotebookUris.add(notebookUri);
      } else {
        selectedNotebookUris.delete(notebookUri);
      }

      syncActiveNotebookKernelContext();
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveNotebookEditor(() => {
      syncActiveNotebookKernelContext();
    }),
  );

  registerToggleCellIsolationCommand(context, {
    commands: vscode.commands,
    workspace: vscode.workspace,
    window: vscode.window,
    NotebookEdit: vscode.NotebookEdit,
    WorkspaceEdit: vscode.WorkspaceEdit,
  });
}

export function deactivate(): Promise<void> {
  return disconnectActiveBrowserConnection();
}
