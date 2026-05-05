import type { AppThread, AppThreadItem, AppTurn, AppUserInput } from "@/types/app-server";

export type AppThreadBucket = "running" | "waiting" | "completed" | "failed" | "history";

export function getAppThreadBucket(thread: AppThread): AppThreadBucket {
  if (thread.status.type === "systemError") {
    return "failed";
  }

  if (thread.status.type === "notLoaded") {
    return "history";
  }

  if (thread.status.type === "idle") {
    return "completed";
  }

  if (thread.status.activeFlags.includes("waitingOnApproval") || thread.status.activeFlags.includes("waitingOnUserInput")) {
    return "waiting";
  }

  return "running";
}

export function getAppThreadStatusLabel(thread: AppThread) {
  if (thread.status.type === "systemError") {
    return "attention_required";
  }

  if (thread.status.type === "notLoaded") {
    return "history_snapshot";
  }

  if (thread.status.type === "idle") {
    return "completed";
  }

  if (thread.status.activeFlags.includes("waitingOnApproval")) {
    return "waiting_on_approval";
  }

  if (thread.status.activeFlags.includes("waitingOnUserInput")) {
    return "waiting_on_user_input";
  }

  return "running";
}

export function getAppThreadTitle(thread: AppThread) {
  const explicitName = thread.name?.trim();
  if (explicitName) {
    return explicitName;
  }

  const preview = cleanThreadText(thread.preview);
  if (preview) {
    return truncate(preview, 78);
  }

  return "Untitled thread";
}

export function getAppThreadPreview(thread: AppThread) {
  const preview = cleanThreadText(thread.preview);
  const title = getAppThreadTitle(thread);

  if (preview && preview !== title) {
    return truncate(preview, 160);
  }

  const latestUserMessage = findLatestUserMessage(thread.turns);
  if (latestUserMessage && latestUserMessage !== title) {
    return truncate(latestUserMessage, 160);
  }

  return "Open the thread to inspect the Codex rollout timeline.";
}

export function getAppThreadWorkspace(thread: AppThread) {
  const normalized = stripDevicePathPrefix(getAppThreadProjectPath(thread));
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  if (!parts.length) {
    return "Unknown workspace";
  }

  return parts[parts.length - 1];
}

export function getAppThreadProjectPath(thread: AppThread) {
  return stripDevicePathPrefix(thread.cwd || thread.path || "");
}

export function getAppThreadSourceLabel(thread: AppThread) {
  return cleanThreadText(thread.source) || "unknown";
}

export function getAppThreadTurnCount(thread: AppThread) {
  return thread.turns.length;
}

export function getAppThreadGitLabel(thread: AppThread) {
  if (!thread.gitInfo?.branch && !thread.gitInfo?.sha) {
    return "no git";
  }

  return [thread.gitInfo.branch, thread.gitInfo.sha?.slice(0, 7)].filter(Boolean).join(" · ");
}

export function describeAppThreadItem(item: AppThreadItem) {
  switch (item.type) {
    case "plan":
      return item.text;
    case "reasoning":
      return [...item.summary, ...item.content].join("\n");
    case "commandExecution":
      return [item.command, item.aggregatedOutput].filter(Boolean).join("\n\n");
    case "fileChange":
      return `Status: ${item.status}. Changes: ${item.changes.length}.`;
    case "mcpToolCall":
      return `${item.server} -> ${item.tool} (${item.status})`;
    case "dynamicToolCall":
      return `${item.tool} (${item.status})`;
    case "collabAgentToolCall":
      return `${item.tool} -> ${item.receiverThreadIds.length} agent${item.receiverThreadIds.length === 1 ? "" : "s"} (${item.status})`;
    case "webSearch":
      return item.query;
    case "imageView":
      return item.path;
    case "imageGeneration":
      return item.revisedPrompt ?? item.result;
    case "enteredReviewMode":
    case "exitedReviewMode":
      return item.review;
    case "contextCompaction":
      return "Thread context was compacted.";
    default:
      return item.type;
  }
}

export function summarizeUserInput(input: AppUserInput) {
  switch (input.type) {
    case "text":
      return cleanThreadText(input.text);
    case "image":
      return input.url.startsWith("data:") ? "[Attached image]" : "[Image]";
    case "localImage":
      return `[Local image] ${input.path}`;
    case "skill":
      return `[Skill] ${input.name}`;
    case "mention":
      return `[Mention] ${input.name}`;
  }
}

function findLatestUserMessage(turns: AppTurn[]) {
  for (const turn of [...turns].reverse()) {
    for (const item of [...turn.items].reverse()) {
      if (item.type !== "userMessage") {
        continue;
      }

      const text = item.content.map(summarizeUserInput).filter(Boolean).join("\n").trim();
      if (text) {
        return text;
      }
    }
  }

  return "";
}

function cleanThreadText(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return value
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function stripDevicePathPrefix(value: string) {
  return value.replace(/^\\\\\?\\/, "");
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
