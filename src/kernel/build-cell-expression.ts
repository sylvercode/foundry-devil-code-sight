export interface BuildCellExpressionOptions {
  isolate: boolean;
}

export function buildCellExpression(
  userCode: string,
  sourceUri: string,
  options: BuildCellExpressionOptions,
): string {
  if (!options.isolate) {
    return `${userCode}\n//# sourceURL=${sourceUri}\n`;
  }

  const isolationStart = "await (async()=>{";
  const isolationEnd = `})()\n//# sourceURL=${sourceUri}\n`;

  if (userCode.length === 0) {
    return `${isolationStart}${isolationEnd}`;
  }

  const lines = userCode.split("\n");

  if (lines.length === 1) {
    const onlyLine = lines[0] ?? "";
    return `${isolationStart}${onlyLine}${isolationEnd}`;
  }

  const firstLine = lines[0] ?? "";
  const lastIndex = lines.length - 1;
  const currentLastLine = lines[lastIndex] ?? "";

  lines[0] = `${isolationStart}${firstLine}`;
  lines[lastIndex] = `${currentLastLine}${isolationEnd}`;

  return `${lines.join("\n")}`;
}
