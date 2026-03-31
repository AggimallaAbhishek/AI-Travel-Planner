import { normalizeUserSelection } from "./trips.js";

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
    return "Cheap";
  }

  if (amount <= 5000) {
    return "Moderate";
  }

  return "Luxury";
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

  if (input.budget) {
    params.set("budget", String(input.budget));
  } else {
    const derivedBudget = budgetTierFromAmount(input.budgetAmount);
    if (derivedBudget) {
      params.set("budget", derivedBudget);
    }
  }

  const travelers = normalizeTravelersLabel(input.travelers);
  if (travelers) {
    params.set("travelers", travelers);
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
  const travelers = params.get("travelers");
  const parsedDays = parseInteger(days);

  const hasPrefill = [destination, days, budget, travelers].some(Boolean);
  if (!hasPrefill) {
    return null;
  }

  const normalized = normalizeUserSelection({
    location: destination ? { label: destination } : { label: "" },
    days: parsedDays ?? 1,
    budget: budget ?? "",
    travelers: normalizeTravelersLabel(travelers),
  });

  return {
    location: normalized.location.label ? normalized.location : null,
    days:
      Number.isInteger(parsedDays) && parsedDays >= 1 && parsedDays <= 30
        ? parsedDays
        : null,
    budget: normalized.budget || null,
    travelers: normalized.travelers || null,
  };
}
