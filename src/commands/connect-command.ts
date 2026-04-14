import type * as vscode from "vscode";
import {
  type Localize,
  type EndpointConfig,
  type EndpointValidationResult,
  readAndValidateEndpointConfig,
  summarizeEndpointForDisplay,
} from "../config/endpoint-config";
import {
  ConnectionStoreHandler,
  withConnectTransition,
  type ConnectionStateStore,
} from "../transport/connection-state";
import {
  connectToBrowserTarget,
  disconnectActiveBrowserConnection,
} from "../transport/browser-connect";
import { formatConnectFailureMessage } from "../transport/connect-diagnostics";
import type {
  ConnectFailureCategory,
  ConnectToTargetOperation,
  ConnectToTargetResult,
} from "../transport/connect-types";

async function showSettingsPrompt(
  runtime: ConnectCommandRuntime,
  message: string,
  settingsKey: "cdpHost" | "cdpPort",
): Promise<void> {
  const action = runtime.localize("Open Settings");

  let selection: string | undefined;
  try {
    selection = await runtime.showErrorMessage(message, action);
  } catch {
    return;
  }

  if (selection !== action) {
    return;
  }

  try {
    await runtime.openSettings(`jupyterBrowserKernel.${settingsKey}`);
  } catch {
    // non-fatal: settings pane failed to open, nothing further to do
  }
}

function settingsKeyForEndpointFailure(
  validation: EndpointValidationResult,
): "cdpHost" | "cdpPort" {
  const settingsKeyByField: Record<string, "cdpHost" | "cdpPort"> = {
    host: "cdpHost",
    port: "cdpPort",
  };

  if (validation.ok) {
    return "cdpHost";
  }

  return settingsKeyByField[validation.error.field] ?? "cdpHost";
}

function settingsKeyForConnectFailure(
  category: ConnectFailureCategory,
): "cdpHost" | "cdpPort" {
  return category === "endpoint-connectivity" ? "cdpPort" : "cdpHost";
}

export interface ConnectCommandRuntime {
  readAndValidate: () => EndpointValidationResult;
  localize: Localize;
  connectionStateStore: ConnectionStateStore;
  connectToTarget: ConnectToTargetOperation;
  showInformationMessage: (
    message: string,
  ) => PromiseLike<string | undefined> | void;
  showErrorMessage: (
    message: string,
    action: string,
  ) => PromiseLike<string | undefined> | string | undefined;
  openSettings: (query: string) => PromiseLike<unknown> | void;
}

export interface ConnectCommandRuntimeOptions extends ConnectionStoreHandler {
  connectToTarget?: ConnectToTargetOperation;
}

export async function showEndpointValidationSettingsPrompt(
  runtime: ConnectCommandRuntime,
  validation: Extract<EndpointValidationResult, { ok: false }>,
): Promise<void> {
  await showSettingsPrompt(
    runtime,
    runtime.localize({
      message: "{0} {1}",
      args: [validation.error.message, validation.error.correctiveAction],
      comment: [
        "{0} is the validation failure message.",
        "{1} is the corrective action the user should take.",
      ],
    }),
    settingsKeyForEndpointFailure(validation),
  );
}

export async function showConnectOutcome(
  runtime: ConnectCommandRuntime,
  connectResult: ConnectToTargetResult,
  endpointSummary: string,
  successMessage: string,
): Promise<void> {
  if (!connectResult.ok) {
    const message = formatConnectFailureMessage(
      connectResult.failure,
      endpointSummary,
      runtime.localize,
    );

    runtime.connectionStateStore.setErrorContext({
      category: connectResult.failure.category,
      guidance: message,
    });

    const settingsKey = settingsKeyForConnectFailure(
      connectResult.failure.category,
    );
    await showSettingsPrompt(runtime, message, settingsKey);
    return;
  }

  runtime.connectionStateStore.setErrorContext(undefined);

  try {
    await runtime.showInformationMessage(
      runtime.localize({
        message: successMessage,
        args: [connectResult.connectedTarget.targetId, endpointSummary],
        comment: [
          "{0} is the connected target id.",
          "{1} is the redacted or loopback-safe endpoint summary shown to the user.",
        ],
      }),
    );
  } catch {
    // non-fatal: info message failed to display
  }
}

export async function runConnect(
  runtime: ConnectCommandRuntime,
  endpoint: EndpointConfig,
): Promise<{
  aborted: boolean;
  connectResult: ConnectToTargetResult;
}> {
  let aborted = false;

  try {
    const connectResult = await withConnectTransition(
      runtime.connectionStateStore,
      (abortSignal) =>
        runtime.connectToTarget(endpoint, runtime.localize, abortSignal),
      (result) => result.ok,
      () => {
        aborted = true;
      },
    );

    if (aborted && connectResult.ok) {
      try {
        await disconnectActiveBrowserConnection();
      } catch {
        // non-fatal: connect attempt was already aborted
      }
    }

    return {
      aborted,
      connectResult,
    };
  } catch (error) {
    if (!aborted) {
      throw error;
    }

    try {
      await disconnectActiveBrowserConnection();
    } catch {
      // non-fatal: connect attempt was already aborted
    }

    return {
      aborted: true,
      connectResult: {
        ok: false,
        endpoint,
        failure: {
          category: "transport-failure",
          message: runtime.localize("Connect attempt canceled."),
        },
      },
    };
  }
}

export async function executeConnectCommand(
  runtime: ConnectCommandRuntime,
): Promise<void> {
  if (runtime.connectionStateStore.getState() === "connecting") {
    return;
  }

  const validation = runtime.readAndValidate();

  if (!validation.ok) {
    await showEndpointValidationSettingsPrompt(runtime, validation);
    return;
  }

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
    "Jupyter Browser Kernel: Connected to target {0} at {1}.",
  );
}

export function createDefaultConnectCommandRuntime(
  vscodeApi: typeof vscode,
  options: ConnectCommandRuntimeOptions,
): ConnectCommandRuntime {
  return {
    readAndValidate: () =>
      readAndValidateEndpointConfig(
        vscodeApi.workspace.getConfiguration("jupyterBrowserKernel"),
        vscodeApi.l10n.t,
      ),
    localize: vscodeApi.l10n.t,
    connectionStateStore: options.connectionStateStore,
    connectToTarget:
      options.connectToTarget ??
      ((endpoint, localize, abortSignal) =>
        connectToBrowserTarget(endpoint, undefined, localize, abortSignal)),
    showInformationMessage: (message) =>
      vscodeApi.window.showInformationMessage(message),
    showErrorMessage: (message, action) =>
      vscodeApi.window.showErrorMessage(message, action),
    openSettings: (query) =>
      vscodeApi.commands.executeCommand("workbench.action.openSettings", query),
  };
}
