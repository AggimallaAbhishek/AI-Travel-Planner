import assert from "node:assert/strict";
import test from "node:test";
import {
  applyThemeToDocument,
  getStoredThemePreference,
  initializeTheme,
  resolveTheme,
  THEME_DARK,
  THEME_LIGHT,
} from "../src/lib/theme.js";

function createRootStub() {
  return {
    dataset: {},
    style: {},
    classList: {
      values: new Set(),
      toggle(name, enabled) {
        if (enabled) {
          this.values.add(name);
        } else {
          this.values.delete(name);
        }
      },
      contains(name) {
        return this.values.has(name);
      },
    },
    setAttribute(name, value) {
      this.dataset[name] = value;
    },
  };
}

test("resolveTheme uses explicit preference when present", () => {
  assert.equal(resolveTheme(THEME_LIGHT, THEME_DARK), THEME_LIGHT);
  assert.equal(resolveTheme(THEME_DARK, THEME_LIGHT), THEME_DARK);
});

test("getStoredThemePreference ignores invalid values", () => {
  const storage = {
    getItem() {
      return "sepia";
    },
  };

  assert.equal(getStoredThemePreference(storage), null);
});

test("applyThemeToDocument updates data-theme, dark class, and color scheme", () => {
  const root = createRootStub();

  applyThemeToDocument(THEME_DARK, root);
  assert.equal(root.dataset["data-theme"], THEME_DARK);
  assert.equal(root.style.colorScheme, THEME_DARK);
  assert.equal(root.classList.contains("dark"), true);

  applyThemeToDocument(THEME_LIGHT, root);
  assert.equal(root.dataset["data-theme"], THEME_LIGHT);
  assert.equal(root.style.colorScheme, THEME_LIGHT);
  assert.equal(root.classList.contains("dark"), false);
});

test("initializeTheme falls back to system theme when no explicit preference is stored", () => {
  const root = createRootStub();
  const storage = {
    getItem() {
      return null;
    },
  };
  const matchMedia = () => ({ matches: true });

  const state = initializeTheme({ storage, matchMedia, root });

  assert.equal(state.themePreference, null);
  assert.equal(state.systemTheme, THEME_DARK);
  assert.equal(state.resolvedTheme, THEME_DARK);
  assert.equal(root.dataset["data-theme"], THEME_DARK);
});
