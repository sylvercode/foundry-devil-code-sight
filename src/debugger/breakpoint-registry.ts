import type { Localize } from "../config/endpoint-config";
import type { BrowserDebuggerSession } from "../transport/browser-connect";

interface RemoveBreakpointParams {
  breakpointId: string;
}

type BreakpointLocations = Awaited<
  ReturnType<BrowserDebuggerSession["setBreakpointByUrl"]>
>["locations"];

export interface DesiredBreakpoint {
  line: number;
  column?: number;
  condition?: string;
  logMessage?: string;
  hitCondition?: string;
}

export interface BoundBreakpoint {
  breakpointId: string;
  line: number;
  column?: number;
  condition?: string;
  locations: BreakpointLocations;
  verified: boolean;
  message?: string;
}

export interface BreakpointRegistry {
  replace: (
    url: string,
    desired: DesiredBreakpoint[],
  ) => Promise<BoundBreakpoint[]>;
  resolveRuntimeBreakpoint: (
    breakpointId: string,
    location: BreakpointLocations[number],
  ) =>
    | {
        url: string;
        breakpointId: string;
        line: number;
        column?: number;
      }
    | undefined;
  clear: (url: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

export interface CreateBreakpointRegistryOptions {
  debuggerSession: BrowserDebuggerSession;
  logger: (message: string, error?: unknown) => void;
  localize?: Localize;
}

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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }

  return String(error);
}

function toBreakpointKey({
  line,
  column,
  condition,
}: {
  line: number;
  column?: number;
  condition?: string;
}): string {
  return `${line}:${column ?? 0}:${condition ?? ""}`;
}

function resolveBoundLine(
  locations: BreakpointLocations,
  fallbackLine: number,
): number {
  const firstLocation = locations[0];
  if (!firstLocation || typeof firstLocation.lineNumber !== "number") {
    return fallbackLine;
  }

  return firstLocation.lineNumber + 1;
}

function resolveBoundColumn(
  locations: BreakpointLocations,
  fallbackColumn: number | undefined,
): number | undefined {
  const firstLocation = locations[0];
  if (firstLocation && typeof firstLocation.columnNumber === "number") {
    return firstLocation.columnNumber;
  }

  return fallbackColumn;
}

function toCdpCondition(condition: string | undefined): string | undefined {
  if (typeof condition !== "string" || condition.trim().length === 0) {
    return undefined;
  }

  // Guard conditional evaluation so TDZ/reference failures evaluate as false.
  return `(function(){try{return (${condition});}catch{return false;}})()`;
}

export function createBreakpointRegistry({
  debuggerSession,
  logger,
  localize = defaultLocalize,
}: CreateBreakpointRegistryOptions): BreakpointRegistry {
  const breakpointsByUrl = new Map<string, Map<string, BoundBreakpoint>>();

  const clearBoundBreakpoints = async (
    breakpoints: Iterable<BoundBreakpoint>,
  ): Promise<void> => {
    await Promise.all(
      Array.from(breakpoints, async (breakpoint) => {
        try {
          await debuggerSession.removeBreakpoint({
            breakpointId: breakpoint.breakpointId,
          } as RemoveBreakpointParams);
        } catch (error) {
          logger(
            `Failed to remove breakpoint ${breakpoint.breakpointId}`,
            error,
          );
        }
      }),
    );
  };

  return {
    replace: async (url, desired) => {
      const previous =
        breakpointsByUrl.get(url) ?? new Map<string, BoundBreakpoint>();

      const desiredByKey = new Map<string, DesiredBreakpoint>();
      const desiredByIndex: Array<{ key: string; desired: DesiredBreakpoint }> =
        [];

      for (const entry of desired) {
        const key = toBreakpointKey(entry);
        desiredByIndex.push({ key, desired: entry });

        if (!desiredByKey.has(key)) {
          desiredByKey.set(key, entry);
        }
      }

      const removals = Array.from(previous.entries()).filter(
        ([key]) => !desiredByKey.has(key),
      );

      await Promise.all(
        removals.map(async ([key, bound]) => {
          try {
            await debuggerSession.removeBreakpoint({
              breakpointId: bound.breakpointId,
            } as RemoveBreakpointParams);
          } catch (error) {
            logger(`Failed to remove breakpoint ${bound.breakpointId}`, error);
          } finally {
            previous.delete(key);
          }
        }),
      );

      const next = new Map<string, BoundBreakpoint>();
      const createdByKey = new Map<string, BoundBreakpoint>();

      await Promise.all(
        Array.from(desiredByKey.entries(), async ([key, candidate]) => {
          const existing = previous.get(key);
          if (existing) {
            next.set(key, existing);
            createdByKey.set(key, existing);
            return;
          }

          try {
            const result = await debuggerSession.setBreakpointByUrl({
              url,
              lineNumber: candidate.line - 1,
              columnNumber: candidate.column,
              condition: toCdpCondition(candidate.condition),
            });

            const locations = result.locations;

            if (locations.length === 0) {
              const unverified: BoundBreakpoint = {
                breakpointId: result.breakpointId,
                line: candidate.line,
                column: candidate.column,
                condition: candidate.condition,
                locations,
                verified: false,
                message: localize(
                  "Breakpoint could not be bound: {0}",
                  "No runtime locations resolved.",
                ),
              };
              next.set(key, unverified);
              createdByKey.set(key, unverified);
              return;
            }

            const bound: BoundBreakpoint = {
              breakpointId: result.breakpointId,
              line: resolveBoundLine(locations, candidate.line),
              column: resolveBoundColumn(locations, candidate.column),
              condition: candidate.condition,
              locations,
              verified: true,
            };

            next.set(key, bound);
            createdByKey.set(key, bound);
          } catch (error) {
            createdByKey.set(key, {
              breakpointId: key,
              line: candidate.line,
              column: candidate.column,
              condition: candidate.condition,
              locations: [],
              verified: false,
              message: localize(
                "Breakpoint could not be bound: {0}",
                toErrorMessage(error),
              ),
            });
          }
        }),
      );

      if (next.size > 0) {
        breakpointsByUrl.set(url, next);
      } else {
        breakpointsByUrl.delete(url);
      }

      return desiredByIndex.map(({ key, desired: candidate }) => {
        const bound = createdByKey.get(key);
        if (bound) {
          return bound;
        }

        return {
          breakpointId: key,
          line: candidate.line,
          column: candidate.column,
          condition: candidate.condition,
          locations: [],
          verified: false,
          message: localize(
            "Breakpoint could not be bound: {0}",
            "No runtime locations resolved.",
          ),
        };
      });
    },
    resolveRuntimeBreakpoint: (breakpointId, location) => {
      for (const [url, boundForUrl] of breakpointsByUrl.entries()) {
        for (const bound of boundForUrl.values()) {
          if (bound.breakpointId !== breakpointId) {
            continue;
          }

          const nextLine =
            typeof location.lineNumber === "number"
              ? location.lineNumber + 1
              : bound.line;
          const nextColumn =
            typeof location.columnNumber === "number"
              ? location.columnNumber
              : bound.column;

          bound.line = nextLine;
          bound.column = nextColumn;
          bound.locations = [location];
          bound.verified = true;
          bound.message = undefined;

          return {
            url,
            breakpointId,
            line: nextLine,
            column: nextColumn,
          };
        }
      }

      return undefined;
    },
    clear: async (url) => {
      const boundForUrl = breakpointsByUrl.get(url);
      if (!boundForUrl) {
        return;
      }

      breakpointsByUrl.delete(url);
      await clearBoundBreakpoints(boundForUrl.values());
    },
    clearAll: async () => {
      const allBound = Array.from(breakpointsByUrl.values());
      breakpointsByUrl.clear();

      await Promise.all(
        allBound.map(async (bound) => clearBoundBreakpoints(bound.values())),
      );
    },
  };
}
