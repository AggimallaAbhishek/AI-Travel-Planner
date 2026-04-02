import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPlanningFallbackResult,
  resolveFirestoreOperationTimeoutMs,
  resolveTripMemoryFallbackEnabled,
  resolveTripPlanningFallbackEnabled,
} from "../server/services/trips.js";

test("buildPlanningFallbackResult returns a usable template trip payload", () => {
  const fallback = buildPlanningFallbackResult({
    userSelection: {
      location: { label: "Kyoto, Japan" },
      days: 4,
      budgetAmount: 2200,
      travelers: "2 Travelers",
      planType: "Moderate Plan",
      travelStyle: "Cultural",
      pace: "Balanced",
      foodPreferences: ["Vegetarian"],
    },
    planningRequest: {
      destination: "Kyoto, Japan",
      isComplete: true,
      missingFields: [],
    },
    error: new Error("Gemini network timeout"),
  });

  assert.equal(fallback.generatedTrip.aiPlan.destination, "Kyoto, Japan");
  assert.ok(fallback.generatedTrip.aiPlan.days.length > 0);
  assert.equal(
    fallback.generatedTrip.recommendations.provider,
    "template_fallback"
  );
  assert.equal(fallback.planningMeta.validation.status, "partial");
  assert.match(
    fallback.planningMeta.validation.warnings[0],
    /template itinerary/i
  );
  assert.match(fallback.planningMeta.fallbackReason, /network timeout/i);
});

test("resolveTripPlanningFallbackEnabled defaults to true and supports explicit disable", () => {
  const previous = process.env.TRIP_PLANNING_FALLBACK_ENABLED;
  delete process.env.TRIP_PLANNING_FALLBACK_ENABLED;
  assert.equal(resolveTripPlanningFallbackEnabled(), true);

  process.env.TRIP_PLANNING_FALLBACK_ENABLED = "false";
  assert.equal(resolveTripPlanningFallbackEnabled(), false);

  if (previous === undefined) {
    delete process.env.TRIP_PLANNING_FALLBACK_ENABLED;
  } else {
    process.env.TRIP_PLANNING_FALLBACK_ENABLED = previous;
  }
});

test("resolveTripMemoryFallbackEnabled honors explicit env override", () => {
  const previousValue = process.env.TRIP_MEMORY_FALLBACK_ENABLED;

  process.env.TRIP_MEMORY_FALLBACK_ENABLED = "true";
  assert.equal(resolveTripMemoryFallbackEnabled(), true);

  process.env.TRIP_MEMORY_FALLBACK_ENABLED = "false";
  assert.equal(resolveTripMemoryFallbackEnabled(), false);

  if (previousValue === undefined) {
    delete process.env.TRIP_MEMORY_FALLBACK_ENABLED;
  } else {
    process.env.TRIP_MEMORY_FALLBACK_ENABLED = previousValue;
  }
});

test("resolveFirestoreOperationTimeoutMs defaults and supports explicit override", () => {
  const previousValue = process.env.FIRESTORE_OPERATION_TIMEOUT_MS;
  delete process.env.FIRESTORE_OPERATION_TIMEOUT_MS;
  assert.equal(resolveFirestoreOperationTimeoutMs(), 12000);

  process.env.FIRESTORE_OPERATION_TIMEOUT_MS = "25000";
  assert.equal(resolveFirestoreOperationTimeoutMs(), 25000);

  process.env.FIRESTORE_OPERATION_TIMEOUT_MS = "invalid";
  assert.equal(resolveFirestoreOperationTimeoutMs(), 12000);

  if (previousValue === undefined) {
    delete process.env.FIRESTORE_OPERATION_TIMEOUT_MS;
  } else {
    process.env.FIRESTORE_OPERATION_TIMEOUT_MS = previousValue;
  }
});
