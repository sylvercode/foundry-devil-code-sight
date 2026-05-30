import type { BrowserDebuggerSession } from "../transport/browser-connect";
import type { RuntimeObjectId } from "./cdp-types";

export type VariableReferenceKind = "scope" | "object" | "array";

export interface VariableReferenceEntry {
  objectId: RuntimeObjectId;
  kind: VariableReferenceKind;
}

export interface VariableStore {
  reserve: (entry: VariableReferenceEntry) => number;
  resolve: (variablesReference: number) => VariableReferenceEntry | undefined;
  clearForPause: () => Promise<void>;
  dispose: () => Promise<void>;
}

export interface CreateVariableStoreOptions {
  debuggerSession: BrowserDebuggerSession;
  logger: (message: string, error?: unknown) => void;
}

const FIRST_VARIABLE_REFERENCE = 1000;

export function createVariableStore({
  debuggerSession,
  logger,
}: CreateVariableStoreOptions): VariableStore {
  let nextReference = FIRST_VARIABLE_REFERENCE;
  let disposed = false;
  const references = new Map<number, VariableReferenceEntry>();
  const trackedObjectIds = new Set<RuntimeObjectId>();

  const resetForPause = (): void => {
    references.clear();
    nextReference = FIRST_VARIABLE_REFERENCE;
  };

  const releaseTrackedObjects = async (): Promise<void> => {
    const objectIds = [...trackedObjectIds];
    trackedObjectIds.clear();

    await Promise.all(
      objectIds.map(async (objectId) => {
        try {
          await debuggerSession.releaseObject({ objectId });
        } catch (error) {
          logger(
            "[debug] Runtime.releaseObject failed for variable handle.",
            error,
          );
        }
      }),
    );
  };

  return {
    reserve: (entry) => {
      if (disposed) {
        return 0;
      }

      const reference = nextReference;
      nextReference += 1;
      references.set(reference, entry);
      trackedObjectIds.add(entry.objectId);
      return reference;
    },
    resolve: (variablesReference) => {
      if (disposed) {
        return undefined;
      }

      return references.get(variablesReference);
    },
    clearForPause: async () => {
      await releaseTrackedObjects();
      resetForPause();
    },
    dispose: async () => {
      if (disposed) {
        return;
      }

      await releaseTrackedObjects();
      disposed = true;
      references.clear();
      trackedObjectIds.clear();
    },
  };
}
