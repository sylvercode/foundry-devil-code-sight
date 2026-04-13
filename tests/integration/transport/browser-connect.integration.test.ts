import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import CDP from "chrome-remote-interface";

import {
  connectToBrowserTarget,
  createAttachToTargetParams,
  toSessionScopedEventName,
} from "../../../src/transport/browser-connect.js";
import { coreTargetProfile } from "../../../src/profile/core-target-profile.js";
import { startHeadlessChromium } from "../helpers/headless-chromium.js";

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
  await new Promise<void>((resolve) => {
    if (!appServer) {
      resolve();
      return;
    }

    appServer.close(() => {
      resolve();
    });
  });

  if (chromiumStop) {
    await chromiumStop();
  }
});

test(
  "connectToBrowserTarget (core profile) attaches to a page target in headless Chromium",
  { skip: !runIntegration },
  async () => {
    const result = await connectToBrowserTarget(
      { host, port: cdpPort },
      coreTargetProfile,
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(typeof result.connectedTarget.targetId, "string");
      assert.equal(typeof result.connectedTarget.sessionId, "string");
      assert.equal(result.connectedTarget.targetId.length > 0, true);
      assert.equal(result.connectedTarget.sessionId.length > 0, true);
    }
  },
);

test(
  "browser-level flat sessions allow concurrent attach and isolated session-scoped events",
  { skip: !runIntegration },
  async () => {
    const browser = await CDP({ host, port: cdpPort });

    try {
      const { targetInfos } = await browser.Target.getTargets();
      const pageTarget = targetInfos.find(
        (target) =>
          target.type === "page" &&
          typeof target.url === "string" &&
          target.url.includes("/game"),
      );

      assert.ok(pageTarget?.targetId);

      const sessionA = await browser.Target.attachToTarget(
        createAttachToTargetParams(pageTarget.targetId),
      );
      const sessionB = await browser.Target.attachToTarget(
        createAttachToTargetParams(pageTarget.targetId),
      );

      assert.notEqual(sessionA.sessionId, sessionB.sessionId);

      await browser.send("Runtime.enable", undefined, sessionA.sessionId);
      await browser.send("Runtime.enable", undefined, sessionB.sessionId);

      const eventsA: string[] = [];
      const eventsB: string[] = [];

      browser.on(
        toSessionScopedEventName(
          "Runtime.consoleAPICalled",
          sessionA.sessionId,
        ),
        (event: { args?: Array<{ value?: unknown }> }) => {
          const values = event.args
            ?.map((arg) => String(arg.value ?? ""))
            .join(" ");
          eventsA.push(values ?? "");
        },
      );

      browser.on(
        toSessionScopedEventName(
          "Runtime.consoleAPICalled",
          sessionB.sessionId,
        ),
        (event: { args?: Array<{ value?: unknown }> }) => {
          const values = event.args
            ?.map((arg) => String(arg.value ?? ""))
            .join(" ");
          eventsB.push(values ?? "");
        },
      );

      await browser.send(
        "Runtime.evaluate",
        {
          expression: "console.log('coexist-a'); 2 + 2;",
          awaitPromise: true,
          returnByValue: true,
        },
        sessionA.sessionId,
      );

      await browser.send(
        "Runtime.evaluate",
        {
          expression: "console.log('coexist-b'); 3 + 3;",
          awaitPromise: true,
          returnByValue: true,
        },
        sessionB.sessionId,
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      assert.ok(eventsA.some((entry) => entry.includes("coexist-a")));
      assert.ok(eventsB.some((entry) => entry.includes("coexist-b")));
    } finally {
      await browser.close();
    }
  },
);

test(
  "session-scoped event routing guardrail fails when flatten mode is omitted",
  { skip: !runIntegration },
  async () => {
    const browser = await CDP({ host, port: cdpPort });

    try {
      const { targetInfos } = await browser.Target.getTargets();
      const pageTarget = targetInfos.find(
        (target) =>
          target.type === "page" &&
          typeof target.url === "string" &&
          target.url.includes("/game"),
      );

      assert.ok(pageTarget?.targetId);

      // Intentionally omit flatten and verify flat session routing APIs fail,
      // proving that flatten mode is required for multiplexed session routing.
      const nestedSession = await browser.Target.attachToTarget({
        targetId: pageTarget.targetId,
      });

      await assert.rejects(
        async () => {
          await browser.send(
            "Runtime.enable",
            undefined,
            nestedSession.sessionId,
          );
        },
        (error: unknown) => {
          const message =
            typeof error === "object" && error !== null && "message" in error
              ? String((error as { message?: unknown }).message ?? "")
              : "";
          return /Session with given id not found/i.test(message);
        },
      );
    } finally {
      await browser.close();
    }
  },
);

test(
  "connectToBrowserTarget remains viable while an external DevTools-like session stays attached",
  { skip: !runIntegration },
  async () => {
    const externalBrowser = await CDP({ host, port: cdpPort });

    try {
      const { targetInfos } = await externalBrowser.Target.getTargets();
      const pageTarget = targetInfos.find(
        (target) =>
          target.type === "page" &&
          typeof target.url === "string" &&
          target.url.includes("/game"),
      );

      assert.ok(pageTarget?.targetId);

      const externalSession = await externalBrowser.Target.attachToTarget(
        createAttachToTargetParams(pageTarget.targetId),
      );

      const initial = await connectToBrowserTarget(
        { host, port: cdpPort },
        coreTargetProfile,
      );
      assert.equal(initial.ok, true);

      const reattached = await connectToBrowserTarget(
        { host, port: cdpPort },
        coreTargetProfile,
      );
      assert.equal(reattached.ok, true);

      const probe = await externalBrowser.send(
        "Runtime.evaluate",
        {
          expression: "1 + 7",
          awaitPromise: true,
          returnByValue: true,
        },
        externalSession.sessionId,
      );

      const value = (probe as { result?: { value?: unknown } }).result?.value;
      assert.equal(value, 8);
    } finally {
      await externalBrowser.close();
    }
  },
);
