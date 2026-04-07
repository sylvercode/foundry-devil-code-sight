import * as vscode from "vscode";
import {
  createDefaultConnectCommandRuntime,
  executeConnectCommand,
} from "./commands/connect-command";
import { createConnectionStateStore } from "./transport/connection-state";
import { createConnectionStatusIndicator } from "./ui/connection-status-indicator";
import { disconnectActiveBrowserConnection } from "./transport/browser-connect";

export function activate(context: vscode.ExtensionContext): void {
  const connectionStateStore = createConnectionStateStore();
  const statusIndicator = createConnectionStatusIndicator(vscode);
  context.subscriptions.push(statusIndicator);

  const runtime = createDefaultConnectCommandRuntime(vscode, {
    connectionStateStore,
    onConnectionStateChanged: (state) => {
      statusIndicator.setState(state);
    },
  });

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jupyterBrowserKernel.connect",
      async () => {
        await executeConnectCommand(runtime);
      },
    ),
  );
}

export function deactivate(): Promise<void> {
  return disconnectActiveBrowserConnection();
}
