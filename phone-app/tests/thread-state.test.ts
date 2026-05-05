import test = require("node:test");
import assert = require("node:assert/strict");

import type { AppThread, AppThreadItem } from "../types/app-server";
import {
  appendCommandOutputDelta,
  appendItemTextDelta,
  findActiveTurnId,
  mergeTurnIntoThread,
  replaceThreadWithSnapshot,
  upsertTurnItem,
} from "../utils/thread-state";

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

test("mergeTurnIntoThread adds a submitted turn for immediate chat updates", () => {
  const thread = createThread({ turns: [] });
  const next = mergeTurnIntoThread(thread, {
    id: "turn-1",
    status: "inProgress",
    error: null,
    items: [{ type: "userMessage", id: "user-1", content: [{ type: "text", text: "hello", text_elements: [] }] }],
  });

  assert.equal(next.turns.length, 1);
  assert.equal(next.turns[0]?.id, "turn-1");
  assert.equal(findActiveTurnId(next), "turn-1");
});

test("mergeTurnIntoThread replaces completed turns without losing position", () => {
  const thread = createThread({
    turns: [
      { id: "turn-1", status: "inProgress", error: null, items: [] },
      { id: "turn-2", status: "inProgress", error: null, items: [] },
    ],
  });

  const next = mergeTurnIntoThread(thread, {
    id: "turn-1",
    status: "completed",
    error: null,
    items: [{ type: "agentMessage", id: "agent-1", text: "done", phase: null }],
  });

  assert.equal(next.turns[0]?.status, "completed");
  assert.equal(next.turns[0]?.items[0]?.id, "agent-1");
  assert.equal(next.turns[1]?.id, "turn-2");
});

test("replaceThreadWithSnapshot accepts a fresh read of the same thread", () => {
  const current = createThread({
    id: "thread-1",
    updatedAt: 1,
    turns: [
      {
        id: "turn-1",
        status: "inProgress",
        error: null,
        items: [{ type: "userMessage", id: "user-1", content: [{ type: "text", text: "old", text_elements: [] }] }],
      },
    ],
  });
  const refreshed = createThread({
    id: "thread-1",
    updatedAt: 2,
    turns: [
      {
        id: "turn-1",
        status: "completed",
        error: null,
        items: [{ type: "agentMessage", id: "agent-1", text: "fresh", phase: null }],
      },
    ],
  });

  const next = replaceThreadWithSnapshot(current, refreshed);
  assert.equal(next.updatedAt, 2);
  assert.equal(next.turns[0]?.status, "completed");
  assert.equal(next.turns[0]?.items[0]?.id, "agent-1");
});

test("replaceThreadWithSnapshot ignores a read for a different thread", () => {
  const current = createThread({ id: "thread-1", updatedAt: 1 });
  const refreshed = createThread({ id: "thread-2", updatedAt: 2 });

  assert.equal(replaceThreadWithSnapshot(current, refreshed), current);
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
