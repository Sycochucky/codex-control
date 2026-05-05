import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ScreenShell } from "@/components/screen-shell";
import { ThreadListItem } from "@/components/thread-list-item";
import { InlineNotice, PillButton, PrimaryButton, SecondaryButton } from "@/components/ui";
import type { ThemeColors } from "@/constants/theme";
import { useSession } from "@/services/session-context";
import { useThemedStyles } from "@/services/theme-context";
import type { AppThread } from "@/types/app-server";
import {
  getAppThreadGitLabel,
  getAppThreadPreview,
  getAppThreadSourceLabel,
  getAppThreadStatusLabel,
  getAppThreadTitle,
  getAppThreadTurnCount,
  getAppThreadWorkspace,
} from "@/utils/app-server-thread";
import { withTimeout } from "@/utils/async-timeout";
import { withWarmAppServerClient } from "@/utils/app-server-connect";
import { getFriendlyNetworkErrorMessage } from "@/utils/network";
import { buildThreadContinuationSections } from "@/utils/thread-list";
import {
  beginThreadPageRequest,
  completeThreadPageRequest,
  createThreadPagingState,
  failThreadPageRequest,
  getNextThreadPageRequest,
  getPreviousThreadPageRequest,
  getRefreshThreadPageRequest,
  THREAD_PAGE_SIZE_OPTIONS,
  type ThreadPageRequest,
  type ThreadPageSize,
} from "@/utils/thread-paging";

const THREAD_PAGE_LOAD_TIMEOUT_MS = 20000;

export function ThreadsScreen() {
  const params = useLocalSearchParams<{ view?: string }>();
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { backendUrl, isHydrated, retrySessionValidation, sessionRestoreState, sessionToken } =
    useSession();
  const requestSequence = useRef(0);
  const [paging, setPaging] = useState(() => createThreadPagingState<AppThread>());
  const [listMode, setListMode] = useState<"active" | "archived">(
    params.view === "archived" ? "archived" : "active",
  );
  const {
    items: threads,
    pageSize,
    currentPageIndex,
    nextCursor,
    isLoading,
    hasLoadedPage,
    error,
  } = paging;
  const previousPageRequest = getPreviousThreadPageRequest(paging);
  const nextPageRequest = getNextThreadPageRequest(paging);
  const refreshPageRequest = getRefreshThreadPageRequest(paging);
  const pageSizeRef = useRef(pageSize);

  useEffect(() => {
    pageSizeRef.current = pageSize;
  }, [pageSize]);

  useEffect(() => {
    setListMode(params.view === "archived" ? "archived" : "active");
  }, [params.view]);

  const continuationSections = useMemo(() => buildThreadContinuationSections(threads), [threads]);

  const loadThreadPage = useCallback(async (
    request: ThreadPageRequest = { cursor: null, pageIndex: 0 },
    nextPageSize?: ThreadPageSize,
  ) => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    const requestedPageSize = nextPageSize ?? pageSizeRef.current;

    if (!sessionToken) {
      setPaging({
        ...createThreadPagingState<AppThread>({ pageSize: requestedPageSize }),
        isLoading: false,
      });
      return;
    }

    setPaging((current) =>
      beginThreadPageRequest(current, {
        requestId,
        cursor: request.cursor,
        pageIndex: request.pageIndex,
        pageSize: nextPageSize,
      }),
    );

    try {
      const page = await withTimeout(
        withWarmAppServerClient(backendUrl, sessionToken, async (client) => {
          return await client.listThreads({
            archived: listMode === "archived",
            cursor: request.cursor,
            limit: requestedPageSize,
          });
        }),
        THREAD_PAGE_LOAD_TIMEOUT_MS,
        "Threads page load timed out while waiting for the Codex App Server.",
      );
      setPaging((current) =>
        completeThreadPageRequest(current, {
          requestId,
          cursor: request.cursor,
          pageIndex: request.pageIndex,
          items: page.data,
          nextCursor: page.nextCursor,
        }),
      );
    } catch (dashboardError) {
      setPaging((current) =>
        failThreadPageRequest(current, {
          requestId,
          error: getThreadLoadErrorMessage(dashboardError),
        }),
      );
    }
  }, [backendUrl, listMode, sessionToken]);

  useEffect(() => {
    if (!isHydrated || !sessionToken) {
      return;
    }

    void loadThreadPage({ cursor: null, pageIndex: 0 });
  }, [isHydrated, loadThreadPage, sessionToken]);

  if (!isHydrated) {
    return (
      <ScreenShell title="Threads" subtitle="Restoring secure session state.">
        <InlineNotice>Loading thread access.</InlineNotice>
      </ScreenShell>
    );
  }

  if (!sessionToken) {
    return <Redirect href="/connect" />;
  }

  return (
    <ScreenShell
      title="Threads"
      subtitle="Official Codex App Server build. Review recent threads, live workload buckets, and token usage from the desktop bridge."
    >
      {sessionRestoreState === "reconnecting" ? (
        <>
          <InlineNotice tone="error">
            The backend is currently unreachable. Your saved session is still present and can be
            revalidated when the desktop server is back online.
          </InlineNotice>
          <PrimaryButton label="Retry Session Validation" onPress={retrySessionValidation} />
        </>
      ) : null}
      <View style={styles.actionRow}>
        <View style={styles.actionCell}>
          <PrimaryButton label="New Thread" onPress={() => router.push("/new-thread")} />
        </View>
        <View style={styles.actionCell}>
          <SecondaryButton
            disabled={isLoading}
            label={isLoading ? "Refreshing..." : "Refresh"}
            onPress={() => {
              void loadThreadPage(refreshPageRequest);
            }}
          />
        </View>
      </View>
      <View style={styles.modeRow}>
        <PillButton
          disabled={isLoading}
          label="Active"
          selected={listMode === "active"}
          onPress={() => setListMode("active")}
        />
        <PillButton
          disabled={isLoading}
          label="Archived"
          selected={listMode === "archived"}
          onPress={() => setListMode("archived")}
        />
      </View>
      <InlineNotice>
        Page {currentPageIndex + 1} | Showing {threads.length} of up to {pageSize} |{" "}
        {hasLoadedPage ? (nextCursor ? "More pages available" : "End of list") : "Waiting for first page"}
      </InlineNotice>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {isLoading ? (
        <InlineNotice>
          {threads.length || hasLoadedPage
            ? "Refreshing page..."
            : "Loading the first page from the desktop App Server bridge."}
        </InlineNotice>
      ) : null}
      {!error && !threads.length && !isLoading ? (
        <InlineNotice>
          {listMode === "archived"
            ? "No archived Codex threads are available yet."
            : "No active threads yet. Create one from the New Thread screen."}
        </InlineNotice>
      ) : null}
      {continuationSections.length ? (
        <View style={styles.continueBlock}>
          <View style={styles.sectionHeading}>
            <Text style={styles.groupTitle}>Current Threads</Text>
            <Text style={styles.sectionHint}>Tap a thread to continue it from this phone.</Text>
          </View>
          {continuationSections.map((group) => (
            <View key={group.key} style={styles.groupSection}>
              <Text style={styles.groupSubtitle}>
                {group.title} ({group.items.length})
              </Text>
              {group.items.map((thread) => (
                <ThreadListItem
                  key={thread.id}
                  onPress={() =>
                    router.push({
                      pathname: "/thread/[id]",
                      params: { id: thread.id, view: listMode },
                    })
                  }
                  metadata={buildThreadMetadata(thread)}
                  preview={getAppThreadPreview(thread)}
                  status={getAppThreadStatusLabel(thread)}
                  title={getAppThreadTitle(thread)}
                  updatedAt={new Date(thread.updatedAt * 1000).toISOString()}
                />
              ))}
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.pagerCard}>
        <View style={styles.actionRow}>
          <View style={styles.actionCell}>
            <SecondaryButton
              disabled={isLoading || !previousPageRequest}
              label="Previous"
              onPress={() => {
                if (previousPageRequest) {
                  void loadThreadPage(previousPageRequest);
                }
              }}
            />
          </View>
          <View style={styles.actionCell}>
            <SecondaryButton
              disabled={isLoading || !nextPageRequest}
              label="Next"
              onPress={() => {
                if (nextPageRequest) {
                  void loadThreadPage(nextPageRequest);
                }
              }}
            />
          </View>
        </View>
        <View style={styles.pageToolbar}>
          <Text style={styles.pageLabel}>Per page</Text>
          <View style={styles.pageSizeRow}>
            {THREAD_PAGE_SIZE_OPTIONS.map((option) => (
              <PillButton
                key={option}
                label={String(option)}
                selected={pageSize === option}
                disabled={isLoading}
                onPress={() => {
                  void loadThreadPage({ cursor: null, pageIndex: 0 }, option);
                }}
              />
            ))}
          </View>
        </View>
      </View>
    </ScreenShell>
  );
}

function buildThreadMetadata(thread: AppThread) {
  const parts = [
    getAppThreadSourceLabel(thread),
    thread.modelProvider,
    getAppThreadWorkspace(thread),
    getAppThreadGitLabel(thread),
    `${getAppThreadTurnCount(thread)} turn${getAppThreadTurnCount(thread) === 1 ? "" : "s"}`,
  ];

  if (thread.tokenUsage) {
    parts.push(`${thread.tokenUsage.total.totalTokens} tokens`);
  }

  return parts.join(" | ");
}

function getThreadLoadErrorMessage(error: unknown) {
  const message = getFriendlyNetworkErrorMessage(error, "Failed to load threads.");
  const lowered = message.toLowerCase();

  if (lowered.includes("connection timed out")) {
    return "Timed out connecting to the Codex App Server. Check the desktop server and tap Refresh.";
  }

  if (lowered.includes("timed out while waiting for initialize")) {
    return "Codex App Server is still starting on the desktop. Wait a moment and tap Refresh.";
  }

  return message;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionCell: {
    flex: 1,
  },
  pageToolbar: {
    gap: 10,
  },
  modeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pagerCard: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  pageLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
  },
  pageSizeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  continueBlock: {
    gap: 12,
  },
  sectionHeading: {
    gap: 3,
  },
  sectionHint: {
    color: colors.textSubtle,
  },
  groupSection: {
    gap: 10,
  },
  groupTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
  },
  groupSubtitle: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textMuted,
    textTransform: "uppercase",
  },
});
