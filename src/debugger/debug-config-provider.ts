import type * as vscode from "vscode";

import {
  getActiveBrowserConnection,
  type ActiveBrowserConnection,
} from "../transport/browser-connect";
import type { Localize } from "../config/endpoint-config";

export type GetActiveBrowserConnection = () =>
  | ActiveBrowserConnection
  | undefined;

export interface DebugConfigProviderOptions {
  getActiveConnection?: GetActiveBrowserConnection;
  localize?: Localize;
}

const defaultLocalize = ((messageOrOptions: string | { message: string }) =>
  typeof messageOrOptions === "string"
    ? messageOrOptions
    : messageOrOptions.message) as Localize;

export class DebugConfigProvider implements vscode.DebugConfigurationProvider {
  private readonly getActiveConnection: GetActiveBrowserConnection;
  private readonly localize: Localize;

  public constructor(options: DebugConfigProviderOptions = {}) {
    this.getActiveConnection =
      options.getActiveConnection ?? getActiveBrowserConnection;
    this.localize = options.localize ?? defaultLocalize;
  }

  public resolveDebugConfiguration(
    _folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    if (config.type && config.type !== "jupyter-browser-kernel") {
      return config;
    }

    if (!this.getActiveConnection()) {
      throw new Error(
        this.localize(
          "Cannot start debug session: connect to a browser target first.",
        ),
      );
    }

    const resolvedConfig: vscode.DebugConfiguration = {
      ...config,
      type: "jupyter-browser-kernel",
      request:
        typeof config.request === "string" && config.request.length > 0
          ? config.request
          : "launch",
      name:
        typeof config.name === "string" && config.name.length > 0
          ? config.name
          : this.localize("Browser Kernel Debug"),
    };

    return resolvedConfig;
  }
}
