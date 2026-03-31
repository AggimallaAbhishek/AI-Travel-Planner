import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDestinationMapsUrl,
  DEFAULT_VOYAGR_CURRENCY,
  formatDestinationStartingPrice,
  formatVoyagrCurrency,
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
