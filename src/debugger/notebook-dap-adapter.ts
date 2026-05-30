import type * as vscode from "vscode";
import {
  BreakpointEvent,
  DebugSession,
  InitializedEvent,
  TerminatedEvent,
  Thread,
} from "@vscode/debugadapter";
import type { DebugProtocol } from "@vscode/debugprotocol";

import type {
  DebugBreakpointResolvedEvent,
  DebugSessionManager,
  DebugSessionTerminationReason,
} from "./debug-session-manager";
import type { Localize } from "../config/endpoint-config";
import type { DesiredBreakpoint } from "./breakpoint-registry";

export interface NotebookDebugAdapterOptions {
  sessionManager: DebugSessionManager;
  localize?: Localize;
  logger?: (message: string, error?: unknown) => void;
}

const defaultLocalize = ((messageOrOptions: string | { message: string }) =>
  typeof messageOrOptions === "string"
    ? messageOrOptions
    : messageOrOptions.message) as Localize;

const noopLogger = (): void => undefined;

function createSource(
  pathOrName: string,
  source?: DebugProtocol.Source,
): DebugProtocol.Source {
  return {
    ...source,
    path: source?.path ?? pathOrName,
    name: source?.name ?? pathOrName,
  };
}

function resolveSourceUrl(source?: DebugProtocol.Source): string | undefined {
  return source?.path ?? source?.name;
}

function toDesiredBreakpoints(
  breakpoints: DebugProtocol.SourceBreakpoint[] | undefined,
): DesiredBreakpoint[] {
  return (breakpoints ?? []).map((breakpoint) => ({
    line: breakpoint.line,
    column: breakpoint.column,
    condition: breakpoint.condition,
    logMessage: breakpoint.logMessage,
    hitCondition: breakpoint.hitCondition,
  }));
}

function createUnverifiedBreakpoints(
  source: DebugProtocol.Source,
  desired: DesiredBreakpoint[],
  message: string,
): DebugProtocol.Breakpoint[] {
  return desired.map((breakpoint) => ({
    verified: false,
    line: breakpoint.line,
    source,
    message,
  }));
}

export class NotebookDebugAdapter
  extends DebugSession
  implements vscode.DebugAdapter
{
  private readonly sessionManager: DebugSessionManager;
  private readonly localize: Localize;
  private readonly logger: (message: string, error?: unknown) => void;
  private readonly terminationSubscription: vscode.Disposable;
  private readonly breakpointResolvedSubscription: vscode.Disposable;
  private disposed = false;
  private terminatedEmitted = false;

  public constructor({
    sessionManager,
    localize = defaultLocalize,
    logger = noopLogger,
  }: NotebookDebugAdapterOptions) {
    super();
    this.sessionManager = sessionManager;
    this.localize = localize;
    this.logger = logger;
    this.terminationSubscription = this.sessionManager.onDidTerminate(
      (reason) => {
        this.emitTermination(reason);
      },
    );
    this.breakpointResolvedSubscription =
      this.sessionManager.onDidBreakpointResolved((event) => {
        this.emitBreakpointResolved(event);
      });
  }

  private sendTerminatedOnce(event: TerminatedEvent): void {
    if (this.terminatedEmitted) {
      return;
    }
    this.terminatedEmitted = true;
    this.sendEvent(event);
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
      supportsConditionalBreakpoints: true,
      supportsHitConditionalBreakpoints: false,
      supportsLogPoints: false,
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
      threads: [new Thread(1, this.localize("Notebook cells"))],
    };
    this.sendResponse(response);
  }

  protected override async setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments,
  ): Promise<void> {
    const requestedUrl = resolveSourceUrl(args.source);
    const desired = toDesiredBreakpoints(args.breakpoints);
    this.logger(
      this.localize(
        "[debug] setBreakpoints received for source '{0}' with {1} requested breakpoint(s).",
        requestedUrl ?? this.localize("(missing source)"),
        String(desired.length),
      ),
    );

    if (!requestedUrl) {
      this.logger(
        this.localize(
          "[debug] setBreakpoints ignored because no source URL was provided.",
        ),
      );
      response.success = true;
      response.body = {
        breakpoints: [],
      };
      this.sendResponse(response);
      return;
    }

    this.sessionManager.recordSetBreakpoints(requestedUrl, desired);

    const source = createSource(requestedUrl, args.source);
    const inactiveMessage = this.localize(
      "Debug session not active; breakpoint will be retried.",
    );

    const registry = this.sessionManager.getBreakpointRegistry();
    if (!registry) {
      this.logger(
        this.localize(
          "[debug] setBreakpoints deferred for source '{0}' because debug session is not active.",
          requestedUrl,
        ),
      );
      response.success = true;
      response.body = {
        breakpoints: createUnverifiedBreakpoints(
          source,
          desired,
          inactiveMessage,
        ),
      };
      this.sendResponse(response);
      return;
    }

    const logpointInfo = this.localize(
      "Logpoints and hit-count breakpoints are not yet supported by the Browser Kernel debugger; binding as unconditional.",
    );

    const bound = await registry.replace(requestedUrl, desired);
    const verifiedCount = bound.filter(
      (breakpoint) => breakpoint.verified,
    ).length;
    const unverifiedCount = bound.length - verifiedCount;
    this.logger(
      this.localize(
        "[debug] setBreakpoints applied for source '{0}': verified={1}, unverified={2}.",
        requestedUrl,
        String(verifiedCount),
        String(unverifiedCount),
      ),
    );
    for (const breakpoint of bound) {
      this.logger(
        this.localize(
          "[debug] breakpoint binding result source='{0}' line={1} verified={2} message='{3}'.",
          requestedUrl,
          String(breakpoint.line),
          breakpoint.verified ? this.localize("true") : this.localize("false"),
          breakpoint.message ?? this.localize("(none)"),
        ),
      );
    }

    const breakpoints: DebugProtocol.Breakpoint[] = bound.map(
      (breakpoint, index) => {
        const requested = desired[index];
        const hasDeferredFeatures =
          Boolean(requested?.logMessage) || Boolean(requested?.hitCondition);

        return {
          verified: breakpoint.verified,
          line: breakpoint.line,
          source,
          message:
            breakpoint.message ??
            (hasDeferredFeatures ? logpointInfo : undefined),
        };
      },
    );

    response.success = true;
    response.body = { breakpoints };
    this.sendResponse(response);
  }

  protected override breakpointLocationsRequest(
    response: DebugProtocol.BreakpointLocationsResponse,
    args: DebugProtocol.BreakpointLocationsArguments,
  ): void {
    const startLine = args.line;
    const endLine = args.endLine ?? args.line;
    const locations: DebugProtocol.BreakpointLocation[] = [];

    for (let line = startLine; line <= endLine; line += 1) {
      locations.push({
        line,
        column: 1,
      });
    }

    response.success = true;
    response.body = {
      breakpoints: locations,
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
    this.sendTerminatedOnce(new TerminatedEvent());
  }

  public override dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.terminationSubscription.dispose();
    this.breakpointResolvedSubscription.dispose();
    this.sessionManager.dispose();
    super.dispose();
  }

  private emitTermination(reason: DebugSessionTerminationReason): void {
    if (reason === "connection-lost") {
      this.sendTerminatedOnce(
        new TerminatedEvent({
          reason: "connection-lost",
          description: this.localize(
            "Browser connection lost; debug session terminated.",
          ),
        }),
      );
    }
  }

  private emitBreakpointResolved(event: DebugBreakpointResolvedEvent): void {
    const source = createSource(event.url, {
      path: event.url,
      name: event.url,
    });

    this.logger(
      this.localize(
        "[debug] breakpoint resolved source='{0}' line={1} breakpointId='{2}'.",
        event.url,
        String(event.line),
        event.breakpointId,
      ),
    );

    this.sendEvent(
      new BreakpointEvent("changed", {
        verified: true,
        line: event.line,
        column: event.column,
        source,
      }),
    );
  }
}
