import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenShell } from "@/components/screen-shell";
import { InlineNotice, LabeledInput, PillButton, PrimaryButton, SecondaryButton } from "@/components/ui";
import type { ThemeColors } from "@/constants/theme";
import { getSetupStatus } from "@/services/api";
import { useSession } from "@/services/session-context";
import { useThemedStyles } from "@/services/theme-context";
import type { AppThread } from "@/types/app-server";
import { getCombinedCommandOutput, runBufferedCommand } from "@/utils/app-server-command";
import { withWarmAppServerClient } from "@/utils/app-server-connect";
import {
  buildGitignoreMergeScript,
  GITIGNORE_TEMPLATES,
  type GitignoreTemplateId,
  isAllowedProjectPath,
  isSafeBranchName,
  isSafeRemoteName,
  isSafeRepositoryName,
  normalizeRepositoryName,
  type RepositoryVisibility,
} from "@/utils/git-repository-setup";
import { createGitActionPresets, parseGitBranches, parseGitLog, parseGitStatus } from "@/utils/git-shell";
import { getFriendlyNetworkErrorMessage } from "@/utils/network";
import {
  deriveWorkspaceOptions,
  getWorkspaceLabel,
  normalizeWorkspacePath,
  resolveWorkspacePickerSelection,
  resolveWorkspaceTarget,
  type ResolvedWorkspaceTarget,
} from "@/utils/workspace-target";

type BranchEntry = { name: string; current: boolean };
type CommitEntry = { sha: string; message: string };
type GitActionScope = "repository" | "workspace";

export function GitScreen() {
  const params = useLocalSearchParams<{ cwd?: string; label?: string; threadId?: string }>();
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const {
    backendUrl,
    isHydrated,
    selectedSourceThreadId,
    selectedWorkspaceLabel,
    selectedWorkspacePath,
    setSelectedWorkspace,
    sessionToken,
  } = useSession();
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  const [workspaceIsRepoRoot, setWorkspaceIsRepoRoot] = useState(true);
  const [originUrl, setOriginUrl] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("");
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [diffStat, setDiffStat] = useState("");
  const [stagedDiffStat, setStagedDiffStat] = useState("");
  const [branches, setBranches] = useState<BranchEntry[]>([]);
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [branchInput, setBranchInput] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [actionOutput, setActionOutput] = useState("");
  const [repoSetupName, setRepoSetupName] = useState("");
  const [repoVisibility, setRepoVisibility] = useState<RepositoryVisibility>("private");
  const [repoRemoteName, setRepoRemoteName] = useState("origin");
  const [repoDefaultBranch, setRepoDefaultBranch] = useState("main");
  const [gitignoreTemplateId, setGitignoreTemplateId] = useState<GitignoreTemplateId>("expo");
  const [setupOutput, setSetupOutput] = useState("");
  const [threadList, setThreadList] = useState<AppThread[]>([]);
  const [manualWorkspace, setManualWorkspace] = useState("");
  const [pickerWorkspacePath, setPickerWorkspacePath] = useState<string | null>(null);
  const [workspaceLoadError, setWorkspaceLoadError] = useState<string | null>(null);
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunningAction, setIsRunningAction] = useState(false);
  const [isRunningSetup, setIsRunningSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gitLoadRequestIdRef = useRef(0);
  const lastRouteWorkspacePathRef = useRef<string | null>(null);
  const routeWorkspace = typeof params.cwd === "string" ? params.cwd : null;
  const routeWorkspaceLabel = typeof params.label === "string" ? params.label : null;
  const threadId = typeof params.threadId === "string" ? params.threadId : null;
  const hasRouteWorkspace = Boolean(routeWorkspace);
  const selectedWorkspace = useMemo<ResolvedWorkspaceTarget>(() => {
    return resolveWorkspaceTarget({
      routePath: routeWorkspace,
      routeLabel: routeWorkspaceLabel,
      routeThreadId: threadId,
      selectedPath: selectedWorkspacePath,
      selectedLabel: selectedWorkspaceLabel,
      selectedSourceThreadId,
    });
  }, [routeWorkspace, routeWorkspaceLabel, selectedSourceThreadId, selectedWorkspaceLabel, selectedWorkspacePath, threadId]);
  const selectedWorkspaceSource = selectedWorkspace.source;
  const usingSessionWorkspace = selectedWorkspaceSource === "selected";
  const routeLocksWorkspace = selectedWorkspaceSource === "route";
  const activeWorkspaceLabel = selectedWorkspace.label;
  const activeWorkspacePath = selectedWorkspace.path;
  const workspaceOptions = useMemo(() => deriveWorkspaceOptions(threadList), [threadList]);
  const normalizedManualWorkspace = useMemo(() => normalizeWorkspacePath(manualWorkspace), [manualWorkspace]);
  const normalizedPickerWorkspace = useMemo(
    () => normalizeWorkspacePath(pickerWorkspacePath),
    [pickerWorkspacePath],
  );
  const sourceDescriptor = selectedWorkspaceSource === "route"
    ? selectedWorkspace.sourceThreadId
      ? `Thread context (${selectedWorkspace.sourceThreadId})`
      : "Thread/project context"
    : selectedWorkspaceSource === "selected"
      ? selectedSourceThreadId
        ? `Sticky selection from thread ${selectedSourceThreadId}`
        : "Sticky workspace selection"
      : "Backend default";

  const parsedStatus = useMemo(() => parseGitStatus(statusText), [statusText]);
  const hasOrigin = Boolean(originUrl);
  const setupWorkspaceRoot = workspaceRoot ?? activeWorkspacePath;
  const setupTargetRoot = setupWorkspaceRoot;
  const setupTargetAllowed = isAllowedProjectPath(setupTargetRoot);
  const setupWorkspaceHasOwnRepo = Boolean(workspaceRoot && repoRoot && areSamePath(workspaceRoot, repoRoot));
  const setupWorkspaceInsideParentRepo = Boolean(workspaceRoot && repoRoot && !areSamePath(workspaceRoot, repoRoot));
  const canUseRepoName = isSafeRepositoryName(repoSetupName.trim());
  const canUseRemoteName = isSafeRemoteName(repoRemoteName.trim());
  const canUseDefaultBranch = isSafeBranchName(repoDefaultBranch.trim());
  const canRunSetupCommand =
    Boolean(sessionToken) &&
    Boolean(setupTargetRoot) &&
    setupTargetAllowed &&
    !isRunningSetup;
  const canCreateRepo =
    canRunSetupCommand &&
    canUseRepoName &&
    canUseRemoteName &&
    canUseDefaultBranch &&
    !setupWorkspaceInsideParentRepo;
  const workspaceActionsAllowed = workspaceRoot && repoRoot && (workspaceIsRepoRoot || hasRouteWorkspace || usingSessionWorkspace);
  const repoWideActionsAllowed = Boolean(repoRoot);
  const presets = useMemo(
    () => createGitActionPresets(branchInput.trim() || null, commitMessage.trim() || null),
    [branchInput, commitMessage],
  );
  const workspaceScopedActions = useMemo(() => presets.filter((preset) => preset.id === "refresh"), [presets]);
  const repoWideActions = useMemo(() => presets.filter((preset) => preset.id !== "refresh"), [presets]);
  const visibleFiles = useMemo(
    () => parsedStatus.files.filter((file) => isVisibleWorkspaceFile(file.path)),
    [parsedStatus.files],
  );
  const hiddenFileCount = parsedStatus.files.length - visibleFiles.length;
  const isRepoRootConfigured =
    workspaceRoot && repoRoot && areSamePath(workspaceRoot, repoRoot);
  const showRepoRootWarning = Boolean(workspaceRoot) && Boolean(repoRoot) && !isRepoRootConfigured && selectedWorkspaceSource !== "default";

  useEffect(() => {
    if (routeLocksWorkspace) {
      return;
    }

    const nextSelection = resolveWorkspacePickerSelection({
      manualWorkspace,
      currentPickerPath: pickerWorkspacePath,
      workspaceTargetPath: selectedWorkspace.path,
      workspaceTargetSource: selectedWorkspace.source,
      workspaceOptions,
      lastRouteWorkspacePath: lastRouteWorkspacePathRef.current,
    });

    lastRouteWorkspacePathRef.current = nextSelection.nextRouteWorkspacePath;

    if (nextSelection.nextPickerPath !== normalizedPickerWorkspace) {
      setPickerWorkspacePath(nextSelection.nextPickerPath);
    }

    const nextWorkspacePath = normalizedManualWorkspace ?? nextSelection.nextPickerPath;
    if (nextWorkspacePath && nextWorkspacePath !== normalizeWorkspacePath(selectedWorkspacePath)) {
      const matchedOption = workspaceOptions.find((option) => option.path === nextWorkspacePath);
      setSelectedWorkspace({
        path: nextWorkspacePath,
        label: matchedOption?.label ?? getWorkspaceLabel(nextWorkspacePath),
        sourceThreadId: matchedOption?.sourceThreadId ?? null,
      });
    }
  }, [
    manualWorkspace,
    normalizedManualWorkspace,
    normalizedPickerWorkspace,
    pickerWorkspacePath,
    routeLocksWorkspace,
    selectedWorkspace.path,
    selectedWorkspace.source,
    selectedWorkspacePath,
    setSelectedWorkspace,
    workspaceOptions,
  ]);

  useEffect(() => {
    if (repoSetupName.trim()) {
      return;
    }

    const nextName = normalizeRepositoryName(activeWorkspacePath ?? activeWorkspaceLabel);
    if (nextName) {
      setRepoSetupName(nextName);
    }
  }, [activeWorkspaceLabel, activeWorkspacePath, repoSetupName]);

  const loadWorkspaceOptions = useCallback(async () => {
    if (!sessionToken) {
      setThreadList([]);
      return;
    }

    try {
      setIsLoadingWorkspaces(true);
      setWorkspaceLoadError(null);
      const threads = await withWarmAppServerClient(backendUrl, sessionToken, async (client) => {
        const [activeThreads, archivedThreads] = await Promise.all([
          client.listAllThreads({ archived: false }),
          client.listAllThreads({ archived: true }),
        ]);
        const mergedThreads = new Map<string, AppThread>();
        for (const thread of [...activeThreads, ...archivedThreads]) {
          mergedThreads.set(thread.id, thread);
        }
        return [...mergedThreads.values()];
      });
      setThreadList(threads);
    } catch (loadError) {
      setWorkspaceLoadError(
        getFriendlyNetworkErrorMessage(loadError, "Failed to load known Git workspaces."),
      );
    } finally {
      setIsLoadingWorkspaces(false);
    }
  }, [backendUrl, sessionToken]);

  const loadCommandState = useCallback(async (cwd: string, requestId: number) => {
    if (!sessionToken) {
      return false;
    }

    const [
      statusResult,
      originResult,
      branchesResult,
      commitsResult,
      diffResult,
      stagedDiffResult,
    ] = await withWarmAppServerClient(backendUrl, sessionToken, async (client) => {
      const statusResult = await client.execCommand({
        command: ["git", "status", "--short", "--branch"],
        cwd,
      });
      const originResult = await client.execCommand({
        command: ["git", "remote", "get-url", "origin"],
        cwd,
      });
      const branchesResult = await client.execCommand({
        command: ["git", "branch", "--format", "%(if)%(HEAD)%(then)* %(else)  %(end)%(refname:short)"],
        cwd,
      });
      const commitsResult = await client.execCommand({
        command: ["git", "log", "--oneline", "-n", "8"],
        cwd,
      });
      const diffResult = await client.execCommand({
        command: ["git", "diff", "--stat"],
        cwd,
      });
      const stagedDiffResult = await client.execCommand({
        command: ["git", "diff", "--cached", "--stat"],
        cwd,
      });

      return [
        statusResult,
        originResult,
        branchesResult,
        commitsResult,
        diffResult,
        stagedDiffResult,
      ] as const;
    });

    if (requestId !== gitLoadRequestIdRef.current) {
      return false;
    }

    if (statusResult.exitCode !== 0) {
      throw new Error(getCombinedCommandOutput(statusResult) || "git status failed.");
    }

    setStatusText(statusResult.stdout);
    setOriginUrl(originResult.exitCode === 0 ? originResult.stdout.trim() || null : null);
    setBranches(branchesResult.exitCode === 0 ? parseGitBranches(branchesResult.stdout) : []);
    setCommits(commitsResult.exitCode === 0 ? parseGitLog(commitsResult.stdout) : []);
    setDiffStat(diffResult.exitCode === 0 ? diffResult.stdout.trim() : "");
    setStagedDiffStat(stagedDiffResult.exitCode === 0 ? stagedDiffResult.stdout.trim() : "");

    const firstFailure = [originResult, branchesResult, commitsResult, diffResult, stagedDiffResult].find(
      (result) => result.exitCode !== 0,
    );
    if (firstFailure) {
      setError(getCombinedCommandOutput(firstFailure) || "Some git details could not be loaded.");
    }
    return true;
  }, [backendUrl, sessionToken]);

  const loadGit = useCallback(async () => {
    const requestId = gitLoadRequestIdRef.current + 1;
    gitLoadRequestIdRef.current = requestId;

    if (!sessionToken) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      setWorkspaceNotice(null);
      setWorkspaceRoot(null);
      setRepoRoot(null);
      setWorkspaceIsRepoRoot(true);
      setStatusText("");
      setBranches([]);
      setCommits([]);
      setDiffStat("");
      setStagedDiffStat("");

      if (activeWorkspacePath) {
        setWorkspaceRoot(activeWorkspacePath);
        setWorkspaceIsRepoRoot(true);

        const repoRootResult = await runBufferedCommand(
          backendUrl,
          sessionToken,
          ["git", "rev-parse", "--show-toplevel"],
          activeWorkspacePath,
        );

        if (repoRootResult.exitCode !== 0) {
          if (selectedWorkspaceSource !== "default") {
            setWorkspaceNotice(
              selectedWorkspaceSource === "selected"
                ? "The saved workspace is no longer available. Falling back to backend default workspace."
                : "The requested thread/project workspace is unavailable. Falling back to backend default workspace.",
            );
          }
          const setup = await getSetupStatus(backendUrl, sessionToken);
          if (requestId !== gitLoadRequestIdRef.current) {
            return;
          }
          const configuredWorkspace = setup.repo.workspace_root;
          const resolvedRepoRoot = setup.repo.repo_root;
          const isRepoRootMatch = setup.repo.workspace_is_repo_root;

          setWorkspaceRoot(configuredWorkspace);
          setRepoRoot(resolvedRepoRoot);
          setWorkspaceIsRepoRoot(isRepoRootMatch);
          setOriginUrl(setup.repo.origin_url ?? null);

          if (!setup.repo.is_git_repository || !resolvedRepoRoot) {
            setDiffStat("");
            setError(
              getCombinedCommandOutput(repoRootResult) || "The selected folder is not inside a Git repository.",
            );
            return;
          }

          await loadCommandState(resolvedRepoRoot, requestId);
          return;
        }

        if (requestId !== gitLoadRequestIdRef.current) {
          return;
        }

        const resolvedRepoRoot = repoRootResult.stdout.trim() || null;
        if (!resolvedRepoRoot) {
          setError(getCombinedCommandOutput(repoRootResult) || "Failed to resolve the git repository root.");
          return;
        }

        setRepoRoot(resolvedRepoRoot);
        setWorkspaceIsRepoRoot(areSamePath(activeWorkspacePath, resolvedRepoRoot));
        await loadCommandState(activeWorkspacePath, requestId);
        return;
      }

      const setup = await getSetupStatus(backendUrl, sessionToken);
      if (requestId !== gitLoadRequestIdRef.current) {
        return;
      }
      const configuredWorkspace = setup.repo.workspace_root;
      const resolvedRepoRoot = setup.repo.repo_root;
      const isRepoRootMatch = setup.repo.workspace_is_repo_root;

      setWorkspaceRoot(configuredWorkspace);
      setRepoRoot(resolvedRepoRoot);
      setWorkspaceIsRepoRoot(isRepoRootMatch);
      setOriginUrl(setup.repo.origin_url ?? null);

      if (!setup.repo.is_git_repository || !resolvedRepoRoot) {
        setStatusText("");
        setBranches([]);
        setCommits([]);
        setDiffStat("");
        setStagedDiffStat("");
        setError("The configured workspace is not inside a Git repository.");
        return;
      }

      if (!isRepoRootMatch) {
        setStatusText("");
        setBranches([]);
        setCommits([]);
        setDiffStat("");
        setStagedDiffStat("");
        setError(
          `Git resolves to ${resolvedRepoRoot}, not ${configuredWorkspace}. Git actions are disabled until the configured workspace matches the repo root.`,
        );
        return;
      }

      await loadCommandState(resolvedRepoRoot, requestId);
    } catch (loadError) {
      if (requestId === gitLoadRequestIdRef.current) {
        setError(getFriendlyNetworkErrorMessage(loadError, "Failed to load git workspace details."));
      }
    } finally {
      if (requestId === gitLoadRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [activeWorkspacePath, backendUrl, loadCommandState, selectedWorkspaceSource, sessionToken]);

  useFocusEffect(
    useCallback(() => {
      if (!sessionToken) {
        return;
      }

      void loadWorkspaceOptions();
      void loadGit();
    }, [loadGit, loadWorkspaceOptions, sessionToken]),
  );

  async function runAction(command: string[], scope: GitActionScope = "workspace") {
    const commandWorkspace = scope === "repository" ? repoRoot : workspaceRoot;
    if (
      !sessionToken ||
      !commandWorkspace ||
      !repoRoot ||
      (scope === "workspace" && !workspaceActionsAllowed)
    ) {
      return;
    }

    try {
      setIsRunningAction(true);
      setError(null);
      const result = await runBufferedCommand(backendUrl, sessionToken, command, commandWorkspace, 60000);
      setActionOutput(getCombinedCommandOutput(result));
      if (result.exitCode !== 0) {
        throw new Error(getCombinedCommandOutput(result) || "Git action failed.");
      }
      await loadGit();
    } catch (runError) {
      setError(getFriendlyNetworkErrorMessage(runError, "Git action failed."));
    } finally {
      setIsRunningAction(false);
    }
  }

  async function runSetupCommand(command: string[], cwd: string, timeoutMs = 60000) {
    if (!sessionToken) {
      throw new Error("Session is not connected.");
    }

    const result = await runBufferedCommand(backendUrl, sessionToken, command, cwd, timeoutMs);
    const output = getCombinedCommandOutput(result);
    if (result.exitCode !== 0) {
      throw new Error(output || "Git setup command failed.");
    }
    return output || command.join(" ");
  }

  async function runSetupSequence(action: () => Promise<string[]>) {
    try {
      setIsRunningSetup(true);
      setError(null);
      setSetupOutput("Running repository setup command...");
      const outputs = await action();
      setSetupOutput(outputs.filter(Boolean).join("\n\n"));
      await loadGit();
    } catch (setupError) {
      setError(getFriendlyNetworkErrorMessage(setupError, "Repository setup failed."));
    } finally {
      setIsRunningSetup(false);
    }
  }

  function requireSetupRoot() {
    if (!setupTargetRoot || !setupTargetAllowed) {
      throw new Error("Repository setup is only enabled for folders inside D:\\DevProjects.");
    }

    return setupTargetRoot;
  }

  function requireWorkspaceRoot() {
    if (!setupWorkspaceRoot || !isAllowedProjectPath(setupWorkspaceRoot)) {
      throw new Error("Repository setup is only enabled for folders inside D:\\DevProjects.");
    }

    return setupWorkspaceRoot;
  }

  async function writeGitignoreTemplate() {
    await runSetupSequence(async () => {
      const targetRoot = requireSetupRoot();
      const script = buildGitignoreMergeScript(gitignoreTemplateId);
      const output = await runSetupCommand(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        targetRoot,
      );
      return [output];
    });
  }

  async function initializeRepository() {
    await runSetupSequence(async () => {
      if (repoRoot) {
        return [`Repository is already initialized at ${repoRoot}.`];
      }

      const targetRoot = requireWorkspaceRoot();
      const output = await runSetupCommand(
        ["git", "init", "-b", repoDefaultBranch.trim()],
        targetRoot,
      );
      return [output];
    });
  }

  async function createGithubRepository() {
    await runSetupSequence(async () => {
      const outputs: string[] = [];
      let sourceRoot = setupWorkspaceRoot;

      if (setupWorkspaceInsideParentRepo) {
        throw new Error("The selected workspace is inside a parent Git repository. GitHub repo creation is disabled to avoid linking the parent root.");
      }

      if (!repoRoot) {
        const workspace = requireWorkspaceRoot();
        outputs.push(await runSetupCommand(["git", "init", "-b", repoDefaultBranch.trim()], workspace));
        sourceRoot = workspace;
      }

      if (!sourceRoot || !isAllowedProjectPath(sourceRoot)) {
        throw new Error("Repository setup is only enabled for folders inside D:\\DevProjects.");
      }

      const visibilityArg = repoVisibility === "private" ? "--private" : "--public";
      outputs.push(
        await runSetupCommand(
          [
            "gh",
            "repo",
            "create",
            repoSetupName.trim(),
            visibilityArg,
            "--source",
            sourceRoot,
            "--remote",
            repoRemoteName.trim(),
          ],
          sourceRoot,
          120000,
        ),
      );
      return outputs;
    });
  }

  async function pushCurrentBranch() {
    await runSetupSequence(async () => {
      if (!setupWorkspaceHasOwnRepo) {
        throw new Error("Push is enabled only when the selected workspace is the Git repository root.");
      }

      const targetRoot = requireSetupRoot();
      const branchName = parsedStatus.branch ?? repoDefaultBranch.trim();
      if (!isSafeBranchName(branchName)) {
        throw new Error("Current branch name is not safe to push from the phone Git screen.");
      }

      const output = await runSetupCommand(
        ["git", "push", "-u", repoRemoteName.trim(), branchName],
        targetRoot,
        120000,
      );
      return [output];
    });
  }

  if (!isHydrated) {
    return (
      <ScreenShell title="Git" subtitle="Loading workspace controls.">
        <InlineNotice>Restoring secure session state.</InlineNotice>
      </ScreenShell>
    );
  }

  if (!sessionToken) {
    return <Redirect href="/connect" />;
  }

  return (
    <ScreenShell
      title="Git"
      subtitle={
        activeWorkspaceLabel
          ? `Git loaded for ${activeWorkspaceLabel}${threadId ? ` from thread ${threadId}` : ""}.`
          : "Workspace-aware git controls powered by Codex App Server command execution."
      }
    >
      <Text style={styles.meta}>Source: {sourceDescriptor}</Text>
      <Text style={styles.meta}>
        Selected workspace: {workspaceRoot ?? "Loading..."}
      </Text>
      <Text style={styles.meta}>Git repo root: {repoRoot ?? "Not detected"}</Text>
      <Text style={styles.meta}>Origin: {originUrl ?? "Not detected"}</Text>
      {workspaceNotice ? <InlineNotice tone="error">{workspaceNotice}</InlineNotice> : null}
      {showRepoRootWarning ? (
        <InlineNotice tone="error">
          Git workspace actions are running from a nested folder. File-level actions apply only to files in
          this workspace view.
        </InlineNotice>
      ) : null}
      {workspaceRoot && !repoWideActionsAllowed ? (
        <InlineNotice tone="error">Repository state is unavailable; commands are disabled.</InlineNotice>
      ) : null}
      {!showRepoRootWarning && usingSessionWorkspace ? (
        <InlineNotice tone="success">
          Workspace actions (file-level status/stage/unstage) are scoped to the selected folder.
          Branch and remote actions still target the full repository.
        </InlineNotice>
      ) : null}
      {!hasOrigin ? (
        <InlineNotice tone="error">
          No origin is configured for this workspace. Open Settings to inspect desktop GitHub readiness
          and add a remote before using fetch or pull.
        </InlineNotice>
      ) : null}
      {!hasOrigin ? (
        <SecondaryButton label="Open Settings" onPress={() => router.push("/settings")} />
      ) : null}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {isLoading ? <InlineNotice>Loading branch, changes, and commit history.</InlineNotice> : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Repository Setup</Text>
        <Text style={styles.sectionMeta}>
          Create a local repo, prepare a .gitignore, and link a GitHub repo from the selected project.
        </Text>
        <Text style={styles.meta}>Setup target: {setupTargetRoot ?? "Not detected"}</Text>
        {!setupTargetAllowed ? (
          <InlineNotice tone="error">Setup actions are only enabled for projects inside D:\DevProjects.</InlineNotice>
        ) : null}
        {setupWorkspaceInsideParentRepo ? (
          <InlineNotice>
            This folder is inside parent Git root {repoRoot}. GitHub repo creation and push are disabled here
            so the phone does not link the parent repository by mistake.
          </InlineNotice>
        ) : null}
        <LabeledInput
          label="Repository Name"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={(value) => setRepoSetupName(normalizeRepositoryName(value))}
          placeholder="my-project"
          value={repoSetupName}
        />
        {!canUseRepoName ? <Text style={styles.warningText}>Use letters, numbers, dots, dashes, or underscores.</Text> : null}
        <LabeledInput
          label="Remote Name"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setRepoRemoteName}
          placeholder="origin"
          value={repoRemoteName}
        />
        <LabeledInput
          label="Default Branch"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setRepoDefaultBranch}
          placeholder="main"
          value={repoDefaultBranch}
        />
        <View style={styles.pillRow}>
          {(["private", "public"] as RepositoryVisibility[]).map((visibility) => (
            <PillButton
              key={visibility}
              label={visibility === "private" ? "Private" : "Public"}
              selected={repoVisibility === visibility}
              onPress={() => setRepoVisibility(visibility)}
            />
          ))}
        </View>
        <Text style={styles.sectionMeta}>.gitignore template</Text>
        <View style={styles.pillRow}>
          {GITIGNORE_TEMPLATES.map((template) => (
            <PillButton
              key={template.id}
              label={template.label}
              selected={gitignoreTemplateId === template.id}
              onPress={() => setGitignoreTemplateId(template.id)}
            />
          ))}
        </View>
        <SecondaryButton
          label="Write .gitignore"
          disabled={!canRunSetupCommand || gitignoreTemplateId === "none"}
          helperText="Adds missing entries from the selected template without overwriting existing rules."
          onPress={() => {
            void writeGitignoreTemplate();
          }}
        />
        <SecondaryButton
          label="Initialize Local Repo"
          disabled={!canRunSetupCommand || !canUseDefaultBranch || Boolean(repoRoot)}
          helperText={repoRoot ? "This workspace is already inside a Git repository." : "Runs git init with the selected default branch."}
          onPress={() => {
            void initializeRepository();
          }}
        />
        <PrimaryButton
          label="Create GitHub Repo"
          disabled={!canCreateRepo || hasOrigin}
          helperText={
            setupWorkspaceInsideParentRepo
              ? "Disabled while this folder resolves to a parent Git root."
              : hasOrigin
                ? "An origin remote is already configured."
                : "Creates the GitHub repo through gh and adds the selected remote."
          }
          onPress={() => {
            void createGithubRepository();
          }}
        />
        <SecondaryButton
          label="Push Current Branch"
          disabled={!canCreateRepo || !setupWorkspaceHasOwnRepo || !hasOrigin}
          helperText={
            setupWorkspaceHasOwnRepo
              ? "Pushes the current branch to the selected remote with upstream tracking."
              : "Enabled only when the selected workspace is the Git repository root."
          }
          onPress={() => {
            void pushCurrentBranch();
          }}
        />
        {setupOutput ? <Text style={styles.outputText}>{setupOutput}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Project</Text>
        <Text style={styles.sectionMeta}>
          {routeLocksWorkspace
            ? "This Git view is locked to the thread workspace that opened it."
            : "Choose a known workspace from Codex threads, or type a folder path."}
        </Text>
        {workspaceLoadError ? <InlineNotice tone="error">{workspaceLoadError}</InlineNotice> : null}
        {!routeLocksWorkspace ? (
          <>
            <LabeledInput
              label="Manual Workspace"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setManualWorkspace}
              placeholder="D:\\DevProjects\\project"
              value={manualWorkspace}
            />
            {isLoadingWorkspaces ? <InlineNotice>Loading known projects from Codex threads.</InlineNotice> : null}
            {!isLoadingWorkspaces && !workspaceOptions.length ? (
              <InlineNotice>No thread workspaces are available yet.</InlineNotice>
            ) : null}
            {workspaceOptions.slice(0, 8).map((project) => (
              <View key={project.path} style={styles.projectRow}>
                <View style={styles.projectCopy}>
                  <Text style={styles.filePath}>{project.label}</Text>
                  <Text style={styles.projectPath} numberOfLines={1}>{project.path}</Text>
                  <Text style={styles.fileMeta}>
                    {project.threadCount} thread{project.threadCount === 1 ? "" : "s"} | {project.runningCount} running | {project.waitingCount} waiting
                  </Text>
                </View>
                <SecondaryButton
                  label={normalizeWorkspacePath(activeWorkspacePath) === project.path ? "Selected" : "Use"}
                  onPress={() => {
                    setManualWorkspace("");
                    setPickerWorkspacePath(project.path);
                    setSelectedWorkspace({
                      path: project.path,
                      label: project.label,
                      sourceThreadId: project.sourceThreadId,
                    });
                  }}
                />
              </View>
            ))}
            {workspaceOptions.length > 8 ? (
              <Text style={styles.sectionMeta}>
                Showing 8 of {workspaceOptions.length} known projects. Use manual workspace for older entries.
              </Text>
            ) : null}
          </>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Repository State</Text>
        <Text style={styles.meta}>Branch: {parsedStatus.branch ?? "Unknown"}</Text>
        <Text style={styles.meta}>Tracking: {parsedStatus.tracking ?? "None"}</Text>
        <Text style={styles.meta}>Ahead: {parsedStatus.aheadBy} / Behind: {parsedStatus.behindBy}</Text>
        <Text style={styles.meta}>Dirty: {parsedStatus.dirty ? "Yes" : "No"}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Workspace-Scoped Actions</Text>
        <Text style={styles.sectionMeta}>These commands are constrained to the workspace view.</Text>
        {workspaceScopedActions.map((preset) => (
          <SecondaryButton
            key={preset.id}
            disabled={
              isRunningAction ||
              !workspaceActionsAllowed ||
              ((preset.id === "fetch" || preset.id === "pull") && !hasOrigin) ||
              (preset.id === "commit" && !commitMessage.trim()) ||
              (preset.id === "switch-branch" && !branchInput.trim())
            }
            label={preset.label}
            helperText={preset.description}
            onPress={() => {
              void runAction(preset.command, "workspace");
            }}
          />
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Repo-wide Actions</Text>
        <Text style={styles.sectionMeta}>These commands affect the entire repository root.</Text>
        {repoWideActions.map((preset) => (
          <SecondaryButton
            key={preset.id}
            disabled={
              isRunningAction ||
              !repoWideActionsAllowed ||
              ((preset.id === "fetch" || preset.id === "pull") && !hasOrigin) ||
              (preset.id === "commit" && !commitMessage.trim()) ||
              (preset.id === "switch-branch" && !branchInput.trim())
            }
            label={preset.label}
            helperText={preset.description}
            onPress={() => {
              void runAction(preset.command, "repository");
            }}
          />
        ))}
      </View>

      <LabeledInput
        label="Switch To Branch"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setBranchInput}
        placeholder="feature/my-branch"
        value={branchInput}
      />
      <LabeledInput
        label="Commit Message"
        autoCapitalize="sentences"
        autoCorrect={false}
        onChangeText={setCommitMessage}
        placeholder="Describe the local git change"
        value={commitMessage}
      />

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Changed Files</Text>
        {!visibleFiles.length ? <InlineNotice>No changed files detected for this workspace view.</InlineNotice> : null}
        {hiddenFileCount > 0 ? (
          <InlineNotice>
            {hiddenFileCount} file change{hiddenFileCount === 1 ? "" : "s"} outside this workspace
            are hidden from the list.
          </InlineNotice>
        ) : null}
        <ScrollView horizontal>
          <View style={styles.listBlock}>
            {visibleFiles.map((file) => (
              <View key={file.path} style={styles.fileRow}>
                <View style={styles.fileCopy}>
                  <Text style={styles.filePath}>{file.path}</Text>
                  <Text style={styles.fileMeta}>
                    index {file.indexStatus} / worktree {file.workTreeStatus}
                  </Text>
                </View>
                <View style={styles.fileActions}>
                  <SecondaryButton
                    label="Stage"
                    disabled={isRunningAction || !workspaceActionsAllowed}
                    onPress={() => {
                      void runAction(["git", "add", "--", file.path], "workspace");
                    }}
                  />
                  <SecondaryButton
                    label="Unstage"
                    disabled={isRunningAction || !workspaceActionsAllowed}
                    onPress={() => {
                      void runAction(["git", "reset", "HEAD", "--", file.path], "workspace");
                    }}
                  />
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Branches</Text>
        {branches.map((branch) => (
          <Text key={branch.name} style={styles.meta}>
            {branch.current ? "• " : ""}{branch.name}
          </Text>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Recent Commits</Text>
        {commits.map((commit) => (
          <Text key={commit.sha} style={styles.meta}>
            {commit.sha} {commit.message}
          </Text>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Diff Summary</Text>
        <Text style={styles.outputText}>{diffStat || "No unstaged diff summary."}</Text>
        <Text style={styles.sectionTitle}>Staged Summary</Text>
        <Text style={styles.outputText}>{stagedDiffStat || "No staged diff summary."}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Last Action Output</Text>
        <Text style={styles.outputText}>{actionOutput || "Run a git action to inspect command output."}</Text>
      </View>
    </ScreenShell>
  );
}

function areSamePath(left: string | null, right: string | null) {
  if (!left || !right) {
    return false;
  }

  return normalizePath(left) === normalizePath(right);
}

function normalizePath(value: string) {
  return value.replace(/^\\\\\?\\/, "").replace(/[\\/]+/g, "\\").replace(/\\$/, "").toLowerCase();
}

function isVisibleWorkspaceFile(path: string) {
  const normalized = path.trim();
  if (!normalized) {
    return false;
  }

  if (normalized === "." || normalized === "./") {
    return true;
  }

  return !normalized.startsWith("..\\") && !normalized.startsWith("../") && !/^[A-Za-z]:[\\/]/.test(normalized);
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: colors.cardSoft,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
  },
  meta: {
    color: colors.textMuted,
  },
  sectionMeta: {
    color: colors.textSubtle,
    marginBottom: 6,
    fontSize: 13,
  },
  warningText: {
    color: colors.noticeErrorText,
    fontSize: 12,
    lineHeight: 18,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  listBlock: {
    gap: 10,
    minWidth: "100%",
  },
  fileRow: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: colors.backgroundMuted,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  fileCopy: {
    gap: 4,
  },
  filePath: {
    color: colors.text,
    fontWeight: "700",
  },
  fileMeta: {
    color: colors.textSubtle,
  },
  fileActions: {
    gap: 8,
  },
  projectRow: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: colors.backgroundMuted,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  projectCopy: {
    gap: 4,
  },
  projectPath: {
    color: colors.textMuted,
    fontSize: 12,
  },
  outputText: {
    color: colors.textMuted,
    lineHeight: 20,
  },
});
