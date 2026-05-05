import type { AppThread } from "../types/app-server";
import { type AppThreadBucket, getAppThreadBucket } from "./app-server-thread";
import { normalizeWorkspacePath as normalizeWorkspaceTargetPath } from "./workspace-target";

const THREAD_CONTINUATION_GROUPS: Array<{ key: AppThreadBucket; title: string }> = [
  { key: "waiting", title: "Needs Response" },
  { key: "running", title: "Running Now" },
  { key: "failed", title: "Needs Attention" },
  { key: "completed", title: "Ready To Continue" },
  { key: "history", title: "History Snapshots" },
];

export type ThreadContinuationSection = {
  key: AppThreadBucket;
  title: string;
  items: AppThread[];
};

export function normalizeWorkspacePath(value: string | null | undefined) {
  return normalizeWorkspaceTargetPath(value);
}

export function getWorkspaceLabel(value: string | null | undefined) {
  const normalized = normalizeWorkspacePath(value);
  if (!normalized) {
    return "Workspace";
  }

  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

export function sortThreadsByUpdated(threads: AppThread[]) {
  return [...threads].sort((left, right) => right.updatedAt - left.updatedAt);
}

export function buildThreadContinuationSections(threads: AppThread[]): ThreadContinuationSection[] {
  const sortedThreads = sortThreadsByUpdated(threads);

  return THREAD_CONTINUATION_GROUPS.map((group) => ({
    ...group,
    items: sortedThreads.filter((thread) => getAppThreadBucket(thread) === group.key),
  })).filter((group) => group.items.length > 0);
}
