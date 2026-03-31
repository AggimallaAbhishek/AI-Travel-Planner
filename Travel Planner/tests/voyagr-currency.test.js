import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDestinationMapsUrl,
  DEFAULT_VOYAGR_CURRENCY,
  formatDestinationStartingPrice,
  formatVoyagrCurrency,
  persistVoyagrCurrencyPreference,
  readVoyagrCurrencyPreference,
  resolveVoyagrCurrencyConfig,
} from "../src/lib/voyagrCurrency.js";

test("resolveVoyagrCurrencyConfig falls back to INR by default", () => {
  assert.equal(DEFAULT_VOYAGR_CURRENCY, "INR");
  assert.equal(resolveVoyagrCurrencyConfig("UNKNOWN").code, "INR");
});

test("formatDestinationStartingPrice converts USD base prices into INR by default", () => {
  assert.equal(formatDestinationStartingPrice(1200), "From ₹99,600");
});

test("formatVoyagrCurrency formats supported currencies consistently", () => {
  assert.equal(formatVoyagrCurrency(1800, "USD"), "$1,800");
  assert.equal(formatVoyagrCurrency(1800, "GBP"), "£1,422");
});

test("buildDestinationMapsUrl returns a Google Maps search link for the destination", () => {
  assert.equal(
    buildDestinationMapsUrl({ name: "Kyoto", country: "Japan" }),
    "https://www.google.com/maps/search/?api=1&query=Kyoto%2C%20Japan"
  );
});

test("currency preference storage falls back safely when localStorage is unavailable", () => {
  const previousWindow = globalThis.window;

  try {
    delete globalThis.window;
    assert.equal(readVoyagrCurrencyPreference(), "INR");
    assert.equal(persistVoyagrCurrencyPreference("USD"), "USD");
  } finally {
    if (typeof previousWindow === "undefined") {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test("currency preference storage persists and normalizes selected code", () => {
  const previousWindow = globalThis.window;
  const store = new Map();

  globalThis.window = {
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => {
        store.set(key, value);
      },
    },
  };

  try {
    assert.equal(readVoyagrCurrencyPreference(), "INR");
    assert.equal(persistVoyagrCurrencyPreference("GBP"), "GBP");
    assert.equal(readVoyagrCurrencyPreference(), "GBP");
    assert.equal(persistVoyagrCurrencyPreference("INVALID"), "INR");
    assert.equal(readVoyagrCurrencyPreference(), "INR");
  } finally {
    if (typeof previousWindow === "undefined") {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});
