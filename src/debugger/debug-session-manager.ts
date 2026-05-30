import type * as vscode from "vscode";
import type ProtocolMappingApi from "devtools-protocol/types/protocol-mapping";

import type { BrowserDebuggerSession } from "../transport/browser-connect";
import { onDidChangeConnectionState } from "../transport/connection-state";
import type { Localize } from "../config/endpoint-config";
import { createVariableStore, type VariableStore } from "./variable-store";
import {
  createBreakpointRegistry,
  type BreakpointRegistry,
  type DesiredBreakpoint,
} from "./breakpoint-registry";

export type DebugSessionTerminationReason = "connection-lost";

export interface DebugBreakpointResolvedEvent {
  url: string;
  breakpointId: string;
  line: number;
  column?: number;
}

export interface DebugSessionManager {
  launch: () => Promise<void>;
  disconnect: () => Promise<void>;
  terminate: () => Promise<void>;
  getDebuggerSession: () => BrowserDebuggerSession | undefined;
  getBreakpointRegistry: () => BreakpointRegistry | undefined;
  getVariableStore: () => VariableStore | undefined;
  getPausedEvent: () => DebuggerPausedEvent | undefined;
  getPauseVersion: () => number;
  recordSetBreakpoints: (url: string, desired: DesiredBreakpoint[]) => void;
  onDidTerminate: (
    listener: (reason: DebugSessionTerminationReason) => void,
  ) => vscode.Disposable;
  onDidBreakpointResolved: (
    listener: (event: DebugBreakpointResolvedEvent) => void,
  ) => vscode.Disposable;
  dispose: () => void;
}

export interface DebugSessionManagerOptions {
  getDebuggerSession: () => BrowserDebuggerSession | undefined;
  logger: (message: string, error?: unknown) => void;
  localize?: Localize;
}

type DebuggerPausedEvent = ProtocolMappingApi.Events["Debugger.paused"][0];

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
  const breakpointResolvedEmitter =
    new SimpleEmitter<DebugBreakpointResolvedEvent>();

  let pausedDisposable: vscode.Disposable | undefined;
  let breakpointResolvedDisposable: vscode.Disposable | undefined;
  let runningSession: BrowserDebuggerSession | undefined;
  let breakpointRegistry: BreakpointRegistry | undefined;
  let variableStore: VariableStore | undefined;
  let pausedEvent: DebuggerPausedEvent | undefined;
  let pauseVersion = 0;
  let running = false;
  let emittedConnectionLost = false;
  const cachedBreakpointsByUrl = new Map<string, DesiredBreakpoint[]>();

  const clearPausedSubscription = (): void => {
    pausedDisposable?.dispose();
    pausedDisposable = undefined;
  };

  const clearBreakpointResolvedSubscription = (): void => {
    breakpointResolvedDisposable?.dispose();
    breakpointResolvedDisposable = undefined;
  };

  const stopRunningSession = async (): Promise<void> => {
    const sessionToStop = runningSession;
    const registryToClear = breakpointRegistry;
    const variableStoreToDispose = variableStore;
    running = false;
    runningSession = undefined;
    breakpointRegistry = undefined;
    variableStore = undefined;
    pausedEvent = undefined;
    pauseVersion = 0;
    clearPausedSubscription();
    clearBreakpointResolvedSubscription();

    if (!sessionToStop) {
      return;
    }

    if (registryToClear) {
      await registryToClear.clearAll();
    }

    if (variableStoreToDispose) {
      await variableStoreToDispose.dispose();
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
      pausedDisposable = session.onPaused((event) => {
        pausedEvent = event;
        pauseVersion += 1;
      });

      const nextVariableStore = createVariableStore({
        debuggerSession: session,
        logger,
      });
      variableStore = nextVariableStore;

      const nextRegistry = createBreakpointRegistry({
        debuggerSession: session,
        logger,
        localize,
      });
      breakpointRegistry = nextRegistry;

      clearBreakpointResolvedSubscription();
      breakpointResolvedDisposable = session.onBreakpointResolved((event) => {
        const registry = breakpointRegistry;
        if (!registry) {
          return;
        }

        const resolved = registry.resolveRuntimeBreakpoint(
          event.breakpointId,
          event.location,
        );

        if (!resolved) {
          return;
        }

        breakpointResolvedEmitter.fire(resolved);
      });

      for (const [url, desired] of cachedBreakpointsByUrl.entries()) {
        await nextRegistry.replace(url, desired);
      }

      runningSession = session;
      running = true;
    },
    disconnect: async () => {
      await stopRunningSession();
    },
    terminate: async () => {
      await stopRunningSession();
    },
    getDebuggerSession: () => runningSession,
    getBreakpointRegistry: () => breakpointRegistry,
    getVariableStore: () => variableStore,
    getPausedEvent: () => pausedEvent,
    getPauseVersion: () => pauseVersion,
    recordSetBreakpoints: (url, desired) => {
      cachedBreakpointsByUrl.set(url, [...desired]);
    },
    onDidTerminate: (listener) => terminateEmitter.event(listener),
    onDidBreakpointResolved: (listener) =>
      breakpointResolvedEmitter.event(listener),
    dispose: () => {
      disconnectFromStateChanges.dispose();
      clearPausedSubscription();
      clearBreakpointResolvedSubscription();
      terminateEmitter.dispose();
      breakpointResolvedEmitter.dispose();
      running = false;
      runningSession = undefined;
      breakpointRegistry = undefined;
      variableStore = undefined;
      pausedEvent = undefined;
      pauseVersion = 0;
      emittedConnectionLost = false;
    },
  };
}
