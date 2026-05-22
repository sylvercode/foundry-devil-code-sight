import type * as vscode from "vscode";

import type { Localize } from "../config/endpoint-config";

export interface DebugConfigProviderOptions {
  localize?: Localize;
}

const defaultLocalize = ((messageOrOptions: string | { message: string }) =>
  typeof messageOrOptions === "string"
    ? messageOrOptions
    : messageOrOptions.message) as Localize;

export class DebugConfigProvider implements vscode.DebugConfigurationProvider {
  private readonly localize: Localize;

  public constructor(options: DebugConfigProviderOptions = {}) {
    this.localize = options.localize ?? defaultLocalize;
  }

  public resolveDebugConfiguration(
    _folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    if (config.type && config.type !== "jupyter-browser-kernel") {
      return config;
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
