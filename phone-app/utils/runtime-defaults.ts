import type { AppServerModel } from "@/types/app-server";
import type { AppServerConfigBatchWriteRequest } from "@/types/app-server";

export const RUNTIME_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
export const RUNTIME_APPROVAL_POLICIES = ["untrusted", "on-failure", "on-request", "never"] as const;
export const RUNTIME_SANDBOX_MODES = ["read-only", "workspace-write", "danger-full-access"] as const;
export const RUNTIME_SERVICE_TIERS = ["fast", "flex"] as const;

export type RuntimeReasoningEffort = (typeof RUNTIME_REASONING_EFFORTS)[number];
export type RuntimeApprovalPolicy = (typeof RUNTIME_APPROVAL_POLICIES)[number];
export type RuntimeSandboxMode = (typeof RUNTIME_SANDBOX_MODES)[number];
export type RuntimeServiceTier = (typeof RUNTIME_SERVICE_TIERS)[number] | null;

export type RuntimeDefaults = {
  model: string | null;
  reasoningEffort: RuntimeReasoningEffort | null;
  approvalPolicy: RuntimeApprovalPolicy;
  sandbox: RuntimeSandboxMode;
  serviceTier: RuntimeServiceTier;
};

export type RuntimeSelection = RuntimeDefaults & {
  selectedModel: AppServerModel | null;
  supportedReasoningEfforts: RuntimeReasoningEffort[];
};

export const DEFAULT_RUNTIME_DEFAULTS: RuntimeDefaults = {
  model: null,
  reasoningEffort: null,
  approvalPolicy: "on-request",
  sandbox: "workspace-write",
  serviceTier: null,
};

export function getVisibleModels(models: AppServerModel[], showHiddenOrUnavailable: boolean) {
  if (showHiddenOrUnavailable) {
    return models;
  }

  return models.filter((model) => !model.hidden && !model.upgrade);
}

export function resolveRuntimeSelection({
  saved,
  models,
}: {
  saved: Partial<RuntimeDefaults> | null | undefined;
  models: AppServerModel[];
}): RuntimeSelection {
  const merged = normalizeRuntimeDefaults(saved);
  const selectedModel =
    findModel(models, merged.model) ??
    getVisibleModels(models, false).find((model) => model.isDefault) ??
    getVisibleModels(models, false)[0] ??
    models.find((model) => model.isDefault) ??
    models[0] ??
    null;

  const supportedReasoningEfforts = selectedModel ? getReasoningEfforts(selectedModel) : [];
  const modelDefaultEffort = normalizeReasoningEffort(selectedModel?.defaultReasoningEffort);
  const reasoningEffort =
    normalizeReasoningEffort(merged.reasoningEffort) &&
    supportedReasoningEfforts.includes(normalizeReasoningEffort(merged.reasoningEffort)!)
      ? normalizeReasoningEffort(merged.reasoningEffort)
      : modelDefaultEffort && supportedReasoningEfforts.includes(modelDefaultEffort)
        ? modelDefaultEffort
        : supportedReasoningEfforts[0] ?? normalizeReasoningEffort(merged.reasoningEffort);

  return {
    ...merged,
    model: selectedModel?.model ?? merged.model,
    reasoningEffort: reasoningEffort ?? null,
    selectedModel,
    supportedReasoningEfforts,
  };
}

export function normalizeRuntimeDefaults(value: Partial<RuntimeDefaults> | null | undefined): RuntimeDefaults {
  return {
    model: value?.model?.trim() || DEFAULT_RUNTIME_DEFAULTS.model,
    reasoningEffort: normalizeReasoningEffort(value?.reasoningEffort) ?? DEFAULT_RUNTIME_DEFAULTS.reasoningEffort,
    approvalPolicy: isApprovalPolicy(value?.approvalPolicy) ? value.approvalPolicy : DEFAULT_RUNTIME_DEFAULTS.approvalPolicy,
    sandbox: isSandboxMode(value?.sandbox) ? value.sandbox : DEFAULT_RUNTIME_DEFAULTS.sandbox,
    serviceTier: isServiceTier(value?.serviceTier) ? value.serviceTier : DEFAULT_RUNTIME_DEFAULTS.serviceTier,
  };
}

export function getReasoningEfforts(model: Pick<AppServerModel, "supportedReasoningEfforts">) {
  return model.supportedReasoningEfforts
    .map((effort) => normalizeReasoningEffort(typeof effort === "string" ? effort : effort.reasoningEffort))
    .filter((effort): effort is RuntimeReasoningEffort => Boolean(effort));
}

export function buildThreadStartPayload({
  cwd,
  runtime,
}: {
  cwd?: string | null;
  runtime: RuntimeDefaults;
}) {
  return {
    cwd: cwd ?? null,
    model: runtime.model ?? null,
    approvalPolicy: runtime.approvalPolicy,
    sandbox: runtime.sandbox,
    serviceTier: runtime.serviceTier,
    config: runtime.reasoningEffort ? { reasoning_effort: runtime.reasoningEffort } : null,
    ephemeral: false,
    experimentalRawEvents: false,
    persistExtendedHistory: true,
  };
}

export function buildTurnStartPayload({
  threadId,
  text,
  cwd,
  runtime,
}: {
  threadId: string;
  text: string;
  cwd?: string | null;
  runtime: RuntimeDefaults;
}) {
  return {
    threadId,
    input: [{ type: "text", text, text_elements: [] }],
    cwd: cwd ?? null,
    approvalPolicy: runtime.approvalPolicy,
    sandboxPolicy: buildSandboxPolicy(runtime.sandbox, cwd ?? null),
    model: runtime.model ?? null,
    serviceTier: runtime.serviceTier,
    effort: runtime.reasoningEffort,
  };
}

export function buildDesktopModelConfigWrite(
  runtime: RuntimeDefaults,
  confirmed: boolean,
): AppServerConfigBatchWriteRequest | null {
  if (!confirmed || !runtime.model) {
    return null;
  }

  const edits: AppServerConfigBatchWriteRequest["edits"] = [
    { keyPath: "model", value: runtime.model, mergeStrategy: "replace" },
  ];

  if (runtime.reasoningEffort) {
    edits.push({
      keyPath: "reasoning_effort",
      value: runtime.reasoningEffort,
      mergeStrategy: "replace",
    });
  }

  return {
    edits,
    reloadUserConfig: true,
  };
}

export function requiresConfirmedCommandCenterAction(method: string, confirmed: boolean) {
  if (confirmed) {
    return false;
  }

  return new Set([
    "config/batchWrite",
    "config/value/write",
    "plugin/install",
    "plugin/uninstall",
    "skills/config/write",
  ]).has(method);
}

function buildSandboxPolicy(mode: RuntimeSandboxMode, cwd: string | null) {
  switch (mode) {
    case "danger-full-access":
      return { type: "dangerFullAccess" };
    case "read-only":
      return {
        type: "readOnly",
        access: { type: "fullAccess" },
        networkAccess: false,
      };
    case "workspace-write":
      return {
        type: "workspaceWrite",
        writableRoots: cwd ? [cwd] : [],
        readOnlyAccess: { type: "fullAccess" },
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      };
  }
}

function findModel(models: AppServerModel[], modelName: string | null) {
  if (!modelName) {
    return null;
  }

  return models.find((model) => model.model === modelName || model.id === modelName) ?? null;
}

function normalizeReasoningEffort(value: string | null | undefined): RuntimeReasoningEffort | null {
  return RUNTIME_REASONING_EFFORTS.includes(value as RuntimeReasoningEffort)
    ? (value as RuntimeReasoningEffort)
    : null;
}

function isApprovalPolicy(value: unknown): value is RuntimeApprovalPolicy {
  return RUNTIME_APPROVAL_POLICIES.includes(value as RuntimeApprovalPolicy);
}

function isSandboxMode(value: unknown): value is RuntimeSandboxMode {
  return RUNTIME_SANDBOX_MODES.includes(value as RuntimeSandboxMode);
}

function isServiceTier(value: unknown): value is RuntimeServiceTier {
  return value === null || RUNTIME_SERVICE_TIERS.includes(value as Exclude<RuntimeServiceTier, null>);
}
