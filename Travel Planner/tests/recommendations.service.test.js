import test from "node:test";
import assert from "node:assert/strict";
import {
  clearDestinationRecommendationsCache,
  getDestinationRecommendations,
} from "../server/services/recommendations.js";

function createGooglePlacesResult({ name, rating = 4.5, priceLevel = 2 }) {
  return {
    name,
    place_id: `test-${name.replace(/\s+/g, "-").toLowerCase()}`,
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

test("getDestinationRecommendations returns only verified data when API key is missing", async () => {
  const originalApiKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalFetch = globalThis.fetch;
  const originalAllowMock = process.env.ALLOW_MOCK_PLACE_DATA;

  try {
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.ALLOW_MOCK_PLACE_DATA;
    clearDestinationRecommendationsCache();

    const recommendations = await getDestinationRecommendations({
      destination: "Rome, Italy",
    });

    assert.equal(recommendations.provider, "verified_unavailable");
    assert.equal(recommendations.hotels.length, 0);
    assert.equal(recommendations.restaurants.length, 0);
    assert.match(recommendations.warning, /verified/i);
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.GOOGLE_PLACES_API_KEY;
    } else {
      process.env.GOOGLE_PLACES_API_KEY = originalApiKey;
    }
    if (originalAllowMock === undefined) {
      delete process.env.ALLOW_MOCK_PLACE_DATA;
    } else {
      process.env.ALLOW_MOCK_PLACE_DATA = originalAllowMock;
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

test("getDestinationRecommendations backfills missing hotels with nearby search", async () => {
  const originalApiKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalFetch = globalThis.fetch;
  const originalAllowMock = process.env.ALLOW_MOCK_PLACE_DATA;

  try {
    process.env.GOOGLE_PLACES_API_KEY = "test-key";
    delete process.env.ALLOW_MOCK_PLACE_DATA;
    clearDestinationRecommendationsCache();

    globalThis.fetch = async (input) => {
      const url =
        input instanceof URL
          ? input
          : new URL(typeof input === "string" ? input : input.url);

      if (url.pathname.endsWith("/textsearch/json")) {
        const query = String(url.searchParams.get("query") ?? "").toLowerCase();
        if (query.includes("best hotels")) {
          return {
            ok: true,
            async json() {
              return {
                status: "ZERO_RESULTS",
                results: [],
              };
            },
          };
        }

        if (query.includes("best restaurants")) {
          return {
            ok: true,
            async json() {
              return {
                status: "OK",
                results: [createGooglePlacesResult({ name: "Park Street Bistro" })],
              };
            },
          };
        }

        return {
          ok: true,
          async json() {
            return {
              status: "ZERO_RESULTS",
              results: [],
            };
          },
        };
      }

      if (url.pathname.endsWith("/nearbysearch/json")) {
        return {
          ok: true,
          async json() {
            return {
              status: "OK",
              results: [createGooglePlacesResult({ name: "The Imperial Kolkata", priceLevel: 3 })],
            };
          },
        };
      }

      throw new Error(`Unexpected URL: ${url.toString()}`);
    };

    const recommendations = await getDestinationRecommendations({
      destination: "Kolkata, West Bengal, India",
    });

    assert.equal(recommendations.provider, "google_places");
    assert.equal(recommendations.hotels.length > 0, true);
    assert.equal(
      recommendations.hotels.some((hotel) =>
        String(hotel.name).toLowerCase().includes("imperial")
      ),
      true
    );
    assert.equal(recommendations.restaurants.length > 0, true);
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.GOOGLE_PLACES_API_KEY;
    } else {
      process.env.GOOGLE_PLACES_API_KEY = originalApiKey;
    }

    if (originalAllowMock === undefined) {
      delete process.env.ALLOW_MOCK_PLACE_DATA;
    } else {
      process.env.ALLOW_MOCK_PLACE_DATA = originalAllowMock;
    }

    globalThis.fetch = originalFetch;
    clearDestinationRecommendationsCache();
  }
});

test("getDestinationRecommendations bypasses cached unavailable data when API key becomes available", async () => {
  const originalApiKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalFetch = globalThis.fetch;
  const originalAllowMock = process.env.ALLOW_MOCK_PLACE_DATA;
  let fetchCallCount = 0;

  try {
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.ALLOW_MOCK_PLACE_DATA;
    clearDestinationRecommendationsCache();

    const unavailable = await getDestinationRecommendations({
      destination: "Paris, France",
    });
    assert.equal(unavailable.provider, "verified_unavailable");

    process.env.GOOGLE_PLACES_API_KEY = "test-key";
    globalThis.fetch = async (input) => {
      fetchCallCount += 1;
      const url =
        input instanceof URL
          ? input
          : new URL(typeof input === "string" ? input : input.url);

      if (url.pathname.endsWith("/textsearch/json")) {
        const query = String(url.searchParams.get("query") ?? "").toLowerCase();
        const isHotelQuery = query.includes("best hotels");
        return {
          ok: true,
          async json() {
            return {
              status: "OK",
              results: [
                createGooglePlacesResult({
                  name: isHotelQuery ? "Paris Central Hotel" : "Cafe de Paris",
                  priceLevel: isHotelQuery ? 3 : 2,
                }),
              ],
            };
          },
        };
      }

      if (url.pathname.endsWith("/nearbysearch/json")) {
        return {
          ok: true,
          async json() {
            return {
              status: "ZERO_RESULTS",
              results: [],
            };
          },
        };
      }

      throw new Error(`Unexpected URL: ${url.toString()}`);
    };

    const refreshed = await getDestinationRecommendations({
      destination: "Paris, France",
    });

    assert.equal(refreshed.provider, "google_places");
    assert.equal(refreshed.hotels.length > 0, true);
    assert.equal(refreshed.restaurants.length > 0, true);
    assert.equal(fetchCallCount >= 2, true);
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.GOOGLE_PLACES_API_KEY;
    } else {
      process.env.GOOGLE_PLACES_API_KEY = originalApiKey;
    }

    if (originalAllowMock === undefined) {
      delete process.env.ALLOW_MOCK_PLACE_DATA;
    } else {
      process.env.ALLOW_MOCK_PLACE_DATA = originalAllowMock;
    }

    globalThis.fetch = originalFetch;
    clearDestinationRecommendationsCache();
  }
});

test("getDestinationRecommendations annotates ranking metadata for verified results", async () => {
  const originalApiKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalFetch = globalThis.fetch;

  try {
    process.env.GOOGLE_PLACES_API_KEY = "test-key";
    clearDestinationRecommendationsCache();

    globalThis.fetch = async (input) => {
      const url =
        input instanceof URL
          ? input
          : new URL(typeof input === "string" ? input : input.url);
      const query = String(url.searchParams.get("query") ?? "").toLowerCase();

      if (url.pathname.endsWith("/textsearch/json")) {
        const isHotelQuery = query.includes("best hotels");
        return {
          ok: true,
          async json() {
            return {
              status: "OK",
              results: [
                {
                  ...createGooglePlacesResult({
                    name: isHotelQuery ? "Riverfront Hotel" : "Spice Route Kitchen",
                    rating: isHotelQuery ? 4.7 : 4.6,
                    priceLevel: isHotelQuery ? 3 : 2,
                  }),
                  user_ratings_total: isHotelQuery ? 1200 : 890,
                },
              ],
            };
          },
        };
      }

      if (url.pathname.endsWith("/nearbysearch/json")) {
        return {
          ok: true,
          async json() {
            return {
              status: "ZERO_RESULTS",
              results: [],
            };
          },
        };
      }

      throw new Error(`Unexpected URL: ${url.toString()}`);
    };

    const recommendations = await getDestinationRecommendations({
      destination: "Kolkata, West Bengal, India",
    });

    assert.equal(recommendations.provider, "google_places");
    assert.equal(recommendations.hotels.length > 0, true);
    assert.equal(recommendations.restaurants.length > 0, true);
    assert.equal(recommendations.hotels[0].verificationSource, "google_places");
    assert.equal(
      Number.isFinite(Number.parseFloat(recommendations.hotels[0].rankingScore)),
      true
    );
    assert.equal(
      recommendations.hotels[0].budgetCategory === "premium" ||
        recommendations.hotels[0].budgetCategory === "midrange" ||
        recommendations.hotels[0].budgetCategory === "budget",
      true
    );
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
