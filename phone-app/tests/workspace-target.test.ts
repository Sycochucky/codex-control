import test = require("node:test");
import assert = require("node:assert/strict");

import type { AppThread } from "../types/app-server";
import {
  deriveWorkspaceOptions,
  resolveWorkspacePickerSelection,
} from "../utils/workspace-target";

test("deriveWorkspaceOptions dedupes workspaces and sorts by recent thread activity", () => {
  const workspaces = deriveWorkspaceOptions([
    createThread({
      id: "repo-a-old",
      cwd: "D:/repos/alpha",
      updatedAt: 10,
      status: { type: "idle" },
    }),
    createThread({
      id: "repo-b",
      cwd: "D:/repos/beta",
      updatedAt: 30,
      status: { type: "active", activeFlags: ["waitingOnUserInput"] },
    }),
    createThread({
      id: "repo-a-new",
      cwd: "\\\\?\\D:/repos/alpha/",
      updatedAt: 40,
      status: { type: "active", activeFlags: [] },
    }),
  ]);

  assert.deepEqual(
    workspaces.map((workspace) => ({
      path: workspace.path,
      threadCount: workspace.threadCount,
      runningCount: workspace.runningCount,
      waitingCount: workspace.waitingCount,
    })),
    [
      {
        path: "D:\\repos\\alpha",
        threadCount: 2,
        runningCount: 1,
        waitingCount: 0,
      },
      {
        path: "D:\\repos\\beta",
        threadCount: 1,
        runningCount: 0,
        waitingCount: 1,
      },
    ],
  );
});

test("resolveWorkspacePickerSelection keeps manual workspace precedence", () => {
  const next = resolveWorkspacePickerSelection({
    manualWorkspace: "D:/manual",
    currentPickerPath: "D:/repos/alpha",
    workspaceTargetPath: "D:/repos/beta",
    workspaceTargetSource: "selected",
    workspaceOptions: [
      createWorkspaceOption("D:\\repos\\beta"),
      createWorkspaceOption("D:\\repos\\alpha"),
    ],
  });

  assert.deepEqual(next, {
    nextPickerPath: "D:\\repos\\alpha",
    nextRouteWorkspacePath: null,
  });
});

test("resolveWorkspacePickerSelection tracks route workspace changes", () => {
  const next = resolveWorkspacePickerSelection({
    currentPickerPath: "D:/repos/old",
    workspaceTargetPath: "D:/repos/new",
    workspaceTargetSource: "route",
    workspaceOptions: [createWorkspaceOption("D:\\repos\\old")],
    lastRouteWorkspacePath: "D:/repos/old",
  });

  assert.deepEqual(next, {
    nextPickerPath: "D:\\repos\\new",
    nextRouteWorkspacePath: "D:\\repos\\new",
  });
});

function createThread(overrides: Partial<AppThread>): AppThread {
  return {
    id: "thread",
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 0,
    updatedAt: 0,
    status: { type: "idle" },
    path: null,
    cwd: "D:\\repos\\alpha",
    cliVersion: "1.0.0",
    source: "vscode",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...overrides,
  };
}

function createWorkspaceOption(path: string) {
  return {
    path,
    label: path.split("\\").at(-1) ?? path,
    sourceThreadId: null,
    threadCount: 1,
    runningCount: 0,
    waitingCount: 0,
    latestUpdatedAt: 1,
  };
}
