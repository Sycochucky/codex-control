import { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from "react-native";

import type { ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/services/theme-context";

export function LabeledInput({
  label,
  multiline,
  ...props
}: TextInputProps & { label: string }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={styles.inputPlaceholder.color}
        multiline={multiline}
        style={[styles.input, multiline ? styles.inputMultiline : null]}
        {...props}
      />
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  helperText,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  helperText?: string;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.buttonGroup}>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.primaryButton,
          disabled ? styles.buttonDisabled : null,
          pressed && !disabled ? styles.buttonPressed : null,
        ]}
      >
        <Text style={styles.primaryButtonText}>{label}</Text>
      </Pressable>
      {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}
    </View>
  );
}

export function SecondaryButton({
  label,
  onPress,
  disabled,
  helperText,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  helperText?: string;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.buttonGroup}>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.secondaryButton,
          disabled ? styles.buttonDisabled : null,
          pressed && !disabled ? styles.buttonPressed : null,
        ]}
      >
        <Text style={styles.secondaryButtonText}>{label}</Text>
      </Pressable>
      {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}
    </View>
  );
}

export function InlineNotice({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "error" | "success";
  children: ReactNode;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <View
      style={[
        styles.notice,
        tone === "error" ? styles.noticeError : null,
        tone === "success" ? styles.noticeSuccess : null,
      ]}
    >
      <Text
        style={[
          styles.noticeText,
          tone === "error" ? styles.noticeTextError : null,
          tone === "success" ? styles.noticeTextSuccess : null,
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

export function PillButton({
  accessibilityLabel,
  accessibilityState,
  label,
  selected,
  disabled,
  onPress,
}: {
  accessibilityLabel?: string;
  accessibilityState?: { selected?: boolean; disabled?: boolean };
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState ?? { selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pillButton,
        selected ? styles.pillButtonSelected : null,
        disabled ? styles.buttonDisabled : null,
        pressed && !disabled ? styles.buttonPressed : null,
      ]}
    >
      <Text style={[styles.pillButtonText, selected ? styles.pillButtonTextSelected : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function InfoRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  field: {
    gap: 8,
  },
  buttonGroup: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.backgroundMuted,
  },
  inputPlaceholder: {
    color: colors.textSubtle,
  },
  inputMultiline: {
    minHeight: 120,
    textAlignVertical: "top",
  },
  primaryButton: {
    backgroundColor: colors.primaryStrong,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: {
    color: colors.onAccent,
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: colors.backgroundElevated,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  helperText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSubtle,
  },
  notice: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noticeError: {
    backgroundColor: colors.noticeErrorBackground,
    borderColor: colors.noticeErrorBorder,
  },
  noticeSuccess: {
    backgroundColor: colors.noticeSuccessBackground,
    borderColor: colors.noticeSuccessBorder,
  },
  noticeText: {
    color: colors.textMuted,
    lineHeight: 20,
  },
  noticeTextError: {
    color: colors.noticeErrorText,
  },
  noticeTextSuccess: {
    color: colors.noticeSuccessText,
  },
  pillButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundElevated,
  },
  pillButtonSelected: {
    backgroundColor: colors.primaryStrong,
    borderColor: colors.primaryStrong,
  },
  pillButtonText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  pillButtonTextSelected: {
    color: colors.onAccent,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  infoLabel: {
    flex: 1,
    color: colors.textSubtle,
    fontSize: 13,
  },
  infoValue: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "right",
  },
});
