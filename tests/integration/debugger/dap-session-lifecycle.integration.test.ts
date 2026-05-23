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
  type BrowserDebuggerSession,
} from "../../../src/transport/browser-connect.js";
import { coreTargetProfile } from "../../../src/profile/core-target-profile.js";
import { startHeadlessChromium } from "../helpers/headless-chromium.js";
import { createDebugSessionManager } from "../../../src/debugger/debug-session-manager.js";
import { NotebookDebugAdapter } from "../../../src/debugger/notebook-dap-adapter.js";

const runIntegration = process.env.RUN_CDP_INTEGRATION === "1";
const host = process.env.CDP_HOST ?? "127.0.0.1";
const cdpPort = Number(process.env.CDP_PORT ?? "9222");
const appPort = Number(process.env.CDP_APP_PORT ?? "9322");

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
    appServer?.listen(appPort, host, () => {
      resolve();
    });
  });

  const browser = await CDP({ host, port: cdpPort });
  await browser.Target.createTarget({ url: `http://${host}:${appPort}/game` });
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

test(
  "DAP lifecycle initialize->launch->threads->disconnect enables and disables Debugger",
  { skip: !runIntegration },
  async () => {
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

    const baseSession = activeConnection.debugger;
    let enableCalls = 0;
    let disableCalls = 0;
    let pausedListenerCount = 0;

    const instrumentedSession: BrowserDebuggerSession = {
      ...baseSession,
      enable: async () => {
        enableCalls += 1;
        await baseSession.enable();
      },
      disable: async () => {
        disableCalls += 1;
        await baseSession.disable();
      },
      onPaused: (listener) => {
        pausedListenerCount += 1;
        const subscription = baseSession.onPaused(listener);
        return {
          dispose: () => {
            pausedListenerCount -= 1;
            subscription.dispose();
          },
        };
      },
    };

    const manager = createDebugSessionManager({
      getDebuggerSession: () => instrumentedSession,
      logger: () => undefined,
    });

    const adapter = new NotebookDebugAdapter({
      sessionManager: manager,
    });

    const messages: DebugProtocol.ProtocolMessage[] = [];
    adapter.onDidSendMessage((message) => {
      messages.push(message as DebugProtocol.ProtocolMessage);
    });

    let seq = 0;
    const request = async (
      command: string,
      args?: Record<string, unknown>,
    ): Promise<DebugProtocol.Response> => {
      seq += 1;
      const requestSeq = seq;

      const dapRequest: DebugProtocol.Request = {
        seq: requestSeq,
        type: "request",
        command,
        arguments: args,
      };

      adapter.handleMessage(dapRequest);

      for (let waitStep = 0; waitStep < 120; waitStep += 1) {
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

    const initializeResponse = await request("initialize", {
      adapterID: "jupyter-browser-kernel",
      pathFormat: "path",
    });
    assert.equal(initializeResponse.success, true);

    const launchResponse = await request("launch", {});
    assert.equal(launchResponse.success, true);

    const threadsResponse = await request("threads", {});
    assert.equal(threadsResponse.success, true);

    const disconnectResponse = await request("disconnect", {});
    assert.equal(disconnectResponse.success, true);

    const initializedEvents = messages.filter(
      (message) =>
        message.type === "event" &&
        (message as DebugProtocol.Event).event === "initialized",
    );

    assert.equal(initializedEvents.length >= 1, true);
    assert.equal(enableCalls, 1);
    assert.equal(disableCalls, 1);
    assert.equal(pausedListenerCount, 0);

    adapter.dispose();
  },
);
