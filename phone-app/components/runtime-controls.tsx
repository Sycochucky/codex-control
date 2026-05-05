import { StyleSheet, Text, View } from "react-native";

import { InlineNotice, PillButton, SecondaryButton } from "@/components/ui";
import type { ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/services/theme-context";
import type { AppServerModel } from "@/types/app-server";
import {
  DEFAULT_RUNTIME_DEFAULTS,
  RUNTIME_APPROVAL_POLICIES,
  RUNTIME_SANDBOX_MODES,
  RUNTIME_SERVICE_TIERS,
  getVisibleModels,
  normalizeRuntimeDefaults,
  resolveRuntimeSelection,
  type RuntimeApprovalPolicy,
  type RuntimeDefaults,
  type RuntimeReasoningEffort,
  type RuntimeSandboxMode,
  type RuntimeServiceTier,
} from "@/utils/runtime-defaults";

type RuntimeControlsProps = {
  title?: string;
  models: AppServerModel[];
  value: RuntimeDefaults;
  showHiddenModels: boolean;
  disabled?: boolean;
  onChange: (value: RuntimeDefaults) => void;
  onShowHiddenModelsChange: (value: boolean) => void;
};

export function RuntimeControls({
  title = "Runtime Defaults",
  models,
  value,
  showHiddenModels,
  disabled,
  onChange,
  onShowHiddenModelsChange,
}: RuntimeControlsProps) {
  const styles = useThemedStyles(createStyles);
  const selection = resolveRuntimeSelection({ saved: value, models });
  const visibleModels = getVisibleModels(models, showHiddenModels);

  function patch(next: Partial<RuntimeDefaults>) {
    onChange(normalizeRuntimeDefaults({ ...value, ...next }));
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.meta}>
            {selection.selectedModel
              ? `${selection.selectedModel.displayName} | ${selection.reasoningEffort ?? "default effort"}`
              : "Model list is still loading."}
          </Text>
        </View>
        <SecondaryButton
          disabled={disabled || !models.length}
          label={showHiddenModels ? "Hide Hidden" : "Show Hidden"}
          onPress={() => onShowHiddenModelsChange(!showHiddenModels)}
        />
      </View>

      {!models.length ? <InlineNotice>Load models from the desktop App Server to enable model presets.</InlineNotice> : null}

      {visibleModels.length ? (
        <>
          <Text style={styles.label}>Model</Text>
          <View style={styles.pillRow}>
            {visibleModels.map((model) => (
              <PillButton
                key={model.id || model.model}
                disabled={disabled}
                label={model.displayName || model.model}
                selected={selection.model === model.model}
                onPress={() => {
                  patch({ model: model.model, reasoningEffort: null });
                }}
              />
            ))}
          </View>
        </>
      ) : null}

      {selection.supportedReasoningEfforts.length ? (
        <>
          <Text style={styles.label}>Reasoning Effort</Text>
          <View style={styles.pillRow}>
            {selection.supportedReasoningEfforts.map((effort) => (
              <PillButton
                key={effort}
                disabled={disabled}
                label={effort}
                selected={selection.reasoningEffort === effort}
                onPress={() => patch({ reasoningEffort: effort as RuntimeReasoningEffort })}
              />
            ))}
          </View>
        </>
      ) : null}

      <Text style={styles.label}>Approval Policy</Text>
      <View style={styles.pillRow}>
        {RUNTIME_APPROVAL_POLICIES.map((policy) => (
          <PillButton
            key={policy}
            disabled={disabled}
            label={policy}
            selected={selection.approvalPolicy === policy}
            onPress={() => patch({ approvalPolicy: policy as RuntimeApprovalPolicy })}
          />
        ))}
      </View>

      <Text style={styles.label}>Sandbox</Text>
      <View style={styles.pillRow}>
        {RUNTIME_SANDBOX_MODES.map((sandbox) => (
          <PillButton
            key={sandbox}
            disabled={disabled}
            label={sandbox}
            selected={selection.sandbox === sandbox}
            onPress={() => patch({ sandbox: sandbox as RuntimeSandboxMode })}
          />
        ))}
      </View>

      <Text style={styles.label}>Service Tier</Text>
      <View style={styles.pillRow}>
        <PillButton
          disabled={disabled}
          label="default"
          selected={selection.serviceTier === null}
          onPress={() => patch({ serviceTier: null })}
        />
        {RUNTIME_SERVICE_TIERS.map((tier) => (
          <PillButton
            key={tier}
            disabled={disabled}
            label={tier}
            selected={selection.serviceTier === tier}
            onPress={() => patch({ serviceTier: tier as RuntimeServiceTier })}
          />
        ))}
      </View>

      <SecondaryButton
        disabled={disabled}
        label="Reset Runtime Controls"
        onPress={() => onChange(DEFAULT_RUNTIME_DEFAULTS)}
      />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: colors.cardSoft,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerRow: {
    gap: 10,
  },
  headerCopy: {
    gap: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
  },
  label: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  meta: {
    color: colors.textMuted,
    lineHeight: 20,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
});
