import * as vscode from "vscode";
import {
  createDefaultConnectCommandRuntime,
  executeConnectCommand,
} from "./commands/connect-command";

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    "jupyterBrowserKernel.connect",
    async () => {
      await executeConnectCommand(createDefaultConnectCommandRuntime(vscode));
    },
  );
  context.subscriptions.push(disposable);
}

export function deactivate(): void {}
