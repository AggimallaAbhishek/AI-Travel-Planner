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

test("destination recommendation service uses OpenStreetMap when Google Places is not configured", async () => {
  const requests = [];
  const service = createDestinationRecommendationService({
    resolveApiKey: () => "",
    nominatimMinIntervalMs: 0,
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });

      if (String(url).includes("nominatim")) {
        return {
          ok: true,
          async json() {
            return [
              {
                lat: "25.1972",
                lon: "55.2744",
                display_name: "Burj Khalifa, Dubai, United Arab Emirates",
              },
            ];
          },
        };
      }

      const body = decodeURIComponent(String(options.body));
      const isHotelQuery = body.includes("tourism");

      return {
        ok: true,
        async json() {
          return {
            elements: isHotelQuery
              ? [
                  {
                    type: "node",
                    lat: 25.198,
                    lon: 55.2747,
                    tags: {
                      name: "Armani Hotel Dubai",
                      tourism: "hotel",
                      stars: "5",
                      "addr:city": "Dubai",
                    },
                  },
                ]
              : [
                  {
                    type: "node",
                    lat: 25.1965,
                    lon: 55.2753,
                    tags: {
                      name: "At.mosphere",
                      amenity: "restaurant",
                      cuisine: "international;fine dining",
                      "addr:city": "Dubai",
                    },
                  },
                ],
          };
        },
      };
    },
  });

  const recommendations = await service.getRecommendationsForDestination({
    destination: "Burj Khalifa, Dubai",
  });

  assert.equal(recommendations.provider, "openstreetmap");
  assert.ok(recommendations.warning.includes("OpenStreetMap"));
  assert.equal(recommendations.hotels[0].name, "Armani Hotel Dubai");
  assert.equal(recommendations.restaurants[0].name, "At.mosphere");
  assert.equal(recommendations.hotels[0].typeLabel, "5-star stay");
  assert.equal(recommendations.restaurants[0].typeLabel, "international, fine dining");
  assert.equal(requests.length, 3);
});

test("destination recommendation service falls back to mock data when live provider fails", async () => {
  const service = createDestinationRecommendationService({
    resolveApiKey: () => "test-key",
    nominatimMinIntervalMs: 0,
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
