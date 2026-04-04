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
  ) => PromiseLike<unknown> | Promise<unknown> | unknown;
  showErrorMessage: (
    message: string,
    action: string,
  ) =>
    | PromiseLike<string | undefined>
    | Promise<string | undefined>
    | string
    | undefined;
  openSettings: (
    query: string,
  ) => PromiseLike<unknown> | Promise<unknown> | unknown;
}

export async function executeConnectCommand(
  runtime: ConnectCommandRuntime,
): Promise<void> {
  const validation = runtime.readAndValidate();

  if (!validation.ok) {
    const action = runtime.localize("Open Settings");
    const selection = await runtime.showErrorMessage(
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

    if (selection === action) {
      await runtime.openSettings(
        `jupyterBrowserKernel.${validation.error.field === "host" ? "cdpHost" : "cdpPort"}`,
      );
    }

    return;
  }

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
}

export function createDefaultConnectCommandRuntime(vscodeApi: {
  workspace: {
    getConfiguration: (section: string) => {
      get<T>(section: string, defaultValue: T): T;
    };
  };
  window: {
    showInformationMessage: (
      message: string,
    ) => PromiseLike<unknown> | Promise<unknown> | unknown;
    showErrorMessage: (
      message: string,
      action: string,
    ) =>
      | PromiseLike<string | undefined>
      | Promise<string | undefined>
      | string
      | undefined;
  };
  l10n: {
    t: Localize;
  };
  commands: {
    executeCommand: (
      command: string,
      query?: string,
    ) => PromiseLike<unknown> | Promise<unknown> | unknown;
  };
}): ConnectCommandRuntime {
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
