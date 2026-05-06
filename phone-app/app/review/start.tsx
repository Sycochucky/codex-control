import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ScreenShell } from "@/components/screen-shell";
import { InlineNotice, LabeledInput, PillButton, PrimaryButton, SecondaryButton } from "@/components/ui";
import { colors } from "@/constants/theme";
import { withAppServerClient } from "@/services/app-server";
import { useSession } from "@/services/session-context";
import type { AppServerReviewTarget } from "@/types/app-server";
import { getFriendlyNetworkErrorMessage } from "@/utils/network";
import {
  buildReviewTargetPayload,
  getReviewDefaults,
  type ReviewDelivery,
  type ReviewTargetMode,
} from "@/utils/review-tools";

type ReviewStartParams = {
  threadId?: string;
  delivery?: string;
  targetMode?: string;
  baseBranch?: string;
  customInstructions?: string;
};

export default function ReviewStartScreen() {
  const params = useLocalSearchParams<ReviewStartParams>();
  const router = useRouter();
  const { backendUrl, isHydrated, sessionToken } = useSession();
  const defaults = useMemo(() => getReviewDefaults(params.threadId ?? ""), [params.threadId]);
  const [threadId, setThreadId] = useState(defaults.threadId);
  const [mode, setMode] = useState<ReviewTargetMode>(() => normalizeReviewTargetMode(params.targetMode, defaults.targetMode));
  const [delivery, setDelivery] = useState<ReviewDelivery>(() => normalizeReviewDelivery(params.delivery, defaults.delivery));
  const [baseBranch, setBaseBranch] = useState(params.baseBranch ?? "main");
  const [customInstructions, setCustomInstructions] = useState(params.customInstructions ?? defaults.customInstructions);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = useMemo<AppServerReviewTarget>(
    () => buildReviewTargetPayload(mode, { baseBranch, customInstructions }),
    [baseBranch, customInstructions, mode],
  );

  async function handleStartReview() {
    if (!sessionToken || !threadId.trim()) {
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const result = await withAppServerClient(backendUrl, sessionToken, async (client) => {
        return await client.startReview(threadId.trim(), target, delivery);
      });
      router.replace({
        pathname: "/thread/[id]",
        params: {
          id: delivery === "detached" ? result.reviewThreadId : threadId.trim(),
        },
      });
    } catch (reviewError) {
      setError(getFriendlyNetworkErrorMessage(reviewError, "Failed to start the review."));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isHydrated) {
    return (
      <ScreenShell title="Start Review" subtitle="Restoring secure session state.">
        <InlineNotice>Loading review controls.</InlineNotice>
      </ScreenShell>
    );
  }

  if (!sessionToken) {
    return <Redirect href="/connect" />;
  }

  return (
    <ScreenShell
      title="Start Review"
      subtitle="Launch a structured Codex review with explicit target and delivery controls."
    >
      <LabeledInput
        label="Thread ID"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setThreadId}
        placeholder="019c..."
        value={threadId}
      />
      <View style={styles.pillRow}>
        <PillButton label="Uncommitted" onPress={() => setMode("uncommitted")} selected={mode === "uncommitted"} />
        <PillButton label="Base Branch" onPress={() => setMode("baseBranch")} selected={mode === "baseBranch"} />
        <PillButton label="Custom" onPress={() => setMode("custom")} selected={mode === "custom"} />
      </View>
      {mode === "baseBranch" ? (
        <LabeledInput
          label="Base Branch"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setBaseBranch}
          value={baseBranch}
        />
      ) : null}
      {mode === "custom" ? (
        <LabeledInput
          label="Custom Instructions"
          multiline
          onChangeText={setCustomInstructions}
          value={customInstructions}
        />
      ) : null}
      <View style={styles.pillRow}>
        <PillButton label="Detached Review" onPress={() => setDelivery("detached")} selected={delivery === "detached"} />
        <PillButton label="Inline Review" onPress={() => setDelivery("inline")} selected={delivery === "inline"} />
      </View>
      <View style={styles.previewCard}>
        <Text style={styles.previewTitle}>Review Target</Text>
        <Text style={styles.previewText}>{JSON.stringify(target, null, 2)}</Text>
      </View>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <PrimaryButton
        disabled={isSubmitting || !threadId.trim()}
        label={isSubmitting ? "Starting Review..." : "Start Review"}
        onPress={() => {
          void handleStartReview();
        }}
      />
      <SecondaryButton
        label="Back To Tools"
        onPress={() => {
          router.replace("/tools");
        }}
      />
    </ScreenShell>
  );
}

function normalizeReviewTargetMode(value: string | undefined, fallback: ReviewTargetMode): ReviewTargetMode {
  return value === "uncommitted" || value === "baseBranch" || value === "custom" ? value : fallback;
}

function normalizeReviewDelivery(value: string | undefined, fallback: ReviewDelivery): ReviewDelivery {
  return value === "inline" || value === "detached" ? value : fallback;
}

const styles = StyleSheet.create({
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  previewCard: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  previewTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  previewText: {
    color: colors.textMuted,
    lineHeight: 20,
  },
});
