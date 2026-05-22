import type * as vscode from "vscode";
import {
  DebugSession,
  InitializedEvent,
  TerminatedEvent,
  Thread,
} from "@vscode/debugadapter";
import type { DebugProtocol } from "@vscode/debugprotocol";

import type {
  DebugSessionManager,
  DebugSessionTerminationReason,
} from "./debug-session-manager";
import type { Localize } from "../config/endpoint-config";

export interface NotebookDebugAdapterOptions {
  sessionManager: DebugSessionManager;
  localize?: Localize;
}

const defaultLocalize = ((messageOrOptions: string | { message: string }) =>
  typeof messageOrOptions === "string"
    ? messageOrOptions
    : messageOrOptions.message) as Localize;

export class NotebookDebugAdapter
  extends DebugSession
  implements vscode.DebugAdapter
{
  private readonly sessionManager: DebugSessionManager;
  private readonly localize: Localize;
  private readonly terminationSubscription: vscode.Disposable;
  private disposed = false;

  public constructor({
    sessionManager,
    localize = defaultLocalize,
  }: NotebookDebugAdapterOptions) {
    super();
    this.sessionManager = sessionManager;
    this.localize = localize;
    this.terminationSubscription = this.sessionManager.onDidTerminate(
      (reason) => {
        this.emitTermination(reason);
      },
    );
  }

  protected override initializeRequest(
    response: DebugProtocol.InitializeResponse,
    _args: DebugProtocol.InitializeRequestArguments,
  ): void {
    response.success = true;
    response.body = {
      supportsBreakpointLocationsRequest: true,
      supportsConfigurationDoneRequest: true,
      supportsTerminateRequest: true,
      supportTerminateDebuggee: false,
      supportsEvaluateForHovers: true,
    };

    this.sendResponse(response);
  }

  protected override async launchRequest(
    response: DebugProtocol.LaunchResponse,
    _args: DebugProtocol.LaunchRequestArguments,
  ): Promise<void> {
    try {
      await this.sessionManager.launch();
      response.success = true;
      this.sendResponse(response);
      this.sendEvent(new InitializedEvent());
    } catch (error) {
      this.sendErrorResponse(
        response,
        0,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  protected override async attachRequest(
    response: DebugProtocol.AttachResponse,
    _args: DebugProtocol.AttachRequestArguments,
  ): Promise<void> {
    await this.launchRequest(response, {});
  }

  protected override threadsRequest(
    response: DebugProtocol.ThreadsResponse,
  ): void {
    response.success = true;
    response.body = {
      threads: [new Thread(1, "Notebook cells")],
    };
    this.sendResponse(response);
  }

  protected override async disconnectRequest(
    response: DebugProtocol.DisconnectResponse,
    _args: DebugProtocol.DisconnectArguments,
  ): Promise<void> {
    await this.sessionManager.disconnect();
    response.success = true;
    this.sendResponse(response);
  }

  protected override async terminateRequest(
    response: DebugProtocol.TerminateResponse,
    _args: DebugProtocol.TerminateArguments,
  ): Promise<void> {
    await this.sessionManager.terminate();
    response.success = true;
    this.sendResponse(response);
  }

  public override dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.terminationSubscription.dispose();
    this.sessionManager.dispose();
    super.dispose();
  }

  private emitTermination(reason: DebugSessionTerminationReason): void {
    if (reason === "connection-lost") {
      this.sendEvent(
        new TerminatedEvent({
          reason: "connection-lost",
          description: this.localize(
            "Browser connection lost; debug session terminated.",
          ),
        }),
      );
    }
  }
}
