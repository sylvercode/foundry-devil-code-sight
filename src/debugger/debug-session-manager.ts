import type * as vscode from "vscode";

import type { BrowserDebuggerSession } from "../transport/browser-connect";
import { onDidChangeConnectionState } from "../transport/connection-state";
import type { Localize } from "../config/endpoint-config";
import {
  createBreakpointRegistry,
  type BreakpointRegistry,
  type DesiredBreakpoint,
} from "./breakpoint-registry";

export type DebugSessionTerminationReason = "connection-lost";

export interface DebugSessionManager {
  launch: () => Promise<void>;
  disconnect: () => Promise<void>;
  terminate: () => Promise<void>;
  getBreakpointRegistry: () => BreakpointRegistry | undefined;
  recordSetBreakpoints: (url: string, desired: DesiredBreakpoint[]) => void;
  onDidTerminate: (
    listener: (reason: DebugSessionTerminationReason) => void,
  ) => vscode.Disposable;
  dispose: () => void;
}

export interface DebugSessionManagerOptions {
  getDebuggerSession: () => BrowserDebuggerSession | undefined;
  logger: (message: string, error?: unknown) => void;
  localize?: Localize;
}

interface DisposableLike {
  dispose: () => void;
}

class SimpleEmitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  public readonly event = (listener: (value: T) => void): DisposableLike => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };

  public fire(value: T): void {
    for (const listener of this.listeners) {
      listener(value);
    }
  }

  public dispose(): void {
    this.listeners.clear();
  }
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

export function createDebugSessionManager({
  getDebuggerSession,
  logger,
  localize = defaultLocalize,
}: DebugSessionManagerOptions): DebugSessionManager {
  const terminateEmitter = new SimpleEmitter<DebugSessionTerminationReason>();

  let pausedDisposable: vscode.Disposable | undefined;
  let runningSession: BrowserDebuggerSession | undefined;
  let breakpointRegistry: BreakpointRegistry | undefined;
  let running = false;
  let emittedConnectionLost = false;
  const cachedBreakpointsByUrl = new Map<string, DesiredBreakpoint[]>();

  const clearPausedSubscription = (): void => {
    pausedDisposable?.dispose();
    pausedDisposable = undefined;
  };

  const stopRunningSession = async (): Promise<void> => {
    const sessionToStop = runningSession;
    const registryToClear = breakpointRegistry;
    running = false;
    runningSession = undefined;
    breakpointRegistry = undefined;
    clearPausedSubscription();

    if (!sessionToStop) {
      return;
    }

    if (registryToClear) {
      await registryToClear.clearAll();
    }

    try {
      await sessionToStop.disable();
    } catch {
      // Best-effort cleanup during shutdown.
    }
  };

  const disconnectFromStateChanges = onDidChangeConnectionState((state) => {
    if (!running || emittedConnectionLost) {
      return;
    }

    if (state !== "disconnected" && state !== "error") {
      return;
    }

    emittedConnectionLost = true;
    void stopRunningSession().finally(() => {
      terminateEmitter.fire("connection-lost");
    });
  });

  return {
    launch: async () => {
      if (running) {
        return;
      }

      const session = getDebuggerSession();
      if (!session) {
        throw new Error(
          localize(
            "Cannot start debug session: connect to a browser target first.",
          ),
        );
      }

      emittedConnectionLost = false;

      let lostDuringEnable = false;
      const lostDuringEnableSub = onDidChangeConnectionState((state) => {
        if (state === "disconnected" || state === "error") {
          lostDuringEnable = true;
        }
      });

      try {
        await session.enable();
      } catch (error) {
        lostDuringEnableSub.dispose();
        logger(
          "Failed to enable Debugger domain on browser session: {0}",
          error,
        );
        throw new Error(
          localize(
            "Failed to enable Debugger domain on browser session: {0}",
            toErrorMessage(error),
          ),
        );
      }
      lostDuringEnableSub.dispose();

      if (lostDuringEnable) {
        try {
          await session.disable();
        } catch {
          // Best-effort cleanup; connection is already gone.
        }
        throw new Error(
          localize("Browser connection lost; debug session terminated."),
        );
      }

      clearPausedSubscription();
      pausedDisposable = session.onPaused(() => {
        // Pause handling is implemented in Story 10.2.
      });

      const nextRegistry = createBreakpointRegistry({
        debuggerSession: session,
        logger,
        localize,
      });

      for (const [url, desired] of cachedBreakpointsByUrl.entries()) {
        await nextRegistry.replace(url, desired);
      }

      breakpointRegistry = nextRegistry;

      runningSession = session;
      running = true;
    },
    disconnect: async () => {
      await stopRunningSession();
    },
    terminate: async () => {
      await stopRunningSession();
    },
    getBreakpointRegistry: () => breakpointRegistry,
    recordSetBreakpoints: (url, desired) => {
      cachedBreakpointsByUrl.set(url, [...desired]);
    },
    onDidTerminate: (listener) => terminateEmitter.event(listener),
    dispose: () => {
      disconnectFromStateChanges.dispose();
      clearPausedSubscription();
      terminateEmitter.dispose();
      running = false;
      runningSession = undefined;
      breakpointRegistry = undefined;
      emittedConnectionLost = false;
    },
  };
}
