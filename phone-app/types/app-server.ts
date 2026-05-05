export type AppThreadActiveFlag = "waitingOnApproval" | "waitingOnUserInput";

export type AppGitInfo = {
  sha: string | null;
  branch: string | null;
  originUrl: string | null;
};

export type AppTokenUsageBreakdown = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export type AppThreadTokenUsage = {
  total: AppTokenUsageBreakdown;
  last: AppTokenUsageBreakdown;
  modelContextWindow: number | null;
};

export type AppThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags: AppThreadActiveFlag[] };

export type AppUserInput =
  | { type: "text"; text: string; text_elements: unknown[] }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

export type AppThreadItem =
  | { type: "userMessage"; id: string; content: AppUserInput[] }
  | { type: "agentMessage"; id: string; text: string; phase: string | null }
  | { type: "plan"; id: string; text: string }
  | { type: "reasoning"; id: string; summary: string[]; content: string[] }
  | {
      type: "commandExecution";
      id: string;
      command: string;
      cwd: string;
      processId: string | null;
      status: string;
      commandActions: Array<{ type: string; command?: string; name?: string; path?: string | null }>;
      aggregatedOutput: string | null;
      exitCode: number | null;
      durationMs: number | null;
    }
  | { type: "fileChange"; id: string; changes: Array<{ path?: string; kind?: string }>; status: string }
  | { type: "mcpToolCall"; id: string; server: string; tool: string; status: string }
  | { type: "dynamicToolCall"; id: string; tool: string; status: string }
  | {
      type: "collabAgentToolCall";
      id: string;
      tool: string;
      status: string;
      senderThreadId: string;
      receiverThreadIds: string[];
      prompt: string | null;
      agentsStates: Record<string, unknown>;
    }
  | { type: "webSearch"; id: string; query: string }
  | { type: "imageView"; id: string; path: string }
  | { type: "imageGeneration"; id: string; status: string; revisedPrompt: string | null; result: string }
  | { type: "enteredReviewMode"; id: string; review: string }
  | { type: "exitedReviewMode"; id: string; review: string }
  | { type: "contextCompaction"; id: string };

export type AppTurn = {
  id: string;
  items: AppThreadItem[];
  status: "completed" | "interrupted" | "failed" | "inProgress";
  error: { message: string; additionalDetails: string | null } | null;
};

export type AppThread = {
  id: string;
  preview: string;
  ephemeral: boolean;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  status: AppThreadStatus;
  path: string | null;
  cwd: string;
  cliVersion: string;
  source: string;
  agentNickname: string | null;
  agentRole: string | null;
  gitInfo: AppGitInfo | null;
  name: string | null;
  tokenUsage?: AppThreadTokenUsage | null;
  turns: AppTurn[];
};

export type AppServerAccount =
  | { type: "apiKey" }
  | { type: "chatgpt"; email: string; planType: string };

export type AppServerRateLimitWindow = {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
};

export type AppServerRateLimitSnapshot = {
  limitId: string | null;
  limitName: string | null;
  primary: AppServerRateLimitWindow | null;
  secondary: AppServerRateLimitWindow | null;
  credits: Record<string, unknown> | null;
  planType: string | null;
};

export type AppServerAccountResponse = {
  account: AppServerAccount | null;
  requiresOpenaiAuth: boolean;
};

export type AppServerAccountLoginStartResponse =
  | { type: "apiKey" }
  | { type: "chatgpt"; loginId: string; authUrl: string }
  | { type: "chatgptAuthTokens" };

export type AppServerRateLimitsResponse = {
  rateLimits: AppServerRateLimitSnapshot;
  rateLimitsByLimitId: Record<string, AppServerRateLimitSnapshot> | null;
};

export type AppServerModel = {
  id: string;
  model: string;
  upgrade?: string | null;
  upgradeInfo?: unknown | null;
  availabilityNux?: unknown | null;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  supportedReasoningEfforts: Array<string | { reasoningEffort: string; description?: string }>;
  defaultReasoningEffort: string;
  inputModalities: string[];
  supportsPersonality: boolean;
};

export type AppServerModelsResponse = {
  data: AppServerModel[];
  nextCursor: string | null;
};

export type AppServerAppInfo = {
  id: string;
  name: string;
  description: string | null;
  isAccessible: boolean;
  isEnabled: boolean;
  installUrl: string | null;
  distributionChannel: string | null;
  pluginDisplayNames: string[];
  labels: Record<string, string> | null;
};

export type AppServerAppsListResponse = {
  data: AppServerAppInfo[];
  nextCursor: string | null;
};

export type AppServerPluginSummary = {
  id: string;
  name: string;
  installed: boolean;
  enabled: boolean;
  source: unknown;
  interface: unknown | null;
};

export type AppServerPluginMarketplace = {
  name: string;
  path: string;
  plugins: AppServerPluginSummary[];
};

export type AppServerPluginListResponse = {
  marketplaces: AppServerPluginMarketplace[];
};

export type AppServerMcpServerStatus = {
  name: string;
  tools: Record<string, unknown>;
  resources: unknown[];
  resourceTemplates: unknown[];
  authStatus: unknown;
};

export type AppServerMcpServerStatusResponse = {
  data: AppServerMcpServerStatus[];
  nextCursor: string | null;
};

export type AppServerExperimentalFeature = {
  name: string;
  stage: string;
  displayName: string | null;
  description: string | null;
  announcement: string | null;
  enabled: boolean;
  defaultEnabled: boolean;
};

export type AppServerExperimentalFeatureListResponse = {
  data: AppServerExperimentalFeature[];
  nextCursor: string | null;
};

export type AppServerSkillMetadata = {
  name: string;
  description: string;
  shortDescription?: string;
  path: string;
  scope: string;
  enabled: boolean;
};

export type AppServerSkillsListEntry = {
  cwd: string;
  skills: AppServerSkillMetadata[];
  errors: Array<{ path?: string; message?: string }>;
};

export type AppServerSkillsListResponse = {
  data: AppServerSkillsListEntry[];
};

export type AppServerConfigReadResponse = {
  config: Record<string, unknown>;
  origins: Record<string, unknown>;
  layers: Array<Record<string, unknown>> | null;
};

export type AppServerConfigEdit = {
  keyPath: string;
  value: unknown;
  mergeStrategy: "replace" | "upsert";
};

export type AppServerConfigBatchWriteRequest = {
  edits: AppServerConfigEdit[];
  filePath?: string | null;
  expectedVersion?: string | null;
  reloadUserConfig?: boolean;
};

export type AppServerConfigWriteResponse = {
  status?: string;
  config?: Record<string, unknown>;
};

export type AppServerConfigRequirementsResponse = {
  requirements: Record<string, unknown> | null;
};

export type AppServerCommandExecResponse = {
  processId?: string | null;
  running?: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type AppServerReviewTarget =
  | { type: "uncommittedChanges" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title: string | null }
  | { type: "custom"; instructions: string };

export type AppServerReviewResponse = {
  turn: AppTurn;
  reviewThreadId: string;
};

export type AppServerFuzzyFileResult = {
  root: string;
  path: string;
  file_name: string;
  score: number;
  indices: number[] | null;
};

export type AppServerFuzzyFileSearchResponse = {
  files: AppServerFuzzyFileResult[];
};

export type JsonRpcResponse<T = unknown> =
  | { jsonrpc?: "2.0"; id: string | number; result: T }
  | { jsonrpc?: "2.0"; id: string | number; error: { code: number; message: string; data?: unknown } };

export type AppServerNotification =
  | {
      method: "account/login/completed";
      params: { loginId: string | null; success: boolean; error: string | null };
    }
  | {
      method: "account/updated";
      params: { authMode: "apikey" | "chatgpt" | "chatgptAuthTokens" | null };
    }
  | {
      method: "account/rateLimits/updated";
      params: { rateLimits: AppServerRateLimitsResponse["rateLimits"] };
    }
  | { method: "thread/started"; params: { thread: AppThread } }
  | { method: "thread/archived"; params: { threadId: string } }
  | { method: "thread/unarchived"; params: { threadId: string } }
  | { method: "thread/name/updated"; params: { threadId: string; threadName?: string } }
  | { method: "thread/status/changed"; params: { threadId: string; status: AppThreadStatus } }
  | { method: "thread/tokenUsage/updated"; params: { threadId: string; turnId: string; tokenUsage: AppThreadTokenUsage } }
  | { method: "turn/started"; params: { threadId: string; turn: AppTurn } }
  | { method: "turn/completed"; params: { threadId: string; turn: AppTurn } }
  | { method: "item/started"; params: { item: AppThreadItem; threadId: string; turnId: string } }
  | { method: "item/completed"; params: { item: AppThreadItem; threadId: string; turnId: string } }
  | { method: "item/agentMessage/delta"; params: { threadId: string; turnId: string; itemId: string; delta: string } }
  | { method: "item/plan/delta"; params: { threadId: string; turnId: string; itemId: string; delta: string } }
  | { method: "item/commandExecution/outputDelta"; params: { threadId: string; turnId: string; itemId: string; delta: string } }
  | { method: "command/exec/outputDelta"; params: { processId: string; stream: "stdout" | "stderr"; deltaBase64: string; capReached: boolean } }
  | { method: "turn/plan/updated"; params: { threadId: string; turnId: string; explanation: string | null; plan: Array<{ step: string; status: string }> } }
  | { method: "error"; params: { error: { message: string; additionalDetails: string | null }; willRetry: boolean; threadId: string; turnId: string } }
  | { method: "serverRequest/resolved"; params: { threadId: string; requestId: string | number } };

export type AppServerRequest =
  | {
      id: string | number;
      method: "item/commandExecution/requestApproval";
      params: {
        threadId: string;
        turnId: string;
        itemId: string;
        approvalId?: string | null;
        reason?: string | null;
        command?: string | null;
        cwd?: string | null;
      };
    }
  | {
      id: string | number;
      method: "item/fileChange/requestApproval";
      params: {
        threadId: string;
        turnId: string;
        itemId: string;
        reason?: string | null;
        grantRoot?: string | null;
      };
    }
  | {
      id: string | number;
      method: "item/permissions/requestApproval";
      params: {
        threadId: string;
        turnId: string;
        itemId: string;
        reason: string | null;
        permissions: {
          network: unknown | null;
          fileSystem: unknown | null;
          macos: unknown | null;
        };
      };
    }
  | {
      id: string | number;
      method: "item/tool/requestUserInput";
      params: {
        threadId: string;
        turnId: string;
        itemId: string;
        questions: Array<{
          id: string;
          header: string;
          question: string;
          isOther: boolean;
          isSecret: boolean;
          options: Array<{ label: string; description: string }> | null;
        }>;
      };
    };

export type AppThreadListResponse = {
  data: AppThread[];
  nextCursor: string | null;
};

export type AppThreadReadResponse = {
  thread: AppThread;
};

export type AppThreadStartResponse = {
  thread: AppThread;
  model: string;
  modelProvider: string;
  serviceTier: string | null;
  cwd: string;
  approvalPolicy: string;
  sandbox: unknown;
  reasoningEffort: string | null;
};

export type AppTurnStartResponse = {
  turn: AppTurn;
};

export type AppTurnSteerResponse = {
  turnId: string;
};
