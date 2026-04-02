import test from "node:test";
import assert from "node:assert/strict";
import {
  derivePlanningConstraints,
  normalizePlanningRequest,
} from "../server/services/planningRequest.js";

test("normalizePlanningRequest applies defaults and detects missing core fields", () => {
  const request = normalizePlanningRequest({
    destination: "Kyoto, Japan",
    days: 4,
    budget: 1800,
    travelers: "A Couple",
  });

  assert.equal(request.destination, "Kyoto, Japan");
  assert.equal(request.planType, "Best Plan");
  assert.equal(request.travelStyle, "Cultural");
  assert.equal(request.pace, "Balanced");
  assert.deepEqual(request.foodPreferences, []);
  assert.equal(request.isComplete, true);
  assert.deepEqual(request.missingFields, []);
});

test("normalizePlanningRequest reports missing fields from raw input", () => {
  const request = normalizePlanningRequest({
    destination: "Kyoto, Japan",
  });

  assert.equal(request.isComplete, false);
  assert.deepEqual(request.missingFields, ["days", "budget", "travelers"]);
});

test("derivePlanningConstraints computes per-day budget and pace limits", () => {
  const constraints = derivePlanningConstraints({
    location: { label: "Tokyo" },
    days: 5,
    budget: 2000,
    planType: "Moderate Plan",
    pace: "Relaxed",
    travelStyle: "Cultural",
  });

  assert.equal(constraints.perDayBudget, 400);
  assert.equal(constraints.minStopsPerDay, 3);
  assert.equal(constraints.maxStopsPerDay, 4);
  assert.equal(constraints.maxDailyMinutes, 390);
  assert.deepEqual(constraints.preferredCategoryMix, {
    attraction: 0.8,
    restaurant: 0.2,
  });
});
