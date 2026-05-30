import type * as vscode from "vscode";
import type Protocol from "devtools-protocol/types/protocol";
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
import { formatRemoteObject, formatRemoteType } from "./variable-formatter";
import type { VariableReferenceKind } from "./variable-store";
import type { RuntimeObjectId } from "./cdp-types";

export interface NotebookDebugAdapterOptions {
  sessionManager: DebugSessionManager;
  localize?: Localize;
  logger?: (message: string, error?: unknown) => void;
}

const defaultLocalize = ((
  messageOrOptions: string | { message: string },
  ...args: unknown[]
) => {
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

const noopLogger = (): void => undefined;
const MAX_VARIABLE_PAGE_SIZE = 100;

interface StackFrameEntry {
  frameId: number;
  callFrame: Protocol.Debugger.CallFrame;
}

const scopeKinds: ReadonlySet<string> = new Set([
  "local",
  "closure",
  "block",
  "with",
]);

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
  private readonly stackFramesById = new Map<number, StackFrameEntry>();
  private cachedStackFrames: StackFrameEntry[] = [];
  private cachedPauseVersion = 0;
  private cachedGlobalObjectId: RuntimeObjectId | undefined;
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

  protected override async stackTraceRequest(
    response: DebugProtocol.StackTraceResponse,
    args: DebugProtocol.StackTraceArguments,
  ): Promise<void> {
    const paused = await this.ensurePausedFrames();
    if (!paused) {
      response.success = true;
      response.body = {
        stackFrames: [],
        totalFrames: 0,
      };
      this.sendResponse(response);
      return;
    }

    const totalFrames = paused.length;
    const startFrame = Math.max(0, args.startFrame ?? 0);
    const levels =
      typeof args.levels === "number" && args.levels > 0
        ? args.levels
        : totalFrames;

    const stackFrames = paused
      .slice(startFrame, startFrame + levels)
      .map((entry) => {
        const callFrame = entry.callFrame;
        const sourceIdentifier =
          callFrame.url.length > 0
            ? callFrame.url
            : this.localize("<anonymous>");

        return {
          id: entry.frameId,
          name:
            callFrame.functionName.length > 0
              ? callFrame.functionName
              : this.localize("<anonymous>"),
          source: createSource(sourceIdentifier),
          line: callFrame.location.lineNumber + 1,
          column: (callFrame.location.columnNumber ?? 0) + 1,
        };
      });

    response.success = true;
    response.body = {
      stackFrames,
      totalFrames,
    };
    this.sendResponse(response);
  }

  protected override async scopesRequest(
    response: DebugProtocol.ScopesResponse,
    args: DebugProtocol.ScopesArguments,
  ): Promise<void> {
    const paused = await this.ensurePausedFrames();
    const frame = paused ? this.stackFramesById.get(args.frameId) : undefined;
    const variableStore = this.sessionManager.getVariableStore();
    const debuggerSession = this.sessionManager.getDebuggerSession();

    if (!frame || !variableStore || !debuggerSession) {
      response.success = true;
      response.body = { scopes: [] };
      this.sendResponse(response);
      return;
    }

    const scopes: DebugProtocol.Scope[] = [];

    for (const scope of frame.callFrame.scopeChain) {
      if (!scopeKinds.has(scope.type)) {
        continue;
      }

      const objectId = scope.object.objectId;
      const variablesReference = objectId
        ? variableStore.reserve({
            objectId,
            kind: toReferenceKind(scope.object),
          })
        : 0;

      scopes.push({
        name: this.localizeScopeName(scope.type),
        presentationHint: scope.type,
        expensive: false,
        variablesReference,
      });
    }

    const globalObjectId = await this.resolveGlobalObjectId(debuggerSession);
    const globalReference =
      globalObjectId !== undefined
        ? variableStore.reserve({
            objectId: globalObjectId,
            kind: "object",
          })
        : 0;

    scopes.push({
      name: this.localize("Global"),
      presentationHint: "globals",
      expensive: true,
      variablesReference: globalReference,
    });

    response.success = true;
    response.body = { scopes };
    this.sendResponse(response);
  }

  protected override async variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments,
  ): Promise<void> {
    const variableStore = this.sessionManager.getVariableStore();
    const debuggerSession = this.sessionManager.getDebuggerSession();

    if (!variableStore || !debuggerSession) {
      response.success = true;
      response.body = { variables: [] };
      this.sendResponse(response);
      return;
    }

    const reference = variableStore.resolve(args.variablesReference);
    if (!reference) {
      response.success = true;
      response.body = { variables: [] };
      this.sendResponse(response);
      return;
    }

    const result = await debuggerSession.getProperties({
      objectId: reference.objectId,
      ownProperties: true,
      accessorPropertiesOnly: false,
      generatePreview: true,
    });

    const descriptors = result.result.filter(
      (descriptor) => descriptor.value !== undefined,
    );
    const start = Math.max(0, args.start ?? 0);
    const requestedCount = Math.max(0, args.count ?? descriptors.length);
    const pageSize = Math.min(requestedCount, MAX_VARIABLE_PAGE_SIZE);
    const selected = descriptors.slice(start, start + pageSize);

    const variables: DebugProtocol.Variable[] = selected.map((descriptor) => {
      const value = descriptor.value as Protocol.Runtime.RemoteObject;
      const nextReference = shouldCreateChildHandle(value)
        ? variableStore.reserve({
            objectId: value.objectId,
            kind: toReferenceKind(value),
          })
        : 0;

      return {
        name: descriptor.name,
        value: formatRemoteObject(value, 10240, this.localize),
        type: formatRemoteType(value),
        variablesReference: nextReference,
      };
    });

    const remaining = Math.max(
      0,
      descriptors.length - (start + selected.length),
    );
    if (requestedCount > MAX_VARIABLE_PAGE_SIZE && remaining > 0) {
      variables.push({
        name: this.localize("… ({0} more)", remaining),
        value: "",
        type: "info",
        variablesReference: 0,
      });
    }

    response.success = true;
    response.body = { variables };
    this.sendResponse(response);
  }

  protected override async evaluateRequest(
    response: DebugProtocol.EvaluateResponse,
    args: DebugProtocol.EvaluateArguments,
  ): Promise<void> {
    const debuggerSession = this.sessionManager.getDebuggerSession();
    if (!debuggerSession) {
      response.success = true;
      response.body = {
        result: this.localize(
          "Evaluation failed: {0}",
          this.localize("session unavailable"),
        ),
        presentationHint: { kind: "error" },
        variablesReference: 0,
      };
      this.sendResponse(response);
      return;
    }

    const paused = await this.ensurePausedFrames();
    const selectedFrame =
      typeof args.frameId === "number"
        ? this.stackFramesById.get(args.frameId)
        : paused?.[0];

    const variableStore = this.sessionManager.getVariableStore();
    const expression = args.expression;

    const evaluation = selectedFrame
      ? await debuggerSession.evaluateOnCallFrame({
          callFrameId: selectedFrame.callFrame.callFrameId,
          expression,
          returnByValue: false,
          generatePreview: true,
          throwOnSideEffect: args.context === "hover",
        })
      : await debuggerSession.evaluate({
          expression,
          returnByValue: false,
          generatePreview: true,
        });

    if (evaluation.exceptionDetails) {
      response.success = true;
      response.body = {
        result: this.localize(
          "Evaluation failed: {0}",
          describeException(evaluation.exceptionDetails),
        ),
        presentationHint: { kind: "error" },
        variablesReference: 0,
      };
      this.sendResponse(response);
      return;
    }

    const remoteResult = evaluation.result;
    const variablesReference =
      variableStore && shouldCreateChildHandle(remoteResult)
        ? variableStore.reserve({
            objectId: remoteResult.objectId,
            kind: toReferenceKind(remoteResult),
          })
        : 0;

    response.success = true;
    response.body = {
      result: formatRemoteObject(remoteResult, 10240, this.localize),
      type: formatRemoteType(remoteResult),
      variablesReference,
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
      `[debug] setBreakpoints received for source '${requestedUrl ?? "(missing source)"}' with ${desired.length} requested breakpoint(s).`,
    );

    if (!requestedUrl) {
      this.logger(
        "[debug] setBreakpoints ignored because no source URL was provided.",
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
        `[debug] setBreakpoints deferred for source '${requestedUrl}' because debug session is not active.`,
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
      `[debug] setBreakpoints applied for source '${requestedUrl}': verified=${verifiedCount}, unverified=${unverifiedCount}.`,
    );
    for (const breakpoint of bound) {
      this.logger(
        `[debug] breakpoint binding result source='${requestedUrl}' line=${breakpoint.line} verified=${breakpoint.verified} message='${breakpoint.message ?? "(none)"}'.`,
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
      `[debug] breakpoint resolved source='${event.url}' line=${event.line} breakpointId='${event.breakpointId}'.`,
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

  private async ensurePausedFrames(): Promise<StackFrameEntry[] | undefined> {
    const pausedEvent = this.sessionManager.getPausedEvent();
    if (!pausedEvent) {
      return undefined;
    }

    const pauseVersion = this.sessionManager.getPauseVersion();
    if (pauseVersion !== this.cachedPauseVersion) {
      this.cachedPauseVersion = pauseVersion;
      this.cachedGlobalObjectId = undefined;
      this.cachedStackFrames = pausedEvent.callFrames.map(
        (callFrame, index) => ({
          frameId: index + 1,
          callFrame,
        }),
      );
      this.stackFramesById.clear();
      for (const entry of this.cachedStackFrames) {
        this.stackFramesById.set(entry.frameId, entry);
      }

      const variableStore = this.sessionManager.getVariableStore();
      if (variableStore) {
        await variableStore.clearForPause();
      }
    }

    return this.cachedStackFrames;
  }

  private async resolveGlobalObjectId(
    debuggerSession: ReturnType<DebugSessionManager["getDebuggerSession"]>,
  ): Promise<string | undefined> {
    if (!debuggerSession) {
      return undefined;
    }

    if (this.cachedGlobalObjectId) {
      return this.cachedGlobalObjectId;
    }

    const globalResult = await debuggerSession.evaluate({
      expression: "globalThis",
      returnByValue: false,
      generatePreview: true,
    });

    const objectId = globalResult.result.objectId;
    if (!objectId) {
      return undefined;
    }

    this.cachedGlobalObjectId = objectId;
    return objectId;
  }

  private localizeScopeName(scopeType: string): string {
    if (scopeType === "local") {
      return this.localize("Local");
    }
    if (scopeType === "closure") {
      return this.localize("Closure");
    }
    if (scopeType === "block") {
      return this.localize("Block");
    }
    if (scopeType === "with") {
      return this.localize("With");
    }

    return scopeType;
  }
}

function toReferenceKind(
  value: Pick<Protocol.Runtime.RemoteObject, "type" | "subtype">,
): VariableReferenceKind {
  if (value.subtype === "array") {
    return "array";
  }

  return value.type === "object" ? "object" : "scope";
}

function shouldCreateChildHandle(
  value: Protocol.Runtime.RemoteObject,
): value is Protocol.Runtime.RemoteObject & { objectId: RuntimeObjectId } {
  if (!value.objectId) {
    return false;
  }

  if (value.type !== "object") {
    return false;
  }

  return value.subtype !== "null";
}

function describeException(
  exceptionDetails: Protocol.Runtime.ExceptionDetails,
): string {
  if (
    typeof exceptionDetails.text === "string" &&
    exceptionDetails.text.length > 0
  ) {
    return exceptionDetails.text;
  }

  if (
    exceptionDetails.exception &&
    typeof exceptionDetails.exception.description === "string" &&
    exceptionDetails.exception.description.length > 0
  ) {
    return exceptionDetails.exception.description;
  }

  return "Unknown error";
}
