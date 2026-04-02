import { normalizeDestinationRecommendations } from "./recommendations.js";
import { resolveGoogleMapsUrl } from "./maps.js";

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function normalizeInteger(value, fallback = 1) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampInteger(value, min, max, fallback) {
  const parsed = normalizeInteger(value, fallback);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  if (parsed < min) {
    return min;
  }

  if (parsed > max) {
    return max;
  }

  return parsed;
}

function normalizeChoice(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }

  return normalizeText(String(value));
}

function normalizeRating(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCoordinates(value) {
  if (!value || typeof value !== "object") {
    return { latitude: null, longitude: null };
  }

  const latitude = Number.parseFloat(
    value.latitude ?? value.lat ?? value.latitudeDegrees
  );
  const longitude = Number.parseFloat(
    value.longitude ?? value.lng ?? value.longitudeDegrees
  );

  return {
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
}

function normalizeStringArray(values, maxItems = 8) {
  if (!Array.isArray(values)) {
    return [];
  }

  const normalized = [];
  const seen = new Set();

  for (const value of values) {
    const text = normalizeText(typeof value === "string" ? value : "");
    if (!text) {
      continue;
    }

    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    normalized.push(text);
    seen.add(key);

    if (normalized.length >= maxItems) {
      break;
    }
  }

  return normalized;
}

function normalizeDayNumber(rawDay, index) {
  if (typeof rawDay === "number" && rawDay > 0) {
    return rawDay;
  }

  if (typeof rawDay === "string") {
    const match = rawDay.match(/(\d+)/);
    if (match) {
      return normalizeInteger(match[1], index + 1);
    }
  }

  return index + 1;
}

function normalizeActivityLabel(activity, index) {
  if (typeof activity === "string") {
    return normalizeText(activity);
  }

  if (!activity || typeof activity !== "object") {
    return "";
  }

  return normalizeText(
    activity.activity ??
      activity.title ??
      activity.name ??
      activity.placeName ??
      activity.place ??
      activity.description,
    `Activity ${index + 1}`
  );
}

function normalizeActivities(source = []) {
  if (Array.isArray(source)) {
    const labels = source
      .map((item, index) => normalizeActivityLabel(item, index))
      .filter(Boolean);
    return normalizeStringArray(labels, 10);
  }

  if (typeof source === "string") {
    return normalizeStringArray([source], 10);
  }

  return [];
}

export const PLAN_TYPE_LABELS = Object.freeze([
  "Cheap Plan",
  "Moderate Plan",
  "Best Plan",
]);

export const FOOD_PREFERENCE_LABELS = Object.freeze([
  "Vegetarian",
  "Non-Vegetarian",
  "Vegan",
  "Mixed",
]);

export const TRAVEL_STYLE_LABELS = Object.freeze([
  "Adventure",
  "Relaxation",
  "Cultural",
  "Nightlife",
]);

export const PACE_LABELS = Object.freeze([
  "Fast-paced",
  "Balanced",
  "Relaxed",
]);

const PLAN_TYPE_BUDGET_BANDS = Object.freeze({
  "Cheap Plan": { dailyMin: 80, dailyMax: 150, split: { stay: 0.34, food: 0.24, travel: 0.42 } },
  "Moderate Plan": {
    dailyMin: 151,
    dailyMax: 320,
    split: { stay: 0.45, food: 0.25, travel: 0.3 },
  },
  "Best Plan": { dailyMin: 321, dailyMax: 650, split: { stay: 0.56, food: 0.24, travel: 0.2 } },
});

function normalizeNumericValue(value, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d.-]/g, "");
    if (!cleaned) {
      return fallback;
    }

    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function roundBudgetAmount(value) {
  const numeric = normalizeNumericValue(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return Math.round(numeric);
}

function normalizeLabelAgainstOptions(value, options = [], fallback = "") {
  const normalized = normalizeText(String(value ?? ""));
  if (!normalized) {
    return fallback;
  }

  const normalizedKey = normalized.toLowerCase();
  const directMatch = options.find(
    (option) => option.toLowerCase() === normalizedKey
  );
  if (directMatch) {
    return directMatch;
  }

  return fallback;
}

export function normalizePlanType(value, fallback = "") {
  const normalized = normalizeText(String(value ?? ""));
  if (!normalized) {
    return fallback;
  }

  const key = normalized.toLowerCase();

  if (/(cheap|budget|economy)/.test(key)) {
    return "Cheap Plan";
  }

  if (/(best|luxury|premium)/.test(key)) {
    return "Best Plan";
  }

  if (/(moderate|standard|average|mid)/.test(key)) {
    return "Moderate Plan";
  }

  return normalizeLabelAgainstOptions(normalized, PLAN_TYPE_LABELS, fallback);
}

export function suggestPlanTypeFromBudget(budgetAmount, days = 1) {
  const totalBudget = roundBudgetAmount(budgetAmount);
  const safeDays = clampInteger(days, 1, 30, 1);

  if (!totalBudget) {
    return "";
  }

  const budgetPerDay = totalBudget / safeDays;

  if (budgetPerDay <= PLAN_TYPE_BUDGET_BANDS["Cheap Plan"].dailyMax) {
    return "Cheap Plan";
  }

  if (budgetPerDay <= PLAN_TYPE_BUDGET_BANDS["Moderate Plan"].dailyMax) {
    return "Moderate Plan";
  }

  return "Best Plan";
}

function getPlanTypeBudgetBand(planType) {
  return PLAN_TYPE_BUDGET_BANDS[normalizePlanType(planType, "Moderate Plan")] ??
    PLAN_TYPE_BUDGET_BANDS["Moderate Plan"];
}

export function buildRecommendedBudgetRange(planType, days = 1) {
  const safeDays = clampInteger(days, 1, 30, 1);
  const band = getPlanTypeBudgetBand(planType);
  return {
    min: band.dailyMin * safeDays,
    max: band.dailyMax * safeDays,
  };
}

export function buildBudgetBreakdown(budgetAmount, planType) {
  const safeBudgetAmount = roundBudgetAmount(budgetAmount);
  const band = getPlanTypeBudgetBand(planType);
  const total =
    safeBudgetAmount ??
    Math.round((band.dailyMin + band.dailyMax) / 2);

  return {
    total,
    stay: Math.round(total * band.split.stay),
    food: Math.round(total * band.split.food),
    travel: Math.max(
      0,
      total - Math.round(total * band.split.stay) - Math.round(total * band.split.food)
    ),
  };
}

export function formatBudgetAmount(value) {
  const numeric = roundBudgetAmount(value);
  if (!numeric) {
    return "";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(numeric);
}

export function formatBudgetSummary(selectionInput = {}) {
  const selection = normalizeUserSelection(selectionInput);

  if (selection.budgetAmount) {
    return `${formatBudgetAmount(selection.budgetAmount)} total`;
  }

  if (selection.planType) {
    const recommended = buildRecommendedBudgetRange(selection.planType, selection.days);
    return `${formatBudgetAmount(recommended.min)}-${formatBudgetAmount(
      recommended.max
    )}`;
  }

  return "Budget not set";
}

function buildEstimatedTotalCost(selectionInput = {}) {
  const selection = normalizeUserSelection(selectionInput);

  if (selection.budgetAmount) {
    const budgetPerDay = Math.max(
      1,
      Math.round(selection.budgetAmount / clampInteger(selection.days, 1, 30, 1))
    );

    return `${formatBudgetAmount(selection.budgetAmount)} total (~${formatBudgetAmount(
      budgetPerDay
    )}/day)`;
  }

  const recommended = buildRecommendedBudgetRange(selection.planType, selection.days);
  return `Approx. ${formatBudgetAmount(recommended.min)} - ${formatBudgetAmount(
    recommended.max
  )}`;
}

function normalizeFoodPreferences(values) {
  const normalized = normalizeStringArray(
    Array.isArray(values)
      ? values
      : typeof values === "string"
        ? values.split(",")
        : [],
    FOOD_PREFERENCE_LABELS.length
  )
    .map((value) =>
      normalizeLabelAgainstOptions(value, FOOD_PREFERENCE_LABELS, value)
    )
    .filter(Boolean);

  if (normalized.includes("Mixed")) {
    return ["Mixed"];
  }

  return normalizeStringArray(normalized, FOOD_PREFERENCE_LABELS.length);
}

function normalizeTravelTips(value, destination) {
  const tips = normalizeStringArray(
    Array.isArray(value)
      ? value
      : typeof value === "string"
        ? [value]
        : []
  );

  if (tips.length > 0) {
    return tips;
  }

  return [
    `Book high-demand attractions in ${destination} at least a few days ahead.`,
    "Keep 10-15% of your budget as a contingency buffer.",
    "Start each day early to avoid peak-time crowds and transport delays.",
    "Save an offline map and emergency contacts before heading out.",
  ];
}

function mapDayActivitiesToPlaces(day) {
  const baseDetails = normalizeText(day.tips, "Planned travel activity.");

  return day.activities.map((activity) =>
    normalizePlace({
      placeName: activity,
      placeDetails: baseDetails,
      ticketPricing: normalizeText(day.estimatedCost, "Included in trip budget"),
      travelTime: "Flexible",
      bestTimeToVisit: "As per daily plan",
      category: "Activity",
    })
  );
}

function mapAiPlanDaysToItinerary(days = []) {
  return {
    days: days.map((day, index) => ({
      dayNumber: normalizeDayNumber(day.day, index),
      title: normalizeText(day.title, `Day ${index + 1}`),
      places: mapDayActivitiesToPlaces(day),
    })),
  };
}

function hasAtLeastOnePlannedPlace(itinerary) {
  return Array.isArray(itinerary?.days)
    ? itinerary.days.some(
        (day) => Array.isArray(day?.places) && day.places.length > 0
      )
    : false;
}

function extractRawPlanDays(payload = {}) {
  const directCandidates = [
    payload?.days,
    payload?.tripData?.days,
    payload?.trip?.days,
    payload?.plan?.days,
    payload?.tripPlan?.days,
  ];

  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  const itineraryCandidates = [
    payload?.itinerary,
    payload?.tripData?.itinerary,
    payload?.trip?.itinerary,
  ];

  for (const itinerary of itineraryCandidates) {
    if (Array.isArray(itinerary?.days)) {
      return itinerary.days;
    }

    if (itinerary && typeof itinerary === "object") {
      return Object.entries(itinerary).map(([dayKey, places]) => ({
        day: dayKey,
        title: `Day ${normalizeDayNumber(dayKey, 0)}`,
        activities: Array.isArray(places)
          ? places.map((place) => place?.placeName ?? place?.name ?? place)
          : [],
      }));
    }
  }

  return [];
}

function normalizeAiDay(rawDay = {}, index) {
  const activityCandidates = [
    rawDay.activities,
    rawDay.activityList,
    rawDay.highlights,
    rawDay.places,
  ];

  let activities = [];
  for (const candidate of activityCandidates) {
    const normalized = normalizeActivities(candidate);
    if (normalized.length > 0) {
      activities = normalized;
      break;
    }
  }

  const dayNumber = normalizeDayNumber(rawDay.day ?? rawDay.dayNumber, index);
  const title = normalizeText(rawDay.title ?? rawDay.theme, `Day ${dayNumber}`);

  return {
    day: dayNumber,
    title,
    summary: normalizeText(rawDay.summary, ""),
    activities:
      activities.length > 0
        ? activities
        : [`Explore ${title.toLowerCase()} highlights`],
    estimatedCost: normalizeText(
      rawDay.estimated_cost ?? rawDay.estimatedCost ?? rawDay.cost,
      "Not specified"
    ),
    tips: normalizeText(rawDay.tips ?? rawDay.tip ?? rawDay.notes, ""),
  };
}

function normalizeTravelStyle(value, fallback = "") {
  const normalized = normalizeText(String(value ?? ""));
  if (!normalized) {
    return fallback;
  }

  const key = normalized.toLowerCase();

  if (key.includes("adventure")) {
    return "Adventure";
  }

  if (
    key.includes("relax") ||
    key.includes("spa") ||
    key.includes("leisure")
  ) {
    return "Relaxation";
  }

  if (
    key.includes("cultur") ||
    key.includes("heritage") ||
    key.includes("history") ||
    key.includes("museum")
  ) {
    return "Cultural";
  }

  if (key.includes("night")) {
    return "Nightlife";
  }

  return normalizeLabelAgainstOptions(normalized, TRAVEL_STYLE_LABELS, fallback);
}

function normalizePace(value, fallback = "") {
  const normalized = normalizeText(String(value ?? ""));
  if (!normalized) {
    return fallback;
  }

  const key = normalized.toLowerCase();

  if (key.includes("fast") || key.includes("packed")) {
    return "Fast-paced";
  }

  if (
    key.includes("relax") ||
    key.includes("leisure") ||
    key.includes("slow")
  ) {
    return "Relaxed";
  }

  if (
    key.includes("balanced") ||
    key.includes("moderate")
  ) {
    return "Balanced";
  }

  return normalizeLabelAgainstOptions(normalized, PACE_LABELS, fallback);
}

function resolveBudgetAmount(rawBudgetAmount, planType, days) {
  const directBudgetAmount = roundBudgetAmount(rawBudgetAmount);
  if (directBudgetAmount) {
    return directBudgetAmount;
  }

  const normalizedPlanType = normalizePlanType(planType);
  if (!normalizedPlanType) {
    return null;
  }

  const recommended = buildRecommendedBudgetRange(normalizedPlanType, days);
  return Math.round((recommended.min + recommended.max) / 2);
}

function buildFallbackPlanDays(selection) {
  const destination = normalizeText(selection.location.label, "your destination");
  const dayCount = clampInteger(selection.days, 1, 30, 1);
  const travelStyle = normalizeTravelStyle(selection.travelStyle, "Cultural");
  const pace = normalizePace(selection.pace, "Balanced");
  const foodPreference =
    selection.foodPreferences?.[0] && selection.foodPreferences[0] !== "Mixed"
      ? selection.foodPreferences[0].toLowerCase()
      : "local";

  const activitiesByStyle = {
    Adventure: [
      `Trail or nature route around ${destination}`,
      "High-energy outdoor stop",
      `${foodPreference} lunch near the activity hub`,
      "Scenic sunset viewpoint",
      "Recovery dinner in a lively district",
    ],
    Relaxation: [
      "Slow breakfast and neighborhood walk",
      "Wellness or scenic downtime block",
      `${foodPreference} lunch with a calm setting`,
      "Flexible free time",
      "Sunset dinner with minimal transit",
    ],
    Cultural: [
      "Historic district orientation walk",
      "Museum or heritage site visit",
      `${foodPreference} local dining stop`,
      "Market or craft quarter browsing",
      "Evening cultural experience",
    ],
    Nightlife: [
      "Late-morning city reset",
      "Design-forward neighborhood stop",
      `${foodPreference} dinner in a social area`,
      "Rooftop or live-music venue",
      "Late evening free exploration",
    ],
  };

  const activityCount = {
    "Fast-paced": 5,
    Balanced: 4,
    Relaxed: 3,
  }[pace];

  return Array.from({ length: dayCount }, (_, index) => {
    const template = (activitiesByStyle[travelStyle] ?? activitiesByStyle.Cultural).slice(
      0,
      activityCount
    );
    return {
      day: index + 1,
      title: `Day ${index + 1} in ${destination}`,
      activities: template,
      estimatedCost: buildEstimatedTotalCost(selection),
      tips:
        pace === "Fast-paced"
          ? `Cluster nearby stops in ${destination} to keep the itinerary efficient.`
          : pace === "Relaxed"
            ? `Leave buffer time between stops in ${destination} so the day stays easy.`
            : `Balance anchor attractions with flexible exploration time in ${destination}.`,
    };
  });
}

export function isRemoteImageUrl(value) {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return false;
  }

  return !/placeholder|example|unsplash\.com\/featured/i.test(trimmed);
}

export function normalizeLocation(input) {
  if (typeof input === "string") {
    return {
      label: normalizeText(input),
      placeId: "",
      source: "",
      primaryText: "",
      secondaryText: "",
    };
  }

  if (input && typeof input === "object") {
    return {
      label: normalizeText(input.label ?? input.description ?? input.value),
      placeId: normalizeText(input.placeId ?? input.place_id),
      source: normalizeText(input.source),
      primaryText: normalizeText(
        input.primaryText ??
          input.structured_formatting?.main_text
      ),
      secondaryText: normalizeText(
        input.secondaryText ??
          input.structured_formatting?.secondary_text
      ),
    };
  }

  return {
    label: "",
    placeId: "",
    source: "",
    primaryText: "",
    secondaryText: "",
  };
}

export function normalizeUserSelection(input = {}) {
  const rawTravelerCount =
    input.travelerCount ?? input.numberOfTravelers ?? input.travelersCount;
  const days = normalizeInteger(input.days ?? input.noOfDays, 1);
  const travelerCount =
    rawTravelerCount === undefined || rawTravelerCount === null || rawTravelerCount === ""
      ? null
      : normalizeInteger(rawTravelerCount, 0);
  const rawPlanType =
    input.planType ??
    input.plan_type ??
    input.plan ??
    input.budgetTier ??
    input.budgetLabel;
  const rawBudgetAmount =
    input.budgetAmount ??
    input.budget_amount ??
    input.totalBudget ??
    input.total_budget ??
    input.budget;
  const planType =
    normalizePlanType(rawPlanType ?? rawBudgetAmount) ||
    suggestPlanTypeFromBudget(rawBudgetAmount, days);
  const budgetAmount = resolveBudgetAmount(rawBudgetAmount, planType, days);
  const travelStyle = normalizeTravelStyle(
    input.travelStyle ??
      input.travel_style ??
      input.travelType ??
      input.tripType
  );
  const pace = normalizePace(
    input.pace ??
      input.timePreference ??
      input.time_preference
  );
  const foodPreferences = normalizeFoodPreferences(
    input.foodPreferences ??
      input.foodPreference ??
      input.food_preference
  );
  const accommodation = normalizeText(input.accommodation ?? input.stay ?? "");
  const logistics = normalizeText(input.logistics ?? input.travelLogistics ?? "");
  const origin = normalizeLocation(
    input.origin ?? input.originLocation ?? input.from ?? ""
  );
  const preferredModes = normalizeStringArray(
    input.preferredModes ?? input.preferred_modes,
    3
  )
    .map((value) => value.toLowerCase())
    .filter((value) => ["flight", "train", "road"].includes(value));
  const rawMaxTransfers = input.maxTransfers ?? input.max_transfers;
  const parsedMaxTransfers =
    rawMaxTransfers === undefined || rawMaxTransfers === null || rawMaxTransfers === ""
      ? null
      : normalizeInteger(rawMaxTransfers, 0);
  const maxTransfers =
    Number.isInteger(parsedMaxTransfers) && parsedMaxTransfers >= 0
      ? Math.min(parsedMaxTransfers, 8)
      : null;

  return {
    location: normalizeLocation(input.location ?? input.destination),
    origin,
    days,
    budget: budgetAmount,
    budgetAmount,
    planType,
    travelers: normalizeChoice(
      input.travelers ?? input.travelWith ?? input.traveler
    ),
    travelStyle,
    travelType: travelStyle,
    pace,
    foodPreferences,
    travelerCount,
    accommodation,
    logistics,
    preferredModes,
    maxTransfers,
  };
}

export function getUserSelectionErrors(input = {}) {
  const selection = normalizeUserSelection(input);
  const errors = [];
  const MAX_LOCATION_LENGTH = 120;
  const MAX_CHOICE_LENGTH = 40;
  const MAX_BUDGET = 50_000;

  if (!selection.location.label) {
    errors.push("Destination is required.");
  } else if (selection.location.label.length > MAX_LOCATION_LENGTH) {
    errors.push("Destination must be 120 characters or fewer.");
  }

  if (
    !Number.isInteger(selection.days) ||
    selection.days < 1 ||
    selection.days > 30
  ) {
    errors.push("Trip duration must be between 1 and 30 days.");
  }

  if (!selection.budgetAmount) {
    errors.push("Budget is required.");
  } else if (selection.budgetAmount < 100 || selection.budgetAmount > MAX_BUDGET) {
    errors.push("Budget must be between $100 and $50,000.");
  }

  if (selection.planType && selection.planType.length > MAX_CHOICE_LENGTH) {
    errors.push("Plan type must be 40 characters or fewer.");
  }

  if (!selection.travelers) {
    errors.push("Traveler type is required.");
  } else if (selection.travelers.length > MAX_CHOICE_LENGTH) {
    errors.push("Traveler type must be 40 characters or fewer.");
  }

  if (selection.travelStyle && selection.travelStyle.length > MAX_CHOICE_LENGTH) {
    errors.push("Travel style must be 40 characters or fewer.");
  }

  if (selection.pace && selection.pace.length > MAX_CHOICE_LENGTH) {
    errors.push("Time preference must be 40 characters or fewer.");
  }

  if (
    selection.foodPreferences.includes("Mixed") &&
    selection.foodPreferences.length > 1
  ) {
    errors.push("Mixed food preference cannot be combined with other food selections.");
  }

  if (
    selection.travelerCount !== null &&
    (!Number.isInteger(selection.travelerCount) ||
      selection.travelerCount < 1 ||
      selection.travelerCount > 50)
  ) {
    errors.push("Traveler count must be between 1 and 50.");
  }

  if (
    selection.maxTransfers !== null &&
    (!Number.isInteger(selection.maxTransfers) ||
      selection.maxTransfers < 0 ||
      selection.maxTransfers > 8)
  ) {
    errors.push("Max transfers must be between 0 and 8.");
  }

  return errors;
}

export function normalizeHotel(hotel = {}) {
  const priceSource = hotel.price;
  const price =
    typeof priceSource === "string"
      ? normalizeText(priceSource)
      : normalizeText(
          priceSource?.range ??
            priceSource?.amount ??
            priceSource?.label ??
            hotel.priceRange
        );

  return {
    hotelName: normalizeText(hotel.hotelName ?? hotel.name, "Recommended Hotel"),
    hotelAddress: normalizeText(hotel.hotelAddress ?? hotel.address),
    price,
    hotelImageUrl: isRemoteImageUrl(hotel.hotelImageUrl) ? hotel.hotelImageUrl : "",
    geoCoordinates: normalizeCoordinates(
      hotel.geoCoordinates ?? hotel.coordinates ?? hotel.location
    ),
    rating: normalizeRating(hotel.rating),
    description: normalizeText(hotel.description ?? hotel.details),
  };
}

export function normalizePlace(place = {}) {
  const placeName = normalizeText(place.placeName ?? place.name, "Recommended Stop");
  const placeDetails = normalizeText(
    place.placeDetails ?? place.description ?? place.details
  );
  const placeSummary = normalizeText(
    place.placeSummary ?? place.summary ?? placeDetails ?? place.description
  );
  const geoCoordinates = normalizeCoordinates(
    place.geoCoordinates ?? place.coordinates ?? place.location
  );
  const externalPlaceId = normalizeText(place.externalPlaceId ?? place.placeId);

  const parsedTravelMinutes = Number.parseFloat(
    place.travelTimeMinutes ?? place.travel_time_minutes
  );
  const travelTimeMinutes = Number.isFinite(parsedTravelMinutes)
    ? Math.max(0, Math.round(parsedTravelMinutes))
    : null;
  const parsedDistanceKm = Number.parseFloat(
    place.travelDistanceFromPreviousKm ?? place.travel_distance_km
  );
  const travelDistanceFromPreviousKm = Number.isFinite(parsedDistanceKm)
    ? Number(parsedDistanceKm.toFixed(1))
    : null;
  const parsedDistanceMeters = Number.parseFloat(
    place.travelDistanceFromPreviousMeters ?? place.travel_distance_meters
  );
  const travelDistanceFromPreviousMeters = Number.isFinite(parsedDistanceMeters)
    ? Math.max(0, Math.round(parsedDistanceMeters))
    : null;

  return {
    placeName,
    placeDetails,
    placeSummary,
    placeImageUrl: isRemoteImageUrl(place.placeImageUrl) ? place.placeImageUrl : "",
    geoCoordinates,
    mapsUrl: resolveGoogleMapsUrl({
      mapsUrl: normalizeText(place.mapsUrl),
      externalPlaceId,
      coordinates: geoCoordinates,
      name: placeName,
      address: normalizeText(place.address ?? place.location ?? placeDetails),
    }),
    externalPlaceId,
    source: normalizeText(place.source),
    ticketPricing: normalizeText(place.ticketPricing ?? place.ticketPrice, "N/A"),
    rating: normalizeRating(place.rating),
    travelTime: normalizeText(place.travelTime, "N/A"),
    travelTimeMinutes,
    travelDistance: normalizeText(
      place.travelDistance,
      travelDistanceFromPreviousKm !== null
        ? `${travelDistanceFromPreviousKm} km`
        : "N/A"
    ),
    travelDistanceFromPreviousKm,
    travelDistanceFromPreviousMeters,
    transportMode: normalizeText(place.transportMode, "drive"),
    transportSource: normalizeText(place.transportSource),
    bestTimeToVisit: normalizeText(place.bestTimeToVisit, "Flexible"),
    category: normalizeText(place.category),
  };
}

export function normalizeItinerary(itinerary = {}) {
  let days = [];

  if (Array.isArray(itinerary?.days)) {
    days = itinerary.days.map((day, index) => ({
      dayNumber: normalizeDayNumber(day?.dayNumber ?? day?.day, index),
      title: normalizeText(day?.title ?? day?.theme, `Day ${index + 1}`),
      places: Array.isArray(day?.places)
        ? day.places.map(normalizePlace).filter((place) => place.placeName)
        : [],
      placeCount: clampInteger(day?.placeCount ?? day?.place_count, 0, 100, 0),
      place_count: clampInteger(day?.placeCount ?? day?.place_count, 0, 100, 0),
      placeCountTargetMet: normalizeBoolean(
        day?.placeCountTargetMet ?? day?.place_count_target_met
      ),
      place_count_target_met: normalizeBoolean(
        day?.placeCountTargetMet ?? day?.place_count_target_met
      ),
    }));
  } else if (itinerary && typeof itinerary === "object") {
    days = Object.entries(itinerary).map(([dayKey, places], index) => ({
      dayNumber: normalizeDayNumber(dayKey, index),
      title: `Day ${index + 1}`,
      places: Array.isArray(places)
        ? places.map(normalizePlace).filter((place) => place.placeName)
        : [],
      placeCount: Array.isArray(places) ? places.length : 0,
      place_count: Array.isArray(places) ? places.length : 0,
      placeCountTargetMet: false,
      place_count_target_met: false,
    }));
  }

  days = days.map((day) => {
    const computedPlaceCount = Array.isArray(day.places) ? day.places.length : 0;
    const placeCount = day.placeCount || computedPlaceCount;
    const placeCountTargetMet =
      day.placeCountTargetMet ||
      day.place_count_target_met ||
      (placeCount >= 3 && placeCount <= 4);

    return {
      ...day,
      placeCount,
      place_count: placeCount,
      placeCountTargetMet,
      place_count_target_met: placeCountTargetMet,
    };
  });

  days.sort((left, right) => left.dayNumber - right.dayNumber);

  return { days };
}

function stripJsonCodeFence(value) {
  return value
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();
}

export function parseAiTripPayload(input) {
  if (typeof input !== "string") {
    return input;
  }

  const cleaned = stripJsonCodeFence(input);

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const firstObjectIndex = cleaned.indexOf("{");
    const lastObjectIndex = cleaned.lastIndexOf("}");

    if (firstObjectIndex >= 0 && lastObjectIndex > firstObjectIndex) {
      const candidate = cleaned.slice(firstObjectIndex, lastObjectIndex + 1);
      return JSON.parse(candidate);
    }

    throw error;
  }
}

export function normalizeAiPlan(payload = {}, fallbackSelection = {}) {
  const selection = normalizeUserSelection(fallbackSelection);
  const fallbackDestination = normalizeText(
    selection.location.label,
    "Unknown destination"
  );
  const destination = normalizeText(
    payload?.destination ??
      payload?.tripData?.destination ??
      payload?.trip?.destination ??
      payload?.location,
    fallbackDestination
  );

  const rawDays = extractRawPlanDays(payload);
  let days = rawDays
    .map((rawDay, index) => normalizeAiDay(rawDay, index))
    .sort((left, right) => left.day - right.day);

  if (days.length === 0) {
    days = buildFallbackPlanDays({
      ...selection,
      location: { label: destination },
    });
  }

  const totalEstimatedCost = normalizeText(
    payload?.total_estimated_cost ??
      payload?.totalEstimatedCost ??
      payload?.estimated_total_cost ??
      payload?.costSummary,
    buildEstimatedTotalCost({
      ...selection,
      days: days.length,
    })
  );

  const travelTips = normalizeTravelTips(
    payload?.travel_tips ?? payload?.travelTips ?? payload?.tips,
    destination
  );

  return {
    destination,
    days,
    totalEstimatedCost,
    travelTips,
  };
}

function formatDurationMinutes(totalMinutes) {
  const minutes = Math.max(0, Math.round(Number.parseFloat(totalMinutes) || 0));
  if (minutes <= 0) {
    return "Data not available";
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours === 0) {
    return `${remainder}m`;
  }

  return `${hours}h ${String(remainder).padStart(2, "0")}m`;
}

function normalizeGroundedEntity(entity = {}, fallbackCategory = "attraction") {
  return {
    id: normalizeText(entity.id),
    name: normalizeText(entity.name, "Unknown Place"),
    category: normalizeText(entity.category, fallbackCategory),
    address: normalizeText(entity.address),
    coordinates: normalizeCoordinates(entity.coordinates),
    rating: normalizeRating(entity.rating),
    priceLevel: normalizeText(entity.priceLevel),
    description: normalizeText(entity.description),
    source: normalizeText(entity.source),
    foodTags: normalizeFoodPreferences(entity.foodTags ?? entity.food_tags),
    distanceToClusterMeters:
      Number.isFinite(Number.parseFloat(entity.distanceToClusterMeters))
        ? Math.round(Number.parseFloat(entity.distanceToClusterMeters))
        : null,
    travelTimeFromPreviousMinutes:
      Number.isFinite(Number.parseFloat(entity.travelTimeFromPreviousMinutes))
        ? Math.round(Number.parseFloat(entity.travelTimeFromPreviousMinutes))
        : 0,
    metadata:
      entity.metadata && typeof entity.metadata === "object" ? entity.metadata : {},
  };
}

function normalizeGroundedDay(day = {}, index = 0) {
  const dayNumber = clampInteger(day.day, 1, 30, index + 1);
  const estimatedTimeMinutes = Number.isFinite(
    Number.parseFloat(day.estimatedTimeMinutes ?? day.estimated_time_minutes)
  )
    ? Math.round(Number.parseFloat(day.estimatedTimeMinutes ?? day.estimated_time_minutes))
    : 0;
  const estimatedCostAmount = roundBudgetAmount(
    day.estimatedCostAmount ?? day.estimated_cost_amount
  );

  return {
    day: dayNumber,
    title: normalizeText(day.title, `Day ${dayNumber}`),
    summary: normalizeText(day.summary, ""),
    tips: normalizeStringArray(day.tips, 6),
    places: Array.isArray(day.places)
      ? day.places.map((entity) => normalizeGroundedEntity(entity, "attraction"))
      : [],
    hotels: Array.isArray(day.hotels)
      ? day.hotels.map((entity) => normalizeGroundedEntity(entity, "hotel"))
      : [],
    restaurants: Array.isArray(day.restaurants)
      ? day.restaurants.map((entity) => normalizeGroundedEntity(entity, "restaurant"))
      : [],
    route: Array.isArray(day.route)
      ? day.route.map((value) => normalizeText(value)).filter(Boolean)
      : [],
    estimatedTimeMinutes,
    estimated_time: normalizeText(
      day.estimated_time,
      formatDurationMinutes(estimatedTimeMinutes)
    ),
    estimatedCostAmount,
    cost: normalizeText(
      day.cost,
      estimatedCostAmount ? formatBudgetAmount(estimatedCostAmount) : "Data not available"
    ),
    wasTrimmed: normalizeBoolean(day.wasTrimmed),
    routeLegs: Array.isArray(day.routeLegs)
      ? day.routeLegs
          .map((leg) => ({
            fromPlaceId: normalizeText(leg.fromPlaceId),
            toPlaceId: normalizeText(leg.toPlaceId),
            durationMinutes:
              Number.isFinite(Number.parseFloat(leg.durationMinutes))
                ? Math.round(Number.parseFloat(leg.durationMinutes))
                : null,
            source: normalizeText(leg.source),
          }))
          .filter((leg) => leg.fromPlaceId && leg.toPlaceId)
      : [],
    validation:
      day.validation && typeof day.validation === "object"
        ? {
            isTimeFeasible: normalizeBoolean(day.validation.isTimeFeasible),
            isTransitFeasible: normalizeBoolean(day.validation.isTransitFeasible),
            isStopCountFeasible: normalizeBoolean(day.validation.isStopCountFeasible),
            isBudgetFeasible: normalizeBoolean(day.validation.isBudgetFeasible),
          }
        : {
            isTimeFeasible: true,
            isTransitFeasible: true,
            isStopCountFeasible: true,
            isBudgetFeasible: true,
          },
  };
}

function normalizeGroundedValidation(validation = {}) {
  return {
    status: normalizeText(validation.status, "verified"),
    usedFallbackEdges: normalizeBoolean(validation.usedFallbackEdges),
    fallbackEdgeCount:
      Number.isFinite(Number.parseFloat(validation.fallbackEdgeCount))
        ? Math.round(Number.parseFloat(validation.fallbackEdgeCount))
        : 0,
    narrativeSource: normalizeText(validation.narrativeSource, "template"),
    errors: normalizeStringArray(validation.errors, 20),
    warnings: normalizeStringArray(validation.warnings, 20),
  };
}

export function normalizeGroundedPlan(input = {}, fallbackSelection = {}) {
  const selection = normalizeUserSelection(fallbackSelection);
  const destination = normalizeText(
    input.destination,
    selection.location.label || "Unknown destination"
  );
  const days = Array.isArray(input.days)
    ? input.days.map((day, index) => normalizeGroundedDay(day, index))
    : [];

  return {
    destination,
    days,
    validation: normalizeGroundedValidation(input.validation),
  };
}

export function normalizeGeneratedTrip(input = {}, options = {}) {
  const payload = parseAiTripPayload(input);

  const hotels =
    payload?.hotels ??
    payload?.tripData?.hotels ??
    payload?.trip?.hotels ??
    [];

  const itinerarySource =
    payload?.itinerary ??
    payload?.tripData?.itinerary ??
    payload?.trip?.itinerary ??
    {};

  const normalizedItinerary = normalizeItinerary(itinerarySource);
  const aiPlan = normalizeAiPlan(payload, options.userSelection);

  return {
    hotels: Array.isArray(hotels)
      ? hotels.map(normalizeHotel).filter((hotel) => hotel.hotelName)
      : [],
    itinerary: hasAtLeastOnePlannedPlace(normalizedItinerary)
      ? normalizedItinerary
      : mapAiPlanDaysToItinerary(aiPlan.days),
    aiPlan,
  };
}

function normalizeCreatedAt(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value?.toDate === "function") {
    return value.toDate().toISOString();
  }

  return null;
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = normalizeText(String(value ?? "")).toLowerCase();
  if (!normalized) {
    return false;
  }

  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function normalizePlanningMeta(input = {}) {
  if (!input || typeof input !== "object") {
    return {
      dataProvider: "",
      algorithmVersion: "",
      cacheHit: false,
      generatedAt: "",
      freshness: "",
      storageMode: "",
      recommendationProvider: "",
      intentStatus: "",
      missingFields: [],
      transport: {
        cacheHits: 0,
        liveRefreshedEdges: 0,
        fallbackEdges: 0,
      },
      validation: normalizeGroundedValidation({}),
    };
  }

  return {
    dataProvider: normalizeText(input.dataProvider),
    algorithmVersion: normalizeText(input.algorithmVersion),
    cacheHit: normalizeBoolean(input.cacheHit),
    generatedAt: normalizeCreatedAt(input.generatedAt) ?? "",
    freshness: normalizeCreatedAt(input.freshness) ?? normalizeText(input.freshness),
    storageMode: normalizeText(input.storageMode),
    recommendationProvider: normalizeText(input.recommendationProvider),
    intentStatus: normalizeText(
      input.intentStatus ?? input.intent?.status
    ),
    missingFields: normalizeStringArray(
      input.missingFields ?? input.intent?.missingFields,
      8
    ),
    transport:
      input.transport && typeof input.transport === "object"
        ? {
            cacheHits:
              Number.isFinite(Number.parseFloat(input.transport.cacheHits))
                ? Math.round(Number.parseFloat(input.transport.cacheHits))
                : 0,
            liveRefreshedEdges:
              Number.isFinite(Number.parseFloat(input.transport.liveRefreshedEdges))
                ? Math.round(Number.parseFloat(input.transport.liveRefreshedEdges))
                : 0,
            fallbackEdges:
              Number.isFinite(Number.parseFloat(input.transport.fallbackEdges))
                ? Math.round(Number.parseFloat(input.transport.fallbackEdges))
                : 0,
          }
        : {
            cacheHits: 0,
            liveRefreshedEdges: 0,
            fallbackEdges: 0,
          },
    intercityTransport:
      input.intercityTransport && typeof input.intercityTransport === "object"
        ? {
            objective: normalizeText(input.intercityTransport.objective, "fastest_feasible"),
            algorithm: normalizeText(input.intercityTransport.algorithm),
            preferredModes: normalizeStringArray(
              input.intercityTransport.preferredModes,
              5
            ).map((mode) => mode.toLowerCase()),
            maxTransfers:
              Number.isInteger(Number.parseInt(input.intercityTransport.maxTransfers, 10))
                ? Number.parseInt(input.intercityTransport.maxTransfers, 10)
                : null,
            topK: clampInteger(input.intercityTransport.topK, 0, 20, 0),
            cacheHit: normalizeBoolean(input.intercityTransport.cacheHit),
            fallbackUsed: normalizeBoolean(input.intercityTransport.fallbackUsed),
            optionCount: clampInteger(input.intercityTransport.optionCount, 0, 100, 0),
            verification: normalizeRouteVerification(input.intercityTransport.verification),
            message: normalizeText(input.intercityTransport.message),
          }
        : {
            objective: "fastest_feasible",
            algorithm: "",
            preferredModes: [],
            maxTransfers: null,
            topK: 0,
            cacheHit: false,
            fallbackUsed: false,
            optionCount: 0,
            verification: normalizeRouteVerification({}),
            message: "",
          },
    validation: normalizeGroundedValidation(input.validation),
  };
}

function normalizeOptimization(input = {}) {
  if (!input || typeof input !== "object") {
    return {
      objective: "",
      algorithmVersion: "",
      totalWeight: null,
      visitOrder: [],
      shortestPaths: [],
      previous: [],
      clusters: [],
      clusterAssignments: [],
      dayPlans: [],
      inputHash: "",
      cacheHit: false,
    };
  }

  const totalWeight = Number.parseFloat(input.totalWeight);
  const clusterAssignments = Array.isArray(input.clusterAssignments)
    ? input.clusterAssignments
    : typeof input.clusterAssignments === "object" && input.clusterAssignments
      ? Object.entries(input.clusterAssignments)
          .map(([key, value]) => [Number.parseInt(key, 10), Number.parseInt(value, 10)])
          .filter(([index, clusterId]) => Number.isInteger(index) && Number.isInteger(clusterId))
          .sort((left, right) => left[0] - right[0])
          .map(([, clusterId]) => clusterId)
      : [];

  return {
    objective: normalizeText(input.objective),
    algorithmVersion: normalizeText(input.algorithmVersion ?? input.algorithm),
    totalWeight: Number.isFinite(totalWeight) ? Number(totalWeight.toFixed(2)) : null,
    visitOrder: Array.isArray(input.visitOrder)
      ? input.visitOrder.filter((value) => Number.isInteger(value))
      : [],
    shortestPaths: Array.isArray(input.shortestPaths)
      ? input.shortestPaths
      : Array.isArray(input.shortestPathsFromOrigin)
        ? input.shortestPathsFromOrigin
        : [],
    previous: Array.isArray(input.previous) ? input.previous : [],
    clusters: Array.isArray(input.clusters) ? input.clusters : [],
    clusterAssignments,
    dayPlans: Array.isArray(input.dayPlans) ? input.dayPlans : [],
    inputHash: normalizeText(input.inputHash),
    cacheHit: normalizeBoolean(input.cacheHit),
  };
}

function normalizeTransportSegment(segment = {}) {
  return {
    segment_index: clampInteger(segment?.segment_index, 1, 20, 1),
    route_id: normalizeText(segment?.route_id),
    source_city_id: normalizeText(segment?.source_city_id),
    source_city_name: normalizeText(segment?.source_city_name),
    destination_city_id: normalizeText(segment?.destination_city_id),
    destination_city_name: normalizeText(segment?.destination_city_name),
    mode: normalizeText(segment?.mode),
    submode: normalizeText(segment?.submode),
    duration_minutes: clampInteger(segment?.duration_minutes, 0, 10_000, 0),
    distance_km: normalizeNumericValue(segment?.distance_km),
    availability_status: normalizeText(segment?.availability_status, "unknown"),
    cost_general: normalizeNumericValue(segment?.cost_general),
    cost_sleeper: normalizeNumericValue(segment?.cost_sleeper),
    cost_ac3: normalizeNumericValue(segment?.cost_ac3),
    cost_ac2: normalizeNumericValue(segment?.cost_ac2),
    cost_ac1: normalizeNumericValue(segment?.cost_ac1),
    cost_is_estimated: normalizeBoolean(segment?.cost_is_estimated),
    source_dataset: normalizeText(segment?.source_dataset),
    source_quality: normalizeText(segment?.source_quality, "medium"),
  };
}

function normalizeTransportOption(option = {}) {
  return {
    option_id: normalizeText(option?.option_id),
    mode: normalizeText(option?.mode),
    submode: normalizeText(option?.submode),
    source_city: normalizeText(option?.source_city),
    destination_city: normalizeText(option?.destination_city),
    duration_minutes: clampInteger(option?.duration_minutes, 0, 100_000, 0),
    distance_km: normalizeNumericValue(option?.distance_km),
    availability_status: normalizeText(option?.availability_status, "unknown"),
    cost_general: normalizeNumericValue(option?.cost_general),
    cost_sleeper: normalizeNumericValue(option?.cost_sleeper),
    cost_ac3: normalizeNumericValue(option?.cost_ac3),
    cost_ac2: normalizeNumericValue(option?.cost_ac2),
    cost_ac1: normalizeNumericValue(option?.cost_ac1),
    cost_is_estimated: normalizeBoolean(option?.cost_is_estimated),
    source_quality: normalizeText(option?.source_quality, "medium"),
    source_dataset: normalizeText(option?.source_dataset),
    transfer_count: clampInteger(option?.transfer_count, 0, 20, 0),
    segment_count: clampInteger(option?.segment_count, 0, 20, 0),
    mode_mix: normalizeStringArray(option?.mode_mix, 5).map((value) =>
      value.toLowerCase()
    ),
    source_datasets: normalizeStringArray(option?.source_datasets, 8),
    segments: Array.isArray(option?.segments)
      ? option.segments.map((segment) => normalizeTransportSegment(segment))
      : [],
    last_mile:
      option?.last_mile && typeof option.last_mile === "object"
        ? {
            destination_id: normalizeText(option.last_mile.destination_id),
            city_id: normalizeText(option.last_mile.city_id),
            hub_rank: clampInteger(option.last_mile.hub_rank, 0, 20, 0),
            access_distance_km: normalizeNumericValue(
              option.last_mile.access_distance_km
            ),
            access_duration_minutes: clampInteger(
              option.last_mile.access_duration_minutes,
              0,
              10_000,
              0
            ),
            matching_method: normalizeText(option.last_mile.matching_method),
          }
        : null,
  };
}

function normalizeRouteVerification(value = {}) {
  if (!value || typeof value !== "object") {
    return {
      status: "not_requested",
      provider: "none",
      confidence: 0,
      notes: [],
    };
  }

  return {
    status: normalizeText(value.status, "not_requested"),
    provider: normalizeText(value.provider, "none"),
    confidence:
      Number.isFinite(Number.parseFloat(value.confidence))
        ? Number(Number.parseFloat(value.confidence).toFixed(2))
        : 0,
    notes: normalizeStringArray(value.notes, 6),
  };
}

function normalizeTransportSummary(value = {}) {
  if (!value || typeof value !== "object") {
    return {
      objective: "fastest_feasible",
      algorithm: "",
      preferredModes: [],
      maxTransfers: null,
      topK: 0,
      cacheHit: false,
      fallbackUsed: false,
      notes: [],
      graphMetrics: {},
    };
  }

  return {
    objective: normalizeText(value.objective, "fastest_feasible"),
    algorithm: normalizeText(value.algorithm),
    preferredModes: normalizeStringArray(value.preferredModes, 5).map((mode) =>
      mode.toLowerCase()
    ),
    maxTransfers:
      Number.isInteger(Number.parseInt(value.maxTransfers, 10))
        ? Number.parseInt(value.maxTransfers, 10)
        : null,
    topK: clampInteger(value.topK, 0, 20, 0),
    cacheHit: normalizeBoolean(value.cacheHit),
    fallbackUsed: normalizeBoolean(value.fallbackUsed),
    notes: normalizeStringArray(value.notes, 6),
    graphMetrics:
      value.graphMetrics && typeof value.graphMetrics === "object"
        ? {
            city_count: clampInteger(value.graphMetrics.city_count, 0, 1_000_000, 0),
            route_count: clampInteger(value.graphMetrics.route_count, 0, 10_000_000, 0),
            hub_count: clampInteger(value.graphMetrics.hub_count, 0, 1_000_000, 0),
          }
        : {},
  };
}

function normalizeRoutePlans(routePlans = []) {
  if (!Array.isArray(routePlans)) {
    return [];
  }

  return routePlans
    .map((plan, index) => ({
      day: clampInteger(plan?.day, 1, 30, index + 1),
      clusterId:
        Number.isInteger(plan?.clusterId) && plan.clusterId >= 0
          ? plan.clusterId
          : null,
      stopCount: clampInteger(plan?.stopCount, 0, 100, 0),
      visitOrder: Array.isArray(plan?.visitOrder)
        ? plan.visitOrder.filter((value) => Number.isInteger(value))
        : [],
      stops: Array.isArray(plan?.stops)
        ? plan.stops
            .map((stop, stopIndex) => ({
              order: clampInteger(stop?.order, 1, 200, stopIndex + 1),
              placeId: normalizeText(stop?.placeId),
              name: normalizeText(stop?.name),
              address: normalizeText(stop?.address),
              category: normalizeText(stop?.category),
              rating: normalizeRating(stop?.rating),
              coordinates: normalizeCoordinates(stop?.coordinates),
            }))
            .filter((stop) => stop.name || stop.placeId)
        : [],
    }))
    .filter((plan) => plan.visitOrder.length > 0 || plan.stops.length > 0);
}

export function buildStoredTrip({
  id,
  ownerId,
  ownerEmail,
  userSelection,
  generatedTrip,
  groundedPlan = {},
  planningMeta = {},
  optimization = {},
  routePlans = [],
  recommendations = {},
  transportOptions = [],
  routeVerification = {},
  transportSummary = {},
  transportMessage = "",
  createdAt = new Date().toISOString(),
}) {
  const normalizedGeneratedTrip = normalizeGeneratedTrip(generatedTrip, {
    userSelection,
  });
  const normalizedGroundedPlan = normalizeGroundedPlan(
    groundedPlan && typeof groundedPlan === "object"
      ? groundedPlan
      : generatedTrip?.groundedPlan,
    userSelection
  );
  const transportOptionsSource =
    Array.isArray(transportOptions) && transportOptions.length > 0
      ? transportOptions
      : Array.isArray(generatedTrip?.transportOptions)
      ? generatedTrip.transportOptions
      : [];
  const transportOptionsSnakeSource =
    Array.isArray(transportOptions) && transportOptions.length > 0
      ? transportOptions
      : Array.isArray(generatedTrip?.transport_options)
      ? generatedTrip.transport_options
      : [];

  return {
    id,
    ownerId,
    ownerEmail: normalizeText(ownerEmail),
    createdAt,
    userSelection: normalizeUserSelection(userSelection),
    hotels: normalizedGeneratedTrip.hotels,
    itinerary: normalizedGeneratedTrip.itinerary,
    aiPlan: normalizedGeneratedTrip.aiPlan,
    recommendations: normalizeDestinationRecommendations(
      recommendations && typeof recommendations === "object"
        ? recommendations
        : generatedTrip?.recommendations
    ),
    planningMeta: normalizePlanningMeta(
      planningMeta && typeof planningMeta === "object"
        ? planningMeta
        : generatedTrip?.planningMeta
    ),
    optimization: normalizeOptimization(
      optimization && typeof optimization === "object"
        ? optimization
        : generatedTrip?.optimization
    ),
    transportOptions: transportOptionsSource.map((option) => normalizeTransportOption(option)),
    transport_options: transportOptionsSnakeSource.map((option) =>
      normalizeTransportOption(option)
    ),
    routeVerification: normalizeRouteVerification(
      routeVerification && Object.keys(routeVerification).length > 0
        ? routeVerification
        : generatedTrip?.routeVerification ?? generatedTrip?.route_verification
    ),
    route_verification: normalizeRouteVerification(
      routeVerification && Object.keys(routeVerification).length > 0
        ? routeVerification
        : generatedTrip?.routeVerification ?? generatedTrip?.route_verification
    ),
    transportSummary: normalizeTransportSummary(
      transportSummary && Object.keys(transportSummary).length > 0
        ? transportSummary
        : generatedTrip?.transportSummary ?? generatedTrip?.transport_summary
    ),
    transport_summary: normalizeTransportSummary(
      transportSummary && Object.keys(transportSummary).length > 0
        ? transportSummary
        : generatedTrip?.transportSummary ?? generatedTrip?.transport_summary
    ),
    transportMessage: normalizeText(
      transportMessage || generatedTrip?.transportMessage || generatedTrip?.transport_message
    ),
    transport_message: normalizeText(
      transportMessage || generatedTrip?.transportMessage || generatedTrip?.transport_message
    ),
    groundedPlan: normalizedGroundedPlan,
    routePlans: normalizeRoutePlans(
      Array.isArray(routePlans) && routePlans.length > 0
        ? routePlans
        : generatedTrip?.routePlans
    ),
  };
}

export function normalizeStoredTrip(input = {}) {
  const normalizedTrip = buildStoredTrip({
    id: normalizeText(input.id),
    ownerId: normalizeText(input.ownerId ?? input.userId),
    ownerEmail: normalizeText(input.ownerEmail ?? input.userEmail),
    userSelection: input.userSelection ?? input.selection,
    generatedTrip: {
      hotels: input.hotels ?? input.tripData?.hotels,
      itinerary: input.itinerary ?? input.tripData?.itinerary,
      destination:
        input.aiPlan?.destination ??
        input.destination ??
        input.tripData?.destination,
      days: input.aiPlan?.days ?? input.days ?? input.tripData?.days,
      total_estimated_cost:
        input.aiPlan?.totalEstimatedCost ??
        input.totalEstimatedCost ??
        input.total_estimated_cost ??
        input.tripData?.total_estimated_cost,
      travel_tips:
        input.aiPlan?.travelTips ??
        input.travelTips ??
        input.travel_tips ??
        input.tripData?.travel_tips,
      groundedPlan: input.groundedPlan ?? input.tripData?.groundedPlan,
      recommendations: input.recommendations,
      planningMeta: input.planningMeta,
      optimization: input.optimization,
      routePlans: input.routePlans,
    },
    groundedPlan: input.groundedPlan ?? input.tripData?.groundedPlan,
    planningMeta: input.planningMeta,
    optimization: input.optimization,
    routePlans: input.routePlans,
    recommendations: input.recommendations,
    transportOptions:
      input.transportOptions ??
      input.transport_options ??
      input.tripData?.transportOptions ??
      input.tripData?.transport_options,
    routeVerification:
      input.routeVerification ??
      input.route_verification ??
      input.tripData?.routeVerification ??
      input.tripData?.route_verification,
    transportSummary:
      input.transportSummary ??
      input.transport_summary ??
      input.tripData?.transportSummary ??
      input.tripData?.transport_summary,
    transportMessage:
      input.transportMessage ??
      input.transport_message ??
      input.tripData?.transportMessage ??
      input.tripData?.transport_message,
    createdAt: normalizeCreatedAt(input.createdAt) ?? new Date().toISOString(),
  });

  if (!normalizedTrip.id && input?.id) {
    normalizedTrip.id = String(input.id);
  }

  return normalizedTrip;
}

export function sortTripsNewestFirst(trips = []) {
  return [...trips].sort((left, right) => {
    const leftDate = Date.parse(left.createdAt ?? 0);
    const rightDate = Date.parse(right.createdAt ?? 0);
    return rightDate - leftDate;
  });
}

export function buildTripPrompt(input = {}) {
  const selection = normalizeUserSelection(input);
  const destination = normalizeText(selection.location.label, "Not provided");
  const planType = normalizeText(selection.planType, "Auto-select if needed");
  const budget = selection.budgetAmount
    ? `${formatBudgetAmount(selection.budgetAmount)} total`
    : formatBudgetSummary(selection);
  const travelers = normalizeText(selection.travelers, "Not provided");
  const travelStyle = normalizeText(selection.travelStyle, "General");
  const pace = normalizeText(selection.pace, "Balanced");
  const foodPreferences = selection.foodPreferences.length
    ? selection.foodPreferences.join(", ")
    : "No explicit food preference";
  const travelerCount = selection.travelerCount ?? "Not specified";
  const locationSource = selection.location.source || "typed by user";
  const locationPrecision = selection.location.placeId
    ? `${selection.location.label} (place id available)`
    : selection.location.label;
  const originLabel = normalizeText(selection.origin?.label, "Not specified");
  const preferredModes =
    Array.isArray(selection.preferredModes) && selection.preferredModes.length > 0
      ? selection.preferredModes.join(", ")
      : "Any";
  const maxTransfers =
    Number.isInteger(selection.maxTransfers) && selection.maxTransfers >= 0
      ? String(selection.maxTransfers)
      : "Auto";

  return `You are a travel expert planner.

Generate a personalized itinerary as strict JSON only. Never use markdown fences.
Return valid JSON with no extra keys.

Trip request:
- Destination: ${destination}
- Destination Precision: ${locationPrecision}
- Destination Source: ${locationSource}
- Duration: ${selection.days} day(s)
- Plan Type: ${planType}
- Total Budget: ${budget}
- Travel Style: ${travelStyle}
- Time Preference: ${pace}
- Food Preferences: ${foodPreferences}
- Number of Travelers: ${travelerCount}
- Traveler Profile: ${travelers}
- Origin City: ${originLabel}
- Preferred Intercity Modes: ${preferredModes}
- Max Intercity Transfers: ${maxTransfers}

Return JSON with this exact shape:
{
  "destination": "string",
  "days": [
    {
      "day": 1,
      "title": "string",
      "activities": ["string"],
      "estimated_cost": "string",
      "tips": "string"
    }
  ],
  "total_estimated_cost": "string",
  "travel_tips": ["string"]
}

Rules:
- The "days" array length must exactly match requested Duration.
- "day" values must be sequential starting at 1.
- Each day should have 3-5 concise activities.
- Match pacing to the requested time preference.
- Reflect food preferences in at least one dining recommendation per day when practical.
- Match lodging and activity intensity to the selected plan type and total budget.
- Keep tips actionable and specific to the destination.
- Use plain text cost ranges when exact costs are unknown.
- Output JSON only.`;
}

export function buildFallbackGeneratedTrip(userSelection = {}) {
  const selection = normalizeUserSelection(userSelection);
  const destination = normalizeText(selection.location.label, "Unknown destination");
  const days = buildFallbackPlanDays({
    ...selection,
    location: { label: destination },
  });
  const aiPlan = {
    destination,
    days,
    totalEstimatedCost: buildEstimatedTotalCost({
      ...selection,
      days: days.length,
    }),
    travelTips: normalizeTravelTips([], destination),
  };

  return {
    hotels: [],
    itinerary: mapAiPlanDaysToItinerary(aiPlan.days),
    aiPlan,
  };
}
