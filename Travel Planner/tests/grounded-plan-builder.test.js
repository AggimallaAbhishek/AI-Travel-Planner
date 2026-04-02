import test from "node:test";
import assert from "node:assert/strict";
import { buildGroundedPlan } from "../server/services/groundedPlanBuilder.js";

const SELECTION = {
  location: { label: "Kyoto, Japan" },
  days: 1,
  budget: 1800,
  planType: "Moderate Plan",
  travelers: "A Couple",
  travelStyle: "Cultural",
  pace: "Balanced",
  foodPreferences: ["Vegetarian"],
};

const CANDIDATE_PLACES = [
  {
    id: "pl_1",
    category: "attraction",
    name: "Fushimi Inari Taisha",
    address: "Kyoto",
    coordinates: { latitude: 34.9671, longitude: 135.7727 },
    rating: 4.8,
    priceLevel: "$$",
    description: "Verified shrine stop.",
    source: "structured_store",
    metadata: {},
  },
  {
    id: "pl_2",
    category: "attraction",
    name: "Kiyomizu-dera",
    address: "Kyoto",
    coordinates: { latitude: 34.9948, longitude: 135.785 },
    rating: 4.7,
    priceLevel: "$$",
    description: "Verified temple stop.",
    source: "structured_store",
    metadata: {},
  },
];

const HOTELS = [
  {
    id: "ht_1",
    category: "hotel",
    name: "Hotel The Celestine Kyoto Gion",
    address: "Kyoto",
    coordinates: { latitude: 34.9992, longitude: 135.7784 },
    rating: 4.6,
    priceLevel: "$$$",
    description: "Verified hotel.",
    source: "structured_store",
    metadata: {},
  },
];

const RESTAURANTS = [
  {
    id: "rs_1",
    category: "restaurant",
    name: "Mumokuteki Cafe",
    address: "Kyoto",
    coordinates: { latitude: 35.0044, longitude: 135.7672 },
    rating: 4.5,
    priceLevel: "$$",
    description: "Vegetarian restaurant.",
    source: "structured_store",
    metadata: {
      types: ["restaurant", "vegetarian_restaurant"],
    },
  },
];

const TRANSPORT_EDGES = [
  {
    fromPlaceId: "ht_1",
    toPlaceId: "pl_1",
    durationSeconds: 1200,
    weight: 1200,
    source: "distance_matrix",
  },
  {
    fromPlaceId: "pl_1",
    toPlaceId: "pl_2",
    durationSeconds: 1500,
    weight: 1500,
    source: "distance_matrix",
  },
  {
    fromPlaceId: "pl_2",
    toPlaceId: "rs_1",
    durationSeconds: 900,
    weight: 900,
    source: "haversine_fallback",
  },
];

test("buildGroundedPlan returns grounded route, budget, and validation metadata", () => {
  const groundedPlan = buildGroundedPlan({
    destination: "Kyoto, Japan",
    selection: SELECTION,
    dayPlans: [{ day: 1, clusterId: 0, visitOrder: [0, 1], stopCount: 2 }],
    candidatePlaces: CANDIDATE_PLACES,
    placesByCategory: {
      hotels: HOTELS,
      restaurants: RESTAURANTS,
      attractions: CANDIDATE_PLACES,
    },
    transportEdges: TRANSPORT_EDGES,
    narrativeDays: [],
  });

  assert.equal(groundedPlan.destination, "Kyoto, Japan");
  assert.equal(groundedPlan.days.length, 1);
  assert.deepEqual(groundedPlan.days[0].route, ["ht_1", "pl_1", "pl_2", "rs_1"]);
  assert.equal(groundedPlan.days[0].restaurants[0].foodTags.includes("Vegetarian"), true);
  assert.equal(groundedPlan.days[0].estimatedCostAmount > 0, true);
  assert.equal(groundedPlan.validation.usedFallbackEdges, true);
  assert.equal(groundedPlan.validation.fallbackEdgeCount, 1);
});
