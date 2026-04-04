import test from "node:test";
import assert from "node:assert/strict";

import {
  CDP_PORT_MAX,
  CDP_PORT_MIN,
  readEndpointConfig,
  validateEndpointConfig,
} from "../../../src/config/endpoint-config";

test("validateEndpointConfig accepts valid host and port", () => {
  const result = validateEndpointConfig({ host: "localhost", port: 9222 });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.endpoint.host, "localhost");
    assert.equal(result.endpoint.port, 9222);
  }
});

test("validateEndpointConfig rejects empty host with field-specific corrective action", () => {
  const result = validateEndpointConfig({ host: "   ", port: 9222 });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.field, "host");
    assert.match(
      result.error.correctiveAction,
      /jupyterBrowserKernel\.cdpHost/,
    );
  }
});

test("validateEndpointConfig rejects non-integer and out-of-range port with field-specific corrective action", () => {
  const nonIntegerResult = validateEndpointConfig({
    host: "localhost",
    port: 9222.5,
  });
  const outOfRangeLowResult = validateEndpointConfig({
    host: "localhost",
    port: CDP_PORT_MIN - 1,
  });
  const outOfRangeHighResult = validateEndpointConfig({
    host: "localhost",
    port: CDP_PORT_MAX + 1,
  });

  for (const result of [
    nonIntegerResult,
    outOfRangeLowResult,
    outOfRangeHighResult,
  ]) {
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.field, "port");
      assert.match(
        result.error.correctiveAction,
        /jupyterBrowserKernel\.cdpPort/,
      );
    }
  }
});

test("readEndpointConfig normalizes host and port from configuration", () => {
  const config = {
    get<T>(section: string, defaultValue: T): T {
      if (section === "cdpHost") {
        return " 127.0.0.1 " as T;
      }

      if (section === "cdpPort") {
        return 9333 as T;
      }

      return defaultValue;
    },
  };

  const result = readEndpointConfig(config);

  assert.equal(result.host, "127.0.0.1");
  assert.equal(result.port, 9333);
});
