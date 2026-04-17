import type { Localize } from "../config/endpoint-config";
import type { ExecutionFailure } from "../kernel";
import type { ConnectionStateStore } from "../transport/connection-state";
import {
  getKernelFailureCategoryLabel,
  getKernelFailureNotificationMessage,
} from "../kernel/execution-messages";

export interface KernelTransportFailureReporterDeps {
  connectionStateStore?: Pick<
    ConnectionStateStore,
    "setErrorContext" | "setState"
  >;
  disconnectActiveConnection?: () => Promise<void>;
  outputChannel: { appendLine: (value: string) => void };
  localize: Localize;
  showErrorMessage: (message: string) => Promise<void>;
  now?: () => Date;
}

export function createKernelTransportFailureReporter({
  connectionStateStore,
  disconnectActiveConnection,
  outputChannel,
  localize,
  showErrorMessage,
  now = () => new Date(),
}: KernelTransportFailureReporterDeps): (
  failure: ExecutionFailure,
) => Promise<void> {
  return async (failure: ExecutionFailure): Promise<void> => {
    const categoryLabel = getKernelFailureCategoryLabel(localize, failure.kind);

    outputChannel.appendLine(
      localize(
        "[{0}] Notebook {1} ({2}): {3}",
        now().toISOString(),
        categoryLabel,
        failure.name,
        failure.message,
      ),
    );

    const userMessage = getKernelFailureNotificationMessage(
      localize,
      failure.kind,
    );

    if (failure.kind === "transport-error") {
      try {
        await disconnectActiveConnection?.();
      } catch {
        // non-fatal: state should still move to error if transport cleanup throws
      }

      connectionStateStore?.setErrorContext({
        category: "transport-failure",
        guidance: userMessage,
      });
      connectionStateStore?.setState("error");
    }

    await showErrorMessage(userMessage);
  };
}
