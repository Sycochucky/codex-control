import { StyleSheet, Text, View } from "react-native";

import type { ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/services/theme-context";
import { formatTimestamp } from "@/utils/format";

export function MessageBubble({
  message,
}: {
  message: {
    id: string | number;
    role: "user" | "assistant" | "system";
    content: string;
    created_at: string;
    updated_at: string;
    metaLabel?: string | null;
  };
}) {
  const styles = useThemedStyles(createStyles);
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const roleLabel = isUser ? "You" : isAssistant ? "Codex" : "System";
  const timestamp = formatTimestamp(message.created_at);
  const metaText = timestamp === "Unknown time" ? message.metaLabel ?? "Live thread item" : timestamp;

  return (
    <View style={[styles.container, isUser ? styles.userContainer : styles.otherContainer]}>
      <View style={styles.header}>
        <Text style={[styles.role, isUser ? styles.userRole : styles.otherRole]}>{roleLabel}</Text>
        <Text style={[styles.timestamp, isUser ? styles.userMeta : styles.otherMeta]}>
          {metaText}
        </Text>
      </View>
      <Text style={[styles.content, isUser ? styles.userContent : styles.otherContent]}>
        {message.content}
      </Text>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    borderRadius: 18,
    padding: 14,
    gap: 8,
    maxWidth: "96%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  userContainer: {
    alignSelf: "flex-end",
    backgroundColor: colors.primaryStrong,
  },
  otherContainer: {
    alignSelf: "flex-start",
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  role: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  userRole: {
    color: colors.userBubbleRole,
  },
  otherRole: {
    color: colors.primary,
  },
  content: {
    fontSize: 15,
    lineHeight: 22,
  },
  timestamp: {
    fontSize: 11,
    lineHeight: 16,
  },
  userContent: {
    color: colors.userBubbleText,
  },
  userMeta: {
    color: colors.userBubbleMeta,
  },
  otherContent: {
    color: colors.text,
  },
  otherMeta: {
    color: colors.textSubtle,
  },
});
