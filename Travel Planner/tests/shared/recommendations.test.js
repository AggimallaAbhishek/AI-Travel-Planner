import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGoogleMapsSearchUrl,
  normalizeDestinationRecommendations,
  normalizeRecommendationItem,
} from "../../shared/recommendations.js";

test("normalizeRecommendationItem sanitizes and defaults recommendation cards", () => {
  const normalized = normalizeRecommendationItem(
    {
      name: "  Skyline Suites  ",
      rating: "4.72",
      location: " Main District ",
      description: "  Spacious rooms and great transit access. ",
      priceLabel: 3,
    },
    "hotel"
  );

  assert.equal(normalized.name, "Skyline Suites");
  assert.equal(normalized.rating, 4.7);
  assert.equal(normalized.location, "Main District");
  assert.equal(normalized.priceLabel, "$$$");
  assert.match(normalized.mapsUrl, /google\.com\/maps\/search/);
});

test("normalizeDestinationRecommendations normalizes hotels and restaurants arrays", () => {
  const normalized = normalizeDestinationRecommendations({
    destination: "  Kyoto, Japan ",
    provider: "google_places",
    warning: " ",
    hotels: [{ name: "Hotel A", location: "Kyoto" }],
    restaurants: [{ name: "Restaurant B", location: "Kyoto" }],
  });

  assert.equal(normalized.destination, "Kyoto, Japan");
  assert.equal(normalized.provider, "google_places");
  assert.equal(normalized.warning, "");
  assert.equal(normalized.hotels.length, 1);
  assert.equal(normalized.restaurants.length, 1);
});

test("buildGoogleMapsSearchUrl encodes destination query safely", () => {
  const url = buildGoogleMapsSearchUrl("Paris, France");
  assert.equal(
    url,
    "https://www.google.com/maps/search/?api=1&query=Paris%2C%20France"
  );
});
