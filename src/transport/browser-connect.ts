import os from "node:os";

const CDP_EVALUATION_TIMEOUT_MS = 30_000;

function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("CDP evaluation timed out"));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
import { isIP } from "node:net";
import CDP from "chrome-remote-interface";
import type ProtocolMappingApi from "devtools-protocol/types/protocol-mapping";

import type { EndpointConfig, Localize } from "../config/endpoint-config";
import {
  getActiveProfile,
  selectTarget,
  type TargetProfile,
  type BrowserTargetInfo,
} from "../profile/target-profile";
import type { ConnectToTargetResult } from "./connect-types";

export type BrowserRuntimeEvaluateResult =
  ProtocolMappingApi.Commands["Runtime.evaluate"]["returnType"];

export interface ActiveBrowserConnection {
  targetId: string;
  sessionId: string;
  endpoint: EndpointConfig;
  evaluate: (expression: string) => Promise<BrowserRuntimeEvaluateResult>;
  close: () => Promise<void>;
}

export function createAttachToTargetParams(targetId: string): {
  targetId: string;
  flatten: true;
} {
  return {
    targetId,
    flatten: true,
  };
}

export function toSessionScopedEventName(
  eventName: string,
  sessionId: string,
): string {
  return `${eventName}.${sessionId}`;
}

let activeBrowserConnection: ActiveBrowserConnection | undefined;

const passthroughLocalize = ((input: string): string => input) as Localize;

function createAbortError(localize: Localize): Error {
  return new Error(localize("Connect attempt canceled."));
}

function throwIfCanceled(
  abortSignal: AbortSignal | undefined,
  localize: Localize,
): void {
  if (abortSignal?.aborted) {
    throw createAbortError(localize);
  }
}

async function withAbortSignal<T>(
  operation: Promise<T>,
  abortSignal: AbortSignal | undefined,
  localize: Localize,
): Promise<T> {
  if (!abortSignal) {
    return operation;
  }

  if (abortSignal.aborted) {
    throw createAbortError(localize);
  }

  return await new Promise<T>((resolve, reject) => {
    let settled = false;

    const onAbort = () => {
      if (settled) {
        return;
      }

      settled = true;
      reject(createAbortError(localize));
    };

    abortSignal.addEventListener("abort", onAbort, { once: true });

    operation.then(
      (result) => {
        if (settled) {
          return;
        }

        settled = true;
        abortSignal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error) => {
        if (settled) {
          return;
        }

        settled = true;
        abortSignal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function clearActiveBrowserConnection(): Promise<void> {
  if (!activeBrowserConnection) {
    return;
  }

  const current = activeBrowserConnection;
  activeBrowserConnection = undefined;
  await current.close();
}

export function getActiveBrowserConnection():
  | ActiveBrowserConnection
  | undefined {
  return activeBrowserConnection;
}

export async function disconnectActiveBrowserConnection(): Promise<void> {
  await clearActiveBrowserConnection();
}

export async function resolveBrowserWebSocketUrl(
  { host, port }: EndpointConfig,
  localize: Localize = passthroughLocalize,
): Promise<string> {
  const useHostName = host === "localhost" || isIP(host) !== 0;

  const payload = await (() => {
    try {
      return CDP.Version({
        host,
        port,
        // Edge accepts Host headers for localhost and IP addresses.
        // Other DNS names can fail with:
        // "Host header is specified and is not an IP address or localhost."
        useHostName,
      });
    } catch (error) {
      throw new Error(
        localize({
          message: "CDP.Version failed: {0}",
          args: [getErrorMessage(error)],
          comment: ["{0} is the failure reason from CDP.Version."],
        }),
      );
    }
  })();

  const webSocketDebuggerUrl = payload.webSocketDebuggerUrl;

  if (
    typeof webSocketDebuggerUrl !== "string" ||
    webSocketDebuggerUrl.length === 0
  ) {
    throw new Error(
      localize("Missing browser-level webSocketDebuggerUrl in /json/version."),
    );
  }

  return webSocketDebuggerUrl;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }

  return String(error);
}

function createStepError(step: string, error: unknown): Error {
  return new Error(`${step}: ${getErrorMessage(error)}`);
}

function categorizeTransportFailure(
  error: unknown,
): "endpoint-connectivity" | "transport-failure" {
  const message = getErrorMessage(error);
  if (
    /(ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|timed out|HTTP 4|HTTP 5)/i.test(
      message,
    )
  ) {
    return "endpoint-connectivity";
  }

  return "transport-failure";
}

function shouldRetryTransportError(error: unknown): boolean {
  return /(ECONNRESET|timed out|socket hang up|Empty reply)/i.test(
    getErrorMessage(error),
  );
}

function runtimeContextSummary(): string {
  return `runtime=${process.platform} host=${os.hostname()}`;
}

async function safeClose(client: CDP.Client | undefined): Promise<void> {
  if (!client) {
    return;
  }

  try {
    await client.close();
  } catch {
    // Non-fatal cleanup error.
  }
}

type TargetDetachClient = Pick<CDP.Client, "Target">;

export async function safeDetachFromTarget(
  client: TargetDetachClient,
  sessionId: string,
): Promise<void> {
  try {
    await client.Target.detachFromTarget({ sessionId });
  } catch {
    // Non-fatal cleanup error.
  }
}

async function verifyRuntimeProbe(
  client: CDP.Client,
  localize: Localize,
  sessionId: string,
): Promise<void> {
  const evaluationResult = await (() => {
    try {
      return client.send(
        "Runtime.evaluate",
        {
          expression: "1 + 1",
          returnByValue: true,
          awaitPromise: true,
        },
        sessionId,
      );
    } catch (error) {
      throw new Error(
        localize({
          message: "Runtime probe command failed: {0}",
          args: [getErrorMessage(error)],
          comment: ["{0} is the CDP Runtime.evaluate failure message."],
        }),
      );
    }
  })();

  if (typeof evaluationResult !== "object" || evaluationResult === null) {
    throw new Error(localize("Runtime probe returned no result object."));
  }

  const details = evaluationResult as {
    result?: { value?: unknown };
    exceptionDetails?: unknown;
  };

  if (details.exceptionDetails) {
    throw new Error(localize("Runtime probe raised exception details."));
  }

  if (details.result?.value !== 2) {
    throw new Error(
      localize({
        message: "Runtime probe returned unexpected value: {0}",
        args: [String(details.result?.value)],
        comment: ["{0} is the value returned by Runtime.evaluate."],
      }),
    );
  }
}

async function connectViaBrowserTargetAttach(
  endpoint: EndpointConfig,
  profile: TargetProfile,
  localize: Localize,
  abortSignal?: AbortSignal,
): Promise<ConnectToTargetResult> {
  let client: CDP.Client | undefined;

  try {
    throwIfCanceled(abortSignal, localize);

    let browserWebSocketUrl = "";
    try {
      browserWebSocketUrl = await withAbortSignal(
        resolveBrowserWebSocketUrl(endpoint, localize),
        abortSignal,
        localize,
      );
    } catch (error) {
      throw createStepError("resolveBrowserWebSocketUrl", error);
    }

    try {
      client = await withAbortSignal(
        CDP({
          target: browserWebSocketUrl,
          local: true,
        }),
        abortSignal,
        localize,
      );
    } catch (error) {
      throw createStepError("browserWebSocketConnect", error);
    }

    let targetsResponse: { targetInfos?: BrowserTargetInfo[] };
    try {
      targetsResponse = await withAbortSignal(
        client.Target.getTargets(),
        abortSignal,
        localize,
      );
    } catch (error) {
      throw createStepError("Target.getTargets", error);
    }

    const targetSelection = selectTarget(
      targetsResponse.targetInfos ?? [],
      profile,
      localize,
    );

    if (!targetSelection.ok) {
      return {
        ok: false,
        endpoint,
        failure: targetSelection.failure,
      };
    }

    let attachResult: { sessionId: string };
    try {
      attachResult = await withAbortSignal(
        // Flat sessions are required for browser-level CDP multiplexing and
        // coexistence with other DevTools clients on the same target.
        client.Target.attachToTarget(
          createAttachToTargetParams(targetSelection.target.targetId),
        ),
        abortSignal,
        localize,
      );
    } catch (error) {
      throw createStepError("Target.attachToTarget", error);
    }

    try {
      await withAbortSignal(
        verifyRuntimeProbe(client, localize, attachResult.sessionId),
        abortSignal,
        localize,
      );
    } catch (error) {
      await safeDetachFromTarget(client, attachResult.sessionId);
      throw createStepError("Runtime.evaluate(probe)", error);
    }

    throwIfCanceled(abortSignal, localize);

    await clearActiveBrowserConnection();

    const retainedClient = client;
    const retainedSessionId = attachResult.sessionId;
    activeBrowserConnection = {
      targetId: targetSelection.target.targetId,
      sessionId: retainedSessionId,
      endpoint,
      evaluate: (expression: string) =>
        raceWithTimeout(
          retainedClient.send(
            "Runtime.evaluate",
            {
              expression,
              returnByValue: true,
              awaitPromise: true,
              // Required for top-level await in notebook cells.
              replMode: true,
              timeout: CDP_EVALUATION_TIMEOUT_MS,
              generatePreview: false,
            },
            retainedSessionId,
          ),
          CDP_EVALUATION_TIMEOUT_MS,
        ),
      close: async () => {
        await safeClose(retainedClient);
      },
    };

    client = undefined;

    return {
      ok: true,
      endpoint,
      connectedTarget: {
        targetId: targetSelection.target.targetId,
        sessionId: attachResult.sessionId,
      },
    };
  } finally {
    await safeClose(client);
  }
}

export async function connectToBrowserTarget(
  endpoint: EndpointConfig,
  profile: TargetProfile = getActiveProfile(),
  localize: Localize = passthroughLocalize,
  abortSignal?: AbortSignal,
): Promise<ConnectToTargetResult> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await connectViaBrowserTargetAttach(
        endpoint,
        profile,
        localize,
        abortSignal,
      );
    } catch (error) {
      lastError = error;

      if (abortSignal?.aborted) {
        throw error;
      }

      if (!shouldRetryTransportError(error) || attempt === 1) {
        break;
      }
    }
  }

  const failureMessage = localize({
    message: "Browser attach failed: {0}.",
    args: [getErrorMessage(lastError)],
    comment: ["{0} is the browser-level attach failure message."],
  });

  return {
    ok: false,
    endpoint,
    failure: {
      category: categorizeTransportFailure(lastError),
      message: `${failureMessage} (${runtimeContextSummary()})`,
    },
  };
}
