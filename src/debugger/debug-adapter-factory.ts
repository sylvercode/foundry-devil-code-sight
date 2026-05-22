import * as vscode from "vscode";

import {
  getActiveBrowserConnection,
  type ActiveBrowserConnection,
} from "../transport/browser-connect";
import {
  createDebugSessionManager,
  type DebugSessionManagerOptions,
} from "./debug-session-manager";
import {
  NotebookDebugAdapter,
  type NotebookDebugAdapterOptions,
} from "./notebook-dap-adapter";

export type GetActiveConnection = () => ActiveBrowserConnection | undefined;

type CreateSessionManager = (
  options: DebugSessionManagerOptions,
) => ReturnType<typeof createDebugSessionManager>;

type CreateNotebookDebugAdapter = (
  options: NotebookDebugAdapterOptions,
) => NotebookDebugAdapter;

export interface DebugAdapterFactoryOptions {
  getActiveConnection?: GetActiveConnection;
  createSessionManager?: CreateSessionManager;
  createAdapter?: CreateNotebookDebugAdapter;
  logger: (message: string, error?: unknown) => void;
}

export class DebugAdapterFactory
  implements vscode.DebugAdapterDescriptorFactory
{
  private readonly getActiveConnection: GetActiveConnection;
  private readonly createSessionManager: CreateSessionManager;
  private readonly createAdapter: CreateNotebookDebugAdapter;
  private readonly logger: (message: string, error?: unknown) => void;

  public constructor(options: DebugAdapterFactoryOptions) {
    this.getActiveConnection =
      options.getActiveConnection ?? getActiveBrowserConnection;
    this.createSessionManager =
      options.createSessionManager ?? createDebugSessionManager;
    this.createAdapter =
      options.createAdapter ??
      ((adapterOptions) => new NotebookDebugAdapter(adapterOptions));
    this.logger = options.logger;
  }

  public createDebugAdapterDescriptor(
    _session: vscode.DebugSession,
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    const manager = this.createSessionManager({
      getDebuggerSession: () => this.getActiveConnection()?.debugger,
      logger: this.logger,
      localize: vscode.l10n.t,
    });

    const adapter = this.createAdapter({
      sessionManager: manager,
      localize: vscode.l10n.t,
    });

    return new vscode.DebugAdapterInlineImplementation(adapter);
  }
}
