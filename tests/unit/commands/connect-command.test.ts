import test from "node:test";
import assert from "node:assert/strict";

import {
  executeConnectCommand,
  type ConnectCommandRuntime,
} from "../../../src/commands/connect-command";

function format(
  message: string,
  ...args: Array<string | number | boolean>
): string;
function format(
  message: string,
  args: Record<string, string | number | boolean>,
): string;
function format(options: {
  message: string;
  args?:
    | Array<string | number | boolean>
    | Record<string, string | number | boolean>;
  comment: string | string[];
}): string;
function format(
  messageOrOptions:
    | string
    | {
        message: string;
        args?:
          | Array<string | number | boolean>
          | Record<string, string | number | boolean>;
        comment: string | string[];
      },
  ...args: Array<
    string | number | boolean | Record<string, string | number | boolean>
  >
): string {
  if (typeof messageOrOptions !== "string") {
    if (!messageOrOptions.args || Array.isArray(messageOrOptions.args)) {
      const resolvedArgs = messageOrOptions.args ?? [];
      return format(messageOrOptions.message, ...resolvedArgs);
    }

    return format(messageOrOptions.message, messageOrOptions.args);
  }

  if (
    args.length === 1 &&
    typeof args[0] === "object" &&
    !Array.isArray(args[0])
  ) {
    const namedArgs = args[0] as Record<string, string | number | boolean>;
    return messageOrOptions.replace(/\{([^}]+)\}/g, (_match, key: string) => {
      const resolved = namedArgs[key];
      return resolved === undefined ? "" : String(resolved);
    });
  }

  return messageOrOptions.replace(/\{(\d+)\}/g, (_match, index: string) => {
    const resolved = args[Number(index)];
    return resolved === undefined ? "" : String(resolved);
  });
}

function createRuntime(
  overrides: Partial<ConnectCommandRuntime>,
): ConnectCommandRuntime {
  return {
    readAndValidate: () => ({
      ok: true,
      endpoint: { host: "localhost", port: 9222 },
    }),
    localize: format,
    showInformationMessage: () => undefined,
    showErrorMessage: () => undefined,
    openSettings: () => undefined,
    ...overrides,
  };
}

test("executeConnectCommand uses persisted endpoint values on success", async () => {
  const infoMessages: string[] = [];
  const runtime = createRuntime({
    readAndValidate: () => ({
      ok: true,
      endpoint: { host: "127.0.0.1", port: 9333 },
    }),
    showInformationMessage: (message) => {
      infoMessages.push(message);
      return undefined;
    },
  });

  await executeConnectCommand(runtime);

  assert.equal(infoMessages.length, 1);
  assert.match(infoMessages[0], /127\.0\.0\.1:9333/);
});

test("executeConnectCommand blocks invalid endpoint and offers actionable settings path", async () => {
  const errorMessages: string[] = [];
  const openedSettings: string[] = [];

  const runtime = createRuntime({
    readAndValidate: () => ({
      ok: false,
      error: {
        field: "port",
        message:
          "Invalid CDP port: port must be an integer between 1 and 65535.",
        correctiveAction:
          "Set jupyterBrowserKernel.cdpPort to a whole number between 1 and 65535.",
      },
    }),
    showErrorMessage: (message, action) => {
      errorMessages.push(message);
      return action;
    },
    openSettings: (query) => {
      openedSettings.push(query);
      return undefined;
    },
    showInformationMessage: () => {
      throw new Error(
        "showInformationMessage should not be called when config is invalid",
      );
    },
  });

  await executeConnectCommand(runtime);

  assert.equal(errorMessages.length, 1);
  assert.match(errorMessages[0], /jupyterBrowserKernel\.cdpPort/);
  assert.deepEqual(openedSettings, ["jupyterBrowserKernel.cdpPort"]);
});
