import test from "node:test";
import assert from "node:assert/strict";

import {
  formatRemoteObject,
  formatRemoteType,
} from "../../../src/debugger/variable-formatter.js";
import { createLocalizeMock } from "../test-utils/localize-mock.js";

test("formats primitives", () => {
  const value = formatRemoteObject(
    { type: "number", value: 42 } as never,
    10240,
    createLocalizeMock(),
  );

  assert.equal(value, "42");
});

test("formats functions with placeholder", () => {
  const value = formatRemoteObject(
    { type: "function", description: "fn test()" } as never,
    10240,
    createLocalizeMock(),
  );

  assert.equal(value, "[Function: fn test()]");
});

test("formats DOM nodes from description", () => {
  const value = formatRemoteObject(
    { type: "object", subtype: "node", description: '<div id="x">' } as never,
    10240,
    createLocalizeMock(),
  );

  assert.equal(value, '<div id="x">');
});

test("truncates oversized values", () => {
  const value = formatRemoteObject(
    { type: "string", value: "abcdef" } as never,
    3,
    createLocalizeMock(),
  );

  assert.equal(value, "abc… Value truncated (over 3 characters).");
});

test("formats remote type from subtype first", () => {
  const value = formatRemoteType({ type: "object", subtype: "array" } as never);
  assert.equal(value, "array");
});
