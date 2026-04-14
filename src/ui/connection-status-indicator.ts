import type * as vscode from "vscode";
import {
  readAndValidateEndpointConfig,
  summarizeEndpointForDisplay,
  type EndpointConfigurationReader,
  type Localize,
} from "../config/endpoint-config";
import type {
  ConnectionErrorContext,
  ConnectionState,
} from "../transport/connection-state";

function localizedLabel(state: ConnectionState, localize: Localize): string {
  switch (state) {
    case "disconnected":
      return localize("Disconnected");
    case "connecting":
      return localize("Connecting");
    case "connected":
      return localize("Connected");
    case "error":
      return localize("Error");
  }
}

export interface ConnectionStatusIndicator extends vscode.Disposable {
  setState: (state: ConnectionState) => void;
  setErrorContext: (context: ConnectionErrorContext | undefined) => void;
}

export type ConnectionStatusBarItemLike = Pick<
  vscode.StatusBarItem,
  | "text"
  | "tooltip"
  | "command"
  | "backgroundColor"
  | "name"
  | "show"
  | "dispose"
>;

export type ConnectionStatusIndicatorVscodeApi = {
  l10n: Pick<typeof vscode.l10n, "t">;
  workspace: {
    getConfiguration: (section: string) => EndpointConfigurationReader;
  };
  window: {
    createStatusBarItem: {
      (
        id: string,
        alignment?: vscode.StatusBarAlignment,
        priority?: number,
      ): ConnectionStatusBarItemLike;
      (
        alignment?: vscode.StatusBarAlignment,
        priority?: number,
      ): ConnectionStatusBarItemLike;
    };
  };
  StatusBarAlignment: Pick<typeof vscode.StatusBarAlignment, "Left">;
  ThemeColor: typeof vscode.ThemeColor;
};

/** Compile-time gate: the real vscode namespace must remain assignable to this facade. */
type _AssertVscodeCompat<_T extends ConnectionStatusIndicatorVscodeApi> = true;
type _VscodeApiCheck = _AssertVscodeCompat<typeof vscode>;

export function createConnectionStatusIndicator(
  vscodeApi: ConnectionStatusIndicatorVscodeApi,
): ConnectionStatusIndicator {
  const localize = vscodeApi.l10n.t;
  const endpointConfig = vscodeApi.workspace.getConfiguration(
    "jupyterBrowserKernel",
  ) as EndpointConfigurationReader;
  const statusBarItem = vscodeApi.window.createStatusBarItem(
    vscodeApi.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.name = "Jupyter Browser Kernel Connection Status";
  let currentState: ConnectionState = "disconnected";
  let currentErrorContext: ConnectionErrorContext | undefined;

  const endpointSummary = (): string => {
    const validation = readAndValidateEndpointConfig(endpointConfig, localize);
    if (!validation.ok) {
      return localize("Endpoint unavailable (check settings).");
    }

    return summarizeEndpointForDisplay(validation.endpoint);
  };

  const tooltipForState = (state: ConnectionState): string => {
    const summary = endpointSummary();

    switch (state) {
      case "disconnected":
        return localize({
          message: "Disconnected. Click to reconnect. Endpoint: {0}.",
          args: [summary],
          comment: ["{0} is the redacted endpoint summary."],
        });
      case "connecting":
        return localize("Connecting. Connection attempt in progress...");
      case "connected":
        return localize({
          message: "Connected to browser target. Endpoint: {0}.",
          args: [summary],
          comment: ["{0} is the redacted endpoint summary."],
        });
      case "error":
        if (currentErrorContext) {
          return localize({
            message: "Error ({0}). {1}",
            args: [currentErrorContext.category, currentErrorContext.guidance],
            comment: [
              "{0} is the normalized failure category.",
              "{1} is actionable recovery guidance.",
            ],
          });
        }

        return localize("Error. Run Reconnect command or check settings.");
    }
  };

  const setState = (state: ConnectionState): void => {
    currentState = state;
    const label = localizedLabel(state, localize);
    statusBarItem.text = `Jupyter Browser: ${label}`;
    statusBarItem.command =
      state === "disconnected" || state === "error"
        ? "jupyterBrowserKernel.reconnect"
        : state === "connected"
          ? "jupyterBrowserKernel.disconnect"
          : undefined;
    statusBarItem.tooltip = tooltipForState(state);
    statusBarItem.backgroundColor =
      state === "error"
        ? new vscodeApi.ThemeColor("statusBarItem.errorBackground")
        : undefined;
    statusBarItem.show();
  };

  const setErrorContext = (
    context: ConnectionErrorContext | undefined,
  ): void => {
    currentErrorContext = context;
    if (currentState === "error") {
      statusBarItem.tooltip = tooltipForState("error");
    }
  };

  setState("disconnected");

  return {
    setState,
    setErrorContext,
    dispose: () => statusBarItem.dispose(),
  };
}
