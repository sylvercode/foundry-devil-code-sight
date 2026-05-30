import type Protocol from "devtools-protocol/types/protocol";

import type { Localize } from "../config/endpoint-config";

const defaultLocalize = ((
  messageOrOptions: string | { message: string },
  ...args: unknown[]
): string => {
  const template =
    typeof messageOrOptions === "string"
      ? messageOrOptions
      : messageOrOptions.message;

  let rendered = template;
  for (const [index, value] of args.entries()) {
    rendered = rendered.replace(`{${index}}`, String(value));
  }

  return rendered;
}) as Localize;

function applyLengthLimit(
  value: string,
  maxLength: number,
  localize: Localize,
): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}… ${localize("Value truncated (over {0} characters).", maxLength)}`;
}

export function formatRemoteObject(
  obj: Protocol.Runtime.RemoteObject,
  maxLength = 10240,
  localize: Localize = defaultLocalize,
): string {
  const functionName = obj.description ?? "anonymous";
  if (obj.type === "function") {
    return applyLengthLimit(
      localize("[Function: {0}]", functionName),
      maxLength,
      localize,
    );
  }

  if (obj.subtype === "node") {
    return applyLengthLimit(
      obj.description ?? "[HTMLElement]",
      maxLength,
      localize,
    );
  }

  if (obj.type !== "object") {
    if (typeof obj.value === "string") {
      return applyLengthLimit(obj.value, maxLength, localize);
    }

    if (obj.value === undefined) {
      return applyLengthLimit(
        obj.description ?? "undefined",
        maxLength,
        localize,
      );
    }

    return applyLengthLimit(String(obj.value), maxLength, localize);
  }

  if (typeof obj.description === "string" && obj.description.length > 0) {
    return applyLengthLimit(obj.description, maxLength, localize);
  }

  const preview = obj.preview;
  if (
    preview &&
    Array.isArray(preview.properties) &&
    preview.properties.length > 0
  ) {
    const renderedPreview = preview.properties
      .map((property) => `${property.name}: ${property.value}`)
      .join(", ");

    const wrapperStart = preview.subtype === "array" ? "[" : "{";
    const wrapperEnd = preview.subtype === "array" ? "]" : "}";
    return applyLengthLimit(
      `${wrapperStart}${renderedPreview}${wrapperEnd}`,
      maxLength,
      localize,
    );
  }

  if (obj.subtype === "array") {
    return localize("[Array]");
  }

  return localize("[Object]");
}

export function formatRemoteType(obj: Protocol.Runtime.RemoteObject): string {
  return obj.subtype ?? obj.type;
}
