import assert = require("node:assert/strict");
import test = require("node:test");

import type { AppServerModel } from "../types/app-server";
import {
  DEFAULT_RUNTIME_DEFAULTS,
  buildDesktopModelConfigWrite,
  buildThreadStartPayload,
  buildTurnStartPayload,
  getVisibleModels,
  resolveRuntimeSelection,
  requiresConfirmedCommandCenterAction,
  type RuntimeDefaults,
} from "../utils/runtime-defaults";

function model(input: Partial<AppServerModel> & Pick<AppServerModel, "model" | "displayName">): AppServerModel {
  return {
    id: input.id ?? input.model,
    model: input.model,
    upgrade: input.upgrade ?? null,
    upgradeInfo: input.upgradeInfo ?? null,
    availabilityNux: input.availabilityNux ?? null,
    displayName: input.displayName,
    description: input.description ?? "",
    hidden: input.hidden ?? false,
    isDefault: input.isDefault ?? false,
    supportedReasoningEfforts: input.supportedReasoningEfforts ?? ["medium"],
    defaultReasoningEffort: input.defaultReasoningEffort ?? "medium",
    inputModalities: input.inputModalities ?? ["text"],
    supportsPersonality: input.supportsPersonality ?? false,
  };
}

test("runtime selection uses the App Server default model when no phone model is saved", () => {
  const selection = resolveRuntimeSelection({
    saved: DEFAULT_RUNTIME_DEFAULTS,
    models: [
      model({ model: "gpt-5.4-mini", displayName: "GPT-5.4 Mini" }),
      model({
        model: "gpt-5.5",
        displayName: "GPT-5.5",
        isDefault: true,
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: ["medium", "high"],
      }),
    ],
  });

  assert.equal(selection.model, "gpt-5.5");
  assert.equal(selection.reasoningEffort, "high");
  assert.equal(selection.approvalPolicy, "on-request");
  assert.equal(selection.sandbox, "workspace-write");
});

test("runtime selection resets a saved reasoning effort unsupported by the selected model", () => {
  const saved: RuntimeDefaults = {
    ...DEFAULT_RUNTIME_DEFAULTS,
    model: "gpt-5.4-mini",
    reasoningEffort: "xhigh",
  };

  const selection = resolveRuntimeSelection({
    saved,
    models: [
      model({
        model: "gpt-5.4-mini",
        displayName: "GPT-5.4 Mini",
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: ["low", "medium"],
      }),
    ],
  });

  assert.equal(selection.model, "gpt-5.4-mini");
  assert.equal(selection.reasoningEffort, "medium");
});

test("hidden and unavailable models stay hidden until advanced visibility is enabled", () => {
  const models = [
    model({ model: "visible", displayName: "Visible" }),
    model({ model: "hidden", displayName: "Hidden", hidden: true }),
    model({ model: "upgrade", displayName: "Upgrade", upgrade: "team" }),
  ];

  assert.deepEqual(
    getVisibleModels(models, false).map((entry) => entry.model),
    ["visible"],
  );
  assert.deepEqual(
    getVisibleModels(models, true).map((entry) => entry.model),
    ["visible", "hidden", "upgrade"],
  );
});

test("thread start payload includes model, reasoning config, approval, sandbox, and service tier", () => {
  const payload = buildThreadStartPayload({
    cwd: "C:\\repo",
    runtime: {
      model: "gpt-5.5",
      reasoningEffort: "high",
      approvalPolicy: "on-failure",
      sandbox: "read-only",
      serviceTier: "fast",
    },
  });

  assert.deepEqual(payload, {
    cwd: "C:\\repo",
    model: "gpt-5.5",
    approvalPolicy: "on-failure",
    sandbox: "read-only",
    serviceTier: "fast",
    config: { reasoning_effort: "high" },
    ephemeral: false,
    experimentalRawEvents: false,
    persistExtendedHistory: true,
  });
});

test("turn start payload includes runtime overrides with workspace-write sandbox policy", () => {
  const payload = buildTurnStartPayload({
    threadId: "thread-1",
    input: [{ type: "text", text: "continue", text_elements: [] }],
    cwd: "C:\\repo",
    runtime: {
      model: "gpt-5.5",
      reasoningEffort: "high",
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
      serviceTier: null,
    },
  });

  assert.equal(payload.threadId, "thread-1");
  assert.equal(payload.model, "gpt-5.5");
  assert.equal(payload.effort, "high");
  assert.equal(payload.approvalPolicy, "on-request");
  assert.equal(payload.serviceTier, null);
  assert.deepEqual(payload.sandboxPolicy, {
    type: "workspaceWrite",
    writableRoots: ["C:\\repo"],
    readOnlyAccess: { type: "fullAccess" },
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  });
});

test("desktop model config writes only model and reasoning after explicit confirmation", () => {
  const runtime = {
    model: "gpt-5.5",
    reasoningEffort: "high",
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    serviceTier: null,
  } satisfies RuntimeDefaults;

  assert.equal(buildDesktopModelConfigWrite(runtime, false), null);
  assert.deepEqual(buildDesktopModelConfigWrite(runtime, true), {
    edits: [
      { keyPath: "model", value: "gpt-5.5", mergeStrategy: "replace" },
      { keyPath: "reasoning_effort", value: "high", mergeStrategy: "replace" },
    ],
    reloadUserConfig: true,
  });
});

test("destructive command-center actions require confirmation", () => {
  assert.equal(requiresConfirmedCommandCenterAction("plugin/install", false), true);
  assert.equal(requiresConfirmedCommandCenterAction("plugin/uninstall", false), true);
  assert.equal(requiresConfirmedCommandCenterAction("config/batchWrite", false), true);
  assert.equal(requiresConfirmedCommandCenterAction("model/list", false), false);
  assert.equal(requiresConfirmedCommandCenterAction("plugin/install", true), false);
});
