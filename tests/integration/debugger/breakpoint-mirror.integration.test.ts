import test, { after, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import CDP from "chrome-remote-interface";

import {
  connectToBrowserTarget,
  createAttachToTargetParams,
  disconnectActiveBrowserConnection,
  getActiveBrowserConnection,
  toSessionScopedEventName,
} from "../../../src/transport/browser-connect.js";
import { coreTargetProfile } from "../../../src/profile/core-target-profile.js";
import { startHeadlessChromium } from "../helpers/headless-chromium.js";
import { buildCellExpression } from "../../../src/kernel/build-cell-expression.js";
import { createBreakpointMirror } from "../../../src/debugger/breakpoint-mirror.js";

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
  "breakpoint mirror sync and auto-resume coexist with a second debugger session",
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

    const sourceUri = "vscode-notebook-cell://test-authority/test.ipynb#cell0";

    const debugApi = {
      breakpoints: [
        {
          id: "bp-1",
          enabled: true,
          location: {
            uri: {
              scheme: "vscode-notebook-cell",
              toString: () => sourceUri,
            },
            range: {
              start: {
                line: 0,
              },
            },
          },
        },
      ],
      onDidChangeBreakpoints: () => ({
        dispose: () => undefined,
      }),
    } as never;

    const mirror = createBreakpointMirror({
      debugApi,
      getDebuggerSession: () => getActiveBrowserConnection()?.debugger,
      logger: () => undefined,
    });

    const surrogateBrowser = await CDP({ host, port: cdpPort });
    const surrogateSession = await surrogateBrowser.Target.attachToTarget(
      createAttachToTargetParams(connected.connectedTarget.targetId),
    );

    try {
      await surrogateBrowser.send(
        "Debugger.enable",
        undefined,
        surrogateSession.sessionId,
      );

      await mirror.syncFromVsCode();

      let pausedCount = 0;
      const pausedOnSurrogate = new Promise<void>((resolve) => {
        surrogateBrowser.on(
          toSessionScopedEventName(
            "Debugger.paused",
            surrogateSession.sessionId,
          ),
          async (_event: { hitBreakpoints?: string[] }) => {
            pausedCount += 1;
            try {
              await surrogateBrowser.send(
                "Debugger.resume",
                undefined,
                surrogateSession.sessionId,
              );
            } catch {
              // Non-fatal for test cleanup.
            }

            resolve();
          },
        );
      });

      const expression = buildCellExpression(
        "globalThis.x = 1;\nawait Promise.resolve();\nglobalThis.x = 2;",
        sourceUri,
        { isolate: false },
      );

      const evaluated = activeConnection.evaluate(expression);
      const completion = Promise.race([
        evaluated,
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error("evaluation did not complete in time"));
          }, 3000);
        }),
      ]);

      await Promise.all([completion, pausedOnSurrogate]);

      const finalState = await activeConnection.evaluate("globalThis.x");
      assert.equal(finalState.result?.value, 2);
      assert.equal(pausedCount > 0, true);
    } finally {
      mirror.dispose();
      await surrogateBrowser.close();
    }
  },
);
