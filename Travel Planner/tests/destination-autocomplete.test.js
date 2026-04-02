import test from "node:test";
import assert from "node:assert/strict";
import { getDestinationSuggestions } from "../src/lib/destinationAutocomplete.js";

test("getDestinationSuggestions prioritizes prefix matches", () => {
  const suggestions = getDestinationSuggestions("jai", { limit: 5 });

  assert.ok(suggestions.length > 0);
  assert.equal(suggestions[0].name, "Jaipur");
  assert.equal(suggestions[0].country, "India");
  assert.equal(suggestions[0].placeId, "rajasthan--jaipur");
  assert.equal(suggestions[0].source, "india_dataset");
});

test("getDestinationSuggestions matches by country names", () => {
  const suggestions = getDestinationSuggestions("india", { limit: 8 });
  const hasIndianDestination = suggestions.some(
    (entry) => entry.country === "India"
  );

  assert.equal(hasIndianDestination, true);
});

test("getDestinationSuggestions returns default list for empty query", () => {
  const suggestions = getDestinationSuggestions("", { limit: 4 });

  assert.equal(suggestions.length, 4);
  assert.equal(typeof suggestions[0].label, "string");
});
