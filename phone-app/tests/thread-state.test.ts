import test = require("node:test");
import assert = require("node:assert/strict");

import type { AppThread, AppThreadItem } from "../types/app-server";
import { appendCommandOutputDelta, appendItemTextDelta, upsertTurnItem } from "../utils/thread-state";

test("upsertTurnItem replaces an existing item and preserves order", () => {
  const items: AppThreadItem[] = [
    { type: "plan", id: "plan-1", text: "first" },
    { type: "plan", id: "plan-2", text: "second" },
  ];

  const next = upsertTurnItem(items, { type: "plan", id: "plan-2", text: "updated" });
  assert.equal(next[1]?.type, "plan");
  assert.equal(next[1] && "text" in next[1] ? next[1].text : "", "updated");
});

test("appendItemTextDelta grows agent messages incrementally", () => {
  const thread = createThread({
    turns: [
      {
        id: "turn-1",
        status: "inProgress",
        error: null,
        items: [{ type: "agentMessage", id: "item-1", text: "Hello", phase: null }],
      },
    ],
  });

  const next = appendItemTextDelta(thread, "turn-1", "item-1", "agentMessage", " world");
  const item = next.turns[0]?.items[0];
  assert.equal(item && "text" in item ? item.text : "", "Hello world");
});

test("appendCommandOutputDelta appends output to command execution items", () => {
  const thread = createThread({
    turns: [
      {
        id: "turn-1",
        status: "inProgress",
        error: null,
        items: [
          {
            type: "commandExecution",
            id: "cmd-1",
            command: "git status",
            cwd: "D:\\DevProjects\\codex-app-syco",
            processId: "p1",
            status: "running",
            commandActions: [],
            aggregatedOutput: "line one",
            exitCode: null,
            durationMs: null,
          },
        ],
      },
    ],
  });

  const next = appendCommandOutputDelta(thread, "turn-1", "cmd-1", "\nline two");
  const item = next.turns[0]?.items[0];
  assert.equal(
    item && item.type === "commandExecution" ? item.aggregatedOutput : "",
    "line one\nline two",
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
