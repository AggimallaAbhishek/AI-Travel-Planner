export const THEME_STORAGE_KEY = "voyagr-theme";
export const THEME_LIGHT = "light";
export const THEME_DARK = "dark";

function isTheme(value) {
  return value === THEME_LIGHT || value === THEME_DARK;
}

export function getStoredThemePreference(storage = globalThis?.localStorage) {
  try {
    const value = storage?.getItem?.(THEME_STORAGE_KEY) ?? null;
    return isTheme(value) ? value : null;
  } catch (error) {
    console.warn("[theme] Unable to read stored theme preference", error);
    return null;
  }
}

export function getSystemTheme(matchMedia = globalThis?.matchMedia) {
  try {
    return matchMedia?.("(prefers-color-scheme: dark)")?.matches
      ? THEME_DARK
      : THEME_LIGHT;
  } catch (error) {
    console.warn("[theme] Unable to resolve system theme", error);
    return THEME_DARK;
  }
}

export function resolveTheme(themePreference, systemTheme = THEME_DARK) {
  return isTheme(themePreference) ? themePreference : systemTheme;
}

export function applyThemeToDocument(theme, root = globalThis?.document?.documentElement) {
  if (!root || !isTheme(theme)) {
    return theme;
  }

  root.setAttribute("data-theme", theme);
  root.classList.toggle("dark", theme === THEME_DARK);
  root.style.colorScheme = theme;
  return theme;
}

export function persistThemePreference(
  themePreference,
  storage = globalThis?.localStorage
) {
  try {
    if (isTheme(themePreference)) {
      storage?.setItem?.(THEME_STORAGE_KEY, themePreference);
    } else {
      storage?.removeItem?.(THEME_STORAGE_KEY);
    }
  } catch (error) {
    console.warn("[theme] Unable to persist theme preference", error);
  }
}

export function initializeTheme({
  storage = globalThis?.localStorage,
  matchMedia = globalThis?.matchMedia,
  root = globalThis?.document?.documentElement,
} = {}) {
  const themePreference = getStoredThemePreference(storage);
  const systemTheme = getSystemTheme(matchMedia);
  const resolvedTheme = resolveTheme(themePreference, systemTheme);

  applyThemeToDocument(resolvedTheme, root);
  console.info("[theme] Theme bootstrapped", {
    themePreference: themePreference ?? "system",
    resolvedTheme,
  });

  return {
    themePreference,
    systemTheme,
    resolvedTheme,
  };
}
