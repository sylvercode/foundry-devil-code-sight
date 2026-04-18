import type { Localize } from "../config/endpoint-config";
import type { ExecutionFailureKind } from "./execution-result";

export function getNoActiveSessionMessage(localize: Localize): string {
  return localize(
    "No active browser session. Run Jupyter Browser Kernel: Reconnect and try again.",
  );
}

export function getTransportCellOutputMessage(localize: Localize): string {
  return localize(
    "Transport error while running this cell. Run Reconnect and review the Jupyter Browser Kernel output channel.",
  );
}

export function getTransportNotificationMessage(localize: Localize): string {
  return localize(
    "Browser transport error while running a cell. Run Reconnect and try again.",
  );
}

export function getTimeoutCellOutputMessage(localize: Localize): string {
  return localize(
    "Cell execution timed out. The async operation did not complete within the allowed time. Simplify the expression or check for unresolved Promises.",
  );
}

export function getTimeoutNotificationMessage(localize: Localize): string {
  return localize(
    "Cell execution timed out. Check for unresolved Promises and try again.",
  );
}

export function getKernelFailureCellOutputMessage(
  localize: Localize,
  kind: ExecutionFailureKind,
): string {
  if (kind === "no-session") {
    return getNoActiveSessionMessage(localize);
  }

  if (kind === "timeout") {
    return getTimeoutCellOutputMessage(localize);
  }

  return getTransportCellOutputMessage(localize);
}

export function getKernelFailureNotificationMessage(
  localize: Localize,
  kind: ExecutionFailureKind,
): string {
  if (kind === "no-session") {
    return getNoActiveSessionMessage(localize);
  }

  if (kind === "timeout") {
    return getTimeoutNotificationMessage(localize);
  }

  return getTransportNotificationMessage(localize);
}

export function getKernelFailureCategoryLabel(
  localize: Localize,
  kind: ExecutionFailureKind,
): string {
  if (kind === "no-session") {
    return localize("session unavailable");
  }

  if (kind === "timeout") {
    return localize("evaluation timeout");
  }

  return localize("transport error");
}
