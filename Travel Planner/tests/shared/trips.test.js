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
} from "../../shared/trips.js";

test("normalizeUserSelection maps legacy keys into canonical shape", () => {
  const normalized = normalizeUserSelection({
    destination: "Kyoto",
    noOfDays: "5",
    budget: "Luxury",
    travelWith: "Friends",
  });

  assert.deepEqual(normalized, {
    location: { label: "Kyoto" },
    days: 5,
    budget: "Luxury",
    travelers: "Friends",
    travelType: "",
    travelerCount: null,
    objective: "best_experience",
    constraints: {
      dailyTimeLimitHours: 10,
      budgetCap: null,
      mobilityPref: "balanced",
      mealPrefs: [],
    },
    alternativesCount: 3,
  });
});

test("getUserSelectionErrors flags invalid duration range", () => {
  const errors = getUserSelectionErrors({
    location: { label: "Rome" },
    days: 31,
    budget: "Moderate",
    travelers: "Just Me",
  });

  assert.ok(errors.includes("Trip duration must be between 1 and 30 days."));
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

test("buildFallbackGeneratedTrip returns deterministic minimum itinerary", () => {
  const fallback = buildFallbackGeneratedTrip({
    location: { label: "Tokyo" },
    days: 2,
    budget: "Cheap",
    travelers: "Just Me",
  });

  assert.equal(fallback.aiPlan.destination, "Tokyo");
  assert.equal(fallback.aiPlan.days.length, 2);
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
    budget: "Cheap",
    travelers: "Family",
    travelType: "Relaxation",
    travelerCount: 3,
  });

  assert.ok(prompt.includes("Destination: Seoul"));
  assert.ok(prompt.includes("Duration: 4 day(s)"));
  assert.ok(prompt.includes("Budget: Cheap"));
  assert.ok(prompt.includes("Travel Type: Relaxation"));
  assert.ok(prompt.includes("Number of Travelers: 3"));
  assert.ok(prompt.includes("\"total_estimated_cost\""));
});
