import {
  buildFallbackGeneratedTrip,
  normalizeGeneratedTrip,
  normalizeUserSelection,
} from "../../shared/trips.js";

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function normalizeInteger(value, fallback = null) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function normalizeNumber(value, fallback = null) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeStringArray(items = [], maxItems = 10) {
  if (!Array.isArray(items)) {
    return [];
  }

  const unique = [];
  const seen = new Set();

  for (const item of items) {
    const text = normalizeText(typeof item === "string" ? item : "");
    if (!text) {
      continue;
    }

    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    unique.push(text);
    seen.add(key);

    if (unique.length >= maxItems) {
      break;
    }
  }

  return unique;
}

function parseCostRange(label = "") {
  const numbers = String(label ?? "")
    .replace(/,/g, "")
    .match(/[0-9]+(?:\.[0-9]+)?/g);

  if (!numbers || numbers.length === 0) {
    return {
      min: null,
      max: null,
    };
  }

  const parsed = numbers
    .map((value) => normalizeNumber(value))
    .filter((value) => value !== null);

  if (parsed.length === 0) {
    return {
      min: null,
      max: null,
    };
  }

  const min = Math.min(...parsed);
  const max = Math.max(...parsed);

  return {
    min,
    max,
  };
}

function estimateActivityMinutes(activityName = "") {
  const normalized = normalizeText(activityName).toLowerCase();

  if (/flight|airport|transfer/.test(normalized)) {
    return 120;
  }

  if (/dinner|lunch|brunch|breakfast|food/.test(normalized)) {
    return 75;
  }

  if (/museum|temple|monument|tour/.test(normalized)) {
    return 120;
  }

  return 90;
}

function createFusionLookup(fusionIndex = {}) {
  const items = Array.isArray(fusionIndex?.items) ? fusionIndex.items : [];
  const lookup = new Map();

  for (const item of items) {
    const key = normalizeText(item?.name).toLowerCase();
    if (!key) {
      continue;
    }

    const confidence = normalizeNumber(item?.confidence, 0);
    if (!lookup.has(key) || confidence > lookup.get(key).confidence) {
      lookup.set(key, {
        confidence,
      });
    }
  }

  return lookup;
}

function isPlaceholderActivity(activityName = "") {
  const normalized = normalizeText(activityName).toLowerCase();
  return (
    /^activity\s*\d+/i.test(normalized) ||
    /^place\s*\d+/i.test(normalized) ||
    /^explore day/i.test(normalized) ||
    normalized.length < 4
  );
}

function extractActivitiesByDay(normalizedTrip = {}) {
  const aiDays = Array.isArray(normalizedTrip?.aiPlan?.days)
    ? normalizedTrip.aiPlan.days
    : [];

  return aiDays.map((day) => ({
    day: normalizeInteger(day?.day, 1),
    title: normalizeText(day?.title),
    activities: normalizeStringArray(day?.activities, 8),
    estimatedCost: normalizeText(day?.estimatedCost ?? day?.estimated_cost),
  }));
}

function ensureSequentialDays(days = []) {
  return days.every((day, index) => day.day === index + 1);
}

export function evaluateTripConstraints({
  generatedTrip,
  userSelection,
  fusionIndex = null,
  minFusionConfidence = 0.55,
}) {
  const normalizedSelection = normalizeUserSelection(userSelection);
  const normalizedTrip = normalizeGeneratedTrip(generatedTrip, {
    userSelection: normalizedSelection,
  });
  const daySummaries = extractActivitiesByDay(normalizedTrip);
  const hardViolations = [];
  const softViolations = [];
  const dailyLimitMinutes = normalizedSelection.constraints.dailyTimeLimitHours * 60;
  const fusionLookup = createFusionLookup(fusionIndex);
  const duplicateActivityTracker = new Map();
  let totalEstimatedMinutes = 0;
  let violatedDayCount = 0;

  if (daySummaries.length !== normalizedSelection.days) {
    hardViolations.push(
      `Expected ${normalizedSelection.days} days but received ${daySummaries.length}.`
    );
  }

  if (!ensureSequentialDays(daySummaries)) {
    hardViolations.push("Day numbers must be sequential and start at 1.");
  }

  for (const day of daySummaries) {
    if (day.activities.length < 3 || day.activities.length > 5) {
      hardViolations.push(
        `Day ${day.day} must include between 3 and 5 activities.`
      );
    }

    const transitionBufferMinutes = Math.max(day.activities.length - 1, 0) * 25;
    const dayMinutes =
      day.activities.reduce(
        (total, activity) => total + estimateActivityMinutes(activity),
        0
      ) + transitionBufferMinutes;
    totalEstimatedMinutes += dayMinutes;

    if (dayMinutes > dailyLimitMinutes + 45) {
      violatedDayCount += 1;
      hardViolations.push(
        `Day ${day.day} exceeds the daily time limit by approximately ${Math.max(
          1,
          Math.round((dayMinutes - dailyLimitMinutes) / 15) * 15
        )} minutes.`
      );
    }

    for (const activity of day.activities) {
      const key = activity.toLowerCase();
      duplicateActivityTracker.set(key, (duplicateActivityTracker.get(key) ?? 0) + 1);

      if (isPlaceholderActivity(activity)) {
        softViolations.push(`Activity "${activity}" looks too generic.`);
      }

      if (fusionLookup.size > 0) {
        const fusionHit = fusionLookup.get(key);
        if (!fusionHit || fusionHit.confidence < minFusionConfidence) {
          softViolations.push(
            `Activity "${activity}" is weakly supported by fused destination data.`
          );
        }
      }
    }
  }

  const repeatedActivities = [...duplicateActivityTracker.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name);
  if (repeatedActivities.length > 0) {
    softViolations.push(
      `Repeated activities detected: ${repeatedActivities.slice(0, 5).join(", ")}.`
    );
  }

  const totalEstimatedCostLabel =
    normalizedTrip?.aiPlan?.totalEstimatedCost ?? "";
  const totalCostRange = parseCostRange(totalEstimatedCostLabel);
  if (
    normalizedSelection.constraints.budgetCap !== null &&
    totalCostRange.min !== null &&
    totalCostRange.min > normalizedSelection.constraints.budgetCap
  ) {
    hardViolations.push(
      `Estimated minimum cost ${totalCostRange.min} exceeds budget cap ${normalizedSelection.constraints.budgetCap}.`
    );
  }

  return {
    valid: hardViolations.length === 0,
    hardViolations,
    softViolations: normalizeStringArray(softViolations, 50),
    stats: {
      expectedDays: normalizedSelection.days,
      generatedDays: daySummaries.length,
      totalEstimatedMinutes,
      averageMinutesPerDay:
        daySummaries.length > 0
          ? Math.round(totalEstimatedMinutes / daySummaries.length)
          : 0,
      violatedDayCount,
      totalEstimatedCostMin: totalCostRange.min,
      totalEstimatedCostMax: totalCostRange.max,
      objective: normalizedSelection.objective,
    },
  };
}

function repairDayActivities(day = {}, fallbackDay = {}) {
  const fallbackActivities = normalizeStringArray(fallbackDay.activities, 5);
  const repairedActivities = normalizeStringArray(day.activities, 5);

  while (repairedActivities.length < 3 && fallbackActivities.length > 0) {
    repairedActivities.push(fallbackActivities.shift());
  }

  while (repairedActivities.length < 3) {
    repairedActivities.push("Explore a nearby neighborhood highlight");
  }

  return repairedActivities.slice(0, 5);
}

export function applyDeterministicTripRepairs({
  generatedTrip,
  userSelection,
}) {
  const normalizedSelection = normalizeUserSelection(userSelection);
  const normalizedTrip = normalizeGeneratedTrip(generatedTrip, {
    userSelection: normalizedSelection,
  });
  const fallbackTrip = buildFallbackGeneratedTrip(normalizedSelection);
  const existingDays = Array.isArray(normalizedTrip?.aiPlan?.days)
    ? [...normalizedTrip.aiPlan.days]
    : [];
  const fallbackDays = Array.isArray(fallbackTrip?.aiPlan?.days)
    ? fallbackTrip.aiPlan.days
    : [];

  const repairedDays = [];

  for (let dayIndex = 0; dayIndex < normalizedSelection.days; dayIndex += 1) {
    const sourceDay = existingDays[dayIndex] ?? fallbackDays[dayIndex] ?? {};
    const fallbackDay = fallbackDays[dayIndex] ?? {};

    repairedDays.push({
      day: dayIndex + 1,
      title: normalizeText(
        sourceDay.title,
        fallbackDay.title || `Day ${dayIndex + 1}`
      ),
      activities: repairDayActivities(sourceDay, fallbackDay),
      estimatedCost: normalizeText(
        sourceDay.estimatedCost,
        fallbackDay.estimatedCost || "Not specified"
      ),
      tips: normalizeText(sourceDay.tips, fallbackDay.tips),
    });
  }

  const repairedTrip = normalizeGeneratedTrip(
    {
      ...normalizedTrip,
      destination:
        normalizedTrip?.aiPlan?.destination ??
        normalizedSelection.location.label,
      days: repairedDays,
      total_estimated_cost:
        normalizedTrip?.aiPlan?.totalEstimatedCost ??
        fallbackTrip?.aiPlan?.totalEstimatedCost,
      travel_tips:
        normalizedTrip?.aiPlan?.travelTips ??
        fallbackTrip?.aiPlan?.travelTips,
    },
    {
      userSelection: normalizedSelection,
    }
  );

  return repairedTrip;
}

function extractPlaceSet(trip = {}) {
  const days = Array.isArray(trip?.aiPlan?.days) ? trip.aiPlan.days : [];
  const set = new Set();

  for (const day of days) {
    const activities = Array.isArray(day?.activities) ? day.activities : [];
    for (const activity of activities) {
      const key = normalizeText(activity).toLowerCase();
      if (key) {
        set.add(key);
      }
    }
  }

  return set;
}

export function buildRepairDiff({ beforeTrip, afterTrip }) {
  const before = normalizeGeneratedTrip(beforeTrip ?? {});
  const after = normalizeGeneratedTrip(afterTrip ?? {});
  const beforePlaces = extractPlaceSet(before);
  const afterPlaces = extractPlaceSet(after);

  const removed = [...beforePlaces].filter((item) => !afterPlaces.has(item));
  const added = [...afterPlaces].filter((item) => !beforePlaces.has(item));

  return {
    changed: removed.length > 0 || added.length > 0,
    removedActivities: removed,
    addedActivities: added,
    unchangedActivityCount: [...afterPlaces].filter((item) => beforePlaces.has(item))
      .length,
  };
}
