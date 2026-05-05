import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { RuntimeControls } from "@/components/runtime-controls";
import { ScreenShell } from "@/components/screen-shell";
import { InlineNotice, LabeledInput, PillButton, PrimaryButton, SecondaryButton } from "@/components/ui";
import { themePresets, type ThemeColors } from "@/constants/theme";
import { getAppServerStatus, logout as logoutRequest } from "@/services/api";
import { withAppServerClient } from "@/services/app-server";
import { useRuntimeDefaults } from "@/services/runtime-defaults-context";
import { useSession } from "@/services/session-context";
import { useTheme, useThemedStyles } from "@/services/theme-context";
import type { AppServerModel } from "@/types/app-server";
import { withTimeout } from "@/utils/async-timeout";
import { getFriendlyNetworkErrorMessage, isValidBackendUrl } from "@/utils/network";
import {
  buildDesktopModelConfigWrite,
  normalizeRuntimeDefaults,
  resolveRuntimeSelection,
  type RuntimeDefaults,
} from "@/utils/runtime-defaults";

const COMMAND_CENTER_LOAD_TIMEOUT_MS = 20000;

export function SettingsScreen() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { themePresetId, setThemePresetId, themeSaveError } = useTheme();
  const {
    backendUrl,
    sharedToken,
    isHydrated,
    logout,
    retrySessionValidation,
    sessionRestoreState,
    sessionToken,
    setBackendUrl,
    setSharedToken,
  } = useSession();
  const { runtimeDefaults, isRuntimeDefaultsHydrated, setRuntimeDefaults } = useRuntimeDefaults();
  const [draftBackendUrl, setDraftBackendUrl] = useState(backendUrl);
  const [draftSharedToken, setDraftSharedToken] = useState(sharedToken);
  const [runtimeDraft, setRuntimeDraft] = useState<RuntimeDefaults>(runtimeDefaults);
  const [models, setModels] = useState<AppServerModel[]>([]);
  const [showHiddenModels, setShowHiddenModels] = useState(false);
  const [statusSummary, setStatusSummary] = useState<string | null>(null);
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [accountSummary, setAccountSummary] = useState<string | null>(null);
  const [rateLimitSummary, setRateLimitSummary] = useState<string | null>(null);
  const [configSummary, setConfigSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingCommandCenter, setIsLoadingCommandCenter] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingRuntime, setIsSavingRuntime] = useState(false);
  const [isApplyingDesktopConfig, setIsApplyingDesktopConfig] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const commandCenterRequestIdRef = useRef(0);

  const runtimeSelection = resolveRuntimeSelection({ saved: runtimeDraft, models });

  useEffect(() => {
    setDraftBackendUrl(backendUrl);
  }, [backendUrl]);

  useEffect(() => {
    setDraftSharedToken(sharedToken);
  }, [sharedToken]);

  useEffect(() => {
    if (isRuntimeDefaultsHydrated) {
      setRuntimeDraft(runtimeDefaults);
    }
  }, [isRuntimeDefaultsHydrated, runtimeDefaults]);

  const refreshStatus = useCallback(async () => {
    if (!sessionToken) {
      setStatusSummary(null);
      setStatusDetail(null);
      return;
    }

    try {
      setIsRefreshing(true);
      setError(null);
      const status = await getAppServerStatus(backendUrl, sessionToken);
      setStatusSummary(
        status.ready
          ? `App Server ready on ${status.listen_url}`
          : `Backend reachable on ${status.listen_url}, App Server still starting`,
      );
      setStatusDetail(
        `Workspace root: ${status.workspace_root} | Model: ${status.model} | PID: ${status.pid ?? "Not started"}`,
      );
    } catch (statusError) {
      setStatusSummary(null);
      setStatusDetail(null);
      setError(getFriendlyNetworkErrorMessage(statusError, "Failed to load App Server status."));
    } finally {
      setIsRefreshing(false);
    }
  }, [backendUrl, sessionToken]);

  const loadCommandCenter = useCallback(async () => {
    if (!sessionToken) {
      setModels([]);
      setAccountSummary(null);
      setRateLimitSummary(null);
      setConfigSummary(null);
      return;
    }

    const requestId = commandCenterRequestIdRef.current + 1;
    commandCenterRequestIdRef.current = requestId;

    try {
      setIsLoadingCommandCenter(true);
      setError(null);
      const result = await withTimeout(
        withAppServerClient(backendUrl, sessionToken, async (client) => {
          const [modelsResponse, account, rateLimits, config] = await Promise.all([
            client.listModels({ includeHidden: showHiddenModels }),
            client.getAccount(true),
            client.getAccountRateLimits(),
            client.readConfig(),
          ]);
          return { modelsResponse, account, rateLimits, config };
        }),
        COMMAND_CENTER_LOAD_TIMEOUT_MS,
        "Command center load timed out while waiting for the Codex App Server.",
      );

      if (requestId !== commandCenterRequestIdRef.current) {
        return;
      }

      setModels(result.modelsResponse.data);
      setAccountSummary(
        result.account.account
          ? result.account.account.type === "chatgpt"
            ? `ChatGPT: ${result.account.account.email} (${result.account.account.planType})`
            : "API key account"
          : result.account.requiresOpenaiAuth
            ? "Account login required"
            : "No account details returned",
      );
      setRateLimitSummary(formatRateLimits(result.rateLimits.rateLimits));
      setConfigSummary(formatConfigSummary(result.config.config));
    } catch (loadError) {
      if (requestId !== commandCenterRequestIdRef.current) {
        return;
      }

      setError(getFriendlyNetworkErrorMessage(loadError, "Failed to load command center data."));
    } finally {
      if (requestId === commandCenterRequestIdRef.current) {
        setIsLoadingCommandCenter(false);
      }
    }
  }, [backendUrl, sessionToken, showHiddenModels]);

  useFocusEffect(
    useCallback(() => {
      void refreshStatus();
      void loadCommandCenter();
    }, [loadCommandCenter, refreshStatus]),
  );

  async function handleSaveConnection() {
    const nextBackendUrl = draftBackendUrl.trim();
    const nextSharedToken = draftSharedToken.trim();

    if (!nextBackendUrl || !isValidBackendUrl(nextBackendUrl)) {
      setError("Enter a full backend URL starting with http:// or https://.");
      return;
    }

    if (!nextSharedToken) {
      setError("Enter the shared token configured on the desktop server.");
      return;
    }

    try {
      setIsSaving(true);
      setError(null);
      setNotice(null);

      const connectionChanged = nextBackendUrl !== backendUrl || nextSharedToken !== sharedToken;
      setBackendUrl(nextBackendUrl);
      setSharedToken(nextSharedToken);

      if (connectionChanged) {
        setNotice("Connection settings saved. Reconnect with the updated gateway details.");
        router.replace("/connect");
        return;
      }

      setNotice("Connection settings are already up to date.");
      await refreshStatus();
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLogout() {
    if (!sessionToken) {
      return;
    }

    try {
      setIsSigningOut(true);
      setError(null);
      await logoutRequest(backendUrl, sessionToken).catch(() => undefined);
      logout();
      router.replace("/connect");
    } finally {
      setIsSigningOut(false);
    }
  }

  function handleSavePhoneDefaults() {
    try {
      setIsSavingRuntime(true);
      setError(null);
      setNotice(null);
      setRuntimeDefaults(
        normalizeRuntimeDefaults({
          model: runtimeSelection.model,
          reasoningEffort: runtimeSelection.reasoningEffort,
          approvalPolicy: runtimeSelection.approvalPolicy,
          sandbox: runtimeSelection.sandbox,
          serviceTier: runtimeSelection.serviceTier,
        }),
      );
      setNotice("Phone runtime defaults saved. New threads will use these settings.");
    } finally {
      setIsSavingRuntime(false);
    }
  }

  function confirmApplyDesktopConfig() {
    const payload = buildDesktopModelConfigWrite(
      normalizeRuntimeDefaults({
        model: runtimeSelection.model,
        reasoningEffort: runtimeSelection.reasoningEffort,
        approvalPolicy: runtimeSelection.approvalPolicy,
        sandbox: runtimeSelection.sandbox,
        serviceTier: runtimeSelection.serviceTier,
      }),
      true,
    );

    if (!payload) {
      setError("Choose a model before applying desktop Codex config.");
      return;
    }

    Alert.alert(
      "Apply desktop model config?",
      `This writes model=${runtimeSelection.model} and reasoning_effort=${runtimeSelection.reasoningEffort ?? "default"} to desktop Codex config.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Apply",
          style: "destructive",
          onPress: () => {
            void applyDesktopConfig(payload);
          },
        },
      ],
    );
  }

  async function applyDesktopConfig(payload: NonNullable<ReturnType<typeof buildDesktopModelConfigWrite>>) {
    if (!sessionToken) {
      return;
    }

    try {
      setIsApplyingDesktopConfig(true);
      setError(null);
      setNotice(null);
      await withAppServerClient(backendUrl, sessionToken, async (client) => {
        await client.writeConfigBatch(payload);
      });
      setNotice("Desktop Codex model config updated and reloaded.");
      await loadCommandCenter();
    } catch (configError) {
      setError(getFriendlyNetworkErrorMessage(configError, "Failed to update desktop Codex config."));
    } finally {
      setIsApplyingDesktopConfig(false);
    }
  }

  if (!isHydrated || !isRuntimeDefaultsHydrated) {
    return (
      <ScreenShell title="Settings" subtitle="Restoring secure session state.">
        <InlineNotice>Loading saved connection settings.</InlineNotice>
      </ScreenShell>
    );
  }

  if (!sessionToken) {
    router.replace("/connect");
    return null;
  }

  return (
    <ScreenShell
      title="Settings"
      subtitle="Manage the local Codex gateway connection for the official phone companion."
    >
      {sessionRestoreState === "reconnecting" ? (
        <>
          <InlineNotice tone="error">
            The phone app kept your saved session, but the desktop backend is currently unreachable.
          </InlineNotice>
          <PrimaryButton label="Retry Session Validation" onPress={retrySessionValidation} />
        </>
      ) : null}
      {statusSummary ? <InlineNotice tone="success">{statusSummary}</InlineNotice> : null}
      {statusDetail ? <Text style={styles.meta}>{statusDetail}</Text> : null}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <Text style={styles.meta}>
          Theme presets are saved on this phone only. Desktop theme sync is not available in the current repo.
        </Text>
        <View style={styles.pillRow}>
          {Object.values(themePresets).map((preset) => (
            <PillButton
              key={preset.id}
              accessibilityLabel={`${preset.name} theme`}
              accessibilityState={{ selected: themePresetId === preset.id }}
              label={preset.name}
              selected={themePresetId === preset.id}
              onPress={() => setThemePresetId(preset.id)}
            />
          ))}
        </View>
        <Text style={styles.meta}>{themePresets[themePresetId].description}</Text>
        {themeSaveError ? <InlineNotice tone="error">{themeSaveError}</InlineNotice> : null}
      </View>
      <RuntimeControls
        title="Runtime Defaults"
        disabled={isLoadingCommandCenter || isSavingRuntime || isApplyingDesktopConfig}
        models={models}
        showHiddenModels={showHiddenModels}
        value={runtimeDraft}
        onChange={setRuntimeDraft}
        onShowHiddenModelsChange={setShowHiddenModels}
      />
      <View style={styles.actionRow}>
        <View style={styles.actionCell}>
          <PrimaryButton
            disabled={isSavingRuntime || isLoadingCommandCenter}
            label={isSavingRuntime ? "Saving..." : "Save Phone Defaults"}
            onPress={handleSavePhoneDefaults}
          />
        </View>
        <View style={styles.actionCell}>
          <SecondaryButton
            disabled={isApplyingDesktopConfig || isLoadingCommandCenter || !runtimeSelection.model}
            label={isApplyingDesktopConfig ? "Applying..." : "Apply Model To Desktop Config"}
            helperText="Writes only model and reasoning effort after confirmation."
            onPress={confirmApplyDesktopConfig}
          />
        </View>
      </View>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Desktop Codex</Text>
        <Text style={styles.meta}>Account: {accountSummary ?? "Loading..."}</Text>
        <Text style={styles.meta}>Rate limits: {rateLimitSummary ?? "Loading..."}</Text>
        <Text style={styles.meta}>Config: {configSummary ?? "Loading..."}</Text>
        <SecondaryButton
          disabled={isLoadingCommandCenter}
          label={isLoadingCommandCenter ? "Refreshing..." : "Refresh Command Center"}
          onPress={() => {
            void loadCommandCenter();
          }}
        />
      </View>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Connection</Text>
        <LabeledInput
          label="Backend URL"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setDraftBackendUrl}
          value={draftBackendUrl}
        />
        <LabeledInput
          label="Shared Token"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setDraftSharedToken}
          secureTextEntry
          value={draftSharedToken}
        />
        <Text style={styles.meta}>
          Saving a different backend URL or shared token ends the current session and sends you
          back to Connect.
        </Text>
        <PrimaryButton
          disabled={isSaving || !draftBackendUrl.trim() || !draftSharedToken.trim()}
          label={isSaving ? "Saving..." : "Save Connection"}
          onPress={() => {
            void handleSaveConnection();
          }}
        />
        <SecondaryButton
          disabled={isRefreshing}
          label={isRefreshing ? "Refreshing..." : "Refresh Status"}
          onPress={() => {
            void refreshStatus();
          }}
        />
      </View>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Session</Text>
        <Text style={styles.meta}>Restore state: {sessionRestoreState}</Text>
        <Text style={styles.meta}>Gateway URL: {backendUrl}</Text>
        <SecondaryButton label="Open Threads" onPress={() => router.push("/threads")} />
        <SecondaryButton
          disabled={isSigningOut}
          label={isSigningOut ? "Signing Out..." : "Sign Out"}
          onPress={() => {
            void handleLogout();
          }}
        />
      </View>
      {notice ? <InlineNotice>{notice}</InlineNotice> : null}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </ScreenShell>
  );
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
    lineHeight: 20,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionCell: {
    flex: 1,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
});

function formatRateLimits(rateLimits: { primary?: { usedPercent?: number | null } | null; secondary?: { usedPercent?: number | null } | null } | null) {
  if (!rateLimits) {
    return "Not returned";
  }

  const primary = typeof rateLimits.primary?.usedPercent === "number" ? `${rateLimits.primary.usedPercent}% primary` : "primary unknown";
  const secondary = typeof rateLimits.secondary?.usedPercent === "number" ? `${rateLimits.secondary.usedPercent}% secondary` : "secondary unknown";
  return `${primary} | ${secondary}`;
}

function formatConfigSummary(config: Record<string, unknown>) {
  const model = typeof config.model === "string" ? config.model : "default";
  const reasoning = typeof config.reasoning_effort === "string" ? config.reasoning_effort : "default";
  const keys = Object.keys(config).length;
  return `model=${model} | reasoning=${reasoning} | ${keys} loaded keys`;
}
