import type { Localize } from "../../../src/config/endpoint-config";

type LocalizeValue = string | number | boolean;

function applyNamedArgs(
  template: string,
  args: Record<string, LocalizeValue>,
): string {
  let rendered = template;
  for (const [key, value] of Object.entries(args)) {
    rendered = rendered.replace(`{${key}}`, String(value));
  }
  return rendered;
}

function applyIndexedArgs(template: string, args: LocalizeValue[]): string {
  let rendered = template;
  for (const [index, value] of args.entries()) {
    rendered = rendered.replace(`{${index}}`, String(value));
  }
  return rendered;
}

export function createLocalizeMock(): Localize {
  return (messageOrOptions: unknown, ...args: unknown[]): string => {
    if (typeof messageOrOptions === "string") {
      if (
        args.length === 1 &&
        typeof args[0] === "object" &&
        args[0] !== null &&
        !Array.isArray(args[0])
      ) {
        return applyNamedArgs(
          messageOrOptions,
          args[0] as Record<string, LocalizeValue>,
        );
      }

      return applyIndexedArgs(messageOrOptions, args as LocalizeValue[]);
    }

    const options = messageOrOptions as {
      message: string;
      args?: LocalizeValue[] | Record<string, LocalizeValue>;
    };

    if (Array.isArray(options.args)) {
      return applyIndexedArgs(options.message, options.args);
    }

    if (options.args && typeof options.args === "object") {
      return applyNamedArgs(options.message, options.args);
    }

    return options.message;
  };
}
