import type * as vscode from "vscode";
import type { Localize } from "../config/endpoint-config";
import {
  ConnectionStoreHandler,
  type ConnectionStateStore,
} from "../transport/connection-state";
import { disconnectActiveBrowserConnection } from "../transport/browser-connect";

export interface DisconnectCommandRuntime {
  localize: Localize;
  connectionStateStore: ConnectionStateStore;
  cancelInFlightTransitions: () => void;
  disconnectActiveConnection: () => Promise<void>;
  showInformationMessage: (
    message: string,
  ) => PromiseLike<string | undefined> | void;
}

export interface DisconnectCommandRuntimeOptions extends ConnectionStoreHandler {
  disconnectActiveConnection?: () => Promise<void>;
}

export async function executeDisconnectCommand(
  runtime: DisconnectCommandRuntime,
): Promise<void> {
  runtime.cancelInFlightTransitions();
  await runtime.disconnectActiveConnection();
  runtime.connectionStateStore.setState("disconnected");

  try {
    await runtime.showInformationMessage(
      runtime.localize(
        "Jupyter Browser Kernel: Disconnected from browser target.",
      ),
    );
  } catch {
    // non-fatal: info message failed to display
  }
}

export function createDefaultDisconnectCommandRuntime(
  vscodeApi: typeof vscode,
  options: DisconnectCommandRuntimeOptions,
): DisconnectCommandRuntime {
  const connectionStateStore = options.connectionStateStore;

  return {
    localize: vscodeApi.l10n.t,
    connectionStateStore,
    cancelInFlightTransitions: () => {
      connectionStateStore.cancelTransitions();
    },
    disconnectActiveConnection:
      options.disconnectActiveConnection ?? disconnectActiveBrowserConnection,
    showInformationMessage: (message) =>
      vscodeApi.window.showInformationMessage(message),
  };
}
