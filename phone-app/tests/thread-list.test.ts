import test = require("node:test");
import assert = require("node:assert/strict");

import type { AppThread } from "../types/app-server";
import {
  buildThreadContinuationSections,
  getWorkspaceLabel,
  normalizeWorkspacePath,
  sortThreadsByUpdated,
} from "../utils/thread-list";

test("normalizeWorkspacePath strips device prefixes and trailing separators", () => {
  assert.equal(
    normalizeWorkspacePath("\\\\?\\D:/DevProjects/codex-app-syco/"),
    "D:\\DevProjects\\codex-app-syco",
  );
});

test("getWorkspaceLabel falls back to the folder name", () => {
  assert.equal(getWorkspaceLabel("D:\\DevProjects\\codex-app-syco"), "codex-app-syco");
});

test("sortThreadsByUpdated keeps newest threads first", () => {
  const threads = sortThreadsByUpdated([
    createThread({ id: "one", updatedAt: 10 }),
    createThread({ id: "two", updatedAt: 50 }),
    createThread({ id: "three", updatedAt: 20 }),
  ]);

  assert.deepEqual(threads.map((thread) => thread.id), ["two", "three", "one"]);
});

test("buildThreadContinuationSections groups current threads for continuing work", () => {
  const sections = buildThreadContinuationSections([
    createThread({ id: "completed", updatedAt: 10, status: { type: "idle" } }),
    createThread({
      id: "waiting",
      updatedAt: 20,
      status: { type: "active", activeFlags: ["waitingOnUserInput"] },
    }),
    createThread({ id: "running", updatedAt: 30, status: { type: "active", activeFlags: [] } }),
    createThread({ id: "failed", updatedAt: 40, status: { type: "systemError" } }),
    createThread({ id: "history", updatedAt: 50, status: { type: "notLoaded" } }),
  ]);

  assert.deepEqual(
    sections.map((section) => ({
      key: section.key,
      title: section.title,
      threadIds: section.items.map((thread) => thread.id),
    })),
    [
      { key: "waiting", title: "Needs Response", threadIds: ["waiting"] },
      { key: "running", title: "Running Now", threadIds: ["running"] },
      { key: "failed", title: "Needs Attention", threadIds: ["failed"] },
      { key: "completed", title: "Ready To Continue", threadIds: ["completed"] },
      { key: "history", title: "History Snapshots", threadIds: ["history"] },
    ],
  );
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
    cwd: "D:\\DevProjects\\codex-app-syco",
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
