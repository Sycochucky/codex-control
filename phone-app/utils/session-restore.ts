export type SessionRestoreState = "hydrating" | "ready" | "reconnecting";
export type SessionValidationOutcome = "invalid" | "retryable";

export function getSessionValidationOutcome(error: unknown): SessionValidationOutcome {
  const status = getErrorStatus(error);
  if (status === 401) {
    return "invalid";
  }

  return "retryable";
}

function getErrorStatus(error: unknown) {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return null;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}
