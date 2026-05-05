import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { MessageBubble } from "@/components/message-bubble";
import { RuntimeControls } from "@/components/runtime-controls";
import { ScreenShell } from "@/components/screen-shell";
import { TaskEventItem } from "@/components/task-event-item";
import { InlineNotice, LabeledInput, PillButton, PrimaryButton, SecondaryButton } from "@/components/ui";
import type { ThemeColors } from "@/constants/theme";
import { useRuntimeDefaults } from "@/services/runtime-defaults-context";
import { useSession } from "@/services/session-context";
import { useThemedStyles } from "@/services/theme-context";
import type { AppServerModel, AppServerNotification, AppServerRequest, AppThread, AppThreadItem } from "@/types/app-server";
import type { TaskEventRead } from "@/types/api";
import {
  describeAppThreadItem,
  getAppThreadProjectPath,
  getAppThreadPreview,
  getAppThreadSourceLabel,
  getAppThreadStatusLabel,
  getAppThreadTitle,
  getAppThreadTurnCount,
  getAppThreadWorkspace,
  summarizeUserInput,
} from "@/utils/app-server-thread";
import { connectWarmAppServer } from "@/utils/app-server-connect";
import { withTimeout } from "@/utils/async-timeout";
import { buildComposerInput, type ComposerImageAttachment } from "@/utils/composer-input";
import { formatStatusLabel, formatTimestamp } from "@/utils/format";
import { getFriendlyNetworkErrorMessage } from "@/utils/network";
import {
  normalizeRuntimeDefaults,
  resolveRuntimeSelection,
  type RuntimeDefaults,
} from "@/utils/runtime-defaults";
import {
  appendCommandOutputDelta,
  appendItemTextDelta,
  findActiveTurnId,
  mergeTurnIntoThread,
  replaceThreadWithSnapshot,
  upsertTurn,
  upsertTurnItem,
} from "@/utils/thread-state";

const THREAD_MODEL_LOAD_TIMEOUT_MS = 20000;

type BubbleMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  updated_at: string;
  metaLabel?: string | null;
};

type ActivityEvent = TaskEventRead & { metaLabel?: string | null };

export default function ThreadDetailScreen() {
  const params = useLocalSearchParams<{ id?: string; view?: string }>();
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const {
    backendUrl,
    isHydrated,
    retrySessionValidation,
    sessionRestoreState,
    sessionToken,
    setSelectedWorkspace,
  } = useSession();
  const { runtimeDefaults, isRuntimeDefaultsHydrated } = useRuntimeDefaults();
  const [thread, setThread] = useState<AppThread | null>(null);
  const [reply, setReply] = useState("");
  const [replyImages, setReplyImages] = useState<ComposerImageAttachment[]>([]);
  const [replyRuntimeDraft, setReplyRuntimeDraft] = useState<RuntimeDefaults>(runtimeDefaults);
  const [models, setModels] = useState<AppServerModel[]>([]);
  const [showReplyRuntime, setShowReplyRuntime] = useState(false);
  const [detailPanel, setDetailPanel] = useState<"conversation" | "activity">("conversation");
  const [showThreadActions, setShowThreadActions] = useState(false);
  const [showHiddenModels, setShowHiddenModels] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [rollbackTurns, setRollbackTurns] = useState("1");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPickingImage, setIsPickingImage] = useState(false);
  const [isRefreshingThread, setIsRefreshingThread] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isManagingThread, setIsManagingThread] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [pendingRequest, setPendingRequest] = useState<AppServerRequest | null>(null);
  const [toolAnswers, setToolAnswers] = useState<Record<string, string>>({});
  const clientRef = useRef<Awaited<ReturnType<typeof connectWarmAppServer>> | null>(null);
  const modelRequestIdRef = useRef(0);
  const threadReadRequestIdRef = useRef(0);
  const threadId = params.id ?? "";
  const authToken = sessionToken ?? "";
  const isArchivedView = params.view === "archived";
  const replyRuntimeSelection = resolveRuntimeSelection({ saved: replyRuntimeDraft, models });

  useEffect(() => {
    if (!thread) {
      return;
    }

    setRenameTitle(getAppThreadTitle(thread));
  }, [thread?.name, thread?.preview]);

  useEffect(() => {
    if (isRuntimeDefaultsHydrated) {
      setReplyRuntimeDraft(runtimeDefaults);
    }
  }, [isRuntimeDefaultsHydrated, runtimeDefaults]);

  useEffect(() => {
    let isActive = true;

    async function connect() {
      if (!threadId || !sessionToken) {
        setIsLoading(false);
        return;
      }

      try {
        setConnectionState("connecting");
        setIsLoading(true);
        setError(null);

        const client = await connectWarmAppServer(
          backendUrl,
          authToken,
          (notification) => {
            if (!isActive) {
              return;
            }
            handleNotification(notification, threadId, setThread, setActiveTurnId, setError, setPendingRequest);
            if (
              notification.method === "turn/completed" &&
              notification.params.threadId === threadId
            ) {
              void refreshThreadFromServer();
            }
          },
          (request) => {
            if (!isActive) {
              return;
            }
            if (request.params.threadId === threadId) {
              setPendingRequest(request);
              if (request.method === "item/tool/requestUserInput") {
                setToolAnswers(
                  Object.fromEntries(request.params.questions.map((question) => [question.id, ""])),
                );
              }
            }
          },
        );
        clientRef.current = client;
        const response = await client.readThread(threadId);

        if (!isActive) {
          await client.close();
          return;
        }

        setThread(response.thread);
        setActiveTurnId(findActiveTurnId(response.thread));
        setConnectionState("connected");
      } catch (error) {
        if (!isActive) {
          return;
        }
        const message = getFriendlyNetworkErrorMessage(error, "Failed to load App Server thread.");
        setError(
          message.includes("timed out while waiting for initialize")
            ? "Codex App Server is still starting on the desktop. Open the thread again in a moment."
            : message,
        );
        setConnectionState("disconnected");
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void connect();

    return () => {
      isActive = false;
      const client = clientRef.current;
      clientRef.current = null;
      if (client) {
        void client.close();
      }
    };
  }, [authToken, backendUrl, threadId]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || connectionState !== "connected") {
      return;
    }

    const requestId = modelRequestIdRef.current + 1;
    modelRequestIdRef.current = requestId;

    void withTimeout(
      client.listModels({ includeHidden: showHiddenModels }),
      THREAD_MODEL_LOAD_TIMEOUT_MS,
      "Model list load timed out while waiting for the Codex App Server.",
    )
      .then((modelsResponse) => {
        if (requestId === modelRequestIdRef.current) {
          setModels(modelsResponse.data);
        }
      })
      .catch(() => {
        if (requestId === modelRequestIdRef.current) {
          setModels([]);
        }
      });
  }, [connectionState, showHiddenModels]);

  const statusLabel = useMemo(() => (thread ? getThreadStatusLabel(thread) : "unknown"), [thread]);
  const messages = useMemo(() => buildConversationMessages(thread), [thread]);
  const activity = useMemo(() => buildActivityItems(thread), [thread]);
  const isHistorySnapshot = thread?.status.type === "notLoaded";
  const waitingOnInput = thread?.status.type === "active" && thread.status.activeFlags.includes("waitingOnUserInput");
  const isThreadBusy = thread?.status.type === "active" && !waitingOnInput;
  const connectionTone = connectionState === "connected" ? "success" : connectionState === "disconnected" ? "error" : "neutral";
  const hasReplyInput = Boolean(reply.trim()) || replyImages.length > 0;

  async function refreshThreadFromServer() {
    const client = clientRef.current;
    if (!client || !threadId) {
      return;
    }

    const requestId = threadReadRequestIdRef.current + 1;
    threadReadRequestIdRef.current = requestId;
    setIsRefreshingThread(true);

    try {
      const refreshed = await client.readThread(threadId);
      if (requestId !== threadReadRequestIdRef.current) {
        return;
      }

      setThread((current) =>
        current ? replaceThreadWithSnapshot(current, refreshed.thread) : refreshed.thread,
      );
      setActiveTurnId(findActiveTurnId(refreshed.thread));
    } catch {
      if (requestId === threadReadRequestIdRef.current) {
        setError("The message was sent, but the latest thread state could not be refreshed yet.");
      }
    } finally {
      if (requestId === threadReadRequestIdRef.current) {
        setIsRefreshingThread(false);
      }
    }
  }

  async function handleReply() {
    if (!clientRef.current || !hasReplyInput) {
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const input = buildComposerInput({ text: reply, images: replyImages });
      if (activeTurnId && waitingOnInput) {
        const result = await clientRef.current.steerTurn(threadId, activeTurnId, input);
        setActiveTurnId(result.turnId);
      } else {
        const result = await clientRef.current.startTurn(threadId, input, {
          cwd: thread?.cwd,
          runtime: showReplyRuntime ? getReplyRuntimeForRequest() : undefined,
        });
        setThread((current) => (current ? mergeTurnIntoThread(current, result.turn) : current));
        setActiveTurnId(result.turn.id);
      }
      setReply("");
      setReplyImages([]);
      await refreshThreadFromServer();
    } catch (error) {
      setError(getFriendlyNetworkErrorMessage(error, "Failed to send input to Codex."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePickImage() {
    if (isHistorySnapshot || isSubmitting || pendingRequest) {
      return;
    }

    try {
      setIsPickingImage(true);
      setError(null);
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError("Photo library permission is required to attach an image.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,
        base64: true,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });

      if (result.canceled) {
        return;
      }

      const images = result.assets
        .filter((asset) => Boolean(asset.base64))
        .map((asset, index): ComposerImageAttachment => ({
          id: asset.assetId ?? `${asset.uri}-${Date.now()}-${index}`,
          name: asset.fileName ?? `Image ${index + 1}`,
          mimeType: asset.mimeType ?? "image/jpeg",
          base64: asset.base64 ?? "",
          uri: asset.uri,
        }));

      if (!images.length) {
        setError("The selected image could not be attached.");
        return;
      }

      setReplyImages((current) => [...current, ...images]);
    } catch (error) {
      setError(getFriendlyNetworkErrorMessage(error, "Failed to attach image."));
    } finally {
      setIsPickingImage(false);
    }
  }

  async function handleContinue() {
    if (!clientRef.current) {
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const prompt = "Continue from the current context and provide the next concrete result.";
      if (activeTurnId && waitingOnInput) {
        const result = await clientRef.current.steerTurn(threadId, activeTurnId, prompt);
        setActiveTurnId(result.turnId);
      } else {
        const result = await clientRef.current.startTurn(threadId, prompt, {
          cwd: thread?.cwd,
          runtime: showReplyRuntime ? getReplyRuntimeForRequest() : undefined,
        });
        setThread((current) => (current ? mergeTurnIntoThread(current, result.turn) : current));
        setActiveTurnId(result.turn.id);
      }
    } catch (error) {
      setError(getFriendlyNetworkErrorMessage(error, "Failed to continue the Codex thread."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRenameThread() {
    if (!clientRef.current || !thread || !renameTitle.trim()) {
      return;
    }

    try {
      setIsRenaming(true);
      setError(null);
      await clientRef.current.renameThread(thread.id, renameTitle.trim());
      setThread((current) => (current ? { ...current, name: renameTitle.trim() } : current));
    } catch (error) {
      setError(getFriendlyNetworkErrorMessage(error, "Failed to rename the thread."));
    } finally {
      setIsRenaming(false);
    }
  }

  async function handleArchiveToggle() {
    if (!clientRef.current || !thread) {
      return;
    }

    try {
      setIsArchiving(true);
      setError(null);
      if (isArchivedView) {
        await clientRef.current.unarchiveThread(thread.id);
        router.replace("/threads");
      } else {
        await clientRef.current.archiveThread(thread.id);
        router.replace({ pathname: "/threads", params: { view: "archived" } });
      }
    } catch (error) {
      setError(getFriendlyNetworkErrorMessage(error, isArchivedView ? "Failed to restore the thread." : "Failed to archive the thread."));
    } finally {
      setIsArchiving(false);
    }
  }

  async function handleForkThread() {
    if (!clientRef.current || !thread) {
      return;
    }

    try {
      setIsManagingThread(true);
      setError(null);
      const result = await clientRef.current.forkThread(thread.id);
      router.replace(`/thread/${result.thread.id}`);
    } catch (error) {
      setError(getFriendlyNetworkErrorMessage(error, "Failed to fork the thread."));
    } finally {
      setIsManagingThread(false);
    }
  }

  async function handleResumeThread() {
    if (!clientRef.current || !thread) {
      return;
    }

    try {
      setIsManagingThread(true);
      setError(null);
      const result = await clientRef.current.resumeThread(thread.id);
      router.replace(`/thread/${result.thread.id}`);
    } catch (error) {
      setError(getFriendlyNetworkErrorMessage(error, "Failed to resume the thread."));
    } finally {
      setIsManagingThread(false);
    }
  }

  async function handleRollbackThread() {
    if (!clientRef.current || !thread) {
      return;
    }

    const turnsToDrop = Math.max(1, Number.parseInt(rollbackTurns, 10) || 1);

    try {
      setIsManagingThread(true);
      setError(null);
      const result = (await clientRef.current.rollbackThread(thread.id, turnsToDrop)) as { thread?: AppThread };
      if (result.thread) {
        setThread(result.thread);
        setActiveTurnId(findActiveTurnId(result.thread));
      } else {
        const refreshed = await clientRef.current.readThread(thread.id);
        setThread(refreshed.thread);
        setActiveTurnId(findActiveTurnId(refreshed.thread));
      }
    } catch (error) {
      setError(getFriendlyNetworkErrorMessage(error, "Failed to roll back the thread."));
    } finally {
      setIsManagingThread(false);
    }
  }

  async function handleCompactThread() {
    if (!clientRef.current || !thread) {
      return;
    }

    try {
      setIsManagingThread(true);
      setError(null);
      await clientRef.current.compactThread(thread.id);
      const refreshed = await clientRef.current.readThread(thread.id);
      setThread(refreshed.thread);
      setActiveTurnId(findActiveTurnId(refreshed.thread));
    } catch (error) {
      setError(getFriendlyNetworkErrorMessage(error, "Failed to compact the thread."));
    } finally {
      setIsManagingThread(false);
    }
  }

  function respondCommandApproval(decision: "accept" | "acceptForSession" | "decline" | "cancel") {
    if (!clientRef.current || !pendingRequest || pendingRequest.method !== "item/commandExecution/requestApproval") {
      return;
    }

    clientRef.current.respondToCommandApproval(pendingRequest.id, decision);
    setPendingRequest(null);
  }

  function respondFileApproval(decision: "accept" | "acceptForSession" | "decline" | "cancel") {
    if (!clientRef.current || !pendingRequest || pendingRequest.method !== "item/fileChange/requestApproval") {
      return;
    }

    clientRef.current.respondToFileChangeApproval(pendingRequest.id, decision);
    setPendingRequest(null);
  }

  function respondPermissionsApproval(scope: "turn" | "session") {
    if (!clientRef.current || !pendingRequest || pendingRequest.method !== "item/permissions/requestApproval") {
      return;
    }

    clientRef.current.respondToPermissionsApproval(pendingRequest.id, pendingRequest.params.permissions, scope);
    setPendingRequest(null);
  }

  function respondToolInput() {
    if (!clientRef.current || !pendingRequest || pendingRequest.method !== "item/tool/requestUserInput") {
      return;
    }

    clientRef.current.respondToUserInput(
      pendingRequest.id,
      Object.fromEntries(
        pendingRequest.params.questions.map((question) => [
          question.id,
          { answers: [toolAnswers[question.id] ?? ""] },
        ]),
      ),
    );
    setPendingRequest(null);
  }

  function openThreadWorkspaceTools(target: "git" | "tools") {
    if (!thread || !thread.cwd) {
      return;
    }

    const cwd = getAppThreadProjectPath(thread);
    const label = getAppThreadWorkspace(thread);

    setSelectedWorkspace({
      path: cwd,
      label,
      sourceThreadId: thread.id,
    });

    if (target === "git") {
      router.push({
        pathname: "/git",
        params: {
          cwd,
          label,
          threadId: thread.id,
        },
      });
      return;
    }

    router.push({
      pathname: "/tools",
      params: {
        cwd,
        label,
        threadId: thread.id,
      },
    });
  }

  function getReplyRuntimeForRequest() {
    return normalizeRuntimeDefaults({
      model: replyRuntimeSelection.model,
      reasoningEffort: replyRuntimeSelection.reasoningEffort,
      approvalPolicy: replyRuntimeSelection.approvalPolicy,
      sandbox: replyRuntimeSelection.sandbox,
      serviceTier: replyRuntimeSelection.serviceTier,
    });
  }

  const replyDisabled = isSubmitting || !hasReplyInput || Boolean(isHistorySnapshot) || Boolean(isThreadBusy) || Boolean(pendingRequest);
  const continueDisabled = isSubmitting || Boolean(isHistorySnapshot) || (!waitingOnInput && thread?.status.type !== "idle") || Boolean(pendingRequest);

  if (!isHydrated || !isRuntimeDefaultsHydrated) {
    return (
      <ScreenShell title="Thread" subtitle="Restoring secure session state.">
        <InlineNotice>Loading thread access.</InlineNotice>
      </ScreenShell>
    );
  }

  if (!params.id || !sessionToken) {
    return <Redirect href="/connect" />;
  }

  return (
    <ScreenShell
      title={thread ? getAppThreadTitle(thread) : "Codex Thread"}
      subtitle="Live App Server thread backed by the official Codex thread and turn model."
    >
      <View style={styles.statusCard}>
        <Text style={styles.statusLabel}>Thread</Text>
        <Text style={styles.statusValue}>{formatStatusLabel(statusLabel)}</Text>
        <Text style={styles.statusMeta}>Provider: {thread?.modelProvider ?? "unknown"}</Text>
        <Text style={styles.statusMeta}>Source: {thread ? getAppThreadSourceLabel(thread) : "unknown"}</Text>
        <Text style={styles.statusMeta}>Workspace: {thread ? getAppThreadWorkspace(thread) : "unknown"}</Text>
        <Text style={styles.statusMeta}>Turns loaded: {thread ? getAppThreadTurnCount(thread) : 0}</Text>
        <Text style={styles.statusMeta}>
          Git: {thread?.gitInfo?.branch ?? "no branch"} · {thread?.gitInfo?.sha ?? "no sha"}
        </Text>
        {thread?.tokenUsage ? (
          <Text style={styles.statusMeta}>
            Tokens: {thread.tokenUsage.total.totalTokens} total · {thread.tokenUsage.last.totalTokens} last turn
          </Text>
        ) : null}
        <Text style={styles.statusMeta}>
          Updated: {formatTimestamp(thread ? new Date(thread.updatedAt * 1000).toISOString() : "")}
        </Text>
        <InlineNotice tone={connectionTone}>
          App Server: {formatStatusLabel(connectionState)}
        </InlineNotice>
        {thread?.status.type === "notLoaded" ? (
          <InlineNotice>
            This is a stored Codex history snapshot. Runtime status loads again when a fresh turn starts.
          </InlineNotice>
        ) : null}
        {isHistorySnapshot ? (
          <SecondaryButton
            disabled={isManagingThread}
            label={isManagingThread ? "Resuming..." : "Resume Thread"}
            helperText="Creates a live continuation of this saved thread."
            onPress={() => {
              void handleResumeThread();
            }}
          />
        ) : null}
      </View>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {sessionRestoreState === "reconnecting" ? (
        <>
          <InlineNotice tone="error">
            The current thread is loaded from saved phone app state, but the backend is unreachable.
          </InlineNotice>
          <PrimaryButton label="Retry Session Validation" onPress={retrySessionValidation} />
        </>
      ) : null}
      {isLoading ? <InlineNotice>Loading the App Server thread and historical turns.</InlineNotice> : null}
      {isRefreshingThread ? <InlineNotice>Refreshing the latest thread state.</InlineNotice> : null}
      {pendingRequest ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Action Required</Text>
          <View style={styles.requestCard}>
            <Text style={styles.requestTitle}>{getRequestTitle(pendingRequest)}</Text>
            <Text style={styles.requestBody}>{getRequestBody(pendingRequest)}</Text>
            {pendingRequest.method === "item/tool/requestUserInput"
              ? pendingRequest.params.questions.map((question) => (
                  <LabeledInput
                    key={question.id}
                    label={question.header}
                    multiline
                    onChangeText={(value) =>
                      setToolAnswers((current) => ({
                        ...current,
                        [question.id]: value,
                      }))
                    }
                    placeholder={
                      question.options?.length
                        ? question.options.map((option) => option.label).join(" | ")
                        : question.question
                    }
                    secureTextEntry={question.isSecret}
                    value={toolAnswers[question.id] ?? ""}
                  />
                ))
              : null}
            <View style={styles.requestActions}>
              {pendingRequest.method === "item/commandExecution/requestApproval" ? (
                <>
                  <PrimaryButton label="Allow" onPress={() => respondCommandApproval("accept")} />
                  <SecondaryButton label="Allow Session" onPress={() => respondCommandApproval("acceptForSession")} />
                  <SecondaryButton label="Deny" onPress={() => respondCommandApproval("decline")} />
                </>
              ) : null}
              {pendingRequest.method === "item/fileChange/requestApproval" ? (
                <>
                  <PrimaryButton label="Allow" onPress={() => respondFileApproval("accept")} />
                  <SecondaryButton label="Allow Session" onPress={() => respondFileApproval("acceptForSession")} />
                  <SecondaryButton label="Deny" onPress={() => respondFileApproval("decline")} />
                </>
              ) : null}
              {pendingRequest.method === "item/permissions/requestApproval" ? (
                <>
                  <PrimaryButton label="Allow Turn" onPress={() => respondPermissionsApproval("turn")} />
                  <SecondaryButton label="Allow Session" onPress={() => respondPermissionsApproval("session")} />
                </>
              ) : null}
              {pendingRequest.method === "item/tool/requestUserInput" ? (
                <>
                  <PrimaryButton label="Submit Answer" onPress={respondToolInput} />
                </>
              ) : null}
            </View>
          </View>
        </View>
      ) : null}

      <View style={styles.panelTabs}>
        <PillButton
          label={`Conversation ${messages.length}`}
          selected={detailPanel === "conversation"}
          onPress={() => setDetailPanel("conversation")}
        />
        <PillButton
          label={`Activity ${activity.length}`}
          selected={detailPanel === "activity"}
          onPress={() => setDetailPanel("activity")}
        />
      </View>

      {detailPanel === "conversation" ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Conversation</Text>
          {!messages.length && !isLoading ? (
            <InlineNotice>No user or agent messages are available in this thread yet.</InlineNotice>
          ) : null}
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </View>
      ) : (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Activity</Text>
          {!activity.length && !isLoading ? (
            <InlineNotice>No non-message activity items have been captured for this thread yet.</InlineNotice>
          ) : null}
          {activity.map((event) => (
            <TaskEventItem key={String(event.id)} event={event} />
          ))}
        </View>
      )}

      <View style={styles.composerCard}>
        <Text style={styles.sectionTitle}>{waitingOnInput ? "Respond To Codex" : "Reply"}</Text>
        {isHistorySnapshot ? (
          <InlineNotice>
            Resume this history snapshot to create a live thread before sending a message.
          </InlineNotice>
        ) : null}
        <LabeledInput
          label="Message"
          multiline
          editable={!isHistorySnapshot && !isSubmitting && !Boolean(pendingRequest)}
          onChangeText={setReply}
          placeholder={isHistorySnapshot ? "Resume this snapshot before replying." : "Tell Codex what to do next."}
          value={reply}
        />
        <View style={styles.attachmentActions}>
          <SecondaryButton
            disabled={isHistorySnapshot || isSubmitting || isPickingImage || Boolean(pendingRequest)}
            label={isPickingImage ? "Opening Photos..." : "Attach Image"}
            onPress={() => {
              void handlePickImage();
            }}
          />
        </View>
        {replyImages.length ? (
          <View style={styles.attachmentList}>
            {replyImages.map((image) => (
              <View key={image.id} style={styles.attachmentItem}>
                {image.uri ? <Image source={{ uri: image.uri }} style={styles.attachmentThumb} /> : null}
                <View style={styles.attachmentDetails}>
                  <Text style={styles.attachmentName} numberOfLines={1}>{image.name}</Text>
                  <Text style={styles.statusMeta}>{image.mimeType}</Text>
                </View>
                <PillButton
                  label="Remove"
                  onPress={() => {
                    setReplyImages((current) => current.filter((item) => item.id !== image.id));
                  }}
                />
              </View>
            ))}
          </View>
        ) : null}
        <Text style={styles.statusMeta}>
          Runtime:{" "}
          {showReplyRuntime
            ? `${replyRuntimeSelection.selectedModel?.displayName ?? replyRuntimeSelection.model ?? "App Server default"} | ${replyRuntimeSelection.reasoningEffort ?? "default"} | ${replyRuntimeSelection.sandbox}`
            : "current thread settings"}
        </Text>
        <View style={styles.actionRow}>
          <View style={styles.actionCell}>
            <PrimaryButton
              disabled={replyDisabled}
              label={isSubmitting ? "Sending..." : "Send"}
              onPress={() => {
                void handleReply();
              }}
            />
          </View>
          <View style={styles.actionCell}>
            <SecondaryButton
              disabled={continueDisabled}
              label="Continue"
              onPress={() => {
                void handleContinue();
              }}
            />
          </View>
        </View>
        <SecondaryButton
          disabled={isSubmitting || waitingOnInput || Boolean(isHistorySnapshot)}
          label={showReplyRuntime ? "Hide Runtime Override" : "Runtime Override"}
          helperText={
            isHistorySnapshot
              ? "Runtime overrides apply after the snapshot is resumed."
              : waitingOnInput
              ? "Runtime overrides apply only when starting a new turn."
              : "Optional override for the next new turn only."
          }
          onPress={() => setShowReplyRuntime((current) => !current)}
        />
        {showReplyRuntime ? (
          <RuntimeControls
            title="Reply Runtime Override"
            disabled={isSubmitting}
            models={models}
            showHiddenModels={showHiddenModels}
            value={replyRuntimeDraft}
            onChange={setReplyRuntimeDraft}
            onShowHiddenModelsChange={setShowHiddenModels}
          />
        ) : null}
      </View>

      {!isLoading && thread ? (
        <View style={styles.section}>
          <SecondaryButton
            label={showThreadActions ? "Hide Thread Actions" : "Thread Actions"}
            helperText="Rename, archive, fork, resume, rollback, compact, review, and workspace shortcuts."
            onPress={() => setShowThreadActions((current) => !current)}
          />
          {showThreadActions ? (
            <View style={styles.requestCard}>
              <Text style={styles.requestBody}>{getAppThreadPreview(thread)}</Text>
              <Text style={styles.statusMeta}>Thread ID: {thread.id}</Text>
              <Text style={styles.statusMeta}>Source: {getAppThreadSourceLabel(thread)}</Text>
              <Text style={styles.statusMeta}>CLI: {thread.cliVersion}</Text>
              <Text style={styles.statusMeta}>Path: {thread.path ?? "Not exposed by Codex"}</Text>
              <LabeledInput
                label="Thread Title"
                editable={!isRenaming && !isArchiving}
                onChangeText={setRenameTitle}
                value={renameTitle}
              />
              <PrimaryButton
                disabled={isRenaming || !renameTitle.trim() || renameTitle.trim() === getAppThreadTitle(thread)}
                label={isRenaming ? "Renaming..." : "Rename"}
                onPress={() => {
                  void handleRenameThread();
                }}
              />
              <View style={styles.actionRow}>
                <View style={styles.actionCell}>
                  <SecondaryButton
                    disabled={isArchiving}
                    label={isArchiving ? (isArchivedView ? "Restoring..." : "Archiving...") : isArchivedView ? "Restore" : "Archive"}
                    onPress={() => {
                      void handleArchiveToggle();
                    }}
                  />
                </View>
                <View style={styles.actionCell}>
                  <SecondaryButton
                    disabled={isManagingThread}
                    label={isManagingThread ? "Forking..." : "Fork"}
                    onPress={() => {
                      void handleForkThread();
                    }}
                  />
                </View>
              </View>
              <View style={styles.actionRow}>
                <View style={styles.actionCell}>
                  <SecondaryButton
                    disabled={isManagingThread}
                    label={isManagingThread ? "Resuming..." : "Resume"}
                    onPress={() => {
                      void handleResumeThread();
                    }}
                  />
                </View>
                <View style={styles.actionCell}>
                  <SecondaryButton
                    disabled={isManagingThread}
                    label={isManagingThread ? "Compacting..." : "Compact"}
                    onPress={() => {
                      void handleCompactThread();
                    }}
                  />
                </View>
              </View>
              <LabeledInput
                label="Rollback Turns"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="number-pad"
                onChangeText={setRollbackTurns}
                value={rollbackTurns}
              />
              <SecondaryButton
                disabled={isManagingThread || !rollbackTurns.trim()}
                label={isManagingThread ? "Rolling Back..." : "Rollback"}
                helperText="Drops recent turns from Codex history. Local file changes are not reverted."
                onPress={() => {
                  void handleRollbackThread();
                }}
              />
              <PrimaryButton
                disabled={isManagingThread}
                label="Structured Review"
                onPress={() => {
                  router.push({
                    pathname: "/review/start",
                    params: {
                      threadId: thread.id,
                      delivery: "detached",
                    },
                  });
                }}
              />
              <View style={styles.actionRow}>
                <View style={styles.actionCell}>
                  <SecondaryButton
                    disabled={!thread.cwd}
                    label="Git"
                    onPress={() => {
                      openThreadWorkspaceTools("git");
                    }}
                  />
                </View>
                <View style={styles.actionCell}>
                  <SecondaryButton
                    disabled={!thread.cwd}
                    label="Tools"
                    onPress={() => {
                      openThreadWorkspaceTools("tools");
                    }}
                  />
                </View>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </ScreenShell>
  );
}

function handleNotification(
  notification: AppServerNotification,
  threadId: string,
  setThread: Dispatch<SetStateAction<AppThread | null>>,
  setActiveTurnId: Dispatch<SetStateAction<string | null>>,
  setError: Dispatch<SetStateAction<string | null>>,
  setPendingRequest: Dispatch<SetStateAction<AppServerRequest | null>>,
) {
  if ("params" in notification && "threadId" in notification.params && notification.params.threadId !== threadId) {
    return;
  }

  switch (notification.method) {
    case "thread/started":
      if (notification.params.thread.id === threadId) {
        setThread(notification.params.thread);
      }
      break;
    case "thread/name/updated":
      setThread((current) =>
        current && current.id === threadId
          ? {
              ...current,
              name: notification.params.threadName ?? current.name,
            }
          : current,
      );
      break;
    case "thread/status/changed":
      setThread((current) =>
        current && current.id === threadId
          ? {
              ...current,
              status: notification.params.status,
              updatedAt: Math.floor(Date.now() / 1000),
            }
          : current,
      );
      break;
    case "thread/tokenUsage/updated":
      setThread((current) =>
        current && current.id === threadId
          ? {
              ...current,
              tokenUsage: notification.params.tokenUsage,
            }
          : current,
      );
      break;
    case "thread/archived":
    case "thread/unarchived":
      setThread((current) =>
        current && current.id === threadId
          ? {
              ...current,
              updatedAt: Math.floor(Date.now() / 1000),
            }
          : current,
      );
      break;
    case "turn/started":
      setThread((current) =>
        current && current.id === threadId
          ? {
              ...current,
              turns: upsertTurn(current.turns, notification.params.turn),
            }
          : current,
      );
      setActiveTurnId(notification.params.turn.id);
      break;
    case "turn/completed":
      setThread((current) =>
        current && current.id === threadId
          ? {
              ...current,
              turns: upsertTurn(current.turns, notification.params.turn),
            }
          : current,
      );
      setActiveTurnId((current) => (current === notification.params.turn.id ? null : current));
      break;
    case "item/started":
    case "item/completed":
      setThread((current) => {
        if (!current || current.id !== threadId) {
          return current;
        }

        return {
          ...current,
          turns: current.turns.map((turn) =>
            turn.id === notification.params.turnId
              ? {
                  ...turn,
                  items: upsertTurnItem(turn.items, notification.params.item),
                }
              : turn,
          ),
        };
      });
      break;
    case "item/agentMessage/delta":
      setThread((current) =>
        current && current.id === threadId
          ? appendItemTextDelta(
              current,
              notification.params.turnId,
              notification.params.itemId,
              "agentMessage",
              notification.params.delta,
            )
          : current,
      );
      break;
    case "item/plan/delta":
      setThread((current) =>
        current && current.id === threadId
          ? appendItemTextDelta(
              current,
              notification.params.turnId,
              notification.params.itemId,
              "plan",
              notification.params.delta,
            )
          : current,
      );
      break;
    case "item/commandExecution/outputDelta":
      setThread((current) =>
        current && current.id === threadId
          ? appendCommandOutputDelta(
              current,
              notification.params.turnId,
              notification.params.itemId,
              notification.params.delta,
            )
          : current,
      );
      break;
    case "error":
      setError(notification.params.error.message);
      break;
    case "serverRequest/resolved":
      setPendingRequest((current) =>
        current && String(current.id) === String(notification.params.requestId) ? null : current,
      );
      break;
    default:
      break;
  }
}

function getRequestTitle(request: AppServerRequest) {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
      return "Command approval requested";
    case "item/fileChange/requestApproval":
      return "File change approval requested";
    case "item/permissions/requestApproval":
      return "Permission approval requested";
    case "item/tool/requestUserInput":
      return "Codex needs more input";
  }
}

function getRequestBody(request: AppServerRequest) {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
      return [request.params.reason, request.params.command, request.params.cwd].filter(Boolean).join("\n");
    case "item/fileChange/requestApproval":
      return [request.params.reason, request.params.grantRoot].filter(Boolean).join("\n");
    case "item/permissions/requestApproval":
      return request.params.reason ?? "The current turn is requesting additional permissions.";
    case "item/tool/requestUserInput":
      return request.params.questions.map((question) => question.question).join("\n\n");
  }
}

function getThreadStatusLabel(thread: AppThread) {
  return getAppThreadStatusLabel(thread);
}

function buildConversationMessages(thread: AppThread | null): BubbleMessage[] {
  if (!thread) {
    return [];
  }

  const messages: BubbleMessage[] = [];
  for (const [turnIndex, turn] of thread.turns.entries()) {
    const turnLabel = `Turn ${turnIndex + 1}`;

    for (const item of turn.items) {
      if (item.type === "userMessage") {
        messages.push({
          id: item.id,
          role: "user",
          content: item.content.map(summarizeUserInput).join("\n"),
          created_at: "",
          updated_at: "",
          metaLabel: turnLabel,
        });
        continue;
      }

      if (item.type === "agentMessage") {
        messages.push({
          id: item.id,
          role: "assistant",
          content: item.text,
          created_at: "",
          updated_at: "",
          metaLabel: item.phase ? `${turnLabel} · ${formatStatusLabel(item.phase)}` : turnLabel,
        });
      }
    }
  }

  return messages;
}

function buildActivityItems(thread: AppThread | null): ActivityEvent[] {
  if (!thread) {
    return [];
  }

  const events: ActivityEvent[] = [];
  let nextId = 1;

  for (const [turnIndex, turn] of thread.turns.entries()) {
    const turnLabel = `Turn ${turnIndex + 1}`;

    if (turn.error) {
      events.push({
        id: nextId++,
        event_type: "turn_error",
        content: turn.error.additionalDetails
          ? `${turn.error.message}\n${turn.error.additionalDetails}`
          : turn.error.message,
        created_at: "",
        updated_at: "",
        metaLabel: turnLabel,
      });
    }

    for (const item of turn.items) {
      if (item.type === "userMessage" || item.type === "agentMessage") {
        continue;
      }

      events.push({
        id: nextId++,
        event_type: item.type,
        content: describeThreadItem(item),
        created_at: "",
        updated_at: "",
        metaLabel: turnLabel,
      });
    }
  }

  return events;
}

function describeThreadItem(item: AppThreadItem) {
  return describeAppThreadItem(item);
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  statusCard: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: colors.cardSoft,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    color: colors.primary,
  },
  statusValue: {
    fontSize: 26,
    fontWeight: "800",
    color: colors.text,
  },
  statusMeta: {
    color: colors.textMuted,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },
  requestCard: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  composerCard: {
    borderRadius: 16,
    padding: 12,
    backgroundColor: colors.cardAccent,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  panelTabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionCell: {
    flex: 1,
  },
  requestTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
  requestBody: {
    color: colors.textMuted,
    lineHeight: 20,
  },
  requestActions: {
    gap: 10,
  },
  attachmentActions: {
    gap: 8,
  },
  attachmentList: {
    gap: 8,
  },
  attachmentItem: {
    alignItems: "center",
    backgroundColor: colors.backgroundElevated,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 8,
  },
  attachmentThumb: {
    borderRadius: 10,
    height: 52,
    width: 52,
  },
  attachmentDetails: {
    flex: 1,
    minWidth: 0,
  },
  attachmentName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
});
