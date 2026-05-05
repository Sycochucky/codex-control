import {
  createContext,
  ReactNode,
  startTransition,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  DEFAULT_THEME_PRESET_ID,
  normalizeThemePresetId,
  themePresets,
  type ThemeColors,
  type ThemePresetId,
} from "@/constants/theme";
import { getStoredValue, setStoredValue } from "@/services/secure-storage";

type ThemeContextValue = {
  theme: ThemeColors;
  themePresetId: ThemePresetId;
  isThemeHydrated: boolean;
  themeSaveError: string | null;
  setThemePresetId: (value: ThemePresetId) => void;
  clearThemeSaveError: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_PRESET_KEY = "codex-control.theme-preset";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themePresetId, setThemePresetIdState] = useState<ThemePresetId>(DEFAULT_THEME_PRESET_ID);
  const [isThemeHydrated, setIsThemeHydrated] = useState(false);
  const [themeSaveError, setThemeSaveError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function hydrateTheme() {
      const stored = await getStoredValue(THEME_PRESET_KEY);
      if (!isMounted) {
        return;
      }

      setThemePresetIdState(normalizeThemePresetId(stored));
      setIsThemeHydrated(true);
    }

    void hydrateTheme();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isThemeHydrated) {
      return;
    }

    void setStoredValue(THEME_PRESET_KEY, themePresetId).catch(() => {
      setThemeSaveError("Theme could not be saved. It will reset next launch.");
    });
  }, [isThemeHydrated, themePresetId]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: themePresets[themePresetId],
      themePresetId,
      isThemeHydrated,
      themeSaveError,
      setThemePresetId(value) {
        setThemeSaveError(null);
        startTransition(() => {
          setThemePresetIdState(normalizeThemePresetId(value));
        });
      },
      clearThemeSaveError() {
        setThemeSaveError(null);
      },
    }),
    [isThemeHydrated, themePresetId, themeSaveError],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider.");
  }

  return context;
}

export function useThemedStyles<T>(factory: (theme: ThemeColors) => T): T {
  const { theme } = useTheme();
  return useMemo(() => factory(theme), [factory, theme]);
}
