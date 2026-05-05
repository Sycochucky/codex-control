import type { AppThread } from "../types/app-server";
import { getAppThreadBucket, getAppThreadProjectPath, getAppThreadWorkspace } from "./app-server-thread";

export type WorkspaceSelection = {
  path: string | null;
  label: string | null;
  sourceThreadId: string | null;
};

export type ResolvedWorkspaceTarget = WorkspaceSelection & {
  source: "route" | "selected" | "default";
};

export type WorkspaceOption = {
  path: string;
  label: string;
  sourceThreadId: string | null;
  threadCount: number;
  runningCount: number;
  waitingCount: number;
  latestUpdatedAt: number;
};

export type WorkspacePickerSelection = {
  nextPickerPath: string | null;
  nextRouteWorkspacePath: string | null;
};

export function normalizeWorkspacePath(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value
    .replace(/^\\\\\?\\/, "")
    .replace(/[\\/]+/g, "\\")
    .replace(/\\$/, "")
    .trim();

  return normalized || null;
}

export function resolveWorkspaceTarget(params: {
  routePath?: string | null;
  routeLabel?: string | null;
  routeThreadId?: string | null;
  selectedPath?: string | null;
  selectedLabel?: string | null;
  selectedSourceThreadId?: string | null;
  fallbackPath?: string | null;
  fallbackLabel?: string | null;
}): ResolvedWorkspaceTarget {
  const routePath = normalizeWorkspacePath(params.routePath);
  if (routePath) {
    return {
      path: routePath,
      label: params.routeLabel?.trim() || getWorkspaceLabel(routePath),
      sourceThreadId: params.routeThreadId?.trim() || null,
      source: "route",
    };
  }

  const selectedPath = normalizeWorkspacePath(params.selectedPath);
  if (selectedPath) {
    return {
      path: selectedPath,
      label: params.selectedLabel?.trim() || getWorkspaceLabel(selectedPath),
      sourceThreadId: params.selectedSourceThreadId?.trim() || null,
      source: "selected",
    };
  }

  const fallbackPath = normalizeWorkspacePath(params.fallbackPath);
  return {
    path: fallbackPath,
    label: params.fallbackLabel?.trim() || getWorkspaceLabel(fallbackPath),
    sourceThreadId: null,
    source: "default",
  };
}

export function deriveWorkspaceOptions(threads: AppThread[]) {
  const byPath = new Map<string, WorkspaceOption>();

  for (const thread of threads) {
    const path = normalizeWorkspacePath(getAppThreadProjectPath(thread));
    if (!path) {
      continue;
    }

    const existing = byPath.get(path) ?? {
      path,
      label: getAppThreadWorkspace(thread),
      sourceThreadId: thread.id,
      threadCount: 0,
      runningCount: 0,
      waitingCount: 0,
      latestUpdatedAt: thread.updatedAt,
    };

    existing.threadCount += 1;
    existing.latestUpdatedAt = Math.max(existing.latestUpdatedAt, thread.updatedAt);

    const bucket = getAppThreadBucket(thread);
    if (bucket === "running") {
      existing.runningCount += 1;
    } else if (bucket === "waiting") {
      existing.waitingCount += 1;
    }

    byPath.set(path, existing);
  }

  return [...byPath.values()].sort(
    (left, right) => right.latestUpdatedAt - left.latestUpdatedAt || left.label.localeCompare(right.label),
  );
}

export function resolveWorkspacePickerSelection(params: {
  manualWorkspace?: string | null;
  currentPickerPath?: string | null;
  workspaceTargetPath?: string | null;
  workspaceTargetSource: ResolvedWorkspaceTarget["source"];
  workspaceOptions: WorkspaceOption[];
  lastRouteWorkspacePath?: string | null;
}): WorkspacePickerSelection {
  const manualWorkspace = normalizeWorkspacePath(params.manualWorkspace);
  const currentPickerPath = normalizeWorkspacePath(params.currentPickerPath);
  const workspaceTargetPath = normalizeWorkspacePath(params.workspaceTargetPath);
  const lastRouteWorkspacePath = normalizeWorkspacePath(params.lastRouteWorkspacePath);
  const nextRouteWorkspacePath =
    params.workspaceTargetSource === "route" ? workspaceTargetPath : null;

  if (manualWorkspace) {
    return {
      nextPickerPath: currentPickerPath,
      nextRouteWorkspacePath,
    };
  }

  const availableWorkspacePaths = new Set(
    params.workspaceOptions
      .map((option) => normalizeWorkspacePath(option.path))
      .filter((path): path is string => Boolean(path)),
  );
  const pickerStillAvailable = currentPickerPath
    ? availableWorkspacePaths.has(currentPickerPath) || currentPickerPath === workspaceTargetPath
    : false;
  const routeWorkspaceChanged =
    params.workspaceTargetSource === "route" &&
    Boolean(workspaceTargetPath) &&
    workspaceTargetPath !== lastRouteWorkspacePath;

  if (routeWorkspaceChanged) {
    return {
      nextPickerPath: workspaceTargetPath,
      nextRouteWorkspacePath,
    };
  }

  if (!currentPickerPath || !pickerStillAvailable) {
    return {
      nextPickerPath: workspaceTargetPath ?? params.workspaceOptions[0]?.path ?? null,
      nextRouteWorkspacePath,
    };
  }

  return {
    nextPickerPath: currentPickerPath,
    nextRouteWorkspacePath,
  };
}

export function getWorkspaceLabel(path: string | null | undefined) {
  const normalized = normalizeWorkspacePath(path);
  if (!normalized) {
    return "Default workspace";
  }

  const parts = normalized.split("\\").filter(Boolean);
  return parts[parts.length - 1] || normalized;
}
