import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { RuntimeControls } from "@/components/runtime-controls";
import { ScreenShell } from "@/components/screen-shell";
import { InlineNotice, LabeledInput, PrimaryButton, SecondaryButton } from "@/components/ui";
import type { ThemeColors } from "@/constants/theme";
import { getAppServerStatus } from "@/services/api";
import { useRuntimeDefaults } from "@/services/runtime-defaults-context";
import { useSession } from "@/services/session-context";
import { useThemedStyles } from "@/services/theme-context";
import type { AppServerModel, AppThread } from "@/types/app-server";
import type { AppServerStatus } from "@/types/api";
import { withWarmAppServerClient } from "@/utils/app-server-connect";
import { withTimeout } from "@/utils/async-timeout";
import { getFriendlyNetworkErrorMessage } from "@/utils/network";
import {
  normalizeRuntimeDefaults,
  resolveRuntimeSelection,
  type RuntimeDefaults,
} from "@/utils/runtime-defaults";
import {
  deriveWorkspaceOptions,
  getWorkspaceLabel,
  normalizeWorkspacePath,
  resolveWorkspacePickerSelection,
  resolveWorkspaceTarget,
} from "@/utils/workspace-target";

const NEW_THREAD_RUNTIME_LOAD_TIMEOUT_MS = 20000;

export default function NewTaskScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ cwd?: string; label?: string; threadId?: string }>();
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
  const { runtimeDefaults, isRuntimeDefaultsHydrated } = useRuntimeDefaults();
  const routeWorkspacePath = typeof params.cwd === "string" ? params.cwd : null;
  const routeWorkspaceLabel = typeof params.label === "string" ? params.label : null;
  const routeThreadId = typeof params.threadId === "string" ? params.threadId : null;
  const [title, setTitle] = useState("");
  const [initialMessage, setInitialMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadLoadError, setThreadLoadError] = useState<string | null>(null);
  const [threadList, setThreadList] = useState<AppThread[]>([]);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [backendWorkspaceRoot, setBackendWorkspaceRoot] = useState<string | null>(null);
  const [appServerStatus, setAppServerStatus] = useState<AppServerStatus | null>(null);
  const [models, setModels] = useState<AppServerModel[]>([]);
  const [runtimeDraft, setRuntimeDraft] = useState<RuntimeDefaults>(runtimeDefaults);
  const [showAdvancedRuntime, setShowAdvancedRuntime] = useState(false);
  const [showHiddenModels, setShowHiddenModels] = useState(false);
  const [runtimeLoadError, setRuntimeLoadError] = useState<string | null>(null);
  const [isLoadingRuntime, setIsLoadingRuntime] = useState(false);
  const [manualWorkspace, setManualWorkspace] = useState("");
  const [selectedWorkspacePathFromPicker, setSelectedWorkspacePathFromPicker] = useState<string | null>(null);
  const lastRouteWorkspacePathRef = useRef<string | null>(null);
  const runtimeRequestIdRef = useRef(0);

  const workspaceTarget = resolveWorkspaceTarget({
    routePath: routeWorkspacePath,
    routeLabel: routeWorkspaceLabel,
    routeThreadId,
    selectedPath: selectedWorkspacePath,
    selectedLabel: selectedWorkspaceLabel,
    selectedSourceThreadId,
    fallbackPath: backendWorkspaceRoot,
    fallbackLabel: backendWorkspaceRoot ? "Backend default workspace" : null,
  });
  const workspaceOptions = useMemo(() => deriveWorkspaceOptions(threadList), [threadList]);
  const readinessTone = appServerStatus?.ready ? "success" : "neutral";
  const readinessMessage = appServerStatus
    ? appServerStatus.ready
      ? `Codex App Server is ready on ${appServerStatus.listen_url}. Model: ${appServerStatus.model}.`
      : `Backend reachable. Codex App Server is not ready yet on ${appServerStatus.listen_url}; it will spin up when the websocket path is used.`
    : "Checking backend and Codex App Server readiness.";
  const runtimeSelection = resolveRuntimeSelection({ saved: runtimeDraft, models });

  const selectedSourceText = workspaceTarget.source === "route"
    ? "Route from project/thread workspace"
    : workspaceTarget.source === "selected"
      ? selectedSourceThreadId
        ? `Sticky selection from thread ${selectedSourceThreadId}`
        : "Sticky selected workspace"
      : "No route or selected workspace";

  useEffect(() => {
    if (isRuntimeDefaultsHydrated) {
      setRuntimeDraft(runtimeDefaults);
    }
  }, [isRuntimeDefaultsHydrated, runtimeDefaults]);

  useEffect(() => {
    const nextSelection = resolveWorkspacePickerSelection({
      manualWorkspace,
      currentPickerPath: selectedWorkspacePathFromPicker,
      workspaceTargetPath: workspaceTarget.path,
      workspaceTargetSource: workspaceTarget.source,
      workspaceOptions,
      lastRouteWorkspacePath: lastRouteWorkspacePathRef.current,
    });

    lastRouteWorkspacePathRef.current = nextSelection.nextRouteWorkspacePath;

    if (nextSelection.nextPickerPath !== normalizeWorkspacePath(selectedWorkspacePathFromPicker)) {
      setSelectedWorkspacePathFromPicker(nextSelection.nextPickerPath);
    }
  }, [
    manualWorkspace,
    selectedWorkspacePathFromPicker,
    workspaceOptions,
    workspaceTarget.path,
    workspaceTarget.source,
  ]);

  const normalizedManualWorkspace = useMemo(() => normalizeWorkspacePath(manualWorkspace), [manualWorkspace]);
  const normalizedPickerWorkspace = useMemo(
    () => normalizeWorkspacePath(selectedWorkspacePathFromPicker),
    [selectedWorkspacePathFromPicker],
  );
  const chosenWorkspacePath = normalizedManualWorkspace ?? normalizedPickerWorkspace ?? workspaceTarget.path;
  const chosenWorkspaceLabel = useMemo(() => {
    if (normalizedManualWorkspace) {
      return getWorkspaceLabel(normalizedManualWorkspace);
    }

    const selectedFromOptions = workspaceOptions.find((option) => option.path === normalizedPickerWorkspace);
    if (selectedFromOptions) {
      return selectedFromOptions.label;
    }

    if (workspaceTarget.label) {
      return workspaceTarget.label;
    }

    return normalizedPickerWorkspace ? getWorkspaceLabel(normalizedPickerWorkspace) : "Default workspace";
  }, [normalizedManualWorkspace, normalizedPickerWorkspace, workspaceOptions, workspaceTarget.label]);

  const loadThreads = useCallback(async () => {
    if (!sessionToken) {
      setThreadList([]);
      setIsLoadingThreads(false);
      return;
    }

    try {
      setIsLoadingThreads(true);
      setThreadLoadError(null);
      const threads = await withWarmAppServerClient(backendUrl, sessionToken, async (client) => {
        const [activeThreads, archivedThreads] = await Promise.all([
          client.listAllThreads({ archived: false }),
          client.listAllThreads({ archived: true }),
        ]);
        const mergedThreads = new Map<string, AppThread>();
        for (const thread of [...activeThreads, ...archivedThreads]) {
          mergedThreads.set(thread.id, thread);
        }
        return [...mergedThreads.values()].sort((left, right) => right.updatedAt - left.updatedAt);
      });
      setThreadList(threads);
    } catch (loadError) {
      const message = getFriendlyNetworkErrorMessage(loadError, "Failed to load thread list for workspace selection.");
      setThreadLoadError(
        message.includes("timed out while waiting for initialize")
          ? "Codex App Server is still starting on the desktop. Wait a moment and refresh this screen."
          : message,
      );
    } finally {
      setIsLoadingThreads(false);
    }
  }, [backendUrl, sessionToken]);

  const loadBackendWorkspace = useCallback(async () => {
    if (!sessionToken) {
      setBackendWorkspaceRoot(null);
      setAppServerStatus(null);
      return;
    }

    try {
      const status = await getAppServerStatus(backendUrl, sessionToken);
      setBackendWorkspaceRoot(status.workspace_root);
      setAppServerStatus(status);
    } catch {
      setBackendWorkspaceRoot(null);
      setAppServerStatus(null);
    }
  }, [backendUrl, sessionToken]);

  const loadRuntimeModels = useCallback(async () => {
    if (!sessionToken) {
      setModels([]);
      return;
    }

    const requestId = runtimeRequestIdRef.current + 1;
    runtimeRequestIdRef.current = requestId;

    try {
      setIsLoadingRuntime(true);
      setRuntimeLoadError(null);
      const modelsResponse = await withTimeout(
        withWarmAppServerClient(backendUrl, sessionToken, async (client) =>
          client.listModels({ includeHidden: showHiddenModels }),
        ),
        NEW_THREAD_RUNTIME_LOAD_TIMEOUT_MS,
        "Model list load timed out while waiting for the Codex App Server.",
      );

      if (requestId !== runtimeRequestIdRef.current) {
        return;
      }

      setModels(modelsResponse.data);
    } catch (loadError) {
      if (requestId !== runtimeRequestIdRef.current) {
        return;
      }

      setRuntimeLoadError(getFriendlyNetworkErrorMessage(loadError, "Failed to load model list."));
    } finally {
      if (requestId === runtimeRequestIdRef.current) {
        setIsLoadingRuntime(false);
      }
    }
  }, [backendUrl, sessionToken, showHiddenModels]);

  useFocusEffect(
    useCallback(() => {
      if (!sessionToken) {
        return;
      }

      void loadThreads();
      void loadBackendWorkspace();
      void loadRuntimeModels();
    }, [loadBackendWorkspace, loadRuntimeModels, loadThreads, sessionToken]),
  );

  if (!isHydrated || !isRuntimeDefaultsHydrated) {
    return (
      <ScreenShell
        title="Create Thread"
        subtitle="Restoring secure session state."
      >
        <InlineNotice>Loading task creation access.</InlineNotice>
      </ScreenShell>
    );
  }

  if (!sessionToken) {
    return <Redirect href="/connect" />;
  }

  const authToken = sessionToken;

  async function handleCreate() {
    if (!title.trim()) {
      setError("Add a thread title so it is identifiable on the dashboard.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const threadId = await withWarmAppServerClient(backendUrl, authToken, async (client) => {
        return await client.startThread({
          title: title.trim(),
          initialMessage: initialMessage.trim() || null,
          cwd: chosenWorkspacePath,
          runtime: normalizeRuntimeDefaults({
            model: runtimeSelection.model,
            reasoningEffort: runtimeSelection.reasoningEffort,
            approvalPolicy: runtimeSelection.approvalPolicy,
            sandbox: runtimeSelection.sandbox,
            serviceTier: runtimeSelection.serviceTier,
          }),
        });
      });
      setSelectedWorkspace({
        path: chosenWorkspacePath,
        label: chosenWorkspaceLabel,
        sourceThreadId: threadId,
      });
      router.replace(`/thread/${threadId}`);
    } catch (error) {
      setError(getFriendlyNetworkErrorMessage(error, "Failed to create thread."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScreenShell
      title="Create Thread"
      subtitle="Official Codex App Server build. Start a provider-backed task from the phone using the same backend as the desktop app."
    >
      <InlineNotice tone={readinessTone}>{readinessMessage}</InlineNotice>
      {appServerStatus ? (
        <Text style={styles.meta}>
          App Server PID: {appServerStatus.pid ?? "Not started"} | Workspace root: {appServerStatus.workspace_root}
        </Text>
      ) : null}
      <Text style={styles.sectionTitle}>Thread Workspace</Text>
      <Text style={styles.meta}>Source: {selectedSourceText}</Text>
      {workspaceTarget.source !== "default" ? (
        <Text style={styles.meta}>Detected workspace: {workspaceTarget.path}</Text>
      ) : null}
      <Text style={styles.meta}>Workspace to use: {chosenWorkspacePath || "Backend default workspace"}</Text>
      <InlineNotice tone={runtimeSelection.model ? "success" : "neutral"}>
        Runtime: {runtimeSelection.selectedModel?.displayName ?? runtimeSelection.model ?? "App Server default"} | Effort:{" "}
        {runtimeSelection.reasoningEffort ?? "default"} | Sandbox: {runtimeSelection.sandbox}
      </InlineNotice>
      {runtimeLoadError ? <InlineNotice tone="error">{runtimeLoadError}</InlineNotice> : null}
      <SecondaryButton
        disabled={isLoadingRuntime}
        label={showAdvancedRuntime ? "Hide Runtime Options" : "Show Runtime Options"}
        helperText="Normal creation uses your saved phone defaults. Open this for per-thread overrides."
        onPress={() => setShowAdvancedRuntime((current) => !current)}
      />
      {showAdvancedRuntime ? (
        <RuntimeControls
          title="New Thread Runtime"
          disabled={isSubmitting || isLoadingRuntime}
          models={models}
          showHiddenModels={showHiddenModels}
          value={runtimeDraft}
          onChange={setRuntimeDraft}
          onShowHiddenModelsChange={setShowHiddenModels}
        />
      ) : null}
      <LabeledInput
        label="Manual Workspace Override"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setManualWorkspace}
        placeholder="Type a folder path to override selection"
        value={manualWorkspace}
      />
      <Text style={styles.meta}>Manual override takes precedence over picker and defaults.</Text>
      <LabeledInput label="Title" onChangeText={setTitle} value={title} />
      <LabeledInput
        label="Initial Message"
        multiline
        onChangeText={setInitialMessage}
        value={initialMessage}
      />
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <PrimaryButton
        disabled={isSubmitting || !title.trim()}
        label={isSubmitting ? "Creating..." : "Create Thread"}
        helperText="A title is required. The first message is optional and can be sent later."
        onPress={() => {
          void handleCreate();
        }}
      />
      {threadLoadError ? <InlineNotice tone="error">{threadLoadError}</InlineNotice> : null}
      <Text style={styles.sectionTitle}>Choose from known workspaces</Text>
      {isLoadingThreads ? <InlineNotice>Loading workspace list from active and archived threads.</InlineNotice> : null}
      {!isLoadingThreads && !workspaceOptions.length ? (
        <InlineNotice>No thread-scoped workspace projects are available yet.</InlineNotice>
      ) : null}
      {workspaceOptions.map((project) => (
        <View key={project.path} style={styles.projectRow}>
          <View style={styles.projectCopy}>
            <Text style={styles.projectLabel}>{project.label}</Text>
            <Text style={styles.projectPath}>{project.path}</Text>
            <Text style={styles.projectStats}>
              {project.threadCount} thread{project.threadCount === 1 ? "" : "s"} | {project.runningCount} running | {project.waitingCount} waiting
            </Text>
          </View>
          <SecondaryButton
            label={
              normalizedPickerWorkspace === project.path
                ? "Selected For New Thread"
                : "Use For New Thread"
            }
            onPress={() => {
              setSelectedWorkspacePathFromPicker(project.path);
              setManualWorkspace("");
            }}
          />
        </View>
      ))}
    </ScreenShell>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
  },
  meta: {
    color: colors.textMuted,
    lineHeight: 20,
  },
  projectRow: {
    gap: 8,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  projectCopy: {
    gap: 2,
  },
  projectLabel: {
    color: colors.text,
    fontWeight: "700",
  },
  projectPath: {
    color: colors.textMuted,
    fontSize: 12,
  },
  projectStats: {
    color: colors.textSubtle,
    fontSize: 12,
  },
});
