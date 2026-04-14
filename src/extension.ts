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
import { createConnectionStatusIndicator } from "./ui/connection-status-indicator";
import { disconnectActiveBrowserConnection } from "./transport/browser-connect";

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
}

export function deactivate(): Promise<void> {
  return disconnectActiveBrowserConnection();
}
