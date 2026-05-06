import test = require("node:test");
import assert = require("node:assert/strict");

import type { AppThread } from "../types/app-server";
import {
  buildThreadProjectSections,
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

test("buildThreadProjectSections orders project groups by their most recently updated thread", () => {
  const sections = buildThreadProjectSections([
    createThread({ id: "older-syco", cwd: "D:\\DevProjects\\codex-app-syco", updatedAt: 10 }),
    createThread({ id: "latest-other", cwd: "D:\\DevProjects\\other-project", updatedAt: 50 }),
    createThread({ id: "newer-syco", cwd: "D:\\DevProjects\\codex-app-syco", updatedAt: 30 }),
  ]);

  assert.deepEqual(
    sections.map((section) => ({
      title: section.title,
      latestUpdatedAt: section.latestUpdatedAt,
      threadIds: section.items.map((thread) => thread.id),
    })),
    [
      { title: "other-project", latestUpdatedAt: 50, threadIds: ["latest-other"] },
      { title: "codex-app-syco", latestUpdatedAt: 30, threadIds: ["newer-syco", "older-syco"] },
    ],
  );
});

test("buildThreadProjectSections normalizes cwd before grouping and keeps newest project threads first", () => {
  const sections = buildThreadProjectSections([
    createThread({ id: "old", cwd: "\\\\?\\D:/DevProjects/codex-app-syco/", updatedAt: 10 }),
    createThread({ id: "new", cwd: "D:\\DevProjects\\codex-app-syco", updatedAt: 40 }),
    createThread({ id: "middle", cwd: "D:/DevProjects/codex-app-syco", updatedAt: 30 }),
  ]);

  assert.equal(sections.length, 1);
  assert.equal(sections[0]?.key, "D:\\DevProjects\\codex-app-syco");
  assert.equal(sections[0]?.title, "codex-app-syco");
  assert.deepEqual(sections[0]?.items.map((thread) => thread.id), ["new", "middle", "old"]);
});

test("buildThreadProjectSections keeps status context in each project summary", () => {
  const sections = buildThreadProjectSections([
    createThread({
      id: "waiting",
      updatedAt: 30,
      status: { type: "active", activeFlags: ["waitingOnUserInput"] },
    }),
    createThread({ id: "running", updatedAt: 20, status: { type: "active", activeFlags: [] } }),
    createThread({ id: "completed", updatedAt: 10, status: { type: "idle" } }),
  ]);

  assert.equal(sections[0]?.statusSummary, "Needs response 1 | Running 1 | Ready 1");
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
