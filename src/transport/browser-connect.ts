import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ClientRequest, IncomingMessage } from "node:http";
import WebSocket from "ws";
import CDP from "chrome-remote-interface";

import type { EndpointConfig, Localize } from "../config/endpoint-config";
import {
  getActiveProfile,
  selectTarget,
  type TargetProfile,
  type BrowserTargetInfo,
} from "../profile/target-profile";
import type { ConnectToTargetResult } from "./connect-types";

interface BrowserVersionResponse {
  Browser?: string;
  "Protocol-Version"?: string;
  webSocketDebuggerUrl?: string;
}

interface ListTargetResponse {
  id?: string;
  type?: string;
  url?: string;
  title?: string;
  webSocketDebuggerUrl?: string;
}

interface CriTargetDescriptor extends ListTargetResponse {
  id: string;
  webSocketDebuggerUrl: string;
}

interface CdpClient {
  close: () => Promise<void> | void;
  send: (
    method: string,
    params?: unknown,
    sessionId?: string,
  ) => Promise<unknown>;
  Target: {
    getTargets: () => Promise<{ targetInfos?: BrowserTargetInfo[] }>;
    attachToTarget: (args: {
      targetId: string;
      flatten: true;
    }) => Promise<{ sessionId: string }>;
  };
}

export interface ActiveBrowserConnection {
  targetId: string;
  sessionId: string;
  endpoint: EndpointConfig;
  close: () => Promise<void>;
}

let activeBrowserConnection: ActiveBrowserConnection | undefined;

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

interface NativeWebSocketLike {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  addEventListener: (
    type: string,
    listener: (event: unknown) => void,
    options?: unknown,
  ) => void;
}

interface NativeWebSocketConstructor {
  new (url: string): NativeWebSocketLike;
  CLOSED: number;
}

const execFileAsync = promisify(execFile);

function toHeaderValueString(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && value.length > 0) {
    return value.join(", ");
  }

  return undefined;
}

function makeHttpStatusError(response: IncomingMessage): Error {
  const headersToReport = [
    "connection",
    "upgrade",
    "sec-websocket-version",
    "sec-websocket-accept",
    "sec-websocket-protocol",
    "location",
  ] as const;

  const headerDetails = headersToReport
    .map((name) => {
      const value = toHeaderValueString(response.headers[name]);
      return value ? `${name}=${value}` : undefined;
    })
    .filter((entry): entry is string => typeof entry === "string");

  const statusCode = response.statusCode ?? "unknown";
  const statusMessage =
    typeof response.statusMessage === "string" &&
    response.statusMessage.length > 0
      ? ` ${response.statusMessage}`
      : "";
  const suffix =
    headerDetails.length > 0 ? `; headers: ${headerDetails.join(", ")}` : "";

  return new Error(
    `WebSocket upgrade rejected: HTTP ${statusCode}${statusMessage}${suffix}`,
  );
}

async function openRawWebSocket(
  webSocketUrl: string,
  origin: string | undefined,
): Promise<WebSocket> {
  return await new Promise<WebSocket>((resolve, reject) => {
    let settled = false;
    const options = {
      handshakeTimeout: 5000,
      perMessageDeflate: false,
      ...(origin ? { origin } : {}),
    };
    const socket = new WebSocket(webSocketUrl, options);

    socket.once("open", () => {
      settled = true;
      resolve(socket);
    });

    socket.once(
      "unexpected-response",
      (_request: ClientRequest, response: IncomingMessage) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(makeHttpStatusError(response));
      },
    );

    socket.once("close", (code: number, reasonBuffer: Buffer) => {
      if (settled) {
        return;
      }

      settled = true;
      const reason = reasonBuffer.toString("utf8");
      reject(
        new Error(
          reason.length > 0
            ? `WebSocket closed before open: code=${code} reason=${reason}`
            : `WebSocket closed before open: code=${code}`,
        ),
      );
    });

    socket.once("error", (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });
  });
}

function getNativeWebSocketConstructor(): NativeWebSocketConstructor | null {
  const candidate = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (typeof candidate !== "function") {
    return null;
  }

  return candidate as unknown as NativeWebSocketConstructor;
}

function extractEventMessage(event: unknown): string {
  if (event instanceof Error) {
    return event.message;
  }

  if (typeof event === "object" && event !== null) {
    const maybeMessage = (event as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.length > 0) {
      return maybeMessage;
    }
  }

  return "Unknown websocket event error";
}

function extractCloseEventDetails(event: unknown): string {
  if (typeof event !== "object" || event === null) {
    return "WebSocket closed before open";
  }

  const code = (event as { code?: unknown }).code;
  const reason = (event as { reason?: unknown }).reason;

  if (typeof code === "number" && typeof reason === "string") {
    return reason.length > 0
      ? `WebSocket closed before open: code=${code} reason=${reason}`
      : `WebSocket closed before open: code=${code}`;
  }

  if (typeof code === "number") {
    return `WebSocket closed before open: code=${code}`;
  }

  return "WebSocket closed before open";
}

function extractNativeMessagePayload(event: unknown): string | null {
  if (typeof event !== "object" || event === null) {
    return null;
  }

  const data = (event as { data?: unknown }).data;
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
      "utf8",
    );
  }

  return null;
}

async function openNativeRawWebSocket(
  webSocketUrl: string,
  constructor: NativeWebSocketConstructor,
): Promise<NativeWebSocketLike> {
  return await new Promise<NativeWebSocketLike>((resolve, reject) => {
    let settled = false;
    const socket = new constructor(webSocketUrl);
    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      try {
        socket.close();
      } catch {
        // Non-fatal close error.
      }
      reject(new Error("Native WebSocket handshake timed out"));
    }, 5000);

    socket.addEventListener("open", () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      resolve(socket);
    });

    socket.addEventListener("close", (event) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      reject(new Error(extractCloseEventDetails(event)));
    });

    socket.addEventListener("error", (event) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      reject(new Error(extractEventMessage(event)));
    });
  });
}

async function connectNativeRawCdpClient(
  webSocketUrl: string,
): Promise<CdpClient> {
  const constructor = getNativeWebSocketConstructor();
  if (!constructor) {
    throw new Error("Native WebSocket constructor unavailable in runtime");
  }

  const socket = await openNativeRawWebSocket(webSocketUrl, constructor);

  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  socket.addEventListener("message", (event) => {
    const rawPayload = extractNativeMessagePayload(event);
    if (!rawPayload) {
      return;
    }

    try {
      const message = JSON.parse(rawPayload) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      if (typeof message.id !== "number") {
        return;
      }

      const callback = pending.get(message.id);
      if (!callback) {
        return;
      }

      pending.delete(message.id);
      if (message.error) {
        callback.reject(
          new Error(message.error.message ?? "CDP command failed"),
        );
        return;
      }

      callback.resolve(message.result);
    } catch {
      // Ignore non-command payloads.
    }
  });

  socket.addEventListener("close", () => {
    for (const callback of pending.values()) {
      callback.reject(new Error("WebSocket connection closed"));
    }
    pending.clear();
  });

  const sendCommand = (
    method: string,
    params?: unknown,
    sessionId?: string,
  ): Promise<unknown> => {
    return new Promise<unknown>((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve, reject });

      const payload: {
        id: number;
        method: string;
        params?: unknown;
        sessionId?: string;
      } = { id, method };

      if (params !== undefined) {
        payload.params = params;
      }

      if (typeof sessionId === "string" && sessionId.length > 0) {
        payload.sessionId = sessionId;
      }

      try {
        socket.send(JSON.stringify(payload));
      } catch (error) {
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  return {
    close: () => {
      if (socket.readyState === constructor.CLOSED) {
        return;
      }

      socket.close();
    },
    send: sendCommand,
    Target: {
      getTargets: async () =>
        (await sendCommand("Target.getTargets")) as {
          targetInfos?: BrowserTargetInfo[];
        },
      attachToTarget: async (args) =>
        (await sendCommand("Target.attachToTarget", args)) as {
          sessionId: string;
        },
    },
  };
}

async function connectRawCdpClient(webSocketUrl: string): Promise<CdpClient> {
  const origins: Array<string | undefined> = [
    undefined,
    "http://localhost",
    "http://127.0.0.1",
    "devtools://devtools",
  ];

  let socket: WebSocket | undefined;
  const attemptErrors: string[] = [];

  for (const origin of origins) {
    try {
      socket = await openRawWebSocket(webSocketUrl, origin);
      break;
    } catch (error) {
      const originLabel = origin ?? "(no origin)";
      attemptErrors.push(`${originLabel}: ${getErrorMessage(error)}`);
    }
  }

  if (!socket) {
    const details = attemptErrors.join(" | ");
    throw new Error(
      details.length > 0
        ? `Raw WebSocket connect failed across origins: ${details}`
        : "Raw WebSocket connect failed across origins with unknown error",
    );
  }

  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  socket.on("message", (data: WebSocket.RawData) => {
    try {
      const message = JSON.parse(data.toString()) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      if (typeof message.id !== "number") {
        return;
      }

      const callback = pending.get(message.id);
      if (!callback) {
        return;
      }

      pending.delete(message.id);
      if (message.error) {
        callback.reject(
          new Error(message.error.message ?? "CDP command failed"),
        );
        return;
      }

      callback.resolve(message.result);
    } catch {
      // Ignore non-command payloads.
    }
  });

  socket.on("close", () => {
    for (const callback of pending.values()) {
      callback.reject(new Error("WebSocket connection closed"));
    }
    pending.clear();
  });

  const sendCommand = (
    method: string,
    params?: unknown,
    sessionId?: string,
  ): Promise<unknown> => {
    return new Promise<unknown>((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve, reject });

      const payload: {
        id: number;
        method: string;
        params?: unknown;
        sessionId?: string;
      } = { id, method };

      if (params !== undefined) {
        payload.params = params;
      }

      if (typeof sessionId === "string" && sessionId.length > 0) {
        payload.sessionId = sessionId;
      }

      socket!.send(JSON.stringify(payload), (error?: Error) => {
        if (!error) {
          return;
        }

        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  };

  return {
    close: async () => {
      if (socket!.readyState === WebSocket.CLOSED) {
        return;
      }

      await new Promise<void>((resolve) => {
        socket!.once("close", () => {
          resolve();
        });
        socket!.close();
      });
    },
    send: sendCommand,
    Target: {
      getTargets: async () =>
        (await sendCommand("Target.getTargets")) as {
          targetInfos?: BrowserTargetInfo[];
        },
      attachToTarget: async (args) =>
        (await sendCommand("Target.attachToTarget", args)) as {
          sessionId: string;
        },
    },
  };
}

async function connectCdpClient(webSocketUrl: string): Promise<CdpClient> {
  try {
    return (await CDP({ target: webSocketUrl, local: true })) as CdpClient;
  } catch (criError) {
    try {
      return await connectNativeRawCdpClient(webSocketUrl);
    } catch (nativeError) {
      try {
        return await connectRawCdpClient(webSocketUrl);
      } catch (rawError) {
        throw new Error(
          `CRI connect failed: ${getErrorMessage(criError)}; native ws failed: ${getErrorMessage(nativeError)}; raw ws failed: ${getErrorMessage(rawError)}`,
        );
      }
    }
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

/**
 * Normalize a configured host for HTTP/WebSocket connections.
 * Edge typically binds its debug server to `[::1]` (IPv6 loopback).
 * When the user configures `localhost` or leaves the default, we
 * resolve to `::1` to match Edge's binding.
 */
function normalizeEndpointHost(host: string): string {
  if (host === "localhost") {
    return "[::1]";
  }

  return host;
}

export function rewriteBrowserWebSocketUrl(
  browserWebSocketUrl: string,
  endpoint: EndpointConfig,
): string {
  const url = new URL(browserWebSocketUrl);
  const browserHost = url.hostname;

  // When both the browser-reported host and the configured endpoint
  // are loopback addresses, prefer the browser-reported one — the
  // browser knows which loopback interface it bound to.
  if (isLoopbackHost(browserHost) && isLoopbackHost(endpoint.host)) {
    url.hostname = browserHost;
  } else {
    url.hostname = normalizeEndpointHost(endpoint.host);
  }

  url.port = String(endpoint.port);
  return url.toString();
}

async function readJsonViaCurl(url: URL, localize: Localize): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync(
      "curl",
      ["--silent", "--show-error", "--max-time", "5", url.toString()],
      { windowsHide: true },
    );

    try {
      return JSON.parse(stdout);
    } catch {
      throw new Error(
        localize({
          message: "Invalid JSON payload from {0}",
          args: [url.pathname],
          comment: ["{0} is the endpoint path returning malformed JSON."],
        }),
      );
    }
  } catch (error) {
    throw new Error(
      localize({
        message: "curl fallback failed for {0}: {1}",
        args: [url.pathname, getErrorMessage(error)],
        comment: [
          "{0} is the endpoint path being queried.",
          "{1} is the curl failure detail.",
        ],
      }),
    );
  }
}

async function readJson(
  url: URL,
  localize: Localize = passthroughLocalize,
): Promise<unknown> {
  const requestUrl = new URL(url.toString());
  requestUrl.hostname = normalizeEndpointHost(requestUrl.hostname);

  const timeout = 5000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(localize("Endpoint request timed out")));
  }, timeout);

  try {
    const response = await fetch(requestUrl, {
      method: "GET",
      headers: {
        accept: "application/json",
        "cache-control": "no-cache",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        localize({
          message: "HTTP {0} while reading {1}",
          args: [response.status, url.pathname],
          comment: [
            "{0} is the HTTP status code.",
            "{1} is the endpoint path being queried.",
          ],
        }),
      );
    }

    const body = await response.text();
    try {
      return JSON.parse(body);
    } catch {
      throw new Error(
        localize({
          message: "Invalid JSON payload from {0}",
          args: [url.pathname],
          comment: ["{0} is the endpoint path returning malformed JSON."],
        }),
      );
    }
  } catch (error) {
    const message = getErrorMessage(error);
    const shouldTryCurl =
      error instanceof Error &&
      (error.name === "AbortError" ||
        /aborted|timed out|fetch failed|socket hang up|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(
          message,
        ));

    if (shouldTryCurl) {
      return await readJsonViaCurl(requestUrl, localize);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

const passthroughLocalize = ((input: string): string => input) as Localize;

export async function resolveBrowserWebSocketUrl(
  endpoint: EndpointConfig,
  localize: Localize = passthroughLocalize,
): Promise<string> {
  const payload = await fetchBrowserVersion(endpoint, localize);
  const webSocketDebuggerUrl = payload.webSocketDebuggerUrl;

  if (
    typeof webSocketDebuggerUrl !== "string" ||
    webSocketDebuggerUrl.length === 0
  ) {
    throw new Error(
      localize("Missing browser-level webSocketDebuggerUrl in /json/version."),
    );
  }

  return rewriteBrowserWebSocketUrl(webSocketDebuggerUrl, endpoint);
}

async function fetchBrowserVersion(
  endpoint: EndpointConfig,
  localize: Localize = passthroughLocalize,
): Promise<BrowserVersionResponse> {
  const versionUrl = new URL(
    `http://${endpoint.host}:${endpoint.port}/json/version`,
  );
  return (await readJson(versionUrl, localize)) as BrowserVersionResponse;
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

async function safeClose(client: CdpClient | undefined): Promise<void> {
  if (!client) {
    return;
  }

  try {
    await client.close();
  } catch {
    // Non-fatal cleanup error.
  }
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

async function verifyRuntimeProbe(
  client: CdpClient,
  localize: Localize,
  sessionId?: string,
): Promise<void> {
  let evaluationResult: unknown;

  try {
    evaluationResult = await client.send(
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

function runtimeContextSummary(): string {
  return `runtime=${process.platform} host=${os.hostname()}`;
}

function shouldRetryTransportError(error: unknown): boolean {
  return /(ECONNRESET|timed out|socket hang up|Empty reply)/i.test(
    getErrorMessage(error),
  );
}

function toBrowserTargetInfo(
  target: ListTargetResponse,
): BrowserTargetInfo | undefined {
  if (typeof target.id !== "string" || target.id.length === 0) {
    return undefined;
  }

  return {
    targetId: target.id,
    type: target.type,
    url: target.url,
    title: target.title,
  };
}

function toCriTargetDescriptors(targets: unknown): CriTargetDescriptor[] {
  if (!Array.isArray(targets)) {
    return [];
  }

  return targets.filter((target): target is CriTargetDescriptor => {
    if (typeof target !== "object" || target === null) {
      return false;
    }

    const candidate = target as ListTargetResponse;
    return (
      typeof candidate.id === "string" &&
      candidate.id.length > 0 &&
      typeof candidate.webSocketDebuggerUrl === "string" &&
      candidate.webSocketDebuggerUrl.length > 0
    );
  });
}

async function connectViaBrowserTargetAttach(
  endpoint: EndpointConfig,
  profile: TargetProfile,
  localize: Localize,
): Promise<ConnectToTargetResult> {
  let client: CdpClient | undefined;

  try {
    let browserWebSocketUrl = "";
    try {
      browserWebSocketUrl = await resolveBrowserWebSocketUrl(
        endpoint,
        localize,
      );
    } catch (error) {
      throw createStepError("resolveBrowserWebSocketUrl", error);
    }

    try {
      client = await connectCdpClient(browserWebSocketUrl);
    } catch (error) {
      throw createStepError("browserWebSocketConnect", error);
    }

    let targetsResponse: { targetInfos?: BrowserTargetInfo[] };
    try {
      targetsResponse = await client.Target.getTargets();
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
      attachResult = await client.Target.attachToTarget({
        targetId: targetSelection.target.targetId,
        flatten: true,
      });
    } catch (error) {
      throw createStepError("Target.attachToTarget", error);
    }

    try {
      await verifyRuntimeProbe(client, localize, attachResult.sessionId);
    } catch (error) {
      throw createStepError("Runtime.evaluate(probe)", error);
    }

    await clearActiveBrowserConnection();

    const retainedClient = client;
    activeBrowserConnection = {
      targetId: targetSelection.target.targetId,
      sessionId: attachResult.sessionId,
      endpoint,
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

async function connectViaDirectTargetWebSocket(
  endpoint: EndpointConfig,
  profile: TargetProfile,
  localize: Localize,
): Promise<ConnectToTargetResult> {
  let directClient: CdpClient | undefined;

  try {
    const listUrl = new URL(
      `http://${endpoint.host}:${endpoint.port}/json/list`,
    );
    const payload = (await readJson(listUrl, localize)) as unknown;
    if (!Array.isArray(payload)) {
      throw new Error(localize("Invalid JSON payload from /json/list"));
    }

    const listTargets = payload as ListTargetResponse[];
    const candidateTargets = listTargets
      .map((target) => toBrowserTargetInfo(target))
      .filter((target): target is BrowserTargetInfo => Boolean(target));

    const targetSelection = selectTarget(candidateTargets, profile, localize);
    if (!targetSelection.ok) {
      return {
        ok: false,
        endpoint,
        failure: targetSelection.failure,
      };
    }

    const selectedTarget = listTargets.find(
      (target) => target.id === targetSelection.target.targetId,
    );
    if (
      !selectedTarget ||
      typeof selectedTarget.webSocketDebuggerUrl !== "string" ||
      selectedTarget.webSocketDebuggerUrl.length === 0
    ) {
      throw new Error(
        localize(
          "Missing target-level webSocketDebuggerUrl in /json/list for selected target.",
        ),
      );
    }

    directClient = (await CDP({
      target: rewriteBrowserWebSocketUrl(
        selectedTarget.webSocketDebuggerUrl,
        endpoint,
      ),
      local: true,
    })) as CdpClient;

    try {
      await verifyRuntimeProbe(directClient, localize);
    } catch (error) {
      throw createStepError("direct.Runtime.evaluate(probe)", error);
    }

    await clearActiveBrowserConnection();

    const retainedClient = directClient;
    activeBrowserConnection = {
      targetId: targetSelection.target.targetId,
      sessionId: `direct:${targetSelection.target.targetId}`,
      endpoint,
      close: async () => {
        await safeClose(retainedClient);
      },
    };

    directClient = undefined;

    return {
      ok: true,
      endpoint,
      connectedTarget: {
        targetId: targetSelection.target.targetId,
        sessionId: `direct:${targetSelection.target.targetId}`,
      },
    };
  } finally {
    await safeClose(directClient);
  }
}

async function connectViaCriTargetSelection(
  endpoint: EndpointConfig,
  profile: TargetProfile,
  localize: Localize,
): Promise<ConnectToTargetResult> {
  let client: CdpClient | undefined;
  let selectedTargetId = "";

  try {
    try {
      client = (await (
        CDP as unknown as (options: unknown) => Promise<unknown>
      )({
        host: normalizeEndpointHost(endpoint.host),
        port: endpoint.port,
        useHostName: true,
        local: true,
        target: (targets: unknown) => {
          const descriptors = toCriTargetDescriptors(targets);
          const candidateTargets = descriptors
            .map((target) => toBrowserTargetInfo(target))
            .filter((target): target is BrowserTargetInfo => Boolean(target));

          const selected = selectTarget(candidateTargets, profile, localize);
          if (!selected.ok) {
            throw new Error(selected.failure.message);
          }

          selectedTargetId = selected.target.targetId;
          const descriptor = descriptors.find(
            (target) => target.id === selectedTargetId,
          );
          if (!descriptor) {
            throw new Error(
              localize(
                "Selected target descriptor missing from CRI target list.",
              ),
            );
          }

          return descriptor as unknown;
        },
      })) as CdpClient;
    } catch (error) {
      throw createStepError("CRI.hostPortTargetConnect", error);
    }

    try {
      await verifyRuntimeProbe(client, localize);
    } catch (error) {
      throw createStepError("CRI.Runtime.evaluate(probe)", error);
    }

    await clearActiveBrowserConnection();

    const retainedClient = client;
    activeBrowserConnection = {
      targetId: selectedTargetId || localize("unknown-target"),
      sessionId: `cri:${selectedTargetId || "unknown"}`,
      endpoint,
      close: async () => {
        await safeClose(retainedClient);
      },
    };

    client = undefined;

    return {
      ok: true,
      endpoint,
      connectedTarget: {
        targetId: selectedTargetId || localize("unknown-target"),
        sessionId: `cri:${selectedTargetId || "unknown"}`,
      },
    };
  } finally {
    await safeClose(client);
  }
}

async function connectViaKnownBrowserWebSocketPath(
  endpoint: EndpointConfig,
  profile: TargetProfile,
  localize: Localize,
): Promise<ConnectToTargetResult> {
  let client: CdpClient | undefined;

  try {
    const browserWebSocketUrl = `ws://${normalizeEndpointHost(endpoint.host)}:${endpoint.port}/devtools/browser`;

    try {
      client = (await CDP({
        target: browserWebSocketUrl,
        local: true,
      })) as CdpClient;
    } catch (error) {
      throw createStepError("knownBrowserPathConnect", error);
    }

    let targetsResponse: { targetInfos?: BrowserTargetInfo[] };
    try {
      targetsResponse = await client.Target.getTargets();
    } catch (error) {
      throw createStepError("knownBrowserPath.Target.getTargets", error);
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
      attachResult = await client.Target.attachToTarget({
        targetId: targetSelection.target.targetId,
        flatten: true,
      });
    } catch (error) {
      throw createStepError("knownBrowserPath.Target.attachToTarget", error);
    }

    try {
      await verifyRuntimeProbe(client, localize, attachResult.sessionId);
    } catch (error) {
      throw createStepError("knownBrowserPath.Runtime.evaluate(probe)", error);
    }

    await clearActiveBrowserConnection();

    const retainedClient = client;
    activeBrowserConnection = {
      targetId: targetSelection.target.targetId,
      sessionId: attachResult.sessionId,
      endpoint,
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
): Promise<ConnectToTargetResult> {
  let lastBrowserAttachError: unknown;
  let lastCriFallbackError: unknown;
  let lastKnownBrowserPathError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await connectViaBrowserTargetAttach(endpoint, profile, localize);
    } catch (error) {
      lastBrowserAttachError = error;
      if (!shouldRetryTransportError(error) || attempt === 1) {
        break;
      }
    }
  }

  try {
    const criTargetResult = await connectViaCriTargetSelection(
      endpoint,
      profile,
      localize,
    );
    if (
      criTargetResult.ok ||
      criTargetResult.failure.category === "target-mismatch"
    ) {
      return criTargetResult;
    }
  } catch (criError) {
    lastCriFallbackError = createStepError(
      "fallback(connectViaCriTargetSelection)",
      criError,
    );
  }

  try {
    const knownBrowserPathResult = await connectViaKnownBrowserWebSocketPath(
      endpoint,
      profile,
      localize,
    );
    if (
      knownBrowserPathResult.ok ||
      knownBrowserPathResult.failure.category === "target-mismatch"
    ) {
      return knownBrowserPathResult;
    }
  } catch (knownBrowserPathError) {
    lastKnownBrowserPathError = createStepError(
      "fallback(connectViaKnownBrowserWebSocketPath)",
      knownBrowserPathError,
    );
  }

  try {
    const directResult = await connectViaDirectTargetWebSocket(
      endpoint,
      profile,
      localize,
    );
    if (
      directResult.ok ||
      directResult.failure.category === "target-mismatch"
    ) {
      return directResult;
    }

    return {
      ok: false,
      endpoint,
      failure: {
        category: directResult.failure.category,
        message: localize({
          message:
            "Browser attach failed: {0}. CRI selection fallback: {1}. Known browser-path fallback: {2}. Direct target fallback failed: {3}.",
          args: [
            getErrorMessage(lastBrowserAttachError),
            getErrorMessage(lastCriFallbackError),
            getErrorMessage(lastKnownBrowserPathError),
            directResult.failure.message,
          ],
          comment: [
            "{0} is the browser-level attach failure message.",
            "{1} is the CRI target selection fallback failure message.",
            "{2} is the known browser-path websocket fallback failure message.",
            "{3} is the direct target websocket fallback failure message.",
          ],
        }),
      },
    };
  } catch (fallbackError) {
    const failureMessage = localize({
      message:
        "Browser attach failed: {0}. CRI selection fallback: {1}. Known browser-path fallback: {2}. Direct target fallback failed: {3}.",
      args: [
        getErrorMessage(lastBrowserAttachError),
        getErrorMessage(lastCriFallbackError),
        getErrorMessage(lastKnownBrowserPathError),
        getErrorMessage(fallbackError),
      ],
      comment: [
        "{0} is the browser-level attach failure message.",
        "{1} is the CRI target selection fallback failure message.",
        "{2} is the known browser-path websocket fallback failure message.",
        "{3} is the direct target websocket fallback failure message.",
      ],
    });

    return {
      ok: false,
      endpoint,
      failure: {
        category:
          categorizeTransportFailure(lastBrowserAttachError) ===
            "endpoint-connectivity" ||
          categorizeTransportFailure(lastCriFallbackError) ===
            "endpoint-connectivity" ||
          categorizeTransportFailure(lastKnownBrowserPathError) ===
            "endpoint-connectivity" ||
          categorizeTransportFailure(fallbackError) === "endpoint-connectivity"
            ? "endpoint-connectivity"
            : "transport-failure",
        message: `${failureMessage} (${runtimeContextSummary()})`,
      },
    };
  }
}
