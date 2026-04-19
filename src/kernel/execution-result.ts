import type { BrowserRuntimeEvaluateResult } from "../transport/browser-connect";

export interface ExecutionSuccess {
  ok: true;
  value: string;
  type: string;
}

export type ExecutionFailureKind =
  | "syntax-error"
  | "runtime-error"
  | "transport-error"
  | "no-session"
  | "promise-rejection"
  | "timeout";

export interface ExecutionFailure {
  ok: false;
  name: string;
  message: string;
  stack?: string;
  kind: ExecutionFailureKind;
}

export type ExecutionResult = ExecutionSuccess | ExecutionFailure;

export function normalizeEvaluationResult(
  response: BrowserRuntimeEvaluateResult,
): ExecutionResult {
  if (response.exceptionDetails) {
    return normalizeExceptionDetails(response);
  }

  const evaluatedType =
    response.result.subtype ?? response.result.type ?? "unknown";

  return {
    ok: true,
    type: evaluatedType,
    value: serializeRemoteValue(response.result),
  };
}

const TIMEOUT_ERROR_PATTERN =
  /CDP evaluation timed out|Execution was terminated|timed out/i;

function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return TIMEOUT_ERROR_PATTERN.test(message);
}

export function normalizeTransportError(error: unknown): ExecutionFailure {
  if (isTimeoutError(error)) {
    return {
      ok: false,
      name: "EvaluationTimeout",
      kind: "timeout",
      message: "Evaluation timed out.",
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  return {
    ok: false,
    name: "TransportError",
    kind: "transport-error",
    message,
    stack,
  };
}

interface RemoteObjectLike {
  type?: string;
  subtype?: string;
  value?: unknown;
  description?: string;
}

interface ExceptionClassification {
  name: string;
  message: string;
  kind: ExecutionFailureKind;
}

interface ExceptionClassificationInput {
  exceptionText: string | undefined;
  exceptionClassName: string | undefined;
  rawText: string | undefined;
  description: string | undefined;
}

function serializeRemoteValue(result: RemoteObjectLike): string {
  if (result.subtype === "null") {
    return "null";
  }

  if (result.type === "undefined") {
    return "undefined";
  }

  if (typeof result.value === "string") {
    return result.value;
  }

  if (result.value === undefined) {
    return result.description ?? result.type ?? "undefined";
  }

  if (
    typeof result.value === "number" ||
    typeof result.value === "boolean" ||
    result.value === null
  ) {
    return String(result.value);
  }

  if (typeof result.value === "bigint") {
    return `${String(result.value)}n`;
  }

  const serialized = JSON.stringify(result.value);
  return serialized ?? String(result.value);
}

function normalizeExceptionDetails(
  response: BrowserRuntimeEvaluateResult,
): ExecutionFailure {
  const exceptionDetails = response.exceptionDetails;

  if (!exceptionDetails) {
    return {
      ok: false,
      name: "RuntimeError",
      message: "Evaluation failed.",
      kind: "runtime-error",
    };
  }

  const exceptionClassName = exceptionDetails.exception?.className;
  const rawText = sanitizeUncaughtPrefix(exceptionDetails.text);
  const description = exceptionDetails.exception?.description;
  const stackFromDescription = extractStackFromDescription(description);
  const stackFromFrames = stackTraceToText(exceptionDetails.stackTrace);

  const { name, message, kind } = classifyExceptionFailure({
    exceptionText: exceptionDetails.text,
    exceptionClassName,
    rawText,
    description,
  });

  return {
    ok: false,
    name,
    message,
    kind,
    stack: stackFromDescription ?? stackFromFrames,
  };
}

function classifyExceptionFailure({
  exceptionText,
  exceptionClassName,
  rawText,
  description,
}: ExceptionClassificationInput): ExceptionClassification {
  const isTimeout = exceptionText?.toLowerCase().includes("timed out") ?? false;
  const isPromiseRejection = exceptionText?.includes("(in promise)") ?? false;

  const parsedName =
    exceptionClassName ??
    parseErrorName(rawText) ??
    parseErrorName(description) ??
    "RuntimeError";

  const kind: ExecutionFailureKind = (() => {
    switch (true) {
      case isTimeout:
        return "timeout";
      case exceptionClassName === "SyntaxError" || parsedName === "SyntaxError":
        return "syntax-error";
      case isPromiseRejection:
        return "promise-rejection";
      default:
        return "runtime-error";
    }
  })();

  switch (kind) {
    case "timeout":
      return {
        name: "EvaluationTimeout",
        message: "Evaluation timed out.",
        kind,
      };
    default:
      return {
        name: parsedName,
        message:
          parseErrorMessage(description, parsedName) ??
          parseErrorMessage(rawText, parsedName) ??
          rawText ??
          "Evaluation failed.",
        kind,
      };
  }
}

function sanitizeUncaughtPrefix(
  rawText: string | undefined,
): string | undefined {
  if (typeof rawText !== "string") {
    return undefined;
  }

  return rawText.replace(/^Uncaught\s+(?:\(in promise\)\s+)?/, "").trim();
}

function parseErrorName(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }

  const firstLine = input.split("\n", 1)[0]?.trim();
  if (!firstLine) {
    return undefined;
  }

  const colonIndex = firstLine.indexOf(":");
  if (colonIndex <= 0) {
    return undefined;
  }

  return firstLine.slice(0, colonIndex).trim();
}

function parseErrorMessage(
  input: string | undefined,
  name: string,
): string | undefined {
  if (!input) {
    return undefined;
  }

  const firstLine = input.split("\n", 1)[0]?.trim();
  if (!firstLine) {
    return undefined;
  }

  const prefix = `${name}:`;
  if (firstLine.startsWith(prefix)) {
    return firstLine.slice(prefix.length).trim() || name;
  }

  return firstLine;
}

function extractStackFromDescription(
  description: string | undefined,
): string | undefined {
  if (!description || !description.includes("\n")) {
    return undefined;
  }

  return description;
}

interface StackFrameLike {
  functionName?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}

interface StackTraceLike {
  callFrames?: StackFrameLike[];
}

function stackTraceToText(
  stackTrace: StackTraceLike | undefined,
): string | undefined {
  const frames = stackTrace?.callFrames;
  if (!Array.isArray(frames) || frames.length === 0) {
    return undefined;
  }

  const renderedFrames = frames.map((frame) => {
    const functionName =
      frame.functionName && frame.functionName.length > 0
        ? frame.functionName
        : "<anonymous>";
    const url = frame.url ?? "unknown";
    const line = (frame.lineNumber ?? 0) + 1;
    const column = (frame.columnNumber ?? 0) + 1;
    return `at ${functionName} (${url}:${line}:${column})`;
  });

  return renderedFrames.join("\n");
}
