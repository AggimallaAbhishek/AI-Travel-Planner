import {
  normalizeUserSelection,
  suggestPlanTypeFromBudget,
} from "../../shared/trips.js";

const DEFAULT_TRAVEL_STYLE = "Cultural";
const DEFAULT_PACE = "Balanced";
const DEFAULT_PLAN_TYPE = "Moderate Plan";
const BUDGET_TOLERANCE_RATIO = 1.12;

const PACE_CONSTRAINTS = Object.freeze({
  "Fast-paced": {
    maxStopsPerDay: 5,
    maxTransitMinutes: 210,
    maxVisitMinutes: 360,
    maxDailyMinutes: 570,
  },
  Balanced: {
    maxStopsPerDay: 4,
    maxTransitMinutes: 165,
    maxVisitMinutes: 300,
    maxDailyMinutes: 480,
  },
  Relaxed: {
    maxStopsPerDay: 3,
    maxTransitMinutes: 120,
    maxVisitMinutes: 240,
    maxDailyMinutes: 390,
  },
});

const TRAVEL_STYLE_CATEGORY_MIX = Object.freeze({
  Adventure: { attraction: 0.85, restaurant: 0.15 },
  Relaxation: { attraction: 0.65, restaurant: 0.35 },
  Cultural: { attraction: 0.8, restaurant: 0.2 },
  Nightlife: { attraction: 0.55, restaurant: 0.45 },
});

function hasOwnValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function detectMissingFields(rawInput = {}) {
  const locationInput = rawInput.location;
  const destinationMissing =
    !hasOwnValue(rawInput.destination) &&
    !hasOwnValue(rawInput.place) &&
    !hasOwnValue(rawInput.location?.label) &&
    !(typeof locationInput === "string" && locationInput.trim());
  const daysMissing = !hasOwnValue(rawInput.days) && !hasOwnValue(rawInput.noOfDays);
  const budgetMissing =
    !hasOwnValue(rawInput.budget) &&
    !hasOwnValue(rawInput.budgetAmount) &&
    !hasOwnValue(rawInput.budget_amount) &&
    !hasOwnValue(rawInput.totalBudget) &&
    !hasOwnValue(rawInput.total_budget);
  const travelersMissing =
    !hasOwnValue(rawInput.travelers) &&
    !hasOwnValue(rawInput.travelWith) &&
    !hasOwnValue(rawInput.traveler);

  return [
    ...(destinationMissing ? ["destination"] : []),
    ...(daysMissing ? ["days"] : []),
    ...(budgetMissing ? ["budget"] : []),
    ...(travelersMissing ? ["travelers"] : []),
  ];
}

export function derivePlanningConstraints(selectionInput = {}) {
  const selection = normalizeUserSelection(selectionInput);
  const pace = selection.pace || DEFAULT_PACE;
  const paceConstraints =
    PACE_CONSTRAINTS[pace] ?? PACE_CONSTRAINTS[DEFAULT_PACE];
  const preferredCategoryMix =
    TRAVEL_STYLE_CATEGORY_MIX[selection.travelStyle || DEFAULT_TRAVEL_STYLE] ??
    TRAVEL_STYLE_CATEGORY_MIX[DEFAULT_TRAVEL_STYLE];
  const perDayBudget = selection.budgetAmount
    ? Math.max(1, Math.round(selection.budgetAmount / Math.max(selection.days, 1)))
    : null;

  return {
    pace,
    perDayBudget,
    maxStopsPerDay: paceConstraints.maxStopsPerDay,
    maxTransitMinutes: paceConstraints.maxTransitMinutes,
    maxVisitMinutes: paceConstraints.maxVisitMinutes,
    maxDailyMinutes: paceConstraints.maxDailyMinutes,
    budgetToleranceRatio: BUDGET_TOLERANCE_RATIO,
    preferredCategoryMix,
  };
}

export function normalizePlanningRequest(input = {}) {
  const selection = normalizeUserSelection(input);
  const normalizedSelection = {
    ...selection,
    planType:
      selection.planType ||
      suggestPlanTypeFromBudget(selection.budgetAmount, selection.days) ||
      DEFAULT_PLAN_TYPE,
    travelStyle: selection.travelStyle || DEFAULT_TRAVEL_STYLE,
    travelType: selection.travelStyle || DEFAULT_TRAVEL_STYLE,
    pace: selection.pace || DEFAULT_PACE,
    foodPreferences: Array.isArray(selection.foodPreferences)
      ? selection.foodPreferences
      : [],
  };
  const missingFields = detectMissingFields(input);
  const constraints = derivePlanningConstraints(normalizedSelection);

  return {
    selection: normalizedSelection,
    destination: normalizedSelection.location.label,
    days: normalizedSelection.days,
    budgetAmount: normalizedSelection.budgetAmount,
    planType: normalizedSelection.planType,
    travelStyle: normalizedSelection.travelStyle,
    pace: normalizedSelection.pace,
    foodPreferences: normalizedSelection.foodPreferences,
    travelers: normalizedSelection.travelers,
    isComplete: missingFields.length === 0,
    missingFields,
    constraints,
  };
}
