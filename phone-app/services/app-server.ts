import type {
  AppServerAccountLoginStartResponse,
  AppServerAccountResponse,
  AppServerAppsListResponse,
  AppServerCommandExecResponse,
  AppServerConfigBatchWriteRequest,
  AppServerConfigReadResponse,
  AppServerConfigRequirementsResponse,
  AppServerConfigWriteResponse,
  AppServerExperimentalFeatureListResponse,
  AppServerFuzzyFileSearchResponse,
  AppServerMcpServerStatusResponse,
  AppServerModelsResponse,
  AppServerNotification,
  AppServerPluginListResponse,
  AppServerRateLimitsResponse,
  AppServerRequest,
  AppServerReviewResponse,
  AppServerReviewTarget,
  AppServerSkillsListResponse,
  AppThreadListResponse,
  AppThreadReadResponse,
  AppThreadStartResponse,
  AppTurnStartResponse,
  AppTurnSteerResponse,
  AppUserInput,
  JsonRpcResponse,
} from "../types/app-server";
import type { RuntimeDefaults } from "../utils/runtime-defaults";
import { buildThreadStartPayload, buildTurnStartPayload } from "../utils/runtime-defaults";
import { normalizeGatewayUrl } from "../utils/network";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type AppServerClientOptions = {
  connectTimeoutMs?: number;
};

const APP_SERVER_REQUEST_TIMEOUT_MS = 30000;
const APP_SERVER_INITIALIZE_TIMEOUT_MS = 60000;
const APP_SERVER_CONNECT_TIMEOUT_MS = 10000;

function toAppServerWsUrl(baseUrl: string, token: string) {
  const normalized = normalizeGatewayUrl(baseUrl);
  const url = normalized.startsWith("https://")
    ? `wss://${normalized.slice("https://".length)}`
    : normalized.startsWith("http://")
      ? `ws://${normalized.slice("http://".length)}`
      : normalized;

  return `${url}/app-server/ws?token=${encodeURIComponent(token)}`;
}

function toGrantedPermissionProfile(permissions: {
  network: unknown | null;
  fileSystem: unknown | null;
  macos: unknown | null;
}) {
  return Object.fromEntries(
    Object.entries(permissions).filter((entry): entry is [string, unknown] => entry[1] !== null && entry[1] !== undefined),
  );
}

export class AppServerClient {
  private readonly socket: WebSocket;
  private readonly pending = new Map<string, PendingRequest>();
  private nextId = 1;
  private initialized = false;
  private socketFailure: Error | null = null;
  private closeRequested = false;

  constructor(
    baseUrl: string,
    token: string,
    private readonly onNotification?: (notification: AppServerNotification) => void,
    private readonly onServerRequest?: (request: AppServerRequest) => void,
    private readonly options: AppServerClientOptions = {},
  ) {
    this.socket = new WebSocket(toAppServerWsUrl(baseUrl, token));
  }

  async connect() {
    if (this.socket.readyState === WebSocket.OPEN) {
      await this.initialize();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeoutMs = this.options.connectTimeoutMs ?? APP_SERVER_CONNECT_TIMEOUT_MS;
      const timeoutId = setTimeout(() => {
        const error = new Error(`Codex App Server connection timed out after ${timeoutMs / 1000} seconds.`);
        this.socketFailure = error;
        settle(() => {
          if (this.socket.readyState !== WebSocket.CLOSING && this.socket.readyState !== WebSocket.CLOSED) {
            this.socket.close();
          }
          reject(error);
        });
      }, timeoutMs);

      const settle = (run: () => void) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutId);
        run();
      };

      this.socket.onopen = () => settle(() => resolve());
      this.socket.onerror = () => {
        if (settled) {
          return;
        }
        console.warn("[AppServerClient] websocket error during connect");
        settle(() => reject(new Error("Failed to connect to the Codex App Server.")));
      };
      this.socket.onclose = (event) => {
        if (settled) {
          return;
        }
        console.warn("[AppServerClient] websocket closed during connect", event.reason);
        const reason =
          typeof event.reason === "string" && event.reason.trim() ? `: ${event.reason.trim()}` : ".";
        settle(() => reject(new Error(`Codex App Server connection closed during startup${reason}`)));
      };
    });

    this.attachSocketEventHandlers();

    await this.initialize();
  }

  async close() {
    this.closeRequested = true;

    if (this.socket.readyState === WebSocket.CLOSING || this.socket.readyState === WebSocket.CLOSED) {
      return;
    }

    this.socket.close();
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    await this.request("initialize", {
      clientInfo: {
        name: "official-codex-phone-app",
        version: "1.0.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    console.info("[AppServerClient] initialize response received; sending initialized");
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }));
    this.initialized = true;
  }

  async listThreads(params?: { archived?: boolean; limit?: number; cursor?: string | null }) {
    return (await this.request("thread/list", {
      limit: params?.limit ?? 100,
      sortKey: "updated_at",
      archived: params?.archived ?? false,
      cursor: params?.cursor ?? null,
    })) as AppThreadListResponse;
  }

  async listAllThreads(params?: { archived?: boolean; limit?: number }) {
    const pages: AppThreadListResponse[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;

    while (true) {
      const page = await this.listThreads({
        archived: params?.archived,
        limit: params?.limit,
        cursor,
      });
      pages.push(page);

      const nextCursor = page.nextCursor?.trim() || null;
      if (!nextCursor || seenCursors.has(nextCursor)) {
        break;
      }

      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }

    return mergeThreadListPages(pages);
  }

  async readThread(threadId: string) {
    return (await this.request("thread/read", {
      threadId,
      includeTurns: true,
    })) as AppThreadReadResponse;
  }

  async startThread(params: {
    title: string;
    initialMessage: string | null;
    cwd?: string | null;
    runtime?: RuntimeDefaults;
  }) {
    const created = (await this.request(
      "thread/start",
      buildThreadStartPayload({
        cwd: params.cwd,
        runtime: params.runtime ?? {
          model: null,
          reasoningEffort: null,
          approvalPolicy: "on-request",
          sandbox: "workspace-write",
          serviceTier: null,
        },
      }),
    )) as AppThreadStartResponse;

    try {
      await this.request("thread/name/set", {
        threadId: created.thread.id,
        name: params.title,
      });

      if (params.initialMessage?.trim()) {
        await this.startTurn(created.thread.id, params.initialMessage.trim(), {
          cwd: params.cwd,
          runtime: params.runtime,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Thread created, but follow-up setup failed.";
      throw new CreatedThreadError(created.thread.id, message);
    }

    return created.thread.id;
  }

  async renameThread(threadId: string, name: string) {
    await this.request("thread/name/set", { threadId, name });
  }

  async archiveThread(threadId: string) {
    await this.request("thread/archive", { threadId });
  }

  async unarchiveThread(threadId: string) {
    await this.request("thread/unarchive", { threadId });
  }

  async forkThread(threadId: string) {
    return (await this.request("thread/fork", {
      threadId,
      persistExtendedHistory: true,
    })) as AppThreadStartResponse;
  }

  async resumeThread(threadId: string) {
    return (await this.request("thread/resume", {
      threadId,
      persistExtendedHistory: true,
    })) as AppThreadStartResponse;
  }

  async rollbackThread(threadId: string, numTurns: number) {
    return await this.request("thread/rollback", { threadId, numTurns });
  }

  async compactThread(threadId: string) {
    return await this.request("thread/compact/start", { threadId });
  }

  async updateThreadGitInfo(
    threadId: string,
    gitInfo: { sha?: string | null; branch?: string | null; originUrl?: string | null },
  ) {
    return await this.request("thread/metadata/update", { threadId, gitInfo });
  }

  async startTurn(
    threadId: string,
    text: string,
    options?: { cwd?: string | null; runtime?: RuntimeDefaults | null },
  ) {
    return (await this.request(
      "turn/start",
      options?.runtime
        ? buildTurnStartPayload({
            threadId,
            text,
            cwd: options.cwd,
            runtime: options.runtime,
          })
        : {
            threadId,
            input: [textInput(text)],
            approvalPolicy: "on-request",
          },
    )) as AppTurnStartResponse;
  }

  async steerTurn(threadId: string, turnId: string, text: string) {
    return (await this.request("turn/steer", {
      threadId,
      expectedTurnId: turnId,
      input: [textInput(text)],
    })) as AppTurnSteerResponse;
  }

  async getAccount(refreshToken = false) {
    return (await this.request("account/read", { refreshToken })) as AppServerAccountResponse;
  }

  async startAccountLogin(type: "chatgpt" | "apiKey", apiKey?: string) {
    return (await this.request("account/login/start", {
      type,
      ...(type === "apiKey" ? { apiKey } : {}),
    })) as AppServerAccountLoginStartResponse;
  }

  async getAccountRateLimits() {
    return (await this.request("account/rateLimits/read", undefined)) as AppServerRateLimitsResponse;
  }

  async listApps(params?: { threadId?: string | null; limit?: number; forceRefetch?: boolean }) {
    return (await this.request("app/list", {
      limit: params?.limit ?? 50,
      threadId: params?.threadId ?? null,
      forceRefetch: params?.forceRefetch ?? false,
    })) as AppServerAppsListResponse;
  }

  async listSkills(params?: { cwds?: string[]; forceReload?: boolean }) {
    return (await this.request("skills/list", {
      cwds: params?.cwds,
      forceReload: params?.forceReload ?? false,
    })) as AppServerSkillsListResponse;
  }

  async readConfig(params?: { cwd?: string | null }) {
    return (await this.request("config/read", {
      includeLayers: true,
      cwd: params?.cwd ?? null,
    })) as AppServerConfigReadResponse;
  }

  async writeConfigBatch(params: AppServerConfigBatchWriteRequest) {
    return (await this.request("config/batchWrite", params)) as AppServerConfigWriteResponse;
  }

  async readConfigRequirements() {
    return (await this.request("configRequirements/read", undefined)) as AppServerConfigRequirementsResponse;
  }

  async listModels(params?: { cursor?: string | null; limit?: number | null; includeHidden?: boolean | null }) {
    return (await this.request("model/list", {
      cursor: params?.cursor ?? null,
      limit: params?.limit ?? null,
      includeHidden: params?.includeHidden ?? false,
    })) as AppServerModelsResponse;
  }

  async listPlugins(params?: { cwds?: string[] | null }) {
    return (await this.request("plugin/list", {
      cwds: params?.cwds ?? null,
    })) as AppServerPluginListResponse;
  }

  async installPlugin(marketplacePath: string, pluginName: string) {
    return await this.request("plugin/install", { marketplacePath, pluginName });
  }

  async uninstallPlugin(pluginId: string) {
    return await this.request("plugin/uninstall", { pluginId });
  }

  async listMcpServerStatus(params?: { cursor?: string | null; limit?: number | null }) {
    return (await this.request("mcpServerStatus/list", {
      cursor: params?.cursor ?? null,
      limit: params?.limit ?? 50,
    })) as AppServerMcpServerStatusResponse;
  }

  async listExperimentalFeatures(params?: { cursor?: string | null; limit?: number | null }) {
    return (await this.request("experimentalFeature/list", {
      cursor: params?.cursor ?? null,
      limit: params?.limit ?? 50,
    })) as AppServerExperimentalFeatureListResponse;
  }

  async startReview(threadId: string, target: AppServerReviewTarget, delivery: "inline" | "detached" = "inline") {
    return (await this.request("review/start", {
      threadId,
      target,
      delivery,
    })) as AppServerReviewResponse;
  }

  async execCommand(params: {
    command: string[];
    cwd?: string | null;
    processId?: string | null;
    tty?: boolean;
    streamStdin?: boolean;
    streamStdoutStderr?: boolean;
    timeoutMs?: number | null;
  }) {
    return (await this.request("command/exec", {
      command: params.command,
      cwd: params.cwd ?? null,
      processId: params.processId ?? null,
      tty: params.tty ?? false,
      streamStdin: params.streamStdin ?? false,
      streamStdoutStderr: params.streamStdoutStderr ?? false,
      timeoutMs: params.timeoutMs === undefined ? 30000 : params.timeoutMs,
    })) as AppServerCommandExecResponse;
  }

  async writeCommandInput(processId: string, deltaBase64?: string, closeStdin?: boolean) {
    return await this.request("command/exec/write", {
      processId,
      deltaBase64: deltaBase64 ?? null,
      closeStdin: closeStdin ?? false,
    });
  }

  async terminateCommand(processId: string) {
    return await this.request("command/exec/terminate", { processId });
  }

  async resizeCommand(processId: string, rows: number, cols: number) {
    return await this.request("command/exec/resize", {
      processId,
      size: { rows, cols },
    });
  }

  async fuzzyFileSearch(query: string, roots: string[]) {
    return (await this.request("fuzzyFileSearch", {
      query,
      roots,
      cancellationToken: null,
    })) as AppServerFuzzyFileSearchResponse;
  }

  async call<T>(method: string, params: unknown) {
    return (await this.request(method, params)) as T;
  }

  respondToCommandApproval(
    id: string | number,
    decision: "accept" | "acceptForSession" | "decline" | "cancel",
  ) {
    this.respond(id, { decision });
  }

  respondToFileChangeApproval(
    id: string | number,
    decision: "accept" | "acceptForSession" | "decline" | "cancel",
  ) {
    this.respond(id, { decision });
  }

  respondToPermissionsApproval(
    id: string | number,
    permissions: { network: unknown | null; fileSystem: unknown | null; macos: unknown | null },
    scope: "turn" | "session",
  ) {
    this.respond(id, { permissions: toGrantedPermissionProfile(permissions), scope });
  }

  respondToUserInput(
    id: string | number,
    answers: Record<string, { answers: string[] }>,
  ) {
    this.respond(id, { answers });
  }

  private respond(id: string | number, result: unknown) {
    this.socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result,
      }),
    );
  }

  private async request(method: string, params: unknown) {
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw this.socketFailure ?? new Error("Codex App Server connection is not open.");
    }

    const id = String(this.nextId++);
    console.info("[AppServerClient] sending request", method, id);
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return await new Promise<unknown>((resolve, reject) => {
      const timeoutMs =
        method === "initialize" ? APP_SERVER_INITIALIZE_TIMEOUT_MS : APP_SERVER_REQUEST_TIMEOUT_MS;
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex App Server request timed out while waiting for ${method}.`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeoutId);
          resolve(value);
        },
        reject: (reason) => {
          clearTimeout(timeoutId);
          reject(reason);
        },
        timeoutId,
      });

      try {
        this.socket.send(JSON.stringify(payload));
      } catch (error) {
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id);
          clearTimeout(pending.timeoutId);
        }

        reject(error instanceof Error ? error : new Error("Failed to send Codex App Server request."));
      }
    });
  }

  private attachSocketEventHandlers() {
    this.socket.onmessage = (event) => {
      this.handleMessage(event.data);
    };
    this.socket.onerror = () => {
      if (this.closeRequested && this.pending.size === 0) {
        return;
      }

      this.handleSocketFailure(new Error("Codex App Server connection failed."));
    };
    this.socket.onclose = (event) => {
      if (this.closeRequested && this.pending.size === 0) {
        return;
      }

      const reason =
        typeof event.reason === "string" && event.reason.trim() ? `: ${event.reason.trim()}` : ".";
      this.handleSocketFailure(new Error(`Codex App Server connection closed${reason}`));
    };
  }

  private handleMessage(raw: string) {
    let message: JsonRpcResponse | AppServerNotification | AppServerRequest;
    try {
      message = JSON.parse(raw) as JsonRpcResponse | AppServerNotification | AppServerRequest;
    } catch {
      this.handleSocketFailure(new Error("Codex App Server sent malformed JSON."));
      return;
    }

    if ("id" in message && ("result" in message || "error" in message)) {
      const pending = this.pending.get(String(message.id));
      if (!pending) {
        return;
      }

      this.pending.delete(String(message.id));
      if ("error" in message) {
        console.warn("[AppServerClient] response error", String(message.id), message.error.message);
        pending.reject(new Error(message.error.message));
        return;
      }

      console.info("[AppServerClient] response success", String(message.id));
      pending.resolve(message.result);
      return;
    }

    if ("id" in message && "method" in message) {
      this.onServerRequest?.(message);
      return;
    }

    this.onNotification?.(message);
  }

  private handleSocketFailure(error: Error) {
    console.warn("[AppServerClient] socket failure", error.message);
    if (this.socketFailure) {
      return;
    }

    this.socketFailure = error;

    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    }
  }
}

export async function withAppServerClient<T>(
  baseUrl: string,
  token: string,
  run: (client: AppServerClient) => Promise<T>,
) {
  const client = new AppServerClient(baseUrl, token);
  try {
    await client.connect();
    return await run(client);
  } finally {
    await client.close();
  }
}

export function textInput(text: string): AppUserInput {
  return {
    type: "text",
    text,
    text_elements: [],
  };
}

export class CreatedThreadError extends Error {
  constructor(
    readonly threadId: string,
    message: string,
  ) {
    super(message);
    this.name = "CreatedThreadError";
  }
}

export function mergeThreadListPages(pages: AppThreadListResponse[]) {
  const mergedThreads = new Map<string, AppThreadListResponse["data"][number]>();

  for (const page of pages) {
    for (const thread of page.data) {
      const current = mergedThreads.get(thread.id);
      if (!current || thread.updatedAt >= current.updatedAt) {
        mergedThreads.set(thread.id, thread);
      }
    }
  }

  return [...mergedThreads.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}
