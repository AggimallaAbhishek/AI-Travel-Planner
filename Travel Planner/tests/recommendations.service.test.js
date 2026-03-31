import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMockDestinationRecommendations,
  createDestinationRecommendationService,
} from "../server/services/recommendations.js";

test("buildMockDestinationRecommendations returns balanced hotel and restaurant cards", () => {
  const recommendations = buildMockDestinationRecommendations({
    destination: "Seoul, South Korea",
    userSelection: {
      budget: "Moderate",
      travelers: "Friends",
    },
    limit: 4,
  });

  assert.equal(recommendations.provider, "mock");
  assert.equal(recommendations.hotels.length, 4);
  assert.equal(recommendations.restaurants.length, 4);
  assert.equal(recommendations.hotels[0].category, "hotel");
  assert.equal(recommendations.restaurants[0].category, "restaurant");
});

test("destination recommendation service caches live provider responses by destination", async () => {
  let fetchCalls = 0;
  let currentTime = 0;
  const service = createDestinationRecommendationService({
    now: () => currentTime,
    cacheTtlMs: 10_000,
    resolveApiKey: () => "test-key",
    fetchImpl: async (_url, options) => {
      fetchCalls += 1;
      const request = JSON.parse(options.body);
      const isHotelQuery = request.includedType === "lodging";

      return {
        ok: true,
        async json() {
          return {
            places: [
              {
                displayName: {
                  text: isHotelQuery ? "Atlas Haven" : "Ember Table",
                },
                formattedAddress: isHotelQuery
                  ? "Downtown, Kyoto"
                  : "Gion, Kyoto",
                rating: isHotelQuery ? 4.6 : 4.7,
                priceLevel: "PRICE_LEVEL_MODERATE",
                primaryTypeDisplayName: {
                  text: isHotelQuery ? "Hotel" : "Restaurant",
                },
                googleMapsUri: isHotelQuery
                  ? "https://maps.google.com/?q=atlas"
                  : "https://maps.google.com/?q=ember",
              },
            ],
          };
        },
      };
    },
  });

  const first = await service.getRecommendationsForDestination({
    destination: "Kyoto, Japan",
  });
  const second = await service.getRecommendationsForDestination({
    destination: "Kyoto, Japan",
  });

  assert.equal(fetchCalls, 2);
  assert.equal(first.provider, "google-places");
  assert.equal(second.provider, "google-places");
  assert.equal(first.hotels[0].name, "Atlas Haven");
  assert.equal(first.restaurants[0].name, "Ember Table");
});

test("destination recommendation service falls back to mock data when live provider fails", async () => {
  const service = createDestinationRecommendationService({
    resolveApiKey: () => "test-key",
    fetchImpl: async () => {
      throw new Error("network failure");
    },
  });

  const recommendations = await service.getRecommendationsForDestination({
    destination: "Lisbon, Portugal",
    userSelection: {
      budget: "Luxury",
      travelers: "A Couple",
    },
  });

  assert.equal(recommendations.provider, "mock");
  assert.ok(recommendations.warning.includes("temporarily unavailable"));
  assert.equal(recommendations.hotels.length > 0, true);
  assert.equal(recommendations.restaurants.length > 0, true);
});
