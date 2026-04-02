import test from "node:test";
import assert from "node:assert/strict";
import {
  clearDestinationRecommendationsCache,
  getDestinationDataBundle,
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
        lat: 22.5726,
        lng: 88.3639,
      },
    },
  };
}

test("getDestinationDataBundle returns verified-unavailable bundle for non-India destinations when API key is unavailable", async () => {
  const previousApiKey = process.env.GOOGLE_PLACES_API_KEY;
  const previousAllowMock = process.env.ALLOW_MOCK_PLACE_DATA;

  try {
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.ALLOW_MOCK_PLACE_DATA;
    clearDestinationRecommendationsCache();

    const bundle = await getDestinationDataBundle({
      destination: "Lisbon, Portugal",
    });

    assert.equal(bundle.provider, "verified_unavailable");
    assert.equal(bundle.recommendations.hotels.length, 0);
    assert.equal(bundle.recommendations.restaurants.length, 0);
    assert.equal(bundle.places.attractions.length, 0);
    assert.match(bundle.warning, /verified/i);
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.GOOGLE_PLACES_API_KEY;
    } else {
      process.env.GOOGLE_PLACES_API_KEY = previousApiKey;
    }
    if (previousAllowMock === undefined) {
      delete process.env.ALLOW_MOCK_PLACE_DATA;
    } else {
      process.env.ALLOW_MOCK_PLACE_DATA = previousAllowMock;
    }
    clearDestinationRecommendationsCache();
  }
});

test("getDestinationDataBundle uses India dataset attractions when API key is unavailable", async () => {
  const previousApiKey = process.env.GOOGLE_PLACES_API_KEY;
  const previousAllowMock = process.env.ALLOW_MOCK_PLACE_DATA;

  try {
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.ALLOW_MOCK_PLACE_DATA;
    clearDestinationRecommendationsCache();

    const bundle = await getDestinationDataBundle({
      destination: "Jaipur, Rajasthan, India",
    });

    assert.equal(bundle.provider, "india_dataset");
    assert.equal(bundle.recommendations.hotels.length, 0);
    assert.equal(bundle.recommendations.restaurants.length, 0);
    assert.equal(bundle.places.attractions.length > 0, true);
    assert.equal(bundle.places.attractions.every((place) => place.source === "india_dataset"), true);
    assert.equal(
      bundle.places.attractions.some((place) => String(place.name).toLowerCase() === "explore"),
      false
    );
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.GOOGLE_PLACES_API_KEY;
    } else {
      process.env.GOOGLE_PLACES_API_KEY = previousApiKey;
    }
    if (previousAllowMock === undefined) {
      delete process.env.ALLOW_MOCK_PLACE_DATA;
    } else {
      process.env.ALLOW_MOCK_PLACE_DATA = previousAllowMock;
    }
    clearDestinationRecommendationsCache();
  }
});

test("getDestinationDataBundle backfills missing hotels and restaurants using nearby search", async () => {
  const previousApiKey = process.env.GOOGLE_PLACES_API_KEY;
  const previousAllowMock = process.env.ALLOW_MOCK_PLACE_DATA;
  const previousFetch = globalThis.fetch;

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
        if (query.includes("best hotels") || query.includes("best restaurants")) {
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

        if (query.includes("top attractions")) {
          return {
            ok: true,
            async json() {
              return {
                status: "OK",
                results: [createGooglePlacesResult({ name: "Victoria Memorial" })],
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
        const type = String(url.searchParams.get("type") ?? "");
        if (type === "lodging") {
          return {
            ok: true,
            async json() {
              return {
                status: "OK",
                results: [createGooglePlacesResult({ name: "Kolkata Grand Hotel", priceLevel: 3 })],
              };
            },
          };
        }

        if (type === "restaurant") {
          return {
            ok: true,
            async json() {
              return {
                status: "OK",
                results: [createGooglePlacesResult({ name: "Bengal House Restaurant", priceLevel: 2 })],
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

      throw new Error(`Unexpected URL: ${url.toString()}`);
    };

    const bundle = await getDestinationDataBundle({
      destination: "Kolkata, West Bengal, India",
    });

    assert.equal(bundle.provider, "google_places");
    assert.equal(bundle.recommendations.hotels.length > 0, true);
    assert.equal(bundle.recommendations.restaurants.length > 0, true);
    assert.equal(bundle.places.attractions.length > 0, true);
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.GOOGLE_PLACES_API_KEY;
    } else {
      process.env.GOOGLE_PLACES_API_KEY = previousApiKey;
    }
    if (previousAllowMock === undefined) {
      delete process.env.ALLOW_MOCK_PLACE_DATA;
    } else {
      process.env.ALLOW_MOCK_PLACE_DATA = previousAllowMock;
    }
    globalThis.fetch = previousFetch;
    clearDestinationRecommendationsCache();
  }
});
