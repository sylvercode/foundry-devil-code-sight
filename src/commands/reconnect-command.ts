import type * as vscode from "vscode";
import {
  readAndValidateEndpointConfig,
  summarizeEndpointForDisplay,
} from "../config/endpoint-config";
import {
  connectToBrowserTarget,
  disconnectActiveBrowserConnection,
} from "../transport/browser-connect";
import {
  showConnectOutcome,
  showEndpointValidationSettingsPrompt,
} from "./connect-command";
import {
  DisconnectCommandRuntime,
  DisconnectCommandRuntimeOptions,
} from "./disconnect-command";
import {
  ConnectCommandRuntime,
  ConnectCommandRuntimeOptions,
  runConnect,
} from "./connect-command";

export interface ReconnectCommandRuntime
  extends ConnectCommandRuntime, DisconnectCommandRuntime {}

export interface ReconnectCommandRuntimeOptions
  extends ConnectCommandRuntimeOptions, DisconnectCommandRuntimeOptions {}

export async function executeReconnectCommand(
  runtime: ReconnectCommandRuntime,
): Promise<void> {
  const validation = runtime.readAndValidate();

  if (!validation.ok) {
    await showEndpointValidationSettingsPrompt(runtime, validation);
    return;
  }

  runtime.cancelInFlightTransitions();
  await runtime.disconnectActiveConnection();

  const endpointSummary = summarizeEndpointForDisplay(validation.endpoint);
  const { aborted, connectResult } = await runConnect(
    runtime,
    validation.endpoint,
  );

  if (aborted) {
    return;
  }

  await showConnectOutcome(
    runtime,
    connectResult,
    endpointSummary,
    "Jupyter Browser Kernel: Reconnected to target {0} at {1}.",
  );
}

export function createDefaultReconnectCommandRuntime(
  vscodeApi: typeof vscode,
  options: ReconnectCommandRuntimeOptions,
): ReconnectCommandRuntime {
  const connectionStateStore = options.connectionStateStore;

  return {
    readAndValidate: () =>
      readAndValidateEndpointConfig(
        vscodeApi.workspace.getConfiguration("jupyterBrowserKernel"),
        vscodeApi.l10n.t,
      ),
    localize: vscodeApi.l10n.t,
    connectionStateStore,
    cancelInFlightTransitions: () => {
      connectionStateStore.cancelTransitions();
    },
    connectToTarget:
      options.connectToTarget ??
      ((endpoint, localize) =>
        connectToBrowserTarget(endpoint, undefined, localize)),
    disconnectActiveConnection:
      options.disconnectActiveConnection ?? disconnectActiveBrowserConnection,
    showInformationMessage: (message) =>
      vscodeApi.window.showInformationMessage(message),
    showErrorMessage: (message, action) =>
      vscodeApi.window.showErrorMessage(message, action),
    openSettings: (query) =>
      vscodeApi.commands.executeCommand("workbench.action.openSettings", query),
  };
}
