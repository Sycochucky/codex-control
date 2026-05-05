export function normalizeGatewayUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function isValidGatewayUrl(value: string) {
  const normalized = normalizeGatewayUrl(value);
  if (!normalized) {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export const isValidBackendUrl = isValidGatewayUrl;

export function getFriendlyNetworkErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error) {
    const lowered = error.message.toLowerCase();

    if (
      lowered.includes("network request failed") ||
      lowered.includes("failed to fetch") ||
      lowered.includes("networkerror") ||
      lowered.includes("load failed")
    ) {
      return "The phone app could not reach the local Codex gateway. Check the URL, confirm the desktop server is running, and make sure the device can reach it over the network.";
    }

    return error.message;
  }

  return fallbackMessage;
}
