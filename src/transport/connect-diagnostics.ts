import type { Localize } from "../config/endpoint-config";
import type { ConnectFailure } from "./connect-types";

export function formatConnectFailureMessage(
  failure: ConnectFailure,
  endpointSummary: string,
  localize: Localize,
): string {
  const localizedFailureMessage = localize(failure.message);

  const baseMessage = localize({
    message: "Connection failed ({0}) at {1}. {2}",
    args: [failure.category, endpointSummary, localizedFailureMessage],
    comment: [
      "{0} is the normalized failure category.",
      "{1} is the redacted endpoint summary.",
      "{2} is a concise failure detail.",
    ],
  });

  if (failure.category !== "target-mismatch") {
    if (/socket hang up/i.test(localizedFailureMessage)) {
      const transportGuidance = localize(
        "Check for local proxy/port-forwarding conflicts (for example VS Code automatic forwarding) and verify cdpHost points to the browser host.",
      );

      return `${baseMessage} ${transportGuidance}`;
    }

    if (failure.category !== "endpoint-connectivity") {
      return baseMessage;
    }

    const endpointGuidance = [
      localize(
        "Confirm the browser was launched with --remote-debugging-port and that the port is open.",
      ),
      localize(
        "If running in a dev container, localhost may point to the container. Set cdpHost to the host machine address.",
      ),
    ];

    return `${baseMessage} ${endpointGuidance.join(" ")}`;
  }

  const guidance = [
    localize("Check browser tab selection and active target context."),
    localize("Verify endpoint host/port configuration."),
  ];

  return `${baseMessage} ${guidance.join(" ")}`;
}
