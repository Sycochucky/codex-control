import type { AppThread, AppThreadItem, AppTurn } from "../types/app-server";

export function upsertTurnItem(items: AppThreadItem[], nextItem: AppThreadItem) {
  const existingIndex = items.findIndex((item) => item.id === nextItem.id);
  if (existingIndex === -1) {
    return [...items, nextItem];
  }

  return items.map((item) => (item.id === nextItem.id ? nextItem : item));
}

export function appendItemTextDelta(
  thread: AppThread,
  turnId: string,
  itemId: string,
  kind: "agentMessage" | "plan",
  delta: string,
) {
  return {
    ...thread,
    turns: thread.turns.map((turn) => appendTextDeltaToTurn(turn, turnId, itemId, kind, delta)),
  };
}

export function appendCommandOutputDelta(
  thread: AppThread,
  turnId: string,
  itemId: string,
  delta: string,
) {
  return {
    ...thread,
    turns: thread.turns.map((turn) => appendCommandDeltaToTurn(turn, turnId, itemId, delta)),
  };
}

function appendTextDeltaToTurn(
  turn: AppTurn,
  turnId: string,
  itemId: string,
  kind: "agentMessage" | "plan",
  delta: string,
) {
  if (turn.id !== turnId) {
    return turn;
  }

  const existing = turn.items.find((item) => item.id === itemId);
  const nextItem: AppThreadItem =
    existing && existing.type === kind
      ? kind === "agentMessage"
        ? { ...existing, text: `${existing.text}${delta}` }
        : { ...existing, text: `${existing.text}${delta}` }
      : kind === "agentMessage"
        ? { type: "agentMessage", id: itemId, text: delta, phase: null }
        : { type: "plan", id: itemId, text: delta };

  return {
    ...turn,
    items: upsertTurnItem(turn.items, nextItem),
  };
}

function appendCommandDeltaToTurn(
  turn: AppTurn,
  turnId: string,
  itemId: string,
  delta: string,
) {
  if (turn.id !== turnId) {
    return turn;
  }

  const existing = turn.items.find((item) => item.id === itemId);
  if (!existing || existing.type !== "commandExecution") {
    return turn;
  }

  return {
    ...turn,
    items: upsertTurnItem(turn.items, {
      ...existing,
      aggregatedOutput: `${existing.aggregatedOutput ?? ""}${delta}`,
    }),
  };
}
