import test from "node:test";
import assert from "node:assert/strict";

import {
  getKernelFailureCellOutputMessage,
  getKernelFailureNotificationMessage,
  getKernelFailureCategoryLabel,
  getTimeoutCellOutputMessage,
  getTimeoutNotificationMessage,
} from "../../../src/kernel/execution-messages.js";
import { createLocalizeMock } from "../test-utils/localize-mock.js";

test("getKernelFailureCellOutputMessage returns no-session message for no-session kind", () => {
  const localize = createLocalizeMock();
  const message = getKernelFailureCellOutputMessage(localize, "no-session");
  assert.ok(message.length > 0);
  assert.ok(message.includes("Reconnect"));
});

test("getKernelFailureCellOutputMessage returns transport message for transport-error kind", () => {
  const localize = createLocalizeMock();
  const message = getKernelFailureCellOutputMessage(
    localize,
    "transport-error",
  );
  assert.ok(message.length > 0);
  assert.ok(
    message.includes("Transport error") || message.includes("transport"),
  );
});

test("getKernelFailureCellOutputMessage returns timeout message for timeout kind", () => {
  const localize = createLocalizeMock();
  const message = getKernelFailureCellOutputMessage(localize, "timeout");
  const expected = getTimeoutCellOutputMessage(localize);
  assert.equal(message, expected);
  assert.ok(message.includes("timed out"));
});

test("getKernelFailureNotificationMessage returns timeout message for timeout kind", () => {
  const localize = createLocalizeMock();
  const message = getKernelFailureNotificationMessage(localize, "timeout");
  const expected = getTimeoutNotificationMessage(localize);
  assert.equal(message, expected);
  assert.ok(message.includes("timed out"));
});

test("getKernelFailureNotificationMessage returns no-session message for no-session kind", () => {
  const localize = createLocalizeMock();
  const message = getKernelFailureNotificationMessage(localize, "no-session");
  assert.ok(message.includes("Reconnect"));
});

test("getKernelFailureNotificationMessage returns transport message for transport-error kind", () => {
  const localize = createLocalizeMock();
  const message = getKernelFailureNotificationMessage(
    localize,
    "transport-error",
  );
  assert.ok(message.length > 0);
});

test("getKernelFailureCategoryLabel returns evaluation timeout for timeout kind", () => {
  const localize = createLocalizeMock();
  const label = getKernelFailureCategoryLabel(localize, "timeout");
  assert.equal(label, "evaluation timeout");
});

test("getKernelFailureCategoryLabel returns session unavailable for no-session kind", () => {
  const localize = createLocalizeMock();
  const label = getKernelFailureCategoryLabel(localize, "no-session");
  assert.equal(label, "session unavailable");
});

test("getKernelFailureCategoryLabel returns transport error for transport-error kind", () => {
  const localize = createLocalizeMock();
  const label = getKernelFailureCategoryLabel(localize, "transport-error");
  assert.equal(label, "transport error");
});

test("getKernelFailureCategoryLabel returns transport error for promise-rejection kind", () => {
  const localize = createLocalizeMock();
  const label = getKernelFailureCategoryLabel(localize, "promise-rejection");
  assert.equal(label, "transport error");
});
