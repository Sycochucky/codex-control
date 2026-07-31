export function normalizeAppServerEndpoint(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function isValidAppServerEndpoint(value: string) {
  const normalized = normalizeAppServerEndpoint(value);
  if (!normalized) {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    return ["http:", "https:", "ws:", "wss:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function getFriendlyNetworkErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error) {
    const lowered = error.message.toLowerCase();

    if (
      lowered.includes("network request failed") ||
      lowered.includes("failed to fetch") ||
      lowered.includes("networkerror") ||
      lowered.includes("load failed")
    ) {
      return "The phone app could not reach the Codex App Server remote endpoint. Check the URL, confirm Codex remote control is running, and make sure this device can reach it over the network.";
    }

    return error.message;
  }

  return fallbackMessage;
}
