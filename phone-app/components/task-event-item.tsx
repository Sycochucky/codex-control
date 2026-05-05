import { StyleSheet, Text, View } from "react-native";

import { colors } from "@/constants/theme";
import type { TaskEventRead } from "@/types/api";
import { formatStatusLabel, formatTimestamp } from "@/utils/format";

export function TaskEventItem({
  event,
}: {
  event: TaskEventRead & { metaLabel?: string | null };
}) {
  const timestamp = formatTimestamp(event.created_at);
  const metaText = timestamp === "Unknown time" ? event.metaLabel ?? null : timestamp;

  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <Text style={styles.type}>{formatStatusLabel(event.event_type)}</Text>
        {metaText ? <Text style={styles.timestamp}>{metaText}</Text> : null}
      </View>
      <Text style={styles.content}>{event.content}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    paddingLeft: 12,
    gap: 4,
    paddingVertical: 4,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  type: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    color: colors.primary,
  },
  content: {
    color: colors.textMuted,
    lineHeight: 20,
  },
  timestamp: {
    fontSize: 11,
    color: colors.textSubtle,
  },
});
