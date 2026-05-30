import test, { after, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import CDP from "chrome-remote-interface";
import type { DebugProtocol } from "@vscode/debugprotocol";

import {
  connectToBrowserTarget,
  disconnectActiveBrowserConnection,
  getActiveBrowserConnection,
} from "../../../src/transport/browser-connect.js";
import { coreTargetProfile } from "../../../src/profile/core-target-profile.js";
import { createDebugSessionManager } from "../../../src/debugger/debug-session-manager.js";
import { NotebookDebugAdapter } from "../../../src/debugger/notebook-dap-adapter.js";
import { startHeadlessChromium } from "../helpers/headless-chromium.js";

const runIntegration = process.env.RUN_CDP_INTEGRATION === "1";
const host = process.env.CDP_HOST ?? "127.0.0.1";
const sharedCdpPort = Number(process.env.CDP_PORT ?? "9222");
const cdpPort = Number(process.env.CDP_BREAKPOINT_PORT ?? sharedCdpPort + 10);
const appPort = Number(process.env.CDP_APP_PORT ?? "9322");
const breakpointAppPort = appPort + 1;

let chromiumStop: (() => Promise<void>) | undefined;
let appServer: http.Server | undefined;

before(async () => {
  if (!runIntegration) {
    return;
  }

  const chromium = await startHeadlessChromium(host, cdpPort);
  chromiumStop = chromium.stop;

  appServer = http.createServer((request, response) => {
    if (request.url === "/game") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html><body>foundry-target</body></html>");
      return;
    }

    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html><body>generic-target</body></html>");
  });

  await new Promise<void>((resolve, reject) => {
    appServer?.once("error", reject);
    appServer?.listen(breakpointAppPort, host, () => {
      resolve();
    });
  });

  const browser = await CDP({ host, port: cdpPort });
  await browser.Target.createTarget({
    url: `http://${host}:${breakpointAppPort}/game`,
  });
  await browser.close();
});

after(async () => {
  await disconnectActiveBrowserConnection();

  if (chromiumStop) {
    await chromiumStop();
  }

  await new Promise<void>((resolve) => {
    if (!appServer) {
      resolve();
      return;
    }

    appServer.close(() => {
      resolve();
    });
  });
});

afterEach(async () => {
  await disconnectActiveBrowserConnection();
});

async function createRequestSender(adapter: NotebookDebugAdapter) {
  const messages: DebugProtocol.ProtocolMessage[] = [];
  adapter.onDidSendMessage((message) => {
    messages.push(message as DebugProtocol.ProtocolMessage);
  });

  let seq = 0;
  return async (
    command: string,
    args?: Record<string, unknown>,
  ): Promise<DebugProtocol.Response> => {
    seq += 1;
    const requestSeq = seq;

    const request: DebugProtocol.Request = {
      seq: requestSeq,
      type: "request",
      command,
      arguments: args,
    };

    adapter.handleMessage(request);

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const response = messages.find((message) => {
        if (message.type !== "response") {
          return false;
        }

        const typed = message as DebugProtocol.Response;
        return typed.request_seq === requestSeq;
      }) as DebugProtocol.Response | undefined;

      if (response) {
        return response;
      }

      await delay(25);
    }

    throw new Error(`No response for ${command}`);
  };
}

test(
  "setBreakpoints binds by cell URL and survives rerun without re-issuing",
  { skip: !runIntegration },
  async () => {
    let adapter: NotebookDebugAdapter | undefined;

    try {
      const connected = await connectToBrowserTarget(
        { host, port: cdpPort },
        coreTargetProfile,
      );
      assert.equal(connected.ok, true);
      if (!connected.ok) {
        return;
      }

      const activeConnection = getActiveBrowserConnection();
      assert.ok(activeConnection);
      if (!activeConnection) {
        return;
      }

      const manager = createDebugSessionManager({
        getDebuggerSession: () => activeConnection.debugger,
        logger: () => undefined,
      });

      adapter = new NotebookDebugAdapter({ sessionManager: manager });
      const request = await createRequestSender(adapter);

      const initializeResponse = await request("initialize", {
        adapterID: "jupyter-browser-kernel",
        pathFormat: "path",
      });
      assert.equal(initializeResponse.success, true);

      const launchResponse = await request("launch", {});
      assert.equal(launchResponse.success, true);

      const pauseSubscription = activeConnection.debugger.onPaused(() => {
        void activeConnection.debugger.resume();
      });

      const cellUrl = "vscode-notebook-cell://test/cell-1.js";
      const expression = [
        "(() => {",
        "  const base = 1;",
        "  const value = base + 1;",
        "  return value;",
        "})();",
        `//# sourceURL=${cellUrl}`,
      ].join("\n");

      await activeConnection.evaluate(expression);

      const setBreakpointsResponse = await request("setBreakpoints", {
        source: {
          path: cellUrl,
          name: "Cell 1",
        },
        breakpoints: [
          {
            line: 3,
          },
        ],
      });
      assert.equal(setBreakpointsResponse.success, true);

      await activeConnection.evaluate(expression);
      await activeConnection.evaluate(expression);

      pauseSubscription.dispose();

      const disconnectResponse = await request("disconnect", {});
      assert.equal(disconnectResponse.success, true);
    } finally {
      adapter?.dispose();
      await disconnectActiveBrowserConnection();
    }
  },
);
