import type { AppServerPluginSummary, AppServerReviewTarget } from "../types/app-server";

export type ReviewDelivery = "inline" | "detached";
export type ReviewTargetMode = "uncommitted" | "baseBranch" | "custom";
export type ToolsMode = "terminal" | "search" | "review";
export type CommandCenterMode = "plugins" | "apps" | "skills" | "mcp" | "config" | "experiments";

export const DEFAULT_REVIEW_INSTRUCTIONS =
  "Review my recent commits for correctness risks and maintainability concerns.";

export function getReviewDefaults(threadId = "") {
  return {
    threadId,
    delivery: "inline" as ReviewDelivery,
    targetMode: "custom" as ReviewTargetMode,
    customInstructions: DEFAULT_REVIEW_INSTRUCTIONS,
  };
}

export function getToolsModeTabs(): ToolsMode[] {
  return ["terminal", "search", "review"];
}

export function getCommandCenterModeTabs(): CommandCenterMode[] {
  return ["plugins", "apps", "skills", "mcp", "config", "experiments"];
}

export function partitionPluginsByInstallState(plugins: AppServerPluginSummary[]) {
  const sorted = [...plugins].sort((left, right) => {
    if (left.installed !== right.installed) {
      return left.installed ? -1 : 1;
    }

    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });

  return {
    installed: sorted.filter((plugin) => plugin.installed),
    available: sorted.filter((plugin) => !plugin.installed),
  };
}

export function buildReviewTargetPayload(
  mode: ReviewTargetMode,
  options: { baseBranch?: string | null; customInstructions?: string | null } = {},
): AppServerReviewTarget {
  switch (mode) {
    case "uncommitted":
      return { type: "uncommittedChanges" };
    case "baseBranch":
      return {
        type: "baseBranch",
        branch: options.baseBranch?.trim() || "main",
      };
    case "custom":
    default:
      return {
        type: "custom",
        instructions: options.customInstructions?.trim() || DEFAULT_REVIEW_INSTRUCTIONS,
      };
  }
}
