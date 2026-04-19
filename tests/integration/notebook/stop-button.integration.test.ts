import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import CDP from "chrome-remote-interface";

import {
  connectToBrowserTarget,
  disconnectActiveBrowserConnection,
  getActiveBrowserConnection,
} from "../../../src/transport/browser-connect.js";
import { coreTargetProfile } from "../../../src/profile/core-target-profile.js";
import { registerKernelController } from "../../../src/notebook/kernel-controller.js";
import { createLocalizeMock } from "../../unit/test-utils/localize-mock.js";
import { startHeadlessChromium } from "../helpers/headless-chromium.js";

const runIntegration = process.env.RUN_CDP_INTEGRATION === "1";
const host = process.env.CDP_HOST ?? "127.0.0.1";
const cdpPort = Number(process.env.CDP_STOP_TEST_PORT ?? "9232");
const appPort = Number(process.env.CDP_STOP_TEST_APP_PORT ?? "9332");

let chromiumStop: (() => Promise<void>) | undefined;
let appServer: http.Server | undefined;

class FakeNotebookCellOutputItem {
  private constructor(
    public readonly kind: "text" | "error",
    public readonly value: string | Error,
    public readonly mime?: string,
  ) {}

  static text(value: string, mime: string): FakeNotebookCellOutputItem {
    return new FakeNotebookCellOutputItem("text", value, mime);
  }

  static error(error: Error): FakeNotebookCellOutputItem {
    return new FakeNotebookCellOutputItem("error", error);
  }
}

class FakeNotebookCellOutput {
  constructor(public readonly items: FakeNotebookCellOutputItem[]) {}
}

interface CancellationTokenLike {
  readonly isCancellationRequested: boolean;
  onCancellationRequested: (listener: () => void) => { dispose: () => void };
}

interface CancellationHarness {
  token: CancellationTokenLike;
  cancel: () => void;
}

interface RecordedExecution {
  started: boolean;
  ended: boolean;
  success?: boolean;
  outputs: FakeNotebookCellOutput[];
}

function createCancellationHarness(): CancellationHarness {
  let isCancellationRequested = false;
  const listeners = new Set<() => void>();

  return {
    token: {
      get isCancellationRequested(): boolean {
        return isCancellationRequested;
      },
      onCancellationRequested: (listener: () => void) => {
        if (isCancellationRequested) {
          queueMicrotask(listener);
          return {
            dispose: () => undefined,
          };
        }

        listeners.add(listener);
        return {
          dispose: () => {
            listeners.delete(listener);
          },
        };
      },
    },
    cancel: () => {
      isCancellationRequested = true;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

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
  "notebook stop cancellation terminates running cell and skips queued cells",
  { skip: !runIntegration },
  async () => {
    const connected = await connectToBrowserTarget(
      { host, port: cdpPort },
      coreTargetProfile,
    );

    assert.equal(connected.ok, true);

    const controller = registerKernelController({
      notebooks: {
        createNotebookController: () => ({ supportedLanguages: [] }) as never,
      },
      l10n: { t: createLocalizeMock() },
      NotebookCellOutput: FakeNotebookCellOutput as never,
      NotebookCellOutputItem: FakeNotebookCellOutputItem as never,
    });

    const executions: RecordedExecution[] = [];
    let firstCellCancel: (() => void) | undefined;
    let firstCellStartedResolve: (() => void) | undefined;

    const firstCellStarted = new Promise<void>((resolve) => {
      firstCellStartedResolve = resolve;
    });

    let createExecutionCallCount = 0;
    const executionController = {
      createNotebookCellExecution: () => {
        createExecutionCallCount += 1;

        const cancellation = createCancellationHarness();
        const record: RecordedExecution = {
          started: false,
          ended: false,
          outputs: [],
        };
        executions.push(record);

        if (createExecutionCallCount === 1) {
          firstCellCancel = cancellation.cancel;
        }

        return {
          token: cancellation.token,
          executionOrder: undefined,
          start: () => {
            record.started = true;
            if (createExecutionCallCount === 1) {
              firstCellStartedResolve?.();
            }
          },
          end: (success: boolean) => {
            record.success = success;
            record.ended = true;
          },
          replaceOutput: async (outputs: FakeNotebookCellOutput[]) => {
            record.outputs = outputs;
          },
        };
      },
    };

    const runPromise = controller.executeHandler?.(
      [
        {
          document: {
            getText: () =>
              "(() => { const start = Date.now(); while (Date.now() - start < 60000) {} return 'late'; })()",
          },
        },
        {
          document: {
            getText: () => "6 * 7",
          },
        },
      ] as never,
      {} as never,
      executionController as never,
    );

    assert.ok(runPromise);
    await withTimeout(firstCellStarted, 2000);

    assert.ok(firstCellCancel);
    firstCellCancel();

    await withTimeout(Promise.resolve(runPromise), 5000);

    assert.equal(createExecutionCallCount, 1);
    assert.equal(executions.length, 1);
    assert.equal(executions[0]?.started, true);
    assert.equal(executions[0]?.ended, true);
    assert.equal(executions[0]?.success, false);
    assert.equal(executions[0]?.outputs.length, 0);

    const activeConnection = getActiveBrowserConnection();
    assert.ok(activeConnection);

    const probe = await activeConnection.evaluate("1 + 1");
    assert.equal(probe.result?.value, 2);
  },
);
