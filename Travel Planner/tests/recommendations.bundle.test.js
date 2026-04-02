import test from "node:test";
import assert from "node:assert/strict";
import {
  clearDestinationRecommendationsCache,
  getDestinationDataBundle,
} from "../server/services/recommendations.js";

test("getDestinationDataBundle returns mock hotels/restaurants/attractions when API key is unavailable", async () => {
  const previousApiKey = process.env.GOOGLE_PLACES_API_KEY;

  try {
    delete process.env.GOOGLE_PLACES_API_KEY;
    clearDestinationRecommendationsCache();

    const bundle = await getDestinationDataBundle({
      destination: "Lisbon, Portugal",
    });

    assert.equal(bundle.provider, "mock");
    assert.equal(bundle.recommendations.hotels.length > 0, true);
    assert.equal(bundle.recommendations.restaurants.length > 0, true);
    assert.equal(bundle.places.attractions.length > 0, true);
    assert.match(bundle.warning, /curated sample/i);
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.GOOGLE_PLACES_API_KEY;
    } else {
      process.env.GOOGLE_PLACES_API_KEY = previousApiKey;
    }
    clearDestinationRecommendationsCache();
  }
});

