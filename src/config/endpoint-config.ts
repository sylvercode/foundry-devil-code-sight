import type * as vscode from "vscode";

export const CDP_PORT_MIN = 1;
export const CDP_PORT_MAX = 65535;

export type Localize = typeof vscode.l10n.t;

export type EndpointValidationField = "host" | "port";

export interface EndpointConfig {
  host: string;
  port: number;
}

export interface EndpointConfigurationReader {
  get<T>(section: string, defaultValue: T): T;
}

export interface EndpointValidationError {
  field: EndpointValidationField;
  message: string;
  correctiveAction: string;
}

export type EndpointValidationResult =
  | { ok: true; endpoint: EndpointConfig }
  | { ok: false; error: EndpointValidationError };

const defaultLocalize = ((
  messageOrOptions: string | { message: string },
): string =>
  typeof messageOrOptions === "string"
    ? messageOrOptions
    : messageOrOptions.message) as Localize;

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function readEndpointConfig(
  config: EndpointConfigurationReader,
): EndpointConfig {
  const host = String(config.get<string>("cdpHost", "localhost") ?? "").trim();
  const port = Number(config.get<number>("cdpPort", 9222));

  return { host, port };
}

export function validateEndpointConfig(
  endpoint: EndpointConfig,
  localize: Localize = defaultLocalize,
): EndpointValidationResult {
  if (endpoint.host.trim().length === 0) {
    return {
      ok: false,
      error: {
        field: "host",
        message: localize("Invalid CDP host: host cannot be empty."),
        correctiveAction: localize(
          "Set jupyterBrowserKernel.cdpHost to a hostname or IP address, for example localhost.",
        ),
      },
    };
  }

  if (
    !Number.isInteger(endpoint.port) ||
    endpoint.port < CDP_PORT_MIN ||
    endpoint.port > CDP_PORT_MAX
  ) {
    return {
      ok: false,
      error: {
        field: "port",
        message: localize(
          "Invalid CDP port: port must be an integer between 1 and 65535.",
        ),
        correctiveAction: localize(
          "Set jupyterBrowserKernel.cdpPort to a whole number between 1 and 65535.",
        ),
      },
    };
  }

  return {
    ok: true,
    endpoint: {
      host: endpoint.host.trim(),
      port: endpoint.port,
    },
  };
}

export function readAndValidateEndpointConfig(
  config: EndpointConfigurationReader,
  localize?: Localize,
): EndpointValidationResult {
  return validateEndpointConfig(readEndpointConfig(config), localize);
}

export function summarizeEndpointForDisplay(endpoint: EndpointConfig): string {
  const host = isLoopbackHost(endpoint.host)
    ? endpoint.host
    : "[redacted-host]";
  return `${host}:${endpoint.port}`;
}
