import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Alert, LayoutChangeEvent, StyleSheet, Text, View } from "react-native";

import { ScreenShell } from "@/components/screen-shell";
import {
  InlineNotice,
  LabeledInput,
  PillButton,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui";
import { colors } from "@/constants/theme";
import { getAppServerStatus } from "@/services/api";
import { AppServerClient, withAppServerClient } from "@/services/app-server";
import { useSession } from "@/services/session-context";
import type {
  AppServerAppsListResponse,
  AppServerConfigReadResponse,
  AppServerConfigRequirementsResponse,
  AppServerExperimentalFeatureListResponse,
  AppServerMcpServerStatusResponse,
  AppServerNotification,
  AppServerPluginListResponse,
  AppServerSkillsListResponse,
} from "@/types/app-server";
import { resolveWorkspaceTarget } from "@/utils/workspace-target";
import {
  appendTerminalDelta,
  encodeTerminalInput,
  type TerminalConnectionState,
} from "@/utils/app-server-terminal";
import { parseShellCommand } from "@/utils/app-server-command";
import { withTimeout } from "@/utils/async-timeout";
import { getFriendlyNetworkErrorMessage } from "@/utils/network";
import {
  getCommandCenterModeTabs,
  getToolsModeTabs,
  partitionPluginsByInstallState,
  type CommandCenterMode,
  type ToolsMode as WorkbenchMode,
} from "@/utils/review-tools";
import { requiresConfirmedCommandCenterAction } from "@/utils/runtime-defaults";

type ToolsMode = WorkbenchMode | CommandCenterMode;
type ToolsGroup = "workbench" | "command-center";

type SurfaceState = {
  apps?: AppServerAppsListResponse;
  skills?: AppServerSkillsListResponse;
  plugins?: AppServerPluginListResponse;
  mcp?: AppServerMcpServerStatusResponse;
  config?: {
    config: AppServerConfigReadResponse;
    requirements: AppServerConfigRequirementsResponse;
  };
  experiments?: AppServerExperimentalFeatureListResponse;
};

const COMMAND_CENTER_SURFACE_TIMEOUT_MS = 20000;

export function ToolsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ cwd?: string; label?: string; threadId?: string }>();
  const {
    backendUrl,
    selectedSourceThreadId,
    selectedWorkspaceLabel,
    selectedWorkspacePath,
    isHydrated,
    retrySessionValidation,
    sessionRestoreState,
    sessionToken,
  } = useSession();
  const [backendWorkspaceRoot, setBackendWorkspaceRoot] = useState<string | null>(null);
  const [toolsGroup, setToolsGroup] = useState<ToolsGroup>("workbench");
  const [mode, setMode] = useState<ToolsMode>("terminal");
  const [surfaceState, setSurfaceState] = useState<SurfaceState>({});
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [surfaceNotice, setSurfaceNotice] = useState<string | null>(null);
  const [isLoadingSurface, setIsLoadingSurface] = useState(false);
  const [terminalCommand, setTerminalCommand] = useState("cmd /k");
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalOutput, setTerminalOutput] = useState("");
  const [terminalState, setTerminalState] =
    useState<TerminalConnectionState>("idle");
  const [terminalProcessId, setTerminalProcessId] = useState<string | null>(null);
  const [terminalExitCode, setTerminalExitCode] = useState<number | null>(null);
  const [reviewThreadId, setReviewThreadId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    Array<{ path: string; score: number }>
  >([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terminalSize, setTerminalSize] = useState({ rows: 24, cols: 80 });
  const clientRef = useRef<AppServerClient | null>(null);
  const surfaceRequestIdRef = useRef(0);

  const routeWorkspacePath = typeof params.cwd === "string" ? params.cwd : null;
  const routeWorkspaceLabel = typeof params.label === "string" ? params.label : null;
  const routeWorkspaceThreadId = typeof params.threadId === "string" ? params.threadId : null;

  const workspaceTarget = resolveWorkspaceTarget({
    routePath: routeWorkspacePath,
    routeLabel: routeWorkspaceLabel,
    routeThreadId: routeWorkspaceThreadId,
    selectedPath: selectedWorkspacePath,
    selectedLabel: selectedWorkspaceLabel,
    selectedSourceThreadId,
    fallbackPath: backendWorkspaceRoot,
    fallbackLabel: backendWorkspaceRoot ? "Backend default workspace" : null,
  });
  const workspaceRoot = workspaceTarget.path ?? backendWorkspaceRoot;

  const workspaceSourceText =
    workspaceTarget.source === "route"
      ? "Selected by route"
      : workspaceTarget.source === "selected"
        ? "Selected in workspace hub"
        : "Backend default";

  useEffect(() => {
    if (routeWorkspaceThreadId) {
      setReviewThreadId(routeWorkspaceThreadId);
      return;
    }

    if (selectedSourceThreadId && !reviewThreadId) {
      setReviewThreadId(selectedSourceThreadId);
    }
  }, [reviewThreadId, routeWorkspaceThreadId, selectedSourceThreadId]);

  useEffect(() => {
    let isActive = true;

    async function connectTerminalClient() {
      if (!sessionToken || mode !== "terminal") {
        return;
      }

      const client = new AppServerClient(backendUrl, sessionToken, (notification) => {
        if (!isActive) {
          return;
        }
        handleTerminalNotification(notification, setTerminalOutput, setTerminalProcessId);
      });

      try {
        await client.connect();
        if (!isActive) {
          await client.close();
          return;
        }
        clientRef.current = client;
      } catch (connectError) {
        if (isActive) {
          setError(
            getFriendlyNetworkErrorMessage(
              connectError,
              "Failed to connect terminal controls to the Codex App Server.",
            ),
          );
        }
      }
    }

    void connectTerminalClient();

    return () => {
      isActive = false;
      const client = clientRef.current;
      clientRef.current = null;
      if (client) {
        void client.close();
      }
    };
  }, [backendUrl, mode, sessionToken]);

  useFocusEffect(
    useCallback(() => {
      if (!sessionToken) {
        return;
      }

      void (async () => {
        try {
          const status = await getAppServerStatus(backendUrl, sessionToken);
          setBackendWorkspaceRoot(status.workspace_root);
        } catch {
          // Best effort only.
        }
      })();
    }, [backendUrl, sessionToken]),
  );

  const loadCommandCenterSurface = useCallback(async (targetMode: ToolsMode = mode) => {
    if (!sessionToken || !isCommandCenterMode(targetMode)) {
      return;
    }

    const requestId = surfaceRequestIdRef.current + 1;
    surfaceRequestIdRef.current = requestId;

    try {
      setIsLoadingSurface(true);
      setSurfaceError(null);
      const result = await withTimeout(
        withAppServerClient(backendUrl, sessionToken, async (client) => {
          switch (targetMode) {
            case "apps":
              return { mode: targetMode, data: await client.listApps({ limit: 50, forceRefetch: false }) };
            case "skills":
              return {
                mode: targetMode,
                data: await client.listSkills({
                  cwds: workspaceRoot ? [workspaceRoot] : undefined,
                  forceReload: false,
                }),
              };
            case "plugins":
              return {
                mode: targetMode,
                data: await client.listPlugins({ cwds: workspaceRoot ? [workspaceRoot] : null }),
              };
            case "mcp":
              return { mode: targetMode, data: await client.listMcpServerStatus({ limit: 50 }) };
            case "config":
              return {
                mode: targetMode,
                data: {
                  config: await client.readConfig({ cwd: workspaceRoot }),
                  requirements: await client.readConfigRequirements(),
                },
              };
            case "experiments":
              return { mode: targetMode, data: await client.listExperimentalFeatures({ limit: 50 }) };
            default:
              throw new Error("Unsupported command center mode.");
          }
        }),
        COMMAND_CENTER_SURFACE_TIMEOUT_MS,
        "Command center surface load timed out while waiting for the Codex App Server.",
      );

      if (requestId !== surfaceRequestIdRef.current) {
        return;
      }

      setSurfaceState((current) => ({
        ...current,
        [result.mode]: result.data,
      }));
    } catch (loadError) {
      if (requestId !== surfaceRequestIdRef.current) {
        return;
      }

      setSurfaceError(getFriendlyNetworkErrorMessage(loadError, "Failed to load command center surface."));
    } finally {
      if (requestId === surfaceRequestIdRef.current) {
        setIsLoadingSurface(false);
      }
    }
  }, [backendUrl, mode, sessionToken, workspaceRoot]);

  useEffect(() => {
    if (!sessionToken || !isCommandCenterMode(mode)) {
      return;
    }

    void loadCommandCenterSurface(mode);
  }, [loadCommandCenterSurface, mode, sessionToken]);

  async function startTerminal() {
    const client = clientRef.current;
    if (!client || !terminalCommand.trim() || !workspaceRoot) {
      return;
    }

    try {
      setIsBusy(true);
      setError(null);
      setTerminalState("starting");
      setTerminalOutput("");
      setTerminalExitCode(null);
      setTerminalProcessId(null);

      const result = await client.execCommand({
        command: parseShellCommand(terminalCommand),
        cwd: workspaceRoot,
        tty: true,
        streamStdin: true,
        streamStdoutStderr: true,
        timeoutMs: null,
      });

      const initialOutput = [result.stdout, result.stderr].filter(Boolean).join("");
      setTerminalOutput(initialOutput);
      setTerminalProcessId(result.processId ?? null);
      setTerminalExitCode(result.exitCode ?? null);
      setTerminalState(result.processId ? "running" : "stopped");

      if (result.processId) {
        await client.resizeCommand(result.processId, terminalSize.rows, terminalSize.cols);
      }
    } catch (runError) {
      setTerminalState("idle");
      setError(getFriendlyNetworkErrorMessage(runError, "Failed to start the terminal."));
    } finally {
      setIsBusy(false);
    }
  }

  async function sendTerminalInput() {
    const client = clientRef.current;
    if (!client || !terminalProcessId || !terminalInput) {
      return;
    }

    try {
      setError(null);
      await client.writeCommandInput(
        terminalProcessId,
        encodeTerminalInput(`${terminalInput}\n`),
        false,
      );
      setTerminalInput("");
    } catch (writeError) {
      setError(getFriendlyNetworkErrorMessage(writeError, "Failed to send terminal input."));
    }
  }

  async function terminateTerminal() {
    const client = clientRef.current;
    if (!client || !terminalProcessId) {
      return;
    }

    try {
      setError(null);
      await client.terminateCommand(terminalProcessId);
      setTerminalState("stopped");
      setTerminalProcessId(null);
    } catch (terminateError) {
      setError(getFriendlyNetworkErrorMessage(terminateError, "Failed to stop the terminal."));
    }
  }

  async function runFuzzySearch() {
    if (!sessionToken || !searchQuery.trim() || !workspaceRoot) {
      return;
    }

    try {
      setIsBusy(true);
      setError(null);
      const result = await withAppServerClient(backendUrl, sessionToken, async (client) => {
        return await client.fuzzyFileSearch(searchQuery.trim(), [workspaceRoot]);
      });
      setSearchResults(
        result.files.map((file) => ({
          path: file.path,
          score: file.score,
        })),
      );
    } catch (searchError) {
      setError(getFriendlyNetworkErrorMessage(searchError, "Failed to search files."));
    } finally {
      setIsBusy(false);
    }
  }

  function confirmPluginInstall(marketplacePath: string, pluginName: string) {
    if (!requiresConfirmedCommandCenterAction("plugin/install", false)) {
      return;
    }

    Alert.alert("Install plugin?", `Install ${pluginName} from ${marketplacePath}.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Install",
        onPress: () => {
          void runPluginAction("install", marketplacePath, pluginName);
        },
      },
    ]);
  }

  function confirmPluginUninstall(pluginId: string, pluginName: string) {
    if (!requiresConfirmedCommandCenterAction("plugin/uninstall", false)) {
      return;
    }

    Alert.alert("Uninstall plugin?", `Uninstall ${pluginName} (${pluginId}).`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Uninstall",
        style: "destructive",
        onPress: () => {
          void runPluginAction("uninstall", pluginId, pluginName);
        },
      },
    ]);
  }

  async function runPluginAction(action: "install" | "uninstall", first: string, second: string) {
    if (!sessionToken) {
      return;
    }

    try {
      setIsLoadingSurface(true);
      setSurfaceError(null);
      setSurfaceNotice(null);
      await withAppServerClient(backendUrl, sessionToken, async (client) => {
        if (action === "install") {
          await client.installPlugin(first, second);
          return;
        }

        await client.uninstallPlugin(first);
      });
      setSurfaceNotice(action === "install" ? `Installed ${second}.` : `Uninstalled ${second}.`);
      await loadCommandCenterSurface("plugins");
    } catch (pluginError) {
      setSurfaceError(getFriendlyNetworkErrorMessage(pluginError, `Failed to ${action} plugin.`));
    } finally {
      setIsLoadingSurface(false);
    }
  }

  async function resizeTerminalFromLayout(event: LayoutChangeEvent) {
    const client = clientRef.current;
    const processId = terminalProcessId;
    if (!client || !processId) {
      return;
    }

    const nextRows = Math.max(12, Math.floor(event.nativeEvent.layout.height / 18));
    const nextCols = Math.max(40, Math.floor(event.nativeEvent.layout.width / 8));
    if (nextRows === terminalSize.rows && nextCols === terminalSize.cols) {
      return;
    }

    setTerminalSize({ rows: nextRows, cols: nextCols });
    try {
      await client.resizeCommand(processId, nextRows, nextCols);
    } catch {
      // Resize is best effort.
    }
  }

  if (!isHydrated) {
    return (
      <ScreenShell title="Tools" subtitle="Loading Codex tool surfaces.">
        <InlineNotice>Restoring secure session state.</InlineNotice>
      </ScreenShell>
    );
  }

  if (!sessionToken) {
    return <Redirect href="/connect" />;
  }

  function selectToolsGroup(nextGroup: ToolsGroup) {
    setToolsGroup(nextGroup);
    if (nextGroup === "workbench") {
      setMode((current) => (isCommandCenterMode(current) ? "terminal" : current));
      return;
    }

    setMode((current) => (isCommandCenterMode(current) ? current : "plugins"));
  }

  const activeModes = toolsGroup === "workbench" ? getToolsModeTabs() : getCommandCenterModeTabs();

  return (
    <ScreenShell
      title="Tools"
      subtitle="Workbench commands and command-center surfaces from the Codex App Server."
    >
      <View style={styles.groupSwitch}>
        <PillButton
          label="Workbench"
          onPress={() => selectToolsGroup("workbench")}
          selected={toolsGroup === "workbench"}
        />
        <PillButton
          label="Command Center"
          onPress={() => selectToolsGroup("command-center")}
          selected={toolsGroup === "command-center"}
        />
      </View>
      <View style={styles.pillRow}>
        {activeModes.map((tab) => (
          <PillButton
            key={tab}
            label={getToolsModeLabel(tab)}
            onPress={() => setMode(tab)}
            selected={mode === tab}
          />
        ))}
      </View>
      {toolsGroup === "command-center" ? (
        <InlineNotice>
          Plugins, apps, skills, MCP, config, and experiments are read from the desktop App Server.
        </InlineNotice>
      ) : null}
      <Text style={styles.meta}>Workspace source: {workspaceSourceText}</Text>
      {routeWorkspaceThreadId ? (
        <Text style={styles.meta}>Opened from thread: {routeWorkspaceThreadId}</Text>
      ) : null}
      <Text style={styles.meta}>Workspace: {workspaceRoot ?? "Loading..."}</Text>
      <Text style={styles.meta}>Workspace label: {workspaceTarget.label}</Text>
      {sessionRestoreState === "reconnecting" ? (
        <InlineNotice tone="error">
          The saved phone app session is being kept locally, but the backend is currently unreachable.
          Retry once the desktop server is available again.
        </InlineNotice>
      ) : null}
      {sessionRestoreState === "reconnecting" ? (
        <PrimaryButton label="Retry Session Validation" onPress={retrySessionValidation} />
      ) : null}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {surfaceError ? <InlineNotice tone="error">{surfaceError}</InlineNotice> : null}
      {surfaceNotice ? <InlineNotice tone="success">{surfaceNotice}</InlineNotice> : null}
      {isCommandCenterMode(mode) ? (
        <SecondaryButton
          disabled={isLoadingSurface}
          label={isLoadingSurface ? "Refreshing..." : "Refresh Surface"}
          onPress={() => {
            void loadCommandCenterSurface(mode);
          }}
        />
      ) : null}

      {mode === "terminal" ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Interactive Terminal</Text>
          <LabeledInput
            label="Launch Command"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setTerminalCommand}
            value={terminalCommand}
          />
          <PrimaryButton
            disabled={isBusy || !terminalCommand.trim() || !workspaceRoot}
            label={
              terminalState === "running"
                ? "Restart Terminal"
                : isBusy
                  ? "Starting..."
                  : "Start Terminal"
            }
            helperText="Runs a streaming TTY session through command/exec. Runs in the selected workspace path when available."
            onPress={() => {
              void startTerminal();
            }}
          />
          <View
            onLayout={(event) => void resizeTerminalFromLayout(event)}
            style={styles.outputCard}
          >
            <Text style={styles.outputTitle}>
              {terminalState === "running"
                ? `Running${terminalProcessId ? ` - ${terminalProcessId}` : ""}`
                : terminalState === "starting"
                  ? "Starting terminal..."
                  : terminalExitCode !== null
                    ? `Stopped - exit ${terminalExitCode}`
                    : "Idle"}
            </Text>
            <Text style={styles.outputText}>
              {terminalOutput ||
                "Terminal output will appear here once the process emits data."}
            </Text>
          </View>
          <LabeledInput
            label="Terminal Input"
            autoCapitalize="none"
            autoCorrect={false}
            editable={terminalState === "running"}
            onChangeText={setTerminalInput}
            placeholder="Type input for the running process"
            value={terminalInput}
          />
          <PrimaryButton
            disabled={terminalState !== "running" || !terminalInput}
            label="Send Input"
            onPress={() => {
              void sendTerminalInput();
            }}
          />
          <View style={styles.actionRow}>
            <View style={styles.actionCell}>
              <SecondaryButton
                disabled={!terminalOutput}
                label="Clear Transcript"
                onPress={() => setTerminalOutput("")}
              />
            </View>
            <View style={styles.actionCell}>
              <SecondaryButton
                disabled={terminalState !== "running"}
                label="Terminate"
                onPress={() => {
                  void terminateTerminal();
                }}
              />
            </View>
          </View>
        </View>
      ) : null}

      {mode === "search" ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Fuzzy File Search</Text>
          <LabeledInput
            label="Search Query"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setSearchQuery}
            placeholder="thread detail"
            value={searchQuery}
          />
          <PrimaryButton
            disabled={isBusy || !searchQuery.trim() || !workspaceRoot}
            label={isBusy ? "Searching..." : "Search Workspace"}
            helperText="Searches against the selected workspace path when present."
            onPress={() => {
              void runFuzzySearch();
            }}
          />
          {!searchResults.length ? <InlineNotice>No search results yet.</InlineNotice> : null}
          {searchResults.map((result) => (
            <View key={result.path} style={styles.resultRow}>
              <Text style={styles.resultPath}>{result.path}</Text>
              <Text style={styles.resultScore}>score {result.score.toFixed(1)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {mode === "review" ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Structured Review Flow</Text>
          <LabeledInput
            label="Thread ID"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setReviewThreadId}
            placeholder="019c..."
            value={reviewThreadId}
          />
          <PrimaryButton
            disabled={!reviewThreadId.trim()}
            label="Open Review Flow"
            helperText="Opens the dedicated review screen with explicit delivery and target controls."
            onPress={() => {
              router.push({
                pathname: "/review/start",
                params: {
                  threadId: reviewThreadId.trim(),
                },
              });
            }}
          />
          <SecondaryButton
            label="Open Blank Review Flow"
            onPress={() => {
              router.push("/review/start");
            }}
          />
        </View>
      ) : null}

      {mode === "apps" ? renderAppsSurface(surfaceState.apps, isLoadingSurface) : null}
      {mode === "skills" ? renderSkillsSurface(surfaceState.skills, isLoadingSurface) : null}
      {mode === "plugins"
        ? renderPluginsSurface(
            surfaceState.plugins,
            isLoadingSurface,
            confirmPluginInstall,
            confirmPluginUninstall,
          )
        : null}
      {mode === "mcp" ? renderMcpSurface(surfaceState.mcp, isLoadingSurface) : null}
      {mode === "config" ? renderConfigSurface(surfaceState.config, isLoadingSurface) : null}
      {mode === "experiments" ? renderExperimentsSurface(surfaceState.experiments, isLoadingSurface) : null}
    </ScreenShell>
  );
}

function isCommandCenterMode(mode: ToolsMode) {
  return ["apps", "skills", "plugins", "mcp", "config", "experiments"].includes(mode);
}

function getToolsModeLabel(mode: ToolsMode) {
  switch (mode) {
    case "mcp":
      return "MCP";
    default:
      return mode.charAt(0).toUpperCase() + mode.slice(1);
  }
}

function renderAppsSurface(data: AppServerAppsListResponse | undefined, isLoading: boolean) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Apps</Text>
      {!data && isLoading ? <InlineNotice>Loading apps from App Server.</InlineNotice> : null}
      {data && !data.data.length ? <InlineNotice>No apps returned by App Server.</InlineNotice> : null}
      {data?.data.map((app) => (
        <View key={app.id} style={styles.resultRow}>
          <Text style={styles.resultPath}>{app.name}</Text>
          <Text style={styles.resultScore}>
            {app.isEnabled ? "enabled" : "disabled"} | {app.isAccessible ? "accessible" : "not accessible"}
          </Text>
          {app.description ? <Text style={styles.outputText}>{app.description}</Text> : null}
          {app.pluginDisplayNames.length ? (
            <Text style={styles.resultScore}>Plugins: {app.pluginDisplayNames.join(", ")}</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function renderSkillsSurface(data: AppServerSkillsListResponse | undefined, isLoading: boolean) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Skills</Text>
      {!data && isLoading ? <InlineNotice>Loading skills for the selected workspace.</InlineNotice> : null}
      {data && !data.data.length ? <InlineNotice>No skill entries returned.</InlineNotice> : null}
      {data?.data.map((entry) => (
        <View key={entry.cwd} style={styles.resultRow}>
          <Text style={styles.resultPath}>{entry.cwd}</Text>
          <Text style={styles.resultScore}>{entry.skills.length} skills | {entry.errors.length} errors</Text>
          {entry.skills.slice(0, 10).map((skill) => (
            <Text key={`${entry.cwd}-${skill.path}`} style={styles.outputText}>
              {skill.enabled ? "on" : "off"} | {skill.name} | {skill.description}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function renderPluginsSurface(
  data: AppServerPluginListResponse | undefined,
  isLoading: boolean,
  onInstall: (marketplacePath: string, pluginName: string) => void,
  onUninstall: (pluginId: string, pluginName: string) => void,
) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Plugins</Text>
      {!data && isLoading ? <InlineNotice>Loading plugin marketplaces.</InlineNotice> : null}
      {data && !data.marketplaces.length ? <InlineNotice>No plugin marketplaces returned.</InlineNotice> : null}
      {data?.marketplaces.map((marketplace) => {
        const groupedPlugins = partitionPluginsByInstallState(marketplace.plugins);
        return (
          <View key={marketplace.path} style={styles.resultRow}>
            <Text style={styles.resultPath}>{marketplace.name}</Text>
            <Text style={styles.resultScore}>
              {groupedPlugins.installed.length} installed | {groupedPlugins.available.length} available
            </Text>
            <Text style={styles.resultScore} numberOfLines={1}>{marketplace.path}</Text>
            {groupedPlugins.installed.length ? (
              <Text style={styles.pluginGroupTitle}>Installed</Text>
            ) : null}
            {groupedPlugins.installed.map((plugin) => (
              <PluginActionRow
                key={plugin.id}
                actionLabel="Uninstall"
                meta={`${plugin.enabled ? "enabled" : "disabled"} | installed`}
                name={plugin.name}
                onPress={() => onUninstall(plugin.id, plugin.name)}
              />
            ))}
            {groupedPlugins.available.length ? (
              <Text style={styles.pluginGroupTitle}>Available</Text>
            ) : null}
            {groupedPlugins.available.map((plugin) => (
              <PluginActionRow
                key={plugin.id}
                actionLabel="Install"
                meta={plugin.enabled ? "enabled | available" : "available"}
                name={plugin.name}
                onPress={() => onInstall(marketplace.path, plugin.name)}
              />
            ))}
          </View>
        );
      })}
    </View>
  );
}

function PluginActionRow({
  actionLabel,
  meta,
  name,
  onPress,
}: {
  actionLabel: string;
  meta: string;
  name: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.pluginRow}>
      <View style={styles.pluginCopy}>
        <Text style={styles.resultPath}>{name}</Text>
        <Text style={styles.resultScore}>{meta}</Text>
      </View>
      <SecondaryButton label={actionLabel} onPress={onPress} />
    </View>
  );
}

function renderMcpSurface(data: AppServerMcpServerStatusResponse | undefined, isLoading: boolean) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>MCP Servers</Text>
      {!data && isLoading ? <InlineNotice>Loading MCP server status.</InlineNotice> : null}
      {data && !data.data.length ? <InlineNotice>No MCP servers returned.</InlineNotice> : null}
      {data?.data.map((server) => (
        <View key={server.name} style={styles.resultRow}>
          <Text style={styles.resultPath}>{server.name}</Text>
          <Text style={styles.resultScore}>
            {Object.keys(server.tools).length} tools | {server.resources.length} resources | {server.resourceTemplates.length} templates
          </Text>
          <Text style={styles.outputText}>Auth: {formatJsonPreview(server.authStatus)}</Text>
        </View>
      ))}
    </View>
  );
}

function renderConfigSurface(
  data: SurfaceState["config"] | undefined,
  isLoading: boolean,
) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Config</Text>
      {!data && isLoading ? <InlineNotice>Loading config and requirements.</InlineNotice> : null}
      {data ? (
        <>
          <Text style={styles.resultScore}>
            {Object.keys(data.config.config).length} loaded keys | {data.config.layers?.length ?? 0} layers
          </Text>
          <Text style={styles.outputText}>{formatJsonPreview(data.config.config)}</Text>
          <Text style={styles.sectionTitle}>Requirements</Text>
          <Text style={styles.outputText}>{formatJsonPreview(data.requirements.requirements ?? {})}</Text>
        </>
      ) : null}
    </View>
  );
}

function renderExperimentsSurface(data: AppServerExperimentalFeatureListResponse | undefined, isLoading: boolean) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Experimental Features</Text>
      {!data && isLoading ? <InlineNotice>Loading experimental feature flags.</InlineNotice> : null}
      {data && !data.data.length ? <InlineNotice>No experimental features returned.</InlineNotice> : null}
      {data?.data.map((feature) => (
        <View key={feature.name} style={styles.resultRow}>
          <Text style={styles.resultPath}>{feature.displayName ?? feature.name}</Text>
          <Text style={styles.resultScore}>
            {feature.enabled ? "enabled" : "disabled"} | default {feature.defaultEnabled ? "on" : "off"} | {feature.stage}
          </Text>
          {feature.description ? <Text style={styles.outputText}>{feature.description}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function formatJsonPreview(value: unknown) {
  try {
    return JSON.stringify(value, null, 2).slice(0, 1600);
  } catch {
    return String(value);
  }
}

function handleTerminalNotification(
  notification: AppServerNotification,
  setTerminalOutput: Dispatch<SetStateAction<string>>,
  setTerminalProcessId: Dispatch<SetStateAction<string | null>>,
) {
  if (notification.method !== "command/exec/outputDelta") {
    return;
  }

  setTerminalProcessId(notification.params.processId);
  setTerminalOutput((current) =>
    appendTerminalDelta(current, notification.params.deltaBase64),
  );
}

const styles = StyleSheet.create({
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  groupSwitch: {
    flexDirection: "row",
    gap: 10,
  },
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
  },
  outputCard: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundElevated,
    minHeight: 220,
    gap: 8,
  },
  outputTitle: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "700",
  },
  outputText: {
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
  resultRow: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: colors.backgroundElevated,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  pluginRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 10,
  },
  pluginCopy: {
    flex: 1,
    minWidth: 0,
  },
  pluginGroupTitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    paddingTop: 8,
    textTransform: "uppercase",
  },
  resultPath: {
    color: colors.text,
    fontWeight: "700",
  },
  resultScore: {
    color: colors.textSubtle,
  },
});
