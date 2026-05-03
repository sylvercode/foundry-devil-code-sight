import test from "node:test";
import assert from "node:assert/strict";

import { buildCellExpression } from "../../../src/kernel/build-cell-expression.js";

const BASE_URI =
  "vscode-notebook-cell://test-authority/workspaces/foundry-devil-code-sight/tests/files/test1.ipynb#ch0000000001234";

test("buildCellExpression returns no-wrapper shape by default", () => {
  const expression = buildCellExpression("const x = 1", BASE_URI, {
    isolate: false,
  });

  assert.equal(expression, `const x = 1\n//# sourceURL=${BASE_URI}\n`);
  assert.equal(expression.startsWith("(async()=>{"), false);
});

test("buildCellExpression wraps multi-line code with same-line Pattern B boundaries", () => {
  const source = "let x = 1;\nlet y = 2;\nx + y";
  const expression = buildCellExpression(source, BASE_URI, {
    isolate: true,
  });

  const expected = `await (async()=>{let x = 1;\nlet y = 2;\nx + y})()\n//# sourceURL=${BASE_URI}\n`;
  assert.equal(expression, expected);
});

test("buildCellExpression wraps single-line code without synthesized line breaks", () => {
  const expression = buildCellExpression("1 + 1", BASE_URI, {
    isolate: true,
  });

  assert.equal(
    expression,
    `await (async()=>{1 + 1})()\n//# sourceURL=${BASE_URI}\n`,
  );
});

test("buildCellExpression wraps empty code as a no-op async IIFE", () => {
  const expression = buildCellExpression("", BASE_URI, {
    isolate: true,
  });

  assert.equal(
    expression,
    `await (async()=>{})()\n//# sourceURL=${BASE_URI}\n`,
  );
});

test("buildCellExpression preserves sourceURL bytes for identical reruns", () => {
  const first = buildCellExpression("2 + 2", BASE_URI, {
    isolate: false,
  });
  const second = buildCellExpression("2 + 2", BASE_URI, {
    isolate: false,
  });

  assert.equal(first, second);
  assert.match(first, new RegExp(`${BASE_URI}\\n$`));
});

test("buildCellExpression uses distinct sourceURL lines for distinct cells", () => {
  const uriA = `${BASE_URI}-a`;
  const uriB = `${BASE_URI}-b`;

  const expressionA = buildCellExpression("1", uriA, {
    isolate: false,
  });
  const expressionB = buildCellExpression("1", uriB, {
    isolate: false,
  });

  assert.notEqual(expressionA, expressionB);
  assert.match(expressionA, new RegExp(`sourceURL=${uriA}`));
  assert.match(expressionB, new RegExp(`sourceURL=${uriB}`));
});
