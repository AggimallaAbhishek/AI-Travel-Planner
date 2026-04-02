import test from "node:test";
import assert from "node:assert/strict";
import {
  clearDestinationRecommendationsCache,
  getDestinationRecommendations,
} from "../server/services/recommendations.js";

function createGooglePlacesResult({ name, rating = 4.5, priceLevel = 2 }) {
  return {
    name,
    formatted_address: "City Center",
    rating,
    price_level: priceLevel,
    geometry: {
      location: {
        lat: 41.9028,
        lng: 12.4964,
      },
    },
  };
}

test("getDestinationRecommendations falls back to mock data when API key is missing", async () => {
  const originalApiKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalFetch = globalThis.fetch;

  try {
    delete process.env.GOOGLE_PLACES_API_KEY;
    clearDestinationRecommendationsCache();

    const recommendations = await getDestinationRecommendations({
      destination: "Rome, Italy",
    });

    assert.equal(recommendations.provider, "mock");
    assert.equal(recommendations.hotels.length > 0, true);
    assert.equal(recommendations.restaurants.length > 0, true);
    assert.match(recommendations.warning, /curated sample/i);
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.GOOGLE_PLACES_API_KEY;
    } else {
      process.env.GOOGLE_PLACES_API_KEY = originalApiKey;
    }

    globalThis.fetch = originalFetch;
    clearDestinationRecommendationsCache();
  }
});

test("getDestinationRecommendations caches live provider responses and respects force refresh", async () => {
  const originalApiKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;

  try {
    process.env.GOOGLE_PLACES_API_KEY = "test-key";
    clearDestinationRecommendationsCache();

    globalThis.fetch = async (input) => {
      fetchCallCount += 1;

      const url =
        input instanceof URL
          ? input
          : new URL(typeof input === "string" ? input : input.url);
      const query = url.searchParams.get("query") ?? "";
      const isHotelQuery = query.toLowerCase().includes("hotel");

      return {
        ok: true,
        async json() {
          return {
            status: "OK",
            results: [
              createGooglePlacesResult({
                name: isHotelQuery ? "Central Grand Hotel" : "Bistro Roma",
                priceLevel: isHotelQuery ? 3 : 2,
              }),
            ],
          };
        },
      };
    };

    const first = await getDestinationRecommendations({
      destination: "Rome, Italy",
    });
    const second = await getDestinationRecommendations({
      destination: "Rome, Italy",
    });
    const third = await getDestinationRecommendations({
      destination: "Rome, Italy",
      forceRefresh: true,
    });

    assert.equal(first.provider, "google_places");
    assert.equal(first.hotels[0].name, "Central Grand Hotel");
    assert.equal(first.restaurants[0].name, "Bistro Roma");
    assert.equal(second.provider, "google_places");
    assert.equal(third.provider, "google_places");
    assert.equal(fetchCallCount, 4);
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.GOOGLE_PLACES_API_KEY;
    } else {
      process.env.GOOGLE_PLACES_API_KEY = originalApiKey;
    }

    globalThis.fetch = originalFetch;
    clearDestinationRecommendationsCache();
  }
});

test("getDestinationRecommendations rejects invalid destination input", async () => {
  await assert.rejects(
    async () =>
      getDestinationRecommendations({
        destination: "",
      }),
    (error) => {
      assert.equal(error.code, "recommendations/invalid-destination");
      return true;
    }
  );
});
