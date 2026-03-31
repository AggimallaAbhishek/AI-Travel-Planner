import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDestinationRecommendations,
  normalizeRecommendationItem,
} from "../../shared/recommendations.js";

test("normalizeRecommendationItem maps legacy fields into the shared card shape", () => {
  const item = normalizeRecommendationItem(
    {
      hotelName: "Luma Suites",
      hotelAddress: "City Center, Kyoto",
      rating: "4.7",
      description: "A polished stay close to transit and nightlife.",
      price: "$180-$240 / night",
      googleMapsUri: "https://maps.google.com/?q=luma",
      primaryTypeDisplayName: "Boutique hotel",
    },
    { category: "hotel" }
  );

  assert.equal(item.name, "Luma Suites");
  assert.equal(item.location, "City Center, Kyoto");
  assert.equal(item.rating, 4.7);
  assert.equal(item.priceLabel, "$180-$240 / night");
  assert.equal(item.typeLabel, "Boutique hotel");
  assert.equal(item.mapsUrl, "https://maps.google.com/?q=luma");
  assert.equal(item.category, "hotel");
});

test("normalizeRecommendationItem falls back to a safe Google Maps search URL", () => {
  const item = normalizeRecommendationItem(
    {
      name: "Saffron Table",
      location: "Old Town, Jaipur",
      mapsUrl: "javascript:alert(1)",
    },
    { category: "restaurant" }
  );

  assert.equal(
    item.mapsUrl,
    "https://www.google.com/maps/search/?api=1&query=Saffron%20Table%2C%20Old%20Town%2C%20Jaipur"
  );
  assert.equal(item.category, "restaurant");
});

test("normalizeDestinationRecommendations removes duplicate venues and normalizes defaults", () => {
  const recommendations = normalizeDestinationRecommendations({
    destination: "Bali, Indonesia",
    hotels: [
      { name: "Atlas Haven", location: "Seminyak, Bali" },
      { name: "Atlas Haven", location: "Seminyak, Bali" },
    ],
    restaurants: [{ name: "Ember Social", location: "Canggu, Bali" }],
    provider: "mock",
  });

  assert.equal(recommendations.destination, "Bali, Indonesia");
  assert.equal(recommendations.hotels.length, 1);
  assert.equal(recommendations.restaurants.length, 1);
  assert.equal(recommendations.provider, "mock");
  assert.ok(recommendations.fetchedAt);
});
