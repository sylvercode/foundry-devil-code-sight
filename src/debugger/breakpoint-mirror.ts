import type * as vscode from "vscode";

import type { BrowserDebuggerSession } from "../transport/browser-connect";

export interface BreakpointMirror {
  syncFromVsCode: () => Promise<void>;
  clearMapping: () => void;
  dispose: () => void;
}

export interface BreakpointMirrorOptions {
  debugApi: Pick<typeof vscode.debug, "breakpoints" | "onDidChangeBreakpoints">;
  getDebuggerSession: () => BrowserDebuggerSession | undefined;
  logger?: (message: string, error?: unknown) => void;
}

type SourceBreakpointLike = vscode.SourceBreakpoint & {
  condition?: string;
};

function asNotebookSourceBreakpoint(
  breakpoint: vscode.Breakpoint,
): SourceBreakpointLike | undefined {
  const candidate = breakpoint as Partial<SourceBreakpointLike>;

  if (
    candidate.location?.uri?.scheme !== "vscode-notebook-cell" ||
    candidate.enabled !== true
  ) {
    return undefined;
  }

  return breakpoint as SourceBreakpointLike;
}

function toSetBreakpointParams(breakpoint: SourceBreakpointLike): {
  url: string;
  lineNumber: number;
  columnNumber?: number;
  condition?: string;
} {
  return {
    url: breakpoint.location.uri.toString(),
    lineNumber: breakpoint.location.range.start.line,
    condition: breakpoint.condition,
  };
}

function formatBreakpointLocations(
  locations: ReadonlyArray<{
    scriptId: string;
    lineNumber: number;
    columnNumber?: number;
  }>,
): string {
  if (locations.length === 0) {
    return "[]";
  }

  return locations
    .map(
      (location) =>
        `{scriptId=${location.scriptId}, line=${location.lineNumber}, column=${location.columnNumber ?? 0}}`,
    )
    .join(", ");
}

export function createBreakpointMirror(
  options: BreakpointMirrorOptions,
): BreakpointMirror {
  const mirroredBreakpointIds = new Map<string, string>();
  let pausedDisposable: vscode.Disposable | undefined;
  let pausedSession: BrowserDebuggerSession | undefined;

  const logMirrorSetFailure = (error: unknown): void => {
    options.logger?.(
      "Failed to mirror notebook-cell breakpoint to browser: {0}",
      error,
    );
  };

  const logMirrorSetSuccess = (
    breakpoint: SourceBreakpointLike,
    browserBreakpointId: string,
    locations: ReadonlyArray<{
      scriptId: string;
      lineNumber: number;
      columnNumber?: number;
    }>,
  ): void => {
    options.logger?.(
      "Mirrored notebook-cell breakpoint registered in browser: {0}",
      `vscodeId=${breakpoint.id}; browserId=${browserBreakpointId}; url=${breakpoint.location.uri.toString()}; line=${breakpoint.location.range.start.line}; locations=${formatBreakpointLocations(locations)}`,
    );
  };

  const logMirrorRemoveFailure = (error: unknown): void => {
    options.logger?.(
      "Failed to remove notebook-cell breakpoint from browser: {0}",
      error,
    );
  };

  const ensurePausedSubscription = (): void => {
    const currentSession = options.getDebuggerSession();

    if (!currentSession) {
      pausedDisposable?.dispose();
      pausedDisposable = undefined;
      pausedSession = undefined;
      return;
    }

    if (pausedSession === currentSession) {
      return;
    }

    pausedDisposable?.dispose();
    pausedSession = currentSession;

    pausedDisposable = currentSession.onPaused((event) => {
      const hitBreakpoints = (event.hitBreakpoints ?? []).join(", ");
      options.logger?.(
        "Browser debugger pause observed on extension session: {0}",
        `reason=${event.reason}; hitBreakpoints=${hitBreakpoints.length > 0 ? hitBreakpoints : "[]"}`,
      );

      void currentSession.resume().catch((error) => {
        options.logger?.(
          "Failed to auto-resume browser debugger after pause: {0}",
          error,
        );
      });
    });
  };

  const removeMirroredBreakpoint = async (
    breakpointId: string,
  ): Promise<void> => {
    const mirroredId = mirroredBreakpointIds.get(breakpointId);

    if (!mirroredId) {
      return;
    }

    mirroredBreakpointIds.delete(breakpointId);

    const currentSession = options.getDebuggerSession();
    if (!currentSession) {
      return;
    }

    try {
      await currentSession.removeBreakpoint({ breakpointId: mirroredId });
    } catch (error) {
      logMirrorRemoveFailure(error);
    }
  };

  const addMirroredBreakpoint = async (
    breakpoint: SourceBreakpointLike,
  ): Promise<void> => {
    const currentSession = options.getDebuggerSession();

    if (!currentSession) {
      return;
    }

    try {
      const response = await currentSession.setBreakpointByUrl(
        toSetBreakpointParams(breakpoint),
      );
      mirroredBreakpointIds.set(breakpoint.id, response.breakpointId);
      logMirrorSetSuccess(
        breakpoint,
        response.breakpointId,
        response.locations,
      );
    } catch (error) {
      logMirrorSetFailure(error);
    }
  };

  const onDidChangeBreakpoints = async (
    event: vscode.BreakpointsChangeEvent,
  ): Promise<void> => {
    ensurePausedSubscription();

    for (const breakpoint of event.removed) {
      await removeMirroredBreakpoint(breakpoint.id);
    }

    for (const breakpoint of event.changed) {
      await removeMirroredBreakpoint(breakpoint.id);

      const notebookBreakpoint = asNotebookSourceBreakpoint(breakpoint);
      if (notebookBreakpoint) {
        await addMirroredBreakpoint(notebookBreakpoint);
      }
    }

    for (const breakpoint of event.added) {
      const notebookBreakpoint = asNotebookSourceBreakpoint(breakpoint);
      if (notebookBreakpoint) {
        await addMirroredBreakpoint(notebookBreakpoint);
      }
    }
  };

  const breakpointsListener = options.debugApi.onDidChangeBreakpoints(
    (event) => {
      void onDidChangeBreakpoints(event);
    },
  );

  return {
    syncFromVsCode: async () => {
      ensurePausedSubscription();
      mirroredBreakpointIds.clear();

      for (const breakpoint of options.debugApi.breakpoints) {
        const notebookBreakpoint = asNotebookSourceBreakpoint(breakpoint);
        if (!notebookBreakpoint) {
          continue;
        }

        await addMirroredBreakpoint(notebookBreakpoint);
      }
    },
    clearMapping: () => {
      mirroredBreakpointIds.clear();
      pausedDisposable?.dispose();
      pausedDisposable = undefined;
      pausedSession = undefined;
    },
    dispose: () => {
      breakpointsListener.dispose();
      pausedDisposable?.dispose();
      pausedDisposable = undefined;
      pausedSession = undefined;
      mirroredBreakpointIds.clear();
    },
  };
}
