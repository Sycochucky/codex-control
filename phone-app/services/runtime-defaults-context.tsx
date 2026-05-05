import { createContext, ReactNode, startTransition, useContext, useEffect, useMemo, useState } from "react";

import { getStoredValue, setStoredValue } from "@/services/secure-storage";
import {
  DEFAULT_RUNTIME_DEFAULTS,
  normalizeRuntimeDefaults,
  type RuntimeDefaults,
} from "@/utils/runtime-defaults";

type RuntimeDefaultsContextValue = {
  runtimeDefaults: RuntimeDefaults;
  isRuntimeDefaultsHydrated: boolean;
  setRuntimeDefaults: (value: RuntimeDefaults) => void;
  resetRuntimeDefaults: () => void;
};

const RuntimeDefaultsContext = createContext<RuntimeDefaultsContextValue | null>(null);

const RUNTIME_DEFAULTS_KEY = "codex-control.runtime-defaults";

export function RuntimeDefaultsProvider({ children }: { children: ReactNode }) {
  const [runtimeDefaults, setRuntimeDefaultsState] = useState<RuntimeDefaults>(DEFAULT_RUNTIME_DEFAULTS);
  const [isRuntimeDefaultsHydrated, setIsRuntimeDefaultsHydrated] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function hydrateRuntimeDefaults() {
      const stored = await getStoredValue(RUNTIME_DEFAULTS_KEY);
      if (!isMounted) {
        return;
      }

      if (stored) {
        try {
          setRuntimeDefaultsState(normalizeRuntimeDefaults(JSON.parse(stored) as Partial<RuntimeDefaults>));
        } catch {
          setRuntimeDefaultsState(DEFAULT_RUNTIME_DEFAULTS);
        }
      }

      setIsRuntimeDefaultsHydrated(true);
    }

    void hydrateRuntimeDefaults();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isRuntimeDefaultsHydrated) {
      return;
    }

    void setStoredValue(RUNTIME_DEFAULTS_KEY, JSON.stringify(runtimeDefaults));
  }, [isRuntimeDefaultsHydrated, runtimeDefaults]);

  const value = useMemo<RuntimeDefaultsContextValue>(
    () => ({
      runtimeDefaults,
      isRuntimeDefaultsHydrated,
      setRuntimeDefaults(nextValue) {
        startTransition(() => {
          setRuntimeDefaultsState(normalizeRuntimeDefaults(nextValue));
        });
      },
      resetRuntimeDefaults() {
        startTransition(() => {
          setRuntimeDefaultsState(DEFAULT_RUNTIME_DEFAULTS);
        });
      },
    }),
    [isRuntimeDefaultsHydrated, runtimeDefaults],
  );

  return <RuntimeDefaultsContext.Provider value={value}>{children}</RuntimeDefaultsContext.Provider>;
}

export function useRuntimeDefaults() {
  const context = useContext(RuntimeDefaultsContext);
  if (!context) {
    throw new Error("useRuntimeDefaults must be used within RuntimeDefaultsProvider.");
  }

  return context;
}
