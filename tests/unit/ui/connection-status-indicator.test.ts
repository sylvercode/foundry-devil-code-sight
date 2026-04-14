import test from "node:test";
import assert from "node:assert/strict";

import {
  ConnectionStatusBarItemLike,
  createConnectionStatusIndicator,
  type ConnectionStatusIndicatorVscodeApi,
} from "../../../src/ui/connection-status-indicator";
import type { Localize } from "../../../src/config/endpoint-config";

type StatusBarMock = ConnectionStatusBarItemLike & {
  showCalls: number;
  disposed: boolean;
};

function tooltipText(item: StatusBarMock): string {
  assert.equal(typeof item.tooltip, "string");
  return item.tooltip as string;
}

function createVscodeMock(config: { host: string; port: number }): {
  vscodeMock: ConnectionStatusIndicatorVscodeApi;
  statusBarItem: StatusBarMock;
} {
  const statusBarItem: StatusBarMock = {
    text: "",
    tooltip: "",
    command: undefined,
    backgroundColor: undefined,
    name: "",
    showCalls: 0,
    disposed: false,
    show: () => {
      statusBarItem.showCalls += 1;
    },
    dispose: () => {
      statusBarItem.disposed = true;
    },
  };

  const localizeMock: Localize = (
    messageOrOptions: unknown,
    ...args: unknown[]
  ): string => {
    if (typeof messageOrOptions === "string") {
      if (
        args.length === 1 &&
        typeof args[0] === "object" &&
        args[0] !== null
      ) {
        const named = args[0] as Record<string, string | number | boolean>;
        let rendered = messageOrOptions;
        for (const [key, value] of Object.entries(named)) {
          rendered = rendered.replace(`{${key}}`, String(value));
        }
        return rendered;
      }

      let rendered = messageOrOptions;
      for (const [index, value] of args.entries()) {
        rendered = rendered.replace(`{${index}}`, String(value));
      }
      return rendered;
    }

    const opts = messageOrOptions as {
      message: string;
      args?:
        | (string | number | boolean)[]
        | Record<string, string | number | boolean>;
    };
    let rendered = opts.message;
    if (Array.isArray(opts.args)) {
      for (const [index, value] of opts.args.entries()) {
        rendered = rendered.replace(`{${index}}`, String(value));
      }
      return rendered;
    }

    if (opts.args && typeof opts.args === "object") {
      for (const [key, value] of Object.entries(opts.args)) {
        rendered = rendered.replace(`{${key}}`, String(value));
      }
    }

    return rendered;
  };

  const vscodeMock: ConnectionStatusIndicatorVscodeApi = {
    l10n: {
      t: localizeMock,
    },
    workspace: {
      getConfiguration: () => ({
        get: <T>(section: string, defaultValue: T): T => {
          if (section === "cdpHost") {
            return config.host as T;
          }

          if (section === "cdpPort") {
            return config.port as T;
          }

          return defaultValue;
        },
      }),
    },
    window: {
      createStatusBarItem: () => statusBarItem,
    },
    StatusBarAlignment: {
      Left: 1,
    },
    ThemeColor: class ThemeColor {
      public readonly id: string;

      public constructor(id: string) {
        this.id = id;
      }
    },
  };

  return {
    vscodeMock,
    statusBarItem,
  };
}

test("status indicator assigns reconnect command for disconnected and error states", () => {
  const { vscodeMock, statusBarItem } = createVscodeMock({
    host: "localhost",
    port: 9222,
  });
  const indicator = createConnectionStatusIndicator(vscodeMock);

  indicator.setState("disconnected");
  assert.equal(statusBarItem.command, "jupyterBrowserKernel.reconnect");

  indicator.setState("error");
  assert.equal(statusBarItem.command, "jupyterBrowserKernel.reconnect");

  indicator.dispose();
});

test("status indicator clears command for connecting state", () => {
  const { vscodeMock, statusBarItem } = createVscodeMock({
    host: "localhost",
    port: 9222,
  });
  const indicator = createConnectionStatusIndicator(vscodeMock);

  indicator.setState("connecting");
  assert.equal(statusBarItem.command, undefined);

  indicator.dispose();
});

test("status indicator assigns disconnect command for connected state", () => {
  const { vscodeMock, statusBarItem } = createVscodeMock({
    host: "localhost",
    port: 9222,
  });
  const indicator = createConnectionStatusIndicator(vscodeMock);

  indicator.setState("connected");
  assert.equal(statusBarItem.command, "jupyterBrowserKernel.disconnect");

  indicator.dispose();
});

test("status indicator renders state-aware tooltips", () => {
  const { vscodeMock, statusBarItem } = createVscodeMock({
    host: "localhost",
    port: 9222,
  });
  const indicator = createConnectionStatusIndicator(vscodeMock);

  indicator.setState("disconnected");
  assert.match(tooltipText(statusBarItem), /Click to reconnect/);

  indicator.setState("connecting");
  assert.match(tooltipText(statusBarItem), /Connection attempt in progress/);

  indicator.setState("connected");
  assert.match(tooltipText(statusBarItem), /Connected to browser target/);

  indicator.dispose();
});

test("status indicator applies semantic error background only in error state", () => {
  const { vscodeMock, statusBarItem } = createVscodeMock({
    host: "localhost",
    port: 9222,
  });
  const indicator = createConnectionStatusIndicator(vscodeMock);

  indicator.setState("error");
  assert.equal(
    statusBarItem.backgroundColor?.id,
    "statusBarItem.errorBackground",
  );

  indicator.setState("connected");
  assert.equal(statusBarItem.backgroundColor, undefined);

  indicator.dispose();
});

test("status indicator uses error context when set and falls back to generic guidance when cleared", () => {
  const { vscodeMock, statusBarItem } = createVscodeMock({
    host: "localhost",
    port: 9222,
  });
  const indicator = createConnectionStatusIndicator(vscodeMock);

  indicator.setErrorContext({
    category: "endpoint-connectivity",
    guidance: "Confirm browser remote debugging port and retry reconnect.",
  });
  indicator.setState("error");

  assert.match(tooltipText(statusBarItem), /endpoint-connectivity/);
  assert.match(tooltipText(statusBarItem), /retry reconnect/);

  indicator.setErrorContext(undefined);
  indicator.setState("error");

  assert.match(
    tooltipText(statusBarItem),
    /Run Reconnect command or check settings/,
  );

  indicator.dispose();
});

test("status indicator refreshes error tooltip when error context changes while already in error state", () => {
  const { vscodeMock, statusBarItem } = createVscodeMock({
    host: "localhost",
    port: 9222,
  });
  const indicator = createConnectionStatusIndicator(vscodeMock);

  indicator.setState("error");
  assert.match(
    tooltipText(statusBarItem),
    /Run Reconnect command or check settings/,
  );

  indicator.setErrorContext({
    category: "endpoint-connectivity",
    guidance: "Confirm browser remote debugging port and retry reconnect.",
  });

  assert.match(tooltipText(statusBarItem), /endpoint-connectivity/);
  assert.match(tooltipText(statusBarItem), /retry reconnect/);

  indicator.dispose();
});
