import test from "node:test";
import assert from "node:assert/strict";
import { t as localize } from "@vscode/l10n";

import {
  executeConnectCommand,
  type ConnectCommandRuntime,
} from "../../../src/commands/connect-command";

function createRuntime(
  overrides: Partial<ConnectCommandRuntime>,
): ConnectCommandRuntime {
  return {
    readAndValidate: () => ({
      ok: true,
      endpoint: { host: "localhost", port: 9222 },
    }),
    localize: localize,
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

test("executeConnectCommand does not open settings when user dismisses error dialog", async () => {
  const openedSettings: string[] = [];

  const runtime = createRuntime({
    readAndValidate: () => ({
      ok: false,
      error: {
        field: "host",
        message: "Invalid CDP host: host cannot be empty.",
        correctiveAction:
          "Set jupyterBrowserKernel.cdpHost to a hostname or IP address, for example localhost.",
      },
    }),
    showErrorMessage: () => undefined, // user dismissed without clicking Open Settings
    openSettings: (query) => {
      openedSettings.push(query);
      return undefined;
    },
  });

  await executeConnectCommand(runtime);

  assert.deepEqual(openedSettings, []);
});

test("executeConnectCommand falls back to host settings key for unknown validation field", async () => {
  const openedSettings: string[] = [];

  const runtime = createRuntime({
    readAndValidate: () => ({
      ok: false,
      error: {
        field: "future-field" as never,
        message: "Invalid endpoint field.",
        correctiveAction: "Update endpoint settings.",
      },
    }),
    showErrorMessage: (_message, action) => action,
    openSettings: (query) => {
      openedSettings.push(query);
      return undefined;
    },
  });

  await executeConnectCommand(runtime);

  assert.deepEqual(openedSettings, ["jupyterBrowserKernel.cdpHost"]);
});
