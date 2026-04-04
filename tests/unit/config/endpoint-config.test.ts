import test from "node:test";
import assert from "node:assert/strict";

import {
  CDP_PORT_MAX,
  CDP_PORT_MIN,
  readEndpointConfig,
  summarizeEndpointForDisplay,
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

test("readEndpointConfig does not apply endpoint defaults when settings are unset", () => {
  const config = {
    get<T>(_section: string, defaultValue: T): T {
      return defaultValue;
    },
  };

  const result = readEndpointConfig(config);

  assert.equal(result.host, "");
  assert.equal(Number.isNaN(result.port), true);
});

test("summarizeEndpointForDisplay shows loopback host as-is", () => {
  assert.equal(
    summarizeEndpointForDisplay({ host: "localhost", port: 9222 }),
    "localhost:9222",
  );
  assert.equal(
    summarizeEndpointForDisplay({ host: "127.0.0.1", port: 9222 }),
    "127.0.0.1:9222",
  );
  assert.equal(
    summarizeEndpointForDisplay({ host: "::1", port: 9222 }),
    "::1:9222",
  );
});

test("summarizeEndpointForDisplay redacts non-loopback host", () => {
  assert.equal(
    summarizeEndpointForDisplay({ host: "example.internal", port: 9222 }),
    "[redacted-host]:9222",
  );
});

test("readEndpointConfig treats non-string cdpHost as empty", () => {
  const config = {
    get<T>(section: string, defaultValue: T): T {
      if (section === "cdpHost") {
        return { nested: "value" } as unknown as T;
      }

      return defaultValue;
    },
  };

  const result = readEndpointConfig(config);

  assert.equal(result.host, "");
});

test("readEndpointConfig treats non-number cdpPort as NaN", () => {
  const config = {
    get<T>(section: string, defaultValue: T): T {
      if (section === "cdpPort") {
        return "9222" as unknown as T;
      }

      return defaultValue;
    },
  };

  const result = readEndpointConfig(config);

  assert.equal(Number.isNaN(result.port), true);
});

test("summarizeEndpointForDisplay preserves port in output", () => {
  assert.equal(
    summarizeEndpointForDisplay({ host: "localhost", port: 9333 }),
    "localhost:9333",
  );
  assert.equal(
    summarizeEndpointForDisplay({ host: "remote.host", port: 9333 }),
    "[redacted-host]:9333",
  );
});
