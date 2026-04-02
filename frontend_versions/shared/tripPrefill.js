import {
  normalizePlanType,
  normalizeUserSelection,
  suggestPlanTypeFromBudget,
} from "./trips.js";

const TRAVELER_LABELS = {
  solo: "Just Me",
  one: "Just Me",
  single: "Just Me",
  "1": "Just Me",
  "1 traveler": "Just Me",
  "1 travelers": "Just Me",
  couple: "A Couple",
  two: "A Couple",
  "2": "A Couple",
  "2 travelers": "A Couple",
  family: "Family",
  "3": "Family",
  "4": "Family",
  "5": "Family",
  "3-5": "Family",
  "3 to 5": "Family",
  "3-5 travelers": "Family",
  friends: "Friends",
  group: "Friends",
  "6": "Friends",
  "6+": "Friends",
  "6+ travelers": "Friends",
};

function parseInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeTravelersLabel(value) {
  if (!value) {
    return "";
  }

  const text = String(value).trim().toLowerCase();
  if (!text) {
    return "";
  }

  if (TRAVELER_LABELS[text]) {
    return TRAVELER_LABELS[text];
  }

  if (text.includes("solo") || text.includes("single")) {
    return "Just Me";
  }

  if (text.includes("couple") || text.includes("2")) {
    return "A Couple";
  }

  if (text.includes("family") || text.includes("3-5")) {
    return "Family";
  }

  if (text.includes("friends") || text.includes("group") || text.includes("6")) {
    return "Friends";
  }

  return "";
}

export function budgetTierFromAmount(value) {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "";
  }

  if (amount <= 1500) {
    return "Cheap Plan";
  }

  if (amount <= 5000) {
    return "Moderate Plan";
  }

  return "Best Plan";
}

function getDaysFromDateRange(fromDate, toDate) {
  if (!fromDate || !toDate) {
    return null;
  }

  const start = new Date(fromDate);
  const end = new Date(toDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  const differenceMs = end.getTime() - start.getTime();
  const differenceDays = Math.floor(differenceMs / (24 * 60 * 60 * 1000)) + 1;
  if (differenceDays < 1) {
    return null;
  }

  return differenceDays;
}

export function buildCreateTripQuery(input = {}) {
  const params = new URLSearchParams();

  if (input.destination) {
    params.set("destination", String(input.destination).trim());
  }

  const daysFromRange = getDaysFromDateRange(input.fromDate, input.toDate);
  const directDays = parseInteger(input.days);
  const days = daysFromRange ?? directDays;

  if (days && days >= 1) {
    params.set("days", String(Math.min(days, 30)));
  }

  const numericBudget =
    parseInteger(input.budgetAmount ?? input.budget) ??
    parseInteger(input.totalBudget);
  if (numericBudget) {
    params.set("budget", String(numericBudget));
  } else if (input.budget) {
    params.set("budget", String(input.budget));
  }

  const planType = normalizePlanType(input.planType ?? input.plan_type) ||
    (numericBudget ? suggestPlanTypeFromBudget(numericBudget, days ?? 1) : "");
  if (planType) {
    params.set("plan_type", planType);
  }

  const travelers = normalizeTravelersLabel(input.travelers);
  if (travelers) {
    params.set("travelers", travelers);
  }

  if (input.travelStyle ?? input.travel_style) {
    params.set("travel_style", String(input.travelStyle ?? input.travel_style));
  }

  if (input.pace) {
    params.set("pace", String(input.pace));
  }

  const rawFoodPreferences =
    input.foodPreferences ??
    input.food_preference ??
    input.foodPreference;
  const foodPreferences = Array.isArray(rawFoodPreferences)
    ? rawFoodPreferences
    : typeof rawFoodPreferences === "string"
      ? rawFoodPreferences.split(",")
      : [];
  if (foodPreferences.length > 0) {
    params.set("food_preference", foodPreferences.join(","));
  }

  return params.toString();
}

export function readCreateTripPrefill(queryInput) {
  const params =
    typeof queryInput === "string" ? new URLSearchParams(queryInput) : queryInput;

  if (!params) {
    return null;
  }

  const destination =
    params.get("destination") ?? params.get("location") ?? params.get("place");
  const days = params.get("days");
  const budget = params.get("budget");
  const planType = params.get("plan_type") ?? params.get("planType");
  const travelers = params.get("travelers");
  const travelStyle =
    params.get("travel_style") ?? params.get("travelStyle") ?? params.get("tripType");
  const pace = params.get("pace");
  const foodPreference =
    params.get("food_preference") ?? params.get("foodPreference");
  const parsedDays = parseInteger(days);

  const hasPrefill = [
    destination,
    days,
    budget,
    planType,
    travelers,
    travelStyle,
    pace,
    foodPreference,
  ].some(Boolean);
  if (!hasPrefill) {
    return null;
  }

  const normalized = normalizeUserSelection({
    location: destination ? { label: destination } : { label: "" },
    days: parsedDays ?? 1,
    budget: budget ?? "",
    planType: planType ?? "",
    travelers: normalizeTravelersLabel(travelers),
    travelStyle: travelStyle ?? "",
    pace: pace ?? "",
    foodPreferences: foodPreference ? foodPreference.split(",") : [],
  });

  return {
    location: normalized.location.label ? normalized.location : null,
    days:
      Number.isInteger(parsedDays) && parsedDays >= 1 && parsedDays <= 30
        ? parsedDays
        : null,
    budgetAmount: normalized.budgetAmount || null,
    planType: normalized.planType || null,
    travelers: normalized.travelers || null,
    travelStyle: normalized.travelStyle || null,
    pace: normalized.pace || null,
    foodPreferences: normalized.foodPreferences ?? [],
  };
}
