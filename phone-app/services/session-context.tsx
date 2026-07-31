import {
  createContext,
  ReactNode,
  useCallback,
  startTransition,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { withAppServerClient } from "@/services/app-server";
import { getStoredValue, setStoredValue } from "@/services/secure-storage";
import { type SessionRestoreState } from "@/utils/session-restore";
import Constants from "expo-constants";
import { getDefaultBackendUrl, hasExplicitDefaultBackendUrl } from "@/utils/default-backend-url";
import { getWorkspaceLabel, normalizeWorkspacePath } from "@/utils/workspace-target";

type WorkspaceSelectionInput = {
  path: string | null;
  label?: string | null;
  sourceThreadId?: string | null;
};

type SessionContextValue = {
  backendUrl: string;
  sharedToken: string;
  sessionToken: string | null;
  selectedWorkspacePath: string | null;
  selectedWorkspaceLabel: string | null;
  selectedSourceThreadId: string | null;
  isHydrated: boolean;
  sessionRestoreState: SessionRestoreState;
  setBackendUrl: (value: string) => void;
  setSharedToken: (value: string) => void;
  setSessionToken: (value: string | null) => void;
  setSelectedWorkspace: (value: WorkspaceSelectionInput) => void;
  clearSelectedWorkspace: () => void;
  logout: () => void;
  invalidateSession: () => void;
  retrySessionValidation: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

const BACKEND_URL_KEY = "codex-control.backend-url";
const SHARED_TOKEN_KEY = "codex-control.shared-token";
const SESSION_TOKEN_KEY = "codex-control.session-token";
const CONNECTED_SESSION_MARKER = "official-codex-app-server";
const LEGACY_SHARED_TOKEN = "codex-dev";
const LEGACY_DEFAULT_BACKEND_URLS = new Set([
  "http://127.0.0.1:8000",
  "http://localhost:8000",
  "http://127.0.0.1:8010",
  "http://localhost:8010",
]);

const constantsWithHost = Constants as unknown as {
  expoConfig?: { hostUri?: string | null } | null;
  manifest2?: { extra?: { expoClient?: { hostUri?: string | null } } } | null;
};

const defaultBackendUrl = getDefaultBackendUrl({
  envRemoteUrl: process.env.EXPO_PUBLIC_CODEX_REMOTE_URL,
  envUrl: process.env.EXPO_PUBLIC_CODEX_BACKEND_URL,
  envTunnelUrl: process.env.EXPO_PUBLIC_CODEX_TUNNEL_URL,
  envPort: process.env.EXPO_PUBLIC_CODEX_BACKEND_PORT,
  expoHostUri:
    constantsWithHost.expoConfig?.hostUri ??
    constantsWithHost.manifest2?.extra?.expoClient?.hostUri,
  browserHostname:
    typeof window === "undefined" ? null : window.location?.hostname,
});
const hasBackendUrlEnvironmentOverride = hasExplicitDefaultBackendUrl({
  envRemoteUrl: process.env.EXPO_PUBLIC_CODEX_REMOTE_URL,
  envUrl: process.env.EXPO_PUBLIC_CODEX_BACKEND_URL,
  envTunnelUrl: process.env.EXPO_PUBLIC_CODEX_TUNNEL_URL,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [backendUrl, setBackendUrlState] = useState(defaultBackendUrl);
  const [sharedToken, setSharedTokenState] = useState("");
  const [sessionToken, setSessionTokenState] = useState<string | null>(null);
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string | null>(null);
  const [selectedWorkspaceLabel, setSelectedWorkspaceLabel] = useState<string | null>(null);
  const [selectedSourceThreadId, setSelectedSourceThreadId] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [sessionRestoreState, setSessionRestoreState] =
    useState<SessionRestoreState>("hydrating");

  const clearSelectedWorkspaceState = useCallback(() => {
    startTransition(() => {
      setSelectedWorkspacePath(null);
      setSelectedWorkspaceLabel(null);
      setSelectedSourceThreadId(null);
    });
  }, []);

  const clearSessionState = useCallback(() => {
    startTransition(() => {
      setSessionTokenState(null);
      setSessionRestoreState("ready");
    });
  }, []);

  const validateSessionToken = useCallback(async (candidateBackendUrl: string, candidateAuthToken: string | null) => {
    try {
      await withAppServerClient(candidateBackendUrl, candidateAuthToken, async () => undefined);
      startTransition(() => {
        setSessionRestoreState("ready");
      });
      return true;
    } catch (error) {
      startTransition(() => {
        setSessionRestoreState("reconnecting");
      });
      return false;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function hydrateSession() {
      const [storedBackendUrl, storedSharedToken, storedSessionToken] = await Promise.all([
        getStoredValue(BACKEND_URL_KEY),
        getStoredValue(SHARED_TOKEN_KEY),
        getStoredValue(SESSION_TOKEN_KEY),
      ]);

      if (!isMounted) {
        return;
      }

      const restoredBackendUrl =
        storedBackendUrl && !LEGACY_DEFAULT_BACKEND_URLS.has(storedBackendUrl) && !hasBackendUrlEnvironmentOverride
          ? storedBackendUrl
          : defaultBackendUrl;
      const migratedSharedToken = storedSharedToken === LEGACY_SHARED_TOKEN ? "" : storedSharedToken;

      setBackendUrlState(restoredBackendUrl);

      if (migratedSharedToken) {
        setSharedTokenState(migratedSharedToken);
      }

      if (storedSessionToken) {
        setSessionTokenState(storedSessionToken);
      }

      setIsHydrated(true);

      if (storedSessionToken) {
        const didValidate = await validateSessionToken(
          restoredBackendUrl,
          migratedSharedToken,
        );
        if (!didValidate && !isMounted) {
          return;
        }
      }

      if (isMounted && !storedSessionToken) {
        setSessionRestoreState("ready");
      }
    }

    void hydrateSession();

    return () => {
      isMounted = false;
    };
  }, [validateSessionToken]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void setStoredValue(BACKEND_URL_KEY, backendUrl);
  }, [backendUrl, isHydrated]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void setStoredValue(SHARED_TOKEN_KEY, sharedToken);
  }, [isHydrated, sharedToken]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void setStoredValue(SESSION_TOKEN_KEY, sessionToken);
  }, [isHydrated, sessionToken]);

  const value = useMemo<SessionContextValue>(
    () => ({
      backendUrl,
      isHydrated,
      selectedSourceThreadId,
      selectedWorkspaceLabel,
      selectedWorkspacePath,
      sessionRestoreState,
      sharedToken,
      sessionToken,
      setBackendUrl(value) {
        startTransition(() => {
          setBackendUrlState(value);
          if (value !== backendUrl) {
            setSessionTokenState(null);
            setSessionRestoreState("ready");
            setSelectedWorkspacePath(null);
            setSelectedWorkspaceLabel(null);
            setSelectedSourceThreadId(null);
          }
        });
      },
      setSharedToken(value) {
        startTransition(() => {
          setSharedTokenState(value);
          if (value !== sharedToken) {
            setSessionTokenState(null);
            setSessionRestoreState("ready");
            setSelectedWorkspacePath(null);
            setSelectedWorkspaceLabel(null);
            setSelectedSourceThreadId(null);
          }
        });
      },
      setSessionToken(value) {
        startTransition(() => {
          setSessionTokenState(value ? CONNECTED_SESSION_MARKER : null);
          setSessionRestoreState("ready");
        });
      },
      setSelectedWorkspace(value) {
        const normalizedPath = normalizeWorkspacePath(value.path);
        startTransition(() => {
          setSelectedWorkspacePath(normalizedPath);
          setSelectedWorkspaceLabel(
            normalizedPath ? value.label?.trim() || getWorkspaceLabel(normalizedPath) : null,
          );
          setSelectedSourceThreadId(value.sourceThreadId?.trim() || null);
        });
      },
      clearSelectedWorkspace() {
        clearSelectedWorkspaceState();
      },
      logout() {
        clearSessionState();
      },
      invalidateSession() {
        clearSessionState();
      },
      retrySessionValidation() {
        if (!sessionToken) {
          return;
        }

        void validateSessionToken(backendUrl, sharedToken);
      },
    }),
    [
      backendUrl,
      clearSelectedWorkspaceState,
      clearSessionState,
      isHydrated,
      selectedSourceThreadId,
      selectedWorkspaceLabel,
      selectedWorkspacePath,
      sessionRestoreState,
      sessionToken,
      sharedToken,
      validateSessionToken,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function createConnectedSessionToken() {
  return CONNECTED_SESSION_MARKER;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within SessionProvider.");
  }

  return context;
}
