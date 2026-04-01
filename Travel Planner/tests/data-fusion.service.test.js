import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTripFusionIndex,
  findLowConfidenceActivities,
} from "../server/services/dataFusion.js";

test("buildTripFusionIndex merges itinerary and recommendation sources", () => {
  const fusionIndex = buildTripFusionIndex({
    trip: {
      userSelection: {
        location: {
          label: "Kyoto, Japan",
        },
      },
      itinerary: {
        days: [
          {
            dayNumber: 1,
            places: [
              {
                placeName: "Fushimi Inari Shrine",
                location: "Kyoto",
                category: "activity",
              },
            ],
          },
        ],
      },
      hotels: [
        {
          hotelName: "Atlas Haven",
          hotelAddress: "Downtown Kyoto",
        },
      ],
    },
    recommendations: {
      destination: "Kyoto, Japan",
      provider: "google-places",
      fetchedAt: "2026-04-01T00:00:00.000Z",
      hotels: [
        {
          name: "Atlas Haven",
          location: "Downtown Kyoto",
          category: "hotel",
        },
      ],
      restaurants: [
        {
          name: "Ember Table",
          location: "Gion, Kyoto",
          category: "restaurant",
        },
      ],
    },
  });

  assert.equal(fusionIndex.destination, "Kyoto, Japan");
  assert.equal(fusionIndex.items.length >= 3, true);
  assert.equal(fusionIndex.stats.itemCount >= 3, true);
  assert.equal(
    fusionIndex.items.some((item) => item.name === "Atlas Haven"),
    true
  );
});

test("findLowConfidenceActivities identifies missing itinerary activities", () => {
  const trip = {
    itinerary: {
      days: [
        {
          dayNumber: 1,
          places: [{ placeName: "Unknown Hidden Spot" }],
        },
      ],
    },
  };
  const fusionIndex = {
    items: [
      {
        name: "Known Museum",
        confidence: 0.95,
      },
    ],
  };

  const lowConfidence = findLowConfidenceActivities({
    trip,
    fusionIndex,
    minConfidence: 0.55,
  });

  assert.equal(lowConfidence.length, 1);
  assert.equal(lowConfidence[0].name, "Unknown Hidden Spot");
});
