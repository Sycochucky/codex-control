import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/services/theme-context";
import { formatStatusLabel, formatTimestamp } from "@/utils/format";

export function ThreadListItem({
  metadata,
  preview,
  status,
  title,
  updatedAt,
  onPress,
}: {
  metadata: string;
  title: string;
  preview: string | null;
  status: string;
  updatedAt: string;
  onPress: () => void;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}>
      <View style={styles.header}>
        <Text numberOfLines={2} style={styles.title}>
          {title}
        </Text>
        <View style={styles.statusBadge}>
          <Text numberOfLines={1} style={styles.status}>
            {formatStatusLabel(status)}
          </Text>
        </View>
      </View>
      <Text numberOfLines={2} style={styles.metadata}>
        {metadata}
      </Text>
      <Text numberOfLines={2} style={styles.preview}>
        {preview ?? "No messages yet. Open the thread to continue."}
      </Text>
      <Text numberOfLines={1} style={styles.meta}>
        Updated {formatTimestamp(updatedAt)}
      </Text>
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: colors.cardSoft,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.85,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.cardAccent,
    borderWidth: 1,
    borderColor: colors.border,
  },
  status: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.primary,
    textTransform: "uppercase",
  },
  metadata: {
    fontSize: 12,
    color: colors.textSubtle,
    textTransform: "capitalize",
  },
  preview: {
    color: colors.textMuted,
    lineHeight: 20,
  },
  meta: {
    fontSize: 12,
    color: colors.textSubtle,
  },
});
