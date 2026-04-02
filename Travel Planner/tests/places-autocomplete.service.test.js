import test from "node:test";
import assert from "node:assert/strict";
import {
  clearDestinationAutocompleteCache,
  getDestinationAutocompleteSuggestions,
} from "../server/services/recommendations.js";

test("getDestinationAutocompleteSuggestions rejects invalid short queries", async () => {
  await assert.rejects(
    () => getDestinationAutocompleteSuggestions({ query: "a" }),
    (error) => error?.code === "recommendations/invalid-query"
  );
});

test("getDestinationAutocompleteSuggestions falls back to local suggestions without an API key", async () => {
  const originalApiKey = process.env.GOOGLE_PLACES_API_KEY;

  try {
    delete process.env.GOOGLE_PLACES_API_KEY;
    clearDestinationAutocompleteCache();

    const suggestions = await getDestinationAutocompleteSuggestions({
      query: "ky",
      forceRefresh: true,
    });

    assert.equal(suggestions.length > 0, true);
    assert.equal(suggestions[0].source, "local_index");
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.GOOGLE_PLACES_API_KEY;
    } else {
      process.env.GOOGLE_PLACES_API_KEY = originalApiKey;
    }
    clearDestinationAutocompleteCache();
  }
});

test("getDestinationAutocompleteSuggestions caches live provider responses", async () => {
  const originalApiKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalFetch = global.fetch;
  let fetchCalls = 0;

  try {
    process.env.GOOGLE_PLACES_API_KEY = "test-key";
    clearDestinationAutocompleteCache();
    global.fetch = async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          status: "OK",
          predictions: [
            {
              description: "Kyoto, Japan",
              place_id: "kyoto-place-id",
              structured_formatting: {
                main_text: "Kyoto",
                secondary_text: "Japan",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    };

    const first = await getDestinationAutocompleteSuggestions({
      query: "kyoto",
      forceRefresh: true,
    });

    global.fetch = async () => {
      throw new Error("Unexpected network call after cache warmup");
    };

    const second = await getDestinationAutocompleteSuggestions({
      query: "kyoto",
    });

    assert.equal(fetchCalls, 1);
    assert.deepEqual(second, first);
    assert.equal(second[0].source, "google_places");
    assert.equal(second[0].placeId, "kyoto-place-id");
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.GOOGLE_PLACES_API_KEY;
    } else {
      process.env.GOOGLE_PLACES_API_KEY = originalApiKey;
    }
    global.fetch = originalFetch;
    clearDestinationAutocompleteCache();
  }
});
