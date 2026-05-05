import type {
  AppServerStatus,
  LoginResponse,
  SessionInfo,
} from "@/types/api";
import type {
  GithubDeviceLoginPollResponse,
  GithubDeviceLoginStartResponse,
  SetupStatusResponse,
} from "@/types/setup";
import { notifyUnauthorized } from "@/services/auth-events";
import { getFriendlyNetworkErrorMessage } from "@/utils/network";

type RequestOptions = {
  method?: "GET" | "POST";
  token?: string | null;
  body?: unknown;
};

export class ApiError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
}

async function request<T>(
  baseUrl: string,
  path: string,
  { method = "GET", token, body }: RequestOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new ApiError(
      getFriendlyNetworkErrorMessage(error, "The request could not reach the backend."),
      null,
    );
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}.`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) {
        message = payload.detail;
      }
    } catch {
      // Keep the fallback message when the response body is not JSON.
    }

    if (response.status === 401) {
      notifyUnauthorized();
      throw new ApiError("Your mobile session is no longer valid. Please sign in again.", 401);
    }

    if (response.status === 403) {
      throw new ApiError(
        "The shared token was rejected by the backend. Verify the token in Settings and try again.",
        403,
      );
    }

    if (response.status >= 500) {
      throw new ApiError(`The backend returned an error: ${message}`, response.status);
    }

    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export async function login(baseUrl: string, sharedToken: string, label = "phone-app") {
  return request<LoginResponse>(baseUrl, "/auth/login", {
    method: "POST",
    body: { token: sharedToken, label },
  });
}

export async function getCurrentSession(baseUrl: string, token: string) {
  return request<SessionInfo>(baseUrl, "/auth/me", { token });
}

export async function logout(baseUrl: string, token: string) {
  return request<{ success: boolean }>(baseUrl, "/auth/logout", {
    method: "POST",
    token,
  });
}

export async function getAppServerStatus(baseUrl: string, token: string) {
  return request<AppServerStatus>(baseUrl, "/app-server/status", { token });
}

export async function getSetupStatus(baseUrl: string, token: string) {
  return request<SetupStatusResponse>(baseUrl, "/setup/status", { token });
}

export async function startGithubDeviceLogin(baseUrl: string, token: string) {
  return request<GithubDeviceLoginStartResponse>(baseUrl, "/setup/github/login/start", {
    method: "POST",
    token,
  });
}

export async function getGithubDeviceLoginStatus(baseUrl: string, token: string, flowId: string) {
  return request<GithubDeviceLoginPollResponse>(baseUrl, `/setup/github/login/${flowId}`, {
    token,
  });
}
