import {
  buildBudgetBreakdown,
  buildRecommendedBudgetRange,
  formatBudgetAmount,
  formatBudgetSummary,
  normalizeUserSelection,
  suggestPlanTypeFromBudget,
} from "../../shared/trips.js";

export const BUDGET_MIN = 300;
export const BUDGET_MAX = 20000;
export const BUDGET_STEP = 100;

const DESTINATION_SUGGESTIONS_BY_STYLE = {
  Adventure: ["Banff, Canada", "Queenstown, New Zealand", "Cape Town, South Africa"],
  Relaxation: ["Maldives", "Bali, Indonesia", "Santorini, Greece"],
  Cultural: ["Kyoto, Japan", "Istanbul, Turkey", "Paris, France"],
  Nightlife: ["Rio de Janeiro, Brazil", "Dubai, United Arab Emirates", "Singapore"],
  default: ["Kyoto, Japan", "Bali, Indonesia", "Cape Town, South Africa"],
};

export function getRecommendedPlanType(selectionInput = {}) {
  const selection = normalizeUserSelection(selectionInput);
  return (
    suggestPlanTypeFromBudget(selection.budgetAmount, selection.days) ||
    selection.planType ||
    "Moderate Plan"
  );
}

export function getRecommendedBudgetRange(selectionInput = {}) {
  const selection = normalizeUserSelection(selectionInput);
  return buildRecommendedBudgetRange(
    selection.planType || getRecommendedPlanType(selection),
    selection.days
  );
}

export function getBudgetBreakdownDetails(selectionInput = {}) {
  const selection = normalizeUserSelection(selectionInput);
  const recommendedRange = getRecommendedBudgetRange(selection);
  const effectiveBudget =
    selection.budgetAmount ?? Math.round((recommendedRange.min + recommendedRange.max) / 2);
  const breakdown = buildBudgetBreakdown(
    effectiveBudget,
    selection.planType || getRecommendedPlanType(selection)
  );

  return [
    {
      id: "stay",
      label: "Stay",
      amount: breakdown.stay,
      percent: Math.round((breakdown.stay / breakdown.total) * 100),
      description: "Hotels, check-ins, and accommodation upgrades.",
    },
    {
      id: "food",
      label: "Food",
      amount: breakdown.food,
      percent: Math.round((breakdown.food / breakdown.total) * 100),
      description: "Dining, cafes, and food-focused detours.",
    },
    {
      id: "travel",
      label: "Travel",
      amount: breakdown.travel,
      percent: Math.round((breakdown.travel / breakdown.total) * 100),
      description: "Transfers, local transport, and route efficiency.",
    },
  ].map((item) => ({
    ...item,
    formattedAmount: formatBudgetAmount(item.amount),
  }));
}

export function buildSelectionTags(selectionInput = {}) {
  const selection = normalizeUserSelection(selectionInput);
  const tags = [];

  if (selection.planType) {
    tags.push(selection.planType);
  }

  if (selection.budgetAmount) {
    tags.push(formatBudgetSummary(selection));
  }

  if (selection.travelers) {
    tags.push(selection.travelers);
  }

  if (selection.travelStyle) {
    tags.push(selection.travelStyle);
  }

  if (selection.pace) {
    tags.push(selection.pace);
  }

  for (const foodPreference of selection.foodPreferences) {
    tags.push(foodPreference);
  }

  return tags;
}

export function buildSmartValidationWarnings(selectionInput = {}) {
  const selection = normalizeUserSelection(selectionInput);
  const warnings = [];
  const recommendedPlanType = getRecommendedPlanType(selection);
  const budgetPerDay = selection.budgetAmount
    ? Math.round(selection.budgetAmount / Math.max(selection.days, 1))
    : 0;

  if (selection.planType && selection.planType !== recommendedPlanType) {
    warnings.push(
      `Your budget aligns more closely with ${recommendedPlanType} than ${selection.planType}.`
    );
  }

  if (selection.days >= 8 && budgetPerDay > 0 && budgetPerDay < 120) {
    warnings.push(
      "Longer trips on a tight daily budget may reduce activity variety and hotel quality."
    );
  }

  if (selection.travelStyle === "Relaxation" && selection.pace === "Fast-paced") {
    warnings.push(
      "Relaxation trips usually work better with a balanced or relaxed pace."
    );
  }

  if (selection.travelStyle === "Adventure" && selection.days <= 2) {
    warnings.push(
      "Adventure itineraries become more useful with at least 3 days to reduce transit-heavy routing."
    );
  }

  if (
    selection.foodPreferences.includes("Vegan") &&
    selection.travelStyle === "Nightlife"
  ) {
    warnings.push(
      "Nightlife-heavy plans may need extra dining curation to keep vegan options reliable late in the day."
    );
  }

  if (!selection.location.label) {
    warnings.push("Pick a destination to unlock more precise AI suggestions.");
  }

  return warnings;
}

export function buildAiSuggestionChips(selectionInput = {}) {
  const selection = normalizeUserSelection(selectionInput);
  const recommendedPlanType = getRecommendedPlanType(selection);
  const recommendedBudgetRange = getRecommendedBudgetRange(selection);
  const destinationSuggestions =
    DESTINATION_SUGGESTIONS_BY_STYLE[selection.travelStyle] ??
    DESTINATION_SUGGESTIONS_BY_STYLE.default;

  return [
    {
      id: "recommended-plan",
      kind: "plan",
      label: `AI recommends ${recommendedPlanType}`,
      value: recommendedPlanType,
    },
    {
      id: "recommended-budget",
      kind: "budget",
      label: `Recommended budget ${formatBudgetAmount(recommendedBudgetRange.min)}-${formatBudgetAmount(
        recommendedBudgetRange.max
      )}`,
      value: `${recommendedBudgetRange.min}-${recommendedBudgetRange.max}`,
    },
    ...(!selection.location.label
      ? destinationSuggestions.slice(0, 3).map((destination) => ({
          id: `destination-${destination}`,
          kind: "destination",
          label: destination,
          value: destination,
        }))
      : []),
  ];
}
