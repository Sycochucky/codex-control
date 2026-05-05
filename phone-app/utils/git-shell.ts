export type GitFileState = {
  path: string;
  indexStatus: string;
  workTreeStatus: string;
  staged: boolean;
  modified: boolean;
  untracked: boolean;
};

export type GitStatusSummary = {
  branch: string | null;
  tracking: string | null;
  aheadBy: number;
  behindBy: number;
  detached: boolean;
  dirty: boolean;
  files: GitFileState[];
};

export type GitActionPreset = {
  id: string;
  label: string;
  description: string;
  command: string[];
  mutatesRepo: boolean;
};

export type GitCommitEntry = {
  sha: string;
  message: string;
};

export type GitBranchEntry = {
  name: string;
  current: boolean;
};

export function parseGitStatus(output: string): GitStatusSummary {
  const lines = output.split(/\r?\n/).filter(Boolean);
  const firstLine = lines[0] ?? "";
  const branchLine = firstLine.startsWith("## ") ? firstLine.slice(3) : "";
  const [branchLabel, trackingPart] = branchLine.split("...");
  const tracking = trackingPart?.split(" ")[0] ?? null;
  const aheadMatch = firstLine.match(/ahead (\d+)/);
  const behindMatch = firstLine.match(/behind (\d+)/);
  const files = lines.slice(1).map((line): GitFileState => {
    const indexStatus = line.slice(0, 1);
    const workTreeStatus = line.slice(1, 2);

    return {
      path: line.slice(3).trim(),
      indexStatus,
      workTreeStatus,
      staged: indexStatus !== " " && indexStatus !== "?",
      modified: workTreeStatus !== " " && workTreeStatus !== "?",
      untracked: indexStatus === "?" || workTreeStatus === "?",
    };
  });

  return {
    branch: branchLabel || null,
    tracking,
    aheadBy: aheadMatch ? Number(aheadMatch[1]) : 0,
    behindBy: behindMatch ? Number(behindMatch[1]) : 0,
    detached: firstLine.includes("HEAD (no branch)") || firstLine.includes("detached"),
    dirty: files.length > 0,
    files,
  };
}

export function parseGitLog(output: string): GitCommitEntry[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): GitCommitEntry => {
      const [sha, ...message] = line.split(" ");
      return {
        sha,
        message: message.join(" "),
      };
    });
}

export function parseGitBranches(output: string): GitBranchEntry[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): GitBranchEntry => ({
      name: line.replace(/^\*\s*/, "").trim(),
      current: line.startsWith("*"),
    }));
}

export function createGitActionPresets(
  branchName?: string | null,
  commitMessage?: string | null,
): GitActionPreset[] {
  return [
    {
      id: "refresh",
      label: "Refresh Status",
      description: "Reload branch, file state, diffs, and recent commits.",
      command: ["git", "status", "--short", "--branch"],
      mutatesRepo: false,
    },
    {
      id: "fetch",
      label: "Fetch",
      description: "Fetch remote refs for the current repository.",
      command: ["git", "fetch", "--all", "--prune"],
      mutatesRepo: true,
    },
    {
      id: "pull",
      label: "Pull",
      description: "Pull the current branch from its upstream remote.",
      command: ["git", "pull", "--ff-only"],
      mutatesRepo: true,
    },
    {
      id: "stage-all",
      label: "Stage All",
      description: "Stage all current file changes.",
      command: ["git", "add", "--all"],
      mutatesRepo: true,
    },
    {
      id: "unstage-all",
      label: "Unstage All",
      description: "Reset the staged set without touching working tree changes.",
      command: ["git", "reset", "HEAD", "--", "."],
      mutatesRepo: true,
    },
    {
      id: "switch-branch",
      label: "Switch Branch",
      description: "Checkout the selected local branch.",
      command: branchName
        ? ["git", "checkout", branchName]
        : ["git", "branch", "--format", "%(refname:short)"],
      mutatesRepo: Boolean(branchName),
    },
    {
      id: "commit",
      label: "Commit",
      description: "Create a local commit with the provided message.",
      command: commitMessage ? ["git", "commit", "-m", commitMessage] : ["git", "status"],
      mutatesRepo: Boolean(commitMessage),
    },
  ];
}
