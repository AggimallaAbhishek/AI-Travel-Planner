import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAiSuggestionChips,
  getBriefCompletionStatus,
  buildSelectionTags,
  buildSmartValidationWarnings,
  getBudgetBreakdownDetails,
  getRecommendedBudgetRange,
  getRecommendedPlanType,
} from "../src/create-trip/intelligence.js";

test("getRecommendedPlanType infers a budget-aligned plan", () => {
  assert.equal(getRecommendedPlanType({ budgetAmount: 900, days: 6 }), "Cheap Plan");
  assert.equal(
    getRecommendedPlanType({ budgetAmount: 2000, days: 5 }),
    "Best Plan"
  );
});

test("getRecommendedBudgetRange and breakdown return stable budget guidance", () => {
  const range = getRecommendedBudgetRange({ planType: "Best Plan", days: 4 });
  const breakdown = getBudgetBreakdownDetails({
    budgetAmount: 2000,
    planType: "Moderate Plan",
  });

  assert.deepEqual(range, { min: 1284, max: 2600 });
  assert.equal(breakdown.length, 3);
  assert.equal(breakdown[0].label, "Stay");
  assert.equal(breakdown[0].formattedAmount, "$900");
  assert.equal(
    breakdown.reduce((sum, item) => sum + item.amount, 0),
    2000
  );
});

test("buildSelectionTags surfaces the user inputs used by itinerary generation", () => {
  const tags = buildSelectionTags({
    budgetAmount: 1800,
    planType: "Moderate Plan",
    travelers: "Family",
    travelStyle: "Cultural",
    pace: "Balanced",
    foodPreferences: ["Vegetarian", "Vegan"],
  });

  assert.deepEqual(tags, [
    "Moderate Plan",
    "$1,800 total",
    "Family",
    "Cultural",
    "Balanced",
    "Vegetarian",
    "Vegan",
  ]);
});

test("buildSmartValidationWarnings highlights mismatches without blocking submission", () => {
  const warnings = buildSmartValidationWarnings({
    location: { label: "" },
    budgetAmount: 600,
    days: 2,
    planType: "Best Plan",
    travelStyle: "Relaxation",
    pace: "Fast-paced",
    foodPreferences: ["Vegan"],
  });

  assert.ok(
    warnings.includes(
      "Your budget aligns more closely with Moderate Plan than Best Plan."
    )
  );
  assert.ok(
    warnings.includes(
      "Relaxation trips usually work better with a balanced or relaxed pace."
    )
  );
  assert.ok(
    warnings.includes("Pick a destination to unlock more precise AI suggestions.")
  );
});

test("buildAiSuggestionChips returns plan, budget, and destination chips", () => {
  const chips = buildAiSuggestionChips({
    travelStyle: "Adventure",
    days: 5,
    budgetAmount: 600,
  });

  assert.equal(chips[0].kind, "plan");
  assert.equal(chips[1].kind, "budget");
  assert.equal(chips.some((chip) => chip.label === "Banff, Canada"), true);
});

test("getBriefCompletionStatus tracks progress for required brief signals", () => {
  const partial = getBriefCompletionStatus({
    location: { label: "Paris, France" },
    days: 4,
    travelers: "A Couple",
    pace: "Balanced",
  });
  const complete = getBriefCompletionStatus({
    location: { label: "Paris, France" },
    days: 4,
    travelers: "A Couple",
    planType: "Moderate Plan",
    budgetAmount: 2400,
    travelStyle: "Cultural",
    pace: "Balanced",
  });

  assert.deepEqual(partial, {
    completed: 4,
    total: 7,
    isReady: false,
  });
  assert.deepEqual(complete, {
    completed: 7,
    total: 7,
    isReady: true,
  });
});
