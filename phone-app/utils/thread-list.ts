import type { AppThread } from "../types/app-server";
import {
  type AppThreadBucket,
  getAppThreadBucket,
  getAppThreadProjectPath,
} from "./app-server-thread";
import { normalizeWorkspacePath as normalizeWorkspaceTargetPath } from "./workspace-target";

const DEFAULT_WORKSPACE_KEY = "__default_workspace__";

const THREAD_BUCKET_LABELS: Record<AppThreadBucket, string> = {
  waiting: "Needs response",
  running: "Running",
  failed: "Needs attention",
  completed: "Ready",
  history: "History",
};

export type ThreadProjectSection = {
  key: string;
  title: string;
  latestUpdatedAt: number;
  items: AppThread[];
  statusSummary: string;
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

export function buildThreadProjectSections(threads: AppThread[]): ThreadProjectSection[] {
  const byProject = new Map<string, ThreadProjectSection>();

  for (const thread of sortThreadsByUpdated(threads)) {
    const normalizedPath = normalizeWorkspacePath(getAppThreadProjectPath(thread));
    const key = normalizedPath ?? DEFAULT_WORKSPACE_KEY;
    const existing = byProject.get(key) ?? {
      key,
      title: getWorkspaceLabel(normalizedPath),
      latestUpdatedAt: thread.updatedAt,
      items: [],
      statusSummary: "",
    };

    existing.items.push(thread);
    existing.latestUpdatedAt = Math.max(existing.latestUpdatedAt, thread.updatedAt);
    byProject.set(key, existing);
  }

  return [...byProject.values()]
    .map((section) => ({
      ...section,
      statusSummary: buildStatusSummary(section.items),
    }))
    .sort(
      (left, right) =>
        right.latestUpdatedAt - left.latestUpdatedAt || left.title.localeCompare(right.title),
    );
}

function buildStatusSummary(threads: AppThread[]) {
  const counts = new Map<AppThreadBucket, number>();

  for (const thread of threads) {
    const bucket = getAppThreadBucket(thread);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  return (Object.keys(THREAD_BUCKET_LABELS) as AppThreadBucket[])
    .map((bucket) => {
      const count = counts.get(bucket) ?? 0;
      return count ? `${THREAD_BUCKET_LABELS[bucket]} ${count}` : null;
    })
    .filter((part): part is string => Boolean(part))
    .join(" | ");
}
