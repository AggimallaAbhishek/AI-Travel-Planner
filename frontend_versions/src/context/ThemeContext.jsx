/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  applyThemeToDocument,
  getStoredThemePreference,
  getSystemTheme,
  persistThemePreference,
  resolveTheme,
  THEME_DARK,
  THEME_LIGHT,
} from "@/lib/theme";

const ThemeContext = createContext(null);

function getInitialThemeState() {
  const themePreference = getStoredThemePreference();
  const systemTheme = getSystemTheme();
  const documentTheme =
    typeof document !== "undefined"
      ? document.documentElement.getAttribute("data-theme")
      : null;
  const resolvedTheme =
    documentTheme === THEME_LIGHT || documentTheme === THEME_DARK
      ? documentTheme
      : resolveTheme(themePreference, systemTheme);

  return {
    themePreference,
    systemTheme,
    resolvedTheme,
  };
}

export function ThemeProvider({ children }) {
  const initialThemeState = useMemo(() => getInitialThemeState(), []);
  const [themePreference, setThemePreference] = useState(
    initialThemeState.themePreference
  );
  const [systemTheme, setSystemTheme] = useState(initialThemeState.systemTheme);

  const resolvedTheme = resolveTheme(themePreference, systemTheme);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onThemeChange = (event) => {
      const nextSystemTheme = event.matches ? THEME_DARK : THEME_LIGHT;
      setSystemTheme(nextSystemTheme);
      console.info("[theme] System theme changed", {
        systemTheme: nextSystemTheme,
      });
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", onThemeChange);
      return () => mediaQuery.removeEventListener("change", onThemeChange);
    }

    mediaQuery.addListener(onThemeChange);
    return () => mediaQuery.removeListener(onThemeChange);
  }, []);

  useEffect(() => {
    applyThemeToDocument(resolvedTheme);
    persistThemePreference(themePreference);
    console.info("[theme] Theme context updated", {
      themePreference: themePreference ?? "system",
      resolvedTheme,
    });
  }, [resolvedTheme, themePreference]);

  const contextValue = useMemo(
    () => ({
      theme: resolvedTheme,
      resolvedTheme,
      systemTheme,
      themePreference: themePreference ?? "system",
      isUsingSystemTheme: themePreference == null,
      setTheme: (nextTheme) => {
        setThemePreference(nextTheme === "system" ? null : nextTheme);
      },
      setThemePreference,
      toggleTheme: () => {
        setThemePreference((previousPreference) => {
          const baseTheme = resolveTheme(previousPreference, systemTheme);
          const nextTheme =
            baseTheme === THEME_DARK ? THEME_LIGHT : THEME_DARK;

          console.info("[theme] Toggle requested", {
            from: previousPreference ?? "system",
            to: nextTheme,
          });

          return nextTheme;
        });
      },
    }),
    [resolvedTheme, systemTheme, themePreference]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider.");
  }

  return context;
}
