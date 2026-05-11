import test, { after, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import CDP from "chrome-remote-interface";

import {
  connectToBrowserTarget,
  disconnectActiveBrowserConnection,
  getActiveBrowserConnection,
} from "../../../src/transport/browser-connect.js";
import { coreTargetProfile } from "../../../src/profile/core-target-profile.js";
import { buildCellExpression } from "../../../src/kernel/build-cell-expression.js";
import { startHeadlessChromium } from "../helpers/headless-chromium.js";

const runIntegration = process.env.RUN_CDP_INTEGRATION === "1";
const host = process.env.CDP_HOST ?? "127.0.0.1";
const cdpPort = Number(process.env.CDP_FAST_RERUN_TEST_PORT ?? "9242");
const appPort = Number(process.env.CDP_FAST_RERUN_TEST_APP_PORT ?? "9342");

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
    appServer?.listen(appPort, host, () => resolve());
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
  "fast rerun keeps active connection and stable sourceURL identity",
  { skip: !runIntegration },
  async () => {
    const connected = await connectToBrowserTarget(
      { host, port: cdpPort },
      coreTargetProfile,
    );
    assert.equal(connected.ok, true);

    const connection = getActiveBrowserConnection();
    assert.ok(connection);

    const sameCellUri =
      "vscode-notebook-cell://test-authority/workspaces/foundry-devil-code-sight/tests/files/test1.ipynb#ch0000000002222";

    const firstExpression = buildCellExpression("2 + 3", sameCellUri, {
      isolate: false,
    });
    const secondExpression = buildCellExpression("2 + 3", sameCellUri, {
      isolate: false,
    });

    assert.equal(firstExpression, secondExpression);

    const firstRun = await connection?.evaluate(firstExpression);
    const secondRun = await connection?.evaluate(secondExpression);

    assert.equal(firstRun?.exceptionDetails, undefined);
    assert.equal(secondRun?.exceptionDetails, undefined);
    assert.equal(firstRun?.result?.value, 5);
    assert.equal(secondRun?.result?.value, 5);
    assert.equal(
      getActiveBrowserConnection()?.sessionId,
      connection?.sessionId,
    );
    assert.equal(getActiveBrowserConnection()?.targetId, connection?.targetId);
  },
);

test(
  "default cells accumulate state while isolated wrapper keeps lexical bindings local",
  { skip: !runIntegration },
  async () => {
    const connected = await connectToBrowserTarget(
      { host, port: cdpPort },
      coreTargetProfile,
    );
    assert.equal(connected.ok, true);

    const connection = getActiveBrowserConnection();
    assert.ok(connection);

    const uriA =
      "vscode-notebook-cell://test-authority/workspaces/foundry-devil-code-sight/tests/files/test1.ipynb#ch0000000003001";
    const uriB =
      "vscode-notebook-cell://test-authority/workspaces/foundry-devil-code-sight/tests/files/test1.ipynb#ch0000000003002";

    const assignShared = buildCellExpression(
      "globalThis.__story24 = 42",
      uriA,
      {
        isolate: false,
      },
    );
    const readShared = buildCellExpression("globalThis.__story24", uriB, {
      isolate: false,
    });

    const assignResult = await connection?.evaluate(assignShared);
    const readResult = await connection?.evaluate(readShared);

    assert.equal(assignResult?.exceptionDetails, undefined);
    assert.equal(readResult?.exceptionDetails, undefined);
    assert.equal(readResult?.result?.value, 42);

    const isolatedUri =
      "vscode-notebook-cell://test-authority/workspaces/foundry-devil-code-sight/tests/files/test1.ipynb#ch0000000003003";
    const isolatedExpression = buildCellExpression(
      "let hidden = 99; return hidden",
      isolatedUri,
      {
        isolate: true,
      },
    );
    assert.equal(isolatedExpression.startsWith("await (async()=>{"), true);

    const isolatedResult = await connection?.evaluate(isolatedExpression);
    assert.equal(isolatedResult?.exceptionDetails, undefined);
    assert.equal(isolatedResult?.result?.value, 99);

    const isolatedReturn = buildCellExpression("return 2 + 2", isolatedUri, {
      isolate: true,
    });
    const isolatedReturnResult = await connection?.evaluate(isolatedReturn);
    assert.equal(isolatedReturnResult?.exceptionDetails, undefined);
    assert.equal(isolatedReturnResult?.result?.value, 4);

    const leakProbe = buildCellExpression("typeof hidden", uriB, {
      isolate: false,
    });
    const leakProbeResult = await connection?.evaluate(leakProbe);
    assert.equal(leakProbeResult?.exceptionDetails, undefined);
    assert.equal(leakProbeResult?.result?.value, "undefined");
  },
);
