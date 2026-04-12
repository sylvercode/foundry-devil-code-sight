export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface ConnectionStateStoreTransitionHandler {
  beginTransition: (newState: ConnectionState) => number;
  transitionTo: (transitionId: number, state: ConnectionState) => boolean;
  cancelTransitions?: () => void;
}

export interface ConnectionStateStore extends Required<ConnectionStateStoreTransitionHandler> {
  getState: () => ConnectionState;
  setState: (state: ConnectionState) => void;
  getHistory: () => ConnectionState[];
}

export interface ConnectionStoreHandler {
  connectionStateStore: ConnectionStateStore;
  onConnectionStateChanged?: (state: ConnectionState) => void;
}

export function createConnectionStateStore({
  initialState,
  onConnectionStateChanged,
}: {
  initialState?: ConnectionState;
  onConnectionStateChanged?: (state: ConnectionState) => void;
} = {}): ConnectionStateStore {
  let state = initialState;
  const history: ConnectionState[] = [initialState ?? "disconnected"];
  let activeTransitionId = 0;

  const setState = (nextState: ConnectionState) => {
    onConnectionStateChanged?.(nextState);
    state = nextState;
    history.push(nextState);
  };

  return {
    getState: () => state ?? "disconnected",
    setState,
    getHistory: () => [...history],
    beginTransition: (newState: ConnectionState) => {
      activeTransitionId += 1;
      setState(newState);
      return activeTransitionId;
    },
    transitionTo: (transitionId, state) => {
      if (transitionId === activeTransitionId) {
        setState(state);
        return true;
      }
      return false;
    },
    cancelTransitions: () => {
      activeTransitionId += 1;
    },
  };
}

export async function withConnectTransition<T>(
  store: ConnectionStateStoreTransitionHandler,
  connectAttempt: () => Promise<T>,
  isSuccess: (result: T) => boolean,
  onAborted: () => void,
): Promise<T> {
  const transitionId = store.beginTransition("connecting");

  try {
    const result = await connectAttempt();

    const transitionApplied = store.transitionTo(
      transitionId,
      isSuccess(result) ? "connected" : "error",
    );

    if (!transitionApplied) {
      onAborted();
    }

    return result;
  } catch (error) {
    const transitionApplied = store.transitionTo(transitionId, "error");

    if (!transitionApplied) {
      onAborted();
    }

    throw error;
  }
}
