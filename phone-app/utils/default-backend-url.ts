const DEFAULT_REMOTE_PORT = 8765;

type DefaultBackendUrlInput = {
  envUrl?: string | null;
  envTunnelUrl?: string | null;
  envRemoteUrl?: string | null;
  envPort?: string | number | null;
  expoHostUri?: string | null;
  browserHostname?: string | null;
  port?: number;
};

export function getDefaultBackendUrl({
  envUrl,
  envTunnelUrl,
  envRemoteUrl,
  envPort,
  expoHostUri,
  browserHostname,
  port,
}: DefaultBackendUrlInput = {}) {
  const remotePort = normalizePort(port ?? envPort, DEFAULT_REMOTE_PORT);
  const explicitUrl =
    normalizeExplicitUrl(resolveEnvRemoteUrl(envRemoteUrl)) ??
    normalizeExplicitUrl(envUrl) ??
    normalizeExplicitUrl(resolveEnvTunnelUrl(envTunnelUrl));
  if (explicitUrl) {
    return explicitUrl;
  }

  const expoHost = extractHost(expoHostUri);
  if (expoHost && !isLocalHost(expoHost)) {
    return `ws://${formatHost(expoHost)}:${remotePort}`;
  }

  const webHost = extractHost(browserHostname);
  if (webHost && !isLocalHost(webHost)) {
    return `ws://${formatHost(webHost)}:${remotePort}`;
  }

  return `ws://127.0.0.1:${remotePort}`;
}

export function hasExplicitDefaultBackendUrl({
  envUrl,
  envTunnelUrl,
  envRemoteUrl,
}: Pick<DefaultBackendUrlInput, "envUrl" | "envTunnelUrl" | "envRemoteUrl"> = {}) {
  return Boolean(
    normalizeExplicitUrl(resolveEnvRemoteUrl(envRemoteUrl)) ??
      normalizeExplicitUrl(envUrl) ??
      normalizeExplicitUrl(resolveEnvTunnelUrl(envTunnelUrl)),
  );
}

function normalizeExplicitUrl(value?: string | null) {
  const normalized = value?.trim().replace(/\/+$/, "");
  if (!normalized || !/^(https?|wss?):\/\//i.test(normalized)) {
    return null;
  }

  return normalized;
}

function resolveEnvTunnelUrl(value: string | null | undefined) {
  return value === undefined && typeof process !== "undefined"
    ? process.env.EXPO_PUBLIC_CODEX_TUNNEL_URL
    : value;
}

function resolveEnvRemoteUrl(value: string | null | undefined) {
  return value === undefined && typeof process !== "undefined"
    ? process.env.EXPO_PUBLIC_CODEX_REMOTE_URL
    : value;
}

function extractHost(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized.includes("://") ? normalized : `http://${normalized}`);
    return parsed.hostname || null;
  } catch {
    return null;
  }
}

function normalizePort(value: string | number | null | undefined, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : fallback;
}

function isLocalHost(host: string) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function formatHost(host: string) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
