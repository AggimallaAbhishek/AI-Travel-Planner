import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFallbackGeneratedTrip,
  buildTripPrompt,
  getUserSelectionErrors,
  normalizeGeneratedTrip,
  normalizeUserSelection,
  parseAiTripPayload,
  sortTripsNewestFirst,
  suggestPlanTypeFromBudget,
} from "../../shared/trips.js";

test("normalizeUserSelection maps legacy keys into canonical shape", () => {
  const normalized = normalizeUserSelection({
    destination: "Kyoto",
    noOfDays: "5",
    budget: "Luxury",
    travelWith: "Friends",
  });

  assert.equal(normalized.location.label, "Kyoto");
  assert.equal(normalized.days, 5);
  assert.equal(normalized.planType, "Best Plan");
  assert.equal(normalized.travelers, "Friends");
  assert.equal(normalized.budgetAmount > 0, true);
});

test("normalizeUserSelection keeps Mixed food preference exclusive", () => {
  const normalized = normalizeUserSelection({
    foodPreferences: ["Vegetarian", "Mixed", "Vegan"],
  });

  assert.deepEqual(normalized.foodPreferences, ["Mixed"]);
});

test("suggestPlanTypeFromBudget derives plan tiers from daily budget", () => {
  assert.equal(suggestPlanTypeFromBudget(700, 5), "Cheap Plan");
  assert.equal(suggestPlanTypeFromBudget(1200, 5), "Moderate Plan");
  assert.equal(suggestPlanTypeFromBudget(2500, 5), "Best Plan");
});

test("getUserSelectionErrors flags invalid duration range", () => {
  const errors = getUserSelectionErrors({
    location: { label: "Rome" },
    days: 31,
    budget: 1600,
    travelers: "Just Me",
  });

  assert.ok(errors.includes("Trip duration must be between 1 and 30 days."));
});

test("getUserSelectionErrors rejects unrealistic numeric budgets", () => {
  const errors = getUserSelectionErrors({
    location: { label: "Rome" },
    days: 4,
    budget: 99,
    travelers: "Just Me",
  });

  assert.ok(errors.includes("Budget must be between $100 and $50,000."));
});

test("parseAiTripPayload accepts fenced JSON payloads", () => {
  const parsed = parseAiTripPayload(`\`\`\`json
{"hotels":[],"itinerary":{"days":[]}}
\`\`\``);

  assert.deepEqual(parsed, {
    hotels: [],
    itinerary: {
      days: [],
    },
  });
});

test("parseAiTripPayload extracts JSON from noisy model output", () => {
  const parsed = parseAiTripPayload(`
Sure, here is the itinerary:
{"destination":"Rome","days":[{"day":1,"title":"Arrival","activities":["City walk"],"estimated_cost":"$90-$140","tips":"Book museum tickets early."}],"total_estimated_cost":"$360-$560","travel_tips":["Carry a refillable water bottle."]}
  `);

  assert.equal(parsed.destination, "Rome");
  assert.equal(parsed.days[0].day, 1);
});

test("normalizeGeneratedTrip normalizes itinerary day objects and defaults", () => {
  const normalized = normalizeGeneratedTrip({
    hotels: [
      {
        name: "Central Stay",
        address: "Downtown",
        rating: "4.6",
      },
    ],
    itinerary: {
      day2: [
        {
          name: "Museum",
          details: "Art and history",
        },
      ],
      day1: [
        {
          name: "Old Town Walk",
          travelTime: "15 min",
        },
      ],
    },
  });

  assert.equal(normalized.hotels.length, 1);
  assert.equal(normalized.hotels[0].hotelName, "Central Stay");
  assert.equal(normalized.itinerary.days.length, 2);
  assert.equal(normalized.itinerary.days[0].dayNumber, 1);
  assert.equal(normalized.itinerary.days[1].dayNumber, 2);
  assert.equal(normalized.aiPlan.days.length, 2);
});

test("normalizeGeneratedTrip maps strict Gemini JSON shape to aiPlan and itinerary", () => {
  const normalized = normalizeGeneratedTrip({
    destination: "Bali",
    days: [
      {
        day: 1,
        title: "Arrival and beach sunset",
        activities: ["Hotel check-in", "Seminyak Beach walk", "Sunset dinner"],
        estimated_cost: "$80-$130",
        tips: "Keep local cash for small vendors.",
      },
    ],
    total_estimated_cost: "$320-$520",
    travel_tips: ["Use ride-hailing apps for reliable transport."],
  });

  assert.equal(normalized.aiPlan.destination, "Bali");
  assert.equal(normalized.aiPlan.days.length, 1);
  assert.equal(normalized.aiPlan.days[0].activities.length, 3);
  assert.equal(normalized.aiPlan.totalEstimatedCost, "$320-$520");
  assert.equal(normalized.itinerary.days[0].places[0].placeName, "Hotel check-in");
});

test("buildFallbackGeneratedTrip responds to travel style, pace, and food preferences", () => {
  const fallback = buildFallbackGeneratedTrip({
    location: { label: "Tokyo" },
    days: 2,
    budget: 500,
    travelers: "Just Me",
    travelStyle: "Adventure",
    pace: "Fast-paced",
    foodPreferences: ["Vegan"],
  });

  assert.equal(fallback.aiPlan.destination, "Tokyo");
  assert.equal(fallback.aiPlan.days.length, 2);
  assert.equal(
    fallback.aiPlan.days[0].activities.some((activity) =>
      activity.toLowerCase().includes("vegan")
    ),
    true
  );
  assert.equal(fallback.itinerary.days.length, 2);
  assert.ok(fallback.aiPlan.totalEstimatedCost.includes("$"));
});

test("sortTripsNewestFirst sorts by descending createdAt", () => {
  const trips = sortTripsNewestFirst([
    { id: "old", createdAt: "2024-01-01T00:00:00.000Z" },
    { id: "new", createdAt: "2025-01-01T00:00:00.000Z" },
    { id: "mid", createdAt: "2024-07-01T00:00:00.000Z" },
  ]);

  assert.deepEqual(trips.map((trip) => trip.id), ["new", "mid", "old"]);
});

test("buildTripPrompt contains all normalized user selection fields", () => {
  const prompt = buildTripPrompt({
    location: { label: "Seoul" },
    days: 4,
    budget: 1600,
    planType: "Cheap Plan",
    travelers: "Family",
    travelStyle: "Relaxation",
    travelerCount: 3,
    pace: "Balanced",
    foodPreferences: ["Vegetarian"],
  });

  assert.ok(prompt.includes("Destination: Seoul"));
  assert.ok(prompt.includes("Plan Type: Cheap Plan"));
  assert.ok(prompt.includes("Total Budget: $1,600 total"));
  assert.ok(prompt.includes("Travel Style: Relaxation"));
  assert.ok(prompt.includes("Time Preference: Balanced"));
  assert.ok(prompt.includes("Food Preferences: Vegetarian"));
  assert.ok(prompt.includes("Number of Travelers: 3"));
  assert.ok(prompt.includes("\"total_estimated_cost\""));
});
