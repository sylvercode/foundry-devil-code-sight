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

export function getKernelFailureCellOutputMessage(
  localize: Localize,
  kind: ExecutionFailureKind,
): string {
  return kind === "no-session"
    ? getNoActiveSessionMessage(localize)
    : getTransportCellOutputMessage(localize);
}

export function getKernelFailureNotificationMessage(
  localize: Localize,
  kind: ExecutionFailureKind,
): string {
  return kind === "no-session"
    ? getNoActiveSessionMessage(localize)
    : getTransportNotificationMessage(localize);
}

export function getKernelFailureCategoryLabel(
  localize: Localize,
  kind: ExecutionFailureKind,
): string {
  return kind === "no-session"
    ? localize("session unavailable")
    : localize("transport error");
}
