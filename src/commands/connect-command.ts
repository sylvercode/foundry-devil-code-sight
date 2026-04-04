import type * as vscode from "vscode";
import {
  type Localize,
  type EndpointValidationResult,
  readAndValidateEndpointConfig,
  summarizeEndpointForDisplay,
} from "../config/endpoint-config";

export interface ConnectCommandRuntime {
  readAndValidate: () => EndpointValidationResult;
  localize: Localize;
  showInformationMessage: (
    message: string,
  ) => PromiseLike<string | undefined> | void;
  showErrorMessage: (
    message: string,
    action: string,
  ) => PromiseLike<string | undefined> | string | undefined;
  openSettings: (query: string) => PromiseLike<unknown> | void;
}

export async function executeConnectCommand(
  runtime: ConnectCommandRuntime,
): Promise<void> {
  const settingsKeyByField: Record<string, "cdpHost" | "cdpPort"> = {
    host: "cdpHost",
    port: "cdpPort",
  };

  const validation = runtime.readAndValidate();

  if (!validation.ok) {
    const action = runtime.localize("Open Settings");

    let selection: string | undefined;
    try {
      selection = await runtime.showErrorMessage(
        runtime.localize({
          message: "{0} {1}",
          args: [validation.error.message, validation.error.correctiveAction],
          comment: [
            "{0} is the validation failure message.",
            "{1} is the corrective action the user should take.",
          ],
        }),
        action,
      );
    } catch {
      return;
    }

    if (selection === action) {
      const settingsKey =
        settingsKeyByField[validation.error.field] ?? "cdpHost";
      try {
        await runtime.openSettings(`jupyterBrowserKernel.${settingsKey}`);
      } catch {
        // non-fatal: settings pane failed to open, nothing further to do
      }
    }

    return;
  }

  try {
    await runtime.showInformationMessage(
      runtime.localize({
        message:
          "Jupyter Browser Kernel: Endpoint {0} validated. CDP connection not yet implemented.",
        args: [summarizeEndpointForDisplay(validation.endpoint)],
        comment: [
          "{0} is the redacted or loopback-safe endpoint summary shown to the user.",
        ],
      }),
    );
  } catch {
    // non-fatal: info message failed to display
  }
}

export function createDefaultConnectCommandRuntime(
  vscodeApi: typeof vscode,
): ConnectCommandRuntime {
  return {
    readAndValidate: () =>
      readAndValidateEndpointConfig(
        vscodeApi.workspace.getConfiguration("jupyterBrowserKernel"),
        vscodeApi.l10n.t,
      ),
    localize: vscodeApi.l10n.t,
    showInformationMessage: (message) =>
      vscodeApi.window.showInformationMessage(message),
    showErrorMessage: (message, action) =>
      vscodeApi.window.showErrorMessage(message, action),
    openSettings: (query) =>
      vscodeApi.commands.executeCommand("workbench.action.openSettings", query),
  };
}
