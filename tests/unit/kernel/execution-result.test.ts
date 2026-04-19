import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeEvaluationResult,
  normalizeTransportError,
} from "../../../src/kernel/execution-result.js";
import type { BrowserRuntimeEvaluateResult } from "../../../src/transport/browser-connect.js";

function createResponse(
  input: Partial<BrowserRuntimeEvaluateResult>,
): BrowserRuntimeEvaluateResult {
  return input as BrowserRuntimeEvaluateResult;
}

test("normalizeEvaluationResult maps number success", () => {
  const result = normalizeEvaluationResult(
    createResponse({ result: { type: "number", value: 42 } }),
  );

  assert.deepEqual(result, {
    ok: true,
    type: "number",
    value: "42",
  });
});

test("normalizeEvaluationResult maps string success", () => {
  const result = normalizeEvaluationResult(
    createResponse({ result: { type: "string", value: "hello" } }),
  );

  assert.deepEqual(result, {
    ok: true,
    type: "string",
    value: "hello",
  });
});

test("normalizeEvaluationResult maps boolean success", () => {
  const result = normalizeEvaluationResult(
    createResponse({ result: { type: "boolean", value: true } }),
  );

  assert.deepEqual(result, {
    ok: true,
    type: "boolean",
    value: "true",
  });
});

test("normalizeEvaluationResult maps null success", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: {
        type: "object",
        subtype: "null",
        value: null,
      },
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    type: "null",
    value: "null",
  });
});

test("normalizeEvaluationResult maps undefined success", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: {
        type: "undefined",
      },
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    type: "undefined",
    value: "undefined",
  });
});

test("normalizeEvaluationResult classifies SyntaxError as syntax-error", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: { type: "undefined" },
      exceptionDetails: {
        exceptionId: 1,
        text: "Uncaught SyntaxError: Unexpected token ';'",
        lineNumber: 0,
        columnNumber: 0,
        exception: {
          type: "object",
          className: "SyntaxError",
          description:
            "SyntaxError: Unexpected token ';'\n    at <anonymous>:1:1",
        },
      },
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.kind, "syntax-error");
  assert.equal(result.name, "SyntaxError");
  assert.equal(result.message, "Unexpected token ';'");
  assert.match(result.stack ?? "", /SyntaxError: Unexpected token/);
});

test("normalizeEvaluationResult classifies TypeError as runtime-error", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: { type: "undefined" },
      exceptionDetails: {
        exceptionId: 2,
        text: "Uncaught TypeError: boom",
        lineNumber: 0,
        columnNumber: 0,
        exception: {
          type: "object",
          className: "TypeError",
          description: "TypeError: boom\n    at run (<anonymous>:1:1)",
        },
      },
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.kind, "runtime-error");
  assert.equal(result.name, "TypeError");
  assert.equal(result.message, "boom");
});

test("normalizeEvaluationResult classifies ReferenceError as runtime-error", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: { type: "undefined" },
      exceptionDetails: {
        exceptionId: 3,
        text: "Uncaught ReferenceError: missing is not defined",
        lineNumber: 0,
        columnNumber: 0,
        exception: {
          type: "object",
          className: "ReferenceError",
          description:
            "ReferenceError: missing is not defined\n    at <anonymous>:1:1",
        },
      },
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.kind, "runtime-error");
  assert.equal(result.name, "ReferenceError");
  assert.equal(result.message, "missing is not defined");
});

test("normalizeEvaluationResult extracts stack from stackTrace call frames", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: { type: "undefined" },
      exceptionDetails: {
        exceptionId: 4,
        text: "Uncaught Error: bad",
        lineNumber: 0,
        columnNumber: 0,
        exception: {
          type: "object",
          className: "Error",
        },
        stackTrace: {
          callFrames: [
            {
              functionName: "run",
              scriptId: "1",
              url: "game.js",
              lineNumber: 1,
              columnNumber: 2,
            },
          ],
        },
      },
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.match(result.stack ?? "", /at run \(game\.js:2:3\)/);
});

test("normalizeTransportError maps thrown errors", () => {
  const normalized = normalizeTransportError(new Error("socket closed"));

  assert.equal(normalized.ok, false);
  assert.equal(normalized.kind, "transport-error");
  assert.equal(normalized.name, "TransportError");
  assert.equal(normalized.message, "socket closed");
});

test("normalizeTransportError classifies 'CDP evaluation timed out' as timeout", () => {
  const normalized = normalizeTransportError(
    new Error("CDP evaluation timed out"),
  );

  assert.equal(normalized.ok, false);
  assert.equal(normalized.kind, "timeout");
  assert.equal(normalized.name, "EvaluationTimeout");
});

test("normalizeTransportError classifies 'Execution was terminated' as timeout", () => {
  const normalized = normalizeTransportError(
    new Error("Execution was terminated"),
  );

  assert.equal(normalized.ok, false);
  assert.equal(normalized.kind, "timeout");
  assert.equal(normalized.name, "EvaluationTimeout");
});

test("normalizeTransportError does not classify 'Internal error' as timeout (regression guard)", () => {
  const normalized = normalizeTransportError(new Error("Internal error"));

  assert.equal(normalized.ok, false);
  assert.equal(normalized.kind, "transport-error");
  assert.equal(normalized.name, "TransportError");
});

test("normalizeEvaluationResult classifies promise rejection as promise-rejection", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: { type: "undefined" },
      exceptionDetails: {
        exceptionId: 10,
        text: "Uncaught (in promise) TypeError: async boom",
        lineNumber: 0,
        columnNumber: 0,
        exception: {
          type: "object",
          className: "TypeError",
          description: "TypeError: async boom\n    at <anonymous>:1:1",
        },
      },
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.kind, "promise-rejection");
  assert.equal(result.name, "TypeError");
  assert.equal(result.message, "async boom");
  assert.match(result.stack ?? "", /TypeError: async boom/);
});

test("normalizeEvaluationResult classifies non-Error promise rejection as promise-rejection", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: { type: "undefined" },
      exceptionDetails: {
        exceptionId: 11,
        text: "Uncaught (in promise) just a string",
        lineNumber: 0,
        columnNumber: 0,
        exception: {
          type: "string",
          value: "just a string",
        },
      },
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.kind, "promise-rejection");
});

test("normalizeEvaluationResult classifies timeout exception as timeout", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: { type: "undefined" },
      exceptionDetails: {
        exceptionId: 12,
        text: "Script execution timed out.",
        lineNumber: 0,
        columnNumber: 0,
      },
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.kind, "timeout");
  assert.equal(result.name, "EvaluationTimeout");
});

test("normalizeEvaluationResult sanitizes Uncaught (in promise) prefix from rawText", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: { type: "undefined" },
      exceptionDetails: {
        exceptionId: 13,
        text: "Uncaught (in promise) RangeError: index out of bounds",
        lineNumber: 0,
        columnNumber: 0,
        exception: {
          type: "object",
          className: "RangeError",
          description:
            "RangeError: index out of bounds\n    at <anonymous>:1:1",
        },
      },
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.kind, "promise-rejection");
  assert.equal(result.name, "RangeError");
  assert.equal(result.message, "index out of bounds");
});

test("normalizeEvaluationResult sync throw still classifies as runtime-error (regression)", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: { type: "undefined" },
      exceptionDetails: {
        exceptionId: 14,
        text: "Uncaught Error: sync boom",
        lineNumber: 0,
        columnNumber: 0,
        exception: {
          type: "object",
          className: "Error",
          description: "Error: sync boom\n    at <anonymous>:1:1",
        },
      },
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.kind, "runtime-error");
});

test("normalizeEvaluationResult SyntaxError still classifies as syntax-error (regression)", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: { type: "undefined" },
      exceptionDetails: {
        exceptionId: 15,
        text: "Uncaught SyntaxError: Unexpected token ';'",
        lineNumber: 0,
        columnNumber: 0,
        exception: {
          type: "object",
          className: "SyntaxError",
          description:
            "SyntaxError: Unexpected token ';'\n    at <anonymous>:1:1",
        },
      },
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.kind, "syntax-error");
});

test("normalizeEvaluationResult resolved Promise value produces ExecutionSuccess (same as sync)", () => {
  // awaitPromise: true resolves non-Promise and resolved-Promise values identically
  const result = normalizeEvaluationResult(
    createResponse({ result: { type: "number", value: 42 } }),
  );

  assert.deepEqual(result, {
    ok: true,
    type: "number",
    value: "42",
  });
});
