import { getFriendlyNetworkErrorMessage } from "./network";

const RAW_PREFIX = "Raw error:";

export function formatAppServerErrorMessage(error: unknown, fallbackMessage: string) {
  const rawMessage = getRawErrorMessage(error);
  const lowered = rawMessage.toLowerCase();

  if (isQuotaLimitMessage(lowered)) {
    return withRawMessage(
      "Codex hit a usage or quota limit. Check the account, plan, or billing limit before retrying.",
      rawMessage,
    );
  }

  if (isRateLimitMessage(lowered)) {
    return withRawMessage(
      "Codex is rate limited. Wait a moment, then try sending again.",
      rawMessage,
    );
  }

  if (isContextLimitMessage(lowered)) {
    return withRawMessage(
      "Codex hit the context limit for this thread. Compact, roll back, or start from a smaller prompt before continuing.",
      rawMessage,
    );
  }

  if (rawMessage && !(error instanceof Error)) {
    return rawMessage;
  }

  return getFriendlyNetworkErrorMessage(error, fallbackMessage);
}

function getRawErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }

  return "";
}

function isRateLimitMessage(message: string) {
  return (
    message.includes("rate_limit") ||
    message.includes("rate limit") ||
    message.includes("rate-limit") ||
    message.includes("too many requests") ||
    /\b429\b/.test(message)
  );
}

function isQuotaLimitMessage(message: string) {
  return (
    message.includes("insufficient_quota") ||
    message.includes("quota") ||
    message.includes("usage limit") ||
    message.includes("billing hard limit") ||
    message.includes("credit balance")
  );
}

function isContextLimitMessage(message: string) {
  return (
    message.includes("context length") ||
    message.includes("context window") ||
    message.includes("context limit") ||
    message.includes("maximum context") ||
    message.includes("too many tokens")
  );
}

function withRawMessage(userMessage: string, rawMessage: string) {
  if (!rawMessage.trim()) {
    return userMessage;
  }

  return `${userMessage} ${RAW_PREFIX} ${rawMessage}`;
}
