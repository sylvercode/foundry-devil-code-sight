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

// ──────────────────────────────────────────────────────────────────────────────
// Serialization edge-case tests
// ──────────────────────────────────────────────────────────────────────────────

test("normalizeEvaluationResult Infinity via unserializableValue", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: { type: "number", unserializableValue: "Infinity" },
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    type: "number",
    value: "Infinity",
  });
});

test("normalizeEvaluationResult -Infinity via unserializableValue", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: { type: "number", unserializableValue: "-Infinity" },
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    type: "number",
    value: "-Infinity",
  });
});

test("normalizeEvaluationResult NaN via unserializableValue", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: { type: "number", unserializableValue: "NaN" },
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    type: "number",
    value: "NaN",
  });
});

test("normalizeEvaluationResult -0 via unserializableValue", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: { type: "number", unserializableValue: "-0" },
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    type: "number",
    value: "-0",
  });
});

test("normalizeEvaluationResult BigInt via unserializableValue", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: { type: "bigint", unserializableValue: "123n" },
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    type: "bigint",
    value: "123n",
  });
});

test("normalizeEvaluationResult Symbol with description", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: { type: "symbol", description: "Symbol(foo)" },
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    type: "symbol",
    value: "Symbol(foo)",
  });
});

test("normalizeEvaluationResult Function with description", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: {
        type: "function",
        description: "function greet() { ... }",
      },
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    type: "function",
    value: "function greet() { ... }",
  });
});

test("normalizeEvaluationResult Array via returnByValue", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: { type: "object", subtype: "array", value: [1, 2, 3] },
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    type: "array",
    value: "[1,2,3]",
  });
});

test("normalizeEvaluationResult Object via returnByValue", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: { type: "object", value: { a: 1, b: "two" } },
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    type: "object",
    value: '{"a":1,"b":"two"}',
  });
});

test("normalizeEvaluationResult empty string value (edge case)", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: { type: "string", value: "" },
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    type: "string",
    value: "",
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Contract shape invariant tests
// ──────────────────────────────────────────────────────────────────────────────

test("normalizeEvaluationResult success contract: exact shape, no extra properties", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: {
        type: "object",
        subtype: "array",
        value: [1],
        className: "Array",
        description: "Array(1)",
        objectId: "1234",
      },
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  const keys = Object.keys(result).sort();
  assert.deepEqual(keys, ["ok", "type", "value"]);
  assert.equal(typeof result.value, "string");
  assert.equal(typeof result.type, "string");
  assert.equal(result.ok, true);
});

test("normalizeEvaluationResult failure contract: exact shape, no extra properties", () => {
  const result = normalizeEvaluationResult(
    createResponse({
      result: { type: "undefined" },
      exceptionDetails: {
        exceptionId: 100,
        text: "Uncaught TypeError: bad",
        lineNumber: 0,
        columnNumber: 0,
        exception: {
          type: "object",
          className: "TypeError",
          description: "TypeError: bad\n    at <anonymous>:1:1",
        },
      },
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  const keys = Object.keys(result).sort();
  assert.deepEqual(keys, ["kind", "message", "name", "ok", "stack"]);
  assert.equal(result.ok, false);
  assert.equal(typeof result.name, "string");
  assert.equal(typeof result.message, "string");
  assert.equal(typeof result.kind, "string");
  assert.equal(typeof result.stack, "string");
});

test("normalizeTransportError contract: exact shape, no extra properties", () => {
  const result = normalizeTransportError(new Error("socket closed"));

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  const keys = Object.keys(result).sort();
  assert.deepEqual(keys, ["kind", "message", "name", "ok", "stack"]);
  assert.equal(result.ok, false);
  assert.equal(typeof result.name, "string");
  assert.equal(typeof result.message, "string");
  assert.equal(typeof result.kind, "string");
  assert.equal(typeof result.stack, "string");
});

// ──────────────────────────────────────────────────────────────────────────────
// Classification parity tests
// ──────────────────────────────────────────────────────────────────────────────

test("normalizeEvaluationResult classification parity: sync throw vs async rejection produce identical shapes except kind", () => {
  // Sync throw: "Uncaught TypeError: boom"
  const syncResult = normalizeEvaluationResult(
    createResponse({
      result: { type: "undefined" },
      exceptionDetails: {
        exceptionId: 20,
        text: "Uncaught TypeError: boom",
        lineNumber: 0,
        columnNumber: 0,
        exception: {
          type: "object",
          className: "TypeError",
          description: "TypeError: boom\n    at <anonymous>:1:1",
        },
      },
    }),
  );

  // Async rejection: "Uncaught (in promise) TypeError: boom"
  const asyncResult = normalizeEvaluationResult(
    createResponse({
      result: { type: "undefined" },
      exceptionDetails: {
        exceptionId: 21,
        text: "Uncaught (in promise) TypeError: boom",
        lineNumber: 0,
        columnNumber: 0,
        exception: {
          type: "object",
          className: "TypeError",
          description: "TypeError: boom\n    at <anonymous>:1:1",
        },
      },
    }),
  );

  // Both should be failures
  assert.equal(syncResult.ok, false);
  assert.equal(asyncResult.ok, false);
  if (syncResult.ok || asyncResult.ok) {
    return;
  }

  // Both should have identical name, message, stack
  assert.equal(syncResult.name, asyncResult.name);
  assert.equal(syncResult.name, "TypeError");

  assert.equal(syncResult.message, asyncResult.message);
  assert.equal(syncResult.message, "boom");

  assert.equal(syncResult.stack, asyncResult.stack);

  // The ONLY difference should be kind
  assert.equal(syncResult.kind, "runtime-error");
  assert.equal(asyncResult.kind, "promise-rejection");
});
