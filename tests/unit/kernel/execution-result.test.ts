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
