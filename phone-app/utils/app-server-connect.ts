import { getAppServerStatus } from "@/services/api";
import { AppServerClient, withAppServerClient } from "@/services/app-server";
import type { AppServerNotification, AppServerRequest } from "@/types/app-server";

const APP_SERVER_RETRY_ATTEMPTS = 3;
const APP_SERVER_RETRY_DELAY_MS = 1500;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Codex App Server request timed out while waiting for initialize") ||
    message.includes("Codex App Server connection closed during startup") ||
    message.includes("Codex App Server connection failed")
  );
}

async function warmAppServer(baseUrl: string, token: string) {
  try {
    await getAppServerStatus(baseUrl, token);
  } catch {
    // Ignore status failures during warmup; the retry path will surface the final error.
  }
  await delay(APP_SERVER_RETRY_DELAY_MS);
}

export async function withWarmAppServerClient<T>(
  baseUrl: string,
  token: string,
  run: (client: AppServerClient) => Promise<T>,
) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < APP_SERVER_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await withAppServerClient(baseUrl, token, run);
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error) || attempt === APP_SERVER_RETRY_ATTEMPTS - 1) {
        throw error;
      }
      await warmAppServer(baseUrl, token);
    }
  }

  throw lastError;
}

export async function connectWarmAppServer(
  baseUrl: string,
  token: string,
  onNotification?: (notification: AppServerNotification) => void,
  onServerRequest?: (request: AppServerRequest) => void,
) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < APP_SERVER_RETRY_ATTEMPTS; attempt += 1) {
    const client = new AppServerClient(baseUrl, token, onNotification, onServerRequest);
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.close().catch(() => undefined);
      if (!shouldRetry(error) || attempt === APP_SERVER_RETRY_ATTEMPTS - 1) {
        throw error;
      }
      await warmAppServer(baseUrl, token);
    }
  }

  throw lastError;
}
