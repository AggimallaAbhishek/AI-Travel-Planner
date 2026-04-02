function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function toFiniteNumber(value, fallback = null) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function normalizeMode(mode = "") {
  const normalized = normalizeText(mode).toLowerCase();
  if (!normalized) {
    return "unknown";
  }
  return normalized;
}

function normalizeModeMix(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeMode(entry))
    .filter(Boolean);
}

function normalizeTransportOption(option = {}, index = 0) {
  const modeMix = normalizeModeMix(option.mode_mix ?? option.modeMix);
  const modeFromField = normalizeMode(option.mode);
  const mode =
    modeFromField !== "unknown"
      ? modeFromField
      : modeMix.length === 1
      ? modeMix[0]
      : modeMix.length > 1
      ? "multimodal"
      : "unknown";

  return {
    optionId: normalizeText(option.option_id ?? option.optionId, `option-${index + 1}`),
    mode,
    modeMix,
    sourceCity: normalizeText(option.source_city ?? option.sourceCity),
    destinationCity: normalizeText(option.destination_city ?? option.destinationCity),
    durationMinutes: toInteger(
      option.duration_minutes ?? option.total_duration_minutes ?? option.durationMinutes,
      0
    ),
    distanceKm: toFiniteNumber(
      option.distance_km ?? option.total_distance_km ?? option.distanceKm
    ),
    transferCount: toInteger(option.transfer_count ?? option.transferCount, 0),
    segmentCount: toInteger(option.segment_count ?? option.segmentCount, 0),
    availabilityStatus: normalizeText(
      option.availability_status ?? option.availabilityStatus,
      "unknown"
    ),
    sourceQuality: normalizeText(option.source_quality ?? option.sourceQuality, "unknown"),
    sourceDataset: normalizeText(option.source_dataset ?? option.sourceDataset),
    lastMile:
      option.last_mile && typeof option.last_mile === "object"
        ? {
            accessDistanceKm: toFiniteNumber(
              option.last_mile.access_distance_km ?? option.last_mile.accessDistanceKm
            ),
            accessDurationMinutes: toInteger(
              option.last_mile.access_duration_minutes ??
                option.last_mile.accessDurationMinutes,
              0
            ),
            matchingMethod: normalizeText(
              option.last_mile.matching_method ?? option.last_mile.matchingMethod
            ),
          }
        : null,
  };
}

function normalizeRouteVerification(verification = {}) {
  return {
    status: normalizeText(verification.status, "not_requested"),
    provider: normalizeText(verification.provider, "none"),
    confidence: toFiniteNumber(verification.confidence, 0),
    notes: Array.isArray(verification.notes)
      ? verification.notes.map((note) => normalizeText(note)).filter(Boolean)
      : [],
  };
}

function normalizeTransportSummary(summary = {}) {
  return {
    objective: normalizeText(summary.objective),
    algorithm: normalizeText(summary.algorithm),
    fallbackUsed: Boolean(summary.fallbackUsed ?? summary.fallback_used),
    cacheHit: Boolean(summary.cacheHit ?? summary.cache_hit),
    topK: toInteger(summary.topK ?? summary.top_k, 0),
    maxTransfers: toInteger(summary.maxTransfers ?? summary.max_transfers, 0),
  };
}

export function normalizeTripTransportData(trip = {}) {
  const optionsSource = Array.isArray(trip.transportOptions)
    ? trip.transportOptions
    : Array.isArray(trip.transport_options)
    ? trip.transport_options
    : [];
  const routeVerificationSource =
    trip.routeVerification && typeof trip.routeVerification === "object"
      ? trip.routeVerification
      : trip.route_verification && typeof trip.route_verification === "object"
      ? trip.route_verification
      : {};
  const summarySource =
    trip.transportSummary && typeof trip.transportSummary === "object"
      ? trip.transportSummary
      : trip.transport_summary && typeof trip.transport_summary === "object"
      ? trip.transport_summary
      : {};

  return {
    options: optionsSource.map((option, index) =>
      normalizeTransportOption(option, index)
    ),
    routeVerification: normalizeRouteVerification(routeVerificationSource),
    transportSummary: normalizeTransportSummary(summarySource),
    message: normalizeText(trip.transportMessage ?? trip.transport_message),
  };
}

export function getDayPlaceCountMeta(day = {}) {
  const rawPlaces = Array.isArray(day?.places) ? day.places : [];
  const explicitPlaceCount = toInteger(day?.placeCount ?? day?.place_count, 0);
  const placeCount = explicitPlaceCount > 0 ? explicitPlaceCount : rawPlaces.length;
  const explicitTarget = day?.placeCountTargetMet ?? day?.place_count_target_met;
  const placeCountTargetMet =
    typeof explicitTarget === "boolean"
      ? explicitTarget
      : placeCount >= 3 && placeCount <= 4;

  return {
    placeCount,
    placeCountTargetMet,
  };
}

export function summarizePlaceCountCompliance(days = []) {
  if (!Array.isArray(days) || days.length === 0) {
    return {
      totalDays: 0,
      metDays: 0,
      unmetDays: [],
    };
  }

  let metDays = 0;
  const unmetDays = [];

  days.forEach((day, index) => {
    const meta = getDayPlaceCountMeta(day);
    if (meta.placeCountTargetMet) {
      metDays += 1;
      return;
    }

    unmetDays.push(toInteger(day?.dayNumber ?? day?.day, index + 1));
  });

  return {
    totalDays: days.length,
    metDays,
    unmetDays,
  };
}

export function formatDurationMinutes(value) {
  const minutes = toInteger(value, 0);
  if (minutes <= 0) {
    return "N/A";
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours <= 0) {
    return `${remainingMinutes} min`;
  }

  if (remainingMinutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainingMinutes}m`;
}

export function formatDistanceKm(value) {
  const distance = toFiniteNumber(value);
  if (distance === null || distance <= 0) {
    return "N/A";
  }

  return `${distance.toFixed(distance >= 100 ? 0 : 1)} km`;
}
