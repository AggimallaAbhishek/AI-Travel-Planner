import { buildGoogleMapsSearchUrl, normalizeGeoCoordinates } from "../../shared/maps.js";
import {
  fetchWithExternalRequest,
  resolveExternalReadRetries,
  resolveExternalTimeoutMs,
} from "./externalRequest.js";
import { resolvePlace as resolveWorldPoiPlace } from "./worldPoiIndex.js";

const GOOGLE_PLACES_TEXT_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchText";
const GOOGLE_PLACES_ROUTE_FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.googleMapsUri",
  "places.viewport",
].join(",");
const DEFAULT_TRIP_GEOCODE_TIMEOUT_MS = 12_000;
const DEFAULT_GEOCODE_CONCURRENCY = 4;
const DEFAULT_MARKER_LIMIT_PER_DAY = 12;
const PLACE_QUERY_LEADING_PATTERNS = Object.freeze([
  /^explore\s+/i,
  /^visit\s+/i,
  /^discover\s+/i,
  /^experience\s+/i,
  /^check[\s-]*in(?:\s+at)?\s+/i,
  /^walk(?:\s+through|\s+around|\s+along)?\s+/i,
  /^stroll(?:\s+through|\s+around|\s+along)?\s+/i,
  /^temple\s+stop\s+at\s+/i,
  /^stop\s+at\s+/i,
  /^sunset\s+dinner\s+in\s+/i,
  /^dinner\s+in\s+/i,
  /^lunch\s+in\s+/i,
  /^breakfast\s+in\s+/i,
  /^brunch\s+in\s+/i,
  /^coffee\s+tasting(?:\s+session)?(?:\s+in)?\s+/i,
  /^relax(?:ing)?\s+at\s+/i,
  /^surf(?:ing)?\s+at\s+/i,
  /^shop(?:ping)?\s+at\s+/i,
  /^head\s+to\s+/i,
  /^time\s+in\s+/i,
]);
const GENERIC_PLACE_QUERY_PATTERNS = Object.freeze([
  /^arrival$/i,
  /^departure$/i,
  /^departure prep$/i,
  /^check[\s-]*in$/i,
  /^the villa$/i,
  /^villa$/i,
  /^hotel$/i,
  /^resort$/i,
  /^cultural immersion$/i,
  /^natural beauty$/i,
  /^cultural(?: and)? natural wonders$/i,
  /^coastal charm$/i,
  /^beach fun$/i,
  /^island adventure$/i,
  /^water park thrills$/i,
  /^farewell dinner$/i,
  /^coffee tasting(?: session)?$/i,
  /^sunset dinner$/i,
  /^breakfast$/i,
  /^brunch$/i,
  /^lunch$/i,
  /^dinner$/i,
  /^walk$/i,
  /^stroll$/i,
  /^sunset$/i,
  /^sunrise$/i,
  /^temple$/i,
  /^shopping$/i,
  /^nightlife$/i,
  /^(?:cultural|natural|iconic|historic|trendy|coastal|futuristic)$/i,
]);

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function parseCoordinate(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLowerText(value, fallback = "") {
  return normalizeText(value, fallback).toLowerCase();
}

function resolveDestination(trip = {}) {
  return normalizeText(
    trip?.userSelection?.location?.label ?? trip?.aiPlan?.destination
  );
}

function findAiPlanDayByNumber(trip = {}, dayNumber) {
  const aiPlanDays = Array.isArray(trip?.aiPlan?.days) ? trip.aiPlan.days : [];
  const normalizedDayNumber = Number.parseInt(dayNumber, 10);

  if (!Number.isInteger(normalizedDayNumber) || normalizedDayNumber <= 0) {
    return null;
  }

  return (
    aiPlanDays.find(
      (day) =>
        Number.parseInt(day?.day ?? day?.dayNumber, 10) === normalizedDayNumber
    ) ?? null
  );
}

export function resolvePlacesApiKey() {
  return normalizeText(
    process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY
  );
}

function resolveTripGeocodeTimeoutMs() {
  return resolveExternalTimeoutMs({
    envVar: "TRIP_MAP_GEOCODE_TIMEOUT_MS",
    fallbackMs: DEFAULT_TRIP_GEOCODE_TIMEOUT_MS,
    minMs: 2_000,
    maxMs: 30_000,
  });
}

export function hasCoordinates(value) {
  const coordinates = normalizeGeoCoordinates(value);
  return coordinates.latitude !== null && coordinates.longitude !== null;
}

function normalizeBounds(viewport = {}) {
  const north = parseCoordinate(viewport?.northEast?.latitude);
  const east = parseCoordinate(viewport?.northEast?.longitude);
  const south = parseCoordinate(viewport?.southWest?.latitude);
  const west = parseCoordinate(viewport?.southWest?.longitude);

  if (
    north === null ||
    east === null ||
    south === null ||
    west === null ||
    north < south
  ) {
    return null;
  }

  return { north, south, east, west };
}

function isWithinBounds(coordinates = {}, bounds = null) {
  if (!bounds) {
    return true;
  }

  const point = normalizeGeoCoordinates(coordinates);
  if (point.latitude === null || point.longitude === null) {
    return false;
  }

  return (
    point.latitude <= bounds.north &&
    point.latitude >= bounds.south &&
    point.longitude <= bounds.east &&
    point.longitude >= bounds.west
  );
}

function splitCandidateFragments(value = "") {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\s*(?:\/|&|,| and | or )\s*/i)
    .map((fragment) => normalizeText(fragment))
    .filter(Boolean);
}

function cleanPlaceCandidate(value = "") {
  let candidate = normalizeText(value).replace(
    /^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g,
    ""
  );

  for (const pattern of PLACE_QUERY_LEADING_PATTERNS) {
    candidate = candidate.replace(pattern, "");
  }

  candidate = candidate.replace(/^(?:the|central|downtown|local)\s+/i, "");
  candidate = candidate.replace(/\s+(?:and|or)$/i, "");
  candidate = candidate.replace(/\s*\([^)]*\)\s*$/g, "");
  candidate = candidate.replace(
    /(?:,| - |\s+-\s+)\s*(?:known|with|before|after|during|where|which|while|perhaps|perched|overlooking|featuring|including|check|book|head|ending)\b.*$/i,
    ""
  );
  candidate = candidate.replace(
    /\s+\b(?:known|with|before|after|during|where|which|while|perhaps|perched|overlooking|featuring|including)\b.*$/i,
    ""
  );
  candidate = candidate.replace(
    /\s+(?:fun|beauty|wonders?|wonder|grandeur|elegance|adventure|thrills?|immersion|prep|nightlife)$/i,
    ""
  );

  return normalizeText(candidate).replace(
    /^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g,
    ""
  );
}

function isLikelyPlaceCandidate(value = "") {
  const candidate = normalizeText(value);

  if (!candidate) {
    return false;
  }

  if (GENERIC_PLACE_QUERY_PATTERNS.some((pattern) => pattern.test(candidate))) {
    return false;
  }

  if (/^(?:day|stop|session|experience|tour)$/i.test(candidate)) {
    return false;
  }

  const words = candidate.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return candidate.length >= 4;
  }

  return true;
}

function pushUniquePlaceCandidate(candidates = [], seen = new Set(), value = "") {
  const candidate = cleanPlaceCandidate(value);
  const key = candidate.toLowerCase();

  if (!isLikelyPlaceCandidate(candidate) || seen.has(key)) {
    return;
  }

  seen.add(key);
  candidates.push(candidate);
}

function extractPlaceCandidatesFromText(value = "") {
  const text = normalizeText(value);

  if (!text) {
    return [];
  }

  const rawCandidates = [];
  const locationPhrasePattern =
    /\b(?:in|at|near|around|through|towards?|to|from|inside|by|along)\s+([^.;:()]+)/gi;
  const capitalizedPhrasePattern =
    /\b[A-Z][A-Za-z'/-]*(?:\s+(?:[A-Z][A-Za-z'/-]*|of|the|and|\/)){0,5}/g;
  let match;

  while ((match = locationPhrasePattern.exec(text)) !== null) {
    rawCandidates.push(match[1]);
  }

  rawCandidates.push(...(text.match(capitalizedPhrasePattern) ?? []));

  if (rawCandidates.length === 0) {
    rawCandidates.push(text);
  }

  const seen = new Set();
  const candidates = [];

  for (const rawCandidate of rawCandidates) {
    const fragments = splitCandidateFragments(rawCandidate);

    if (fragments.length === 0) {
      pushUniquePlaceCandidate(candidates, seen, rawCandidate);
      continue;
    }

    for (const fragment of fragments) {
      pushUniquePlaceCandidate(candidates, seen, fragment);
    }
  }

  return candidates;
}

function buildScopedGeocodeQuery(value = "", destination = "") {
  const candidate = cleanPlaceCandidate(value);
  const normalizedDestination = normalizeText(destination);

  if (!candidate) {
    return "";
  }

  if (
    !normalizedDestination ||
    candidate.toLowerCase().includes(normalizedDestination.toLowerCase())
  ) {
    return candidate;
  }

  return `${candidate}, ${normalizedDestination}`;
}

function buildGeocodeQueriesForPlace(place = {}, destination = "") {
  const queries = [];
  const seen = new Set();
  const placeName = normalizeText(place?.placeName ?? place?.name);
  const placeLocation = normalizeText(place?.location);
  const placeDetails = normalizeText(place?.placeDetails ?? place?.description);

  function pushQuery(value = "", queryDestination = destination) {
    const query = buildScopedGeocodeQuery(value, queryDestination);
    const key = query.toLowerCase();

    if (!query || seen.has(key)) {
      return;
    }

    seen.add(key);
    queries.push(query);
  }

  pushQuery(placeName);

  for (const candidate of extractPlaceCandidatesFromText(placeName)) {
    pushQuery(candidate);
  }

  for (const candidate of extractPlaceCandidatesFromText(placeDetails)) {
    pushQuery(candidate);
  }

  if (
    placeLocation &&
    placeLocation.toLowerCase() !== normalizeText(destination).toLowerCase()
  ) {
    pushQuery(placeName, placeLocation);
  }

  return queries.slice(0, 8);
}

async function geocodeCityBounds({
  destination,
  apiKey,
  fetchImpl,
  timeoutMs,
  retries = 0,
}) {
  const query = normalizeText(destination);
  if (!apiKey || !query) {
    return null;
  }

  try {
    const response = await fetchWithExternalRequest({
      provider: "google-places",
      operation: "trip-map-city-bounds",
      url: GOOGLE_PLACES_TEXT_SEARCH_URL,
      fetchImpl,
      timeoutMs,
      retries,
      fallbackPath: "continue without destination city bounds",
      request: {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": GOOGLE_PLACES_ROUTE_FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery: query,
          languageCode: "en",
          maxResultCount: 1,
          rankPreference: "RELEVANCE",
        }),
      },
    });
    const payload = await response.json();
    const place = Array.isArray(payload?.places) ? payload.places[0] : null;
    return normalizeBounds(place?.viewport);
  } catch (error) {
    console.warn("[trip-map-enrichment] City bounds lookup failed", {
      destination,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function geocodePlaceWithPlaces({
  place,
  destination,
  apiKey,
  fetchImpl,
  timeoutMs,
  geocodeCache,
  cityBounds = null,
  telemetry = null,
  retries = 0,
}) {
  const queries = buildGeocodeQueriesForPlace(place, destination);
  if (queries.length === 0) {
    return null;
  }

  const cacheKey = queries.join("||").toLowerCase();
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey);
  }

  let shouldRetainCacheEntry = false;
  const geocodePromise = (async () => {
    for (const query of queries) {
      const worldPoiMatch = await resolveWorldPoiPlace({
        destination,
        query,
      }).catch((error) => {
        console.warn("[trip-map-enrichment] World POI lookup failed", {
          query,
          destination,
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      });

      if (worldPoiMatch?.geoCoordinates) {
        telemetry && (telemetry.worldPoiIndexHits += 1);
        console.info("[trip-map-enrichment] Resolved itinerary place from local POI index", {
          destination,
          query,
          matched: worldPoiMatch.name,
        });
        return {
          provider: "world_poi_index",
          resolvedName: normalizeText(worldPoiMatch.name, cleanPlaceCandidate(query)),
          geoCoordinates: normalizeGeoCoordinates(worldPoiMatch.geoCoordinates),
          location: normalizeText(
            [worldPoiMatch.locality, worldPoiMatch.countryName].filter(Boolean).join(", "),
            destination
          ),
          mapsUrl: normalizeText(worldPoiMatch.mapsUrl),
        };
      }

      if (!apiKey) {
        continue;
      }

      try {
        console.info("[trip-map-enrichment] Geocoding itinerary place", {
          placeName: normalizeText(place?.placeName ?? place?.name),
          destination,
          query,
        });
        telemetry && (telemetry.liveLookupCount += 1);

        const response = await fetchWithExternalRequest({
          provider: "google-places",
          operation: "trip-map-place-geocode",
          url: GOOGLE_PLACES_TEXT_SEARCH_URL,
          fetchImpl,
          timeoutMs,
          retries,
          fallbackPath: "leave stop unresolved and continue trip map enrichment",
          request: {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              "X-Goog-Api-Key": apiKey,
              "X-Goog-FieldMask": GOOGLE_PLACES_ROUTE_FIELD_MASK,
            },
            body: JSON.stringify({
              textQuery: query,
              languageCode: "en",
              maxResultCount: 5,
              rankPreference: "RELEVANCE",
            }),
          },
        });

        const payload = await response.json();
        const places = Array.isArray(payload?.places) ? payload.places : [];
        const resolvedPlace =
          places.find((candidate) =>
            isWithinBounds(candidate?.location, cityBounds)
          ) ?? places[0] ?? null;

        if (!resolvedPlace?.location) {
          continue;
        }

        shouldRetainCacheEntry = true;
        return {
          provider: "google_places",
          resolvedName: normalizeText(
            resolvedPlace?.displayName?.text,
            cleanPlaceCandidate(query)
          ),
          geoCoordinates: normalizeGeoCoordinates(resolvedPlace.location),
          location: normalizeText(resolvedPlace.formattedAddress, destination),
          mapsUrl: normalizeText(
            resolvedPlace.googleMapsUri,
            buildGoogleMapsSearchUrl({
              name: place?.placeName ?? place?.name,
              destination,
              coordinates: resolvedPlace.location,
            })
          ),
        };
      } catch (error) {
        console.warn("[trip-map-enrichment] Failed geocode query", {
          query,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return null;
  })().catch((error) => {
    console.warn("[trip-map-enrichment] Failed to geocode itinerary place", {
      placeName: normalizeText(place?.placeName ?? place?.name),
      destination,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }).finally(() => {
    if (!shouldRetainCacheEntry) {
      geocodeCache.delete(cacheKey);
    }
  });

  geocodeCache.set(cacheKey, geocodePromise);
  return geocodePromise;
}

async function mapConcurrently(items = [], concurrency, iteratee) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.max(
    1,
    Math.min(concurrency, Math.max(1, items.length))
  );
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function buildPlaceMapsUrl(place = {}, destination = "", coordinates = null) {
  return normalizeText(
    place?.mapsUrl,
    buildGoogleMapsSearchUrl({
      name: place?.placeName ?? place?.name,
      location: place?.location,
      destination,
      coordinates,
    })
  );
}

function createActivityDerivedPlacesForDay({
  day = {},
  aiPlanDay = null,
  destination = "",
  existingPlaces = [],
  limit = DEFAULT_MARKER_LIMIT_PER_DAY,
} = {}) {
  const activities = Array.isArray(aiPlanDay?.activities) ? aiPlanDay.activities : [];
  const dayNumber = Number.parseInt(day?.dayNumber ?? aiPlanDay?.day ?? aiPlanDay?.dayNumber, 10) || 1;
  const dayTitle = normalizeText(day?.title ?? aiPlanDay?.title, `Day ${dayNumber}`);
  const seen = new Set(
    existingPlaces
      .map((place) => normalizeText(place?.placeName ?? place?.name).toLowerCase())
      .filter(Boolean)
  );
  const inferredPlaces = [];

  function pushPlace(name = "", description = "") {
    const normalizedName = cleanPlaceCandidate(name);
    const key = normalizedName.toLowerCase();

    if (
      !isLikelyPlaceCandidate(normalizedName) ||
      seen.has(key) ||
      inferredPlaces.length >= limit
    ) {
      return;
    }

    seen.add(key);
    inferredPlaces.push({
      placeName: normalizedName,
      placeDetails: normalizeText(description, normalizeText(aiPlanDay?.tips)),
      location: destination,
      mapsUrl: buildGoogleMapsSearchUrl({
        name: normalizedName,
        destination,
      }),
      geoCoordinates: normalizeGeoCoordinates(null),
      geocodeStatus: "inferred",
      geocodeSource: "fallback_inferred",
      geocodedAt: "",
      category: "Activity",
      dayNumber,
      dayTitle,
    });
  }

  for (const activity of activities) {
    const activityText = normalizeText(activity);
    const extractedPlaces = extractPlaceCandidatesFromText(activityText);

    for (const candidate of extractedPlaces) {
      pushPlace(candidate, activityText);
    }

    if (
      extractedPlaces.length === 0 &&
      isLikelyPlaceCandidate(activityText) &&
      activityText.split(/\s+/).filter(Boolean).length <= 6 &&
      activityText.length <= 72
    ) {
      pushPlace(activityText, normalizeText(aiPlanDay?.tips, dayTitle));
    }

    if (inferredPlaces.length >= limit) {
      break;
    }
  }

  if (inferredPlaces.length < 2) {
    for (const candidate of extractPlaceCandidatesFromText(aiPlanDay?.title)) {
      pushPlace(candidate, normalizeText(aiPlanDay?.title, normalizeText(aiPlanDay?.tips)));

      if (inferredPlaces.length >= limit) {
        break;
      }
    }
  }

  console.info("[trip-map-enrichment] Derived activity-based map places", {
    dayNumber,
    dayTitle,
    inferredCount: inferredPlaces.length,
  });

  return inferredPlaces;
}

function createMapEnrichment(
  itinerary = {},
  attemptedAt = "",
  cityBounds = null,
  markerDays = []
) {
  const places = Array.isArray(markerDays) && markerDays.length > 0
    ? markerDays.flatMap((day) =>
        Array.isArray(day?.places) ? day.places : []
      )
    : Array.isArray(itinerary?.days)
      ? itinerary.days.flatMap((day) =>
          Array.isArray(day?.places) ? day.places : []
        )
      : [];
  const geocodedStopCount = places.filter((place) =>
    hasCoordinates(place?.geoCoordinates)
  ).length;
  const unresolvedStopCount = Math.max(0, places.length - geocodedStopCount);

  return {
    status:
      geocodedStopCount === 0
        ? "missing"
        : unresolvedStopCount > 0
          ? "partial"
          : "complete",
    lastAttemptedAt: attemptedAt,
    geocodedStopCount,
    unresolvedStopCount,
    cityBounds,
    markerDays: Array.isArray(markerDays)
      ? markerDays.map((day) => ({
          dayNumber: Number.parseInt(day?.dayNumber, 10) || 0,
          title: normalizeText(day?.title, `Day ${day?.dayNumber ?? 0}`),
          places: Array.isArray(day?.places)
            ? day.places.map((place) => ({
                placeName: normalizeText(place?.placeName ?? place?.name),
                placeDetails: normalizeText(place?.placeDetails ?? place?.description),
                location: normalizeText(place?.location),
                mapsUrl: normalizeText(place?.mapsUrl),
                geoCoordinates: normalizeGeoCoordinates(place?.geoCoordinates),
                geocodeStatus: normalizeLowerText(place?.geocodeStatus, hasCoordinates(place?.geoCoordinates) ? "resolved" : "unresolved"),
                geocodeSource: normalizeLowerText(place?.geocodeSource),
                geocodedAt: normalizeText(place?.geocodedAt),
                category: normalizeText(place?.category),
              }))
            : [],
        }))
      : [],
  };
}

export async function enrichTripWithPersistedGeocodes({
  trip,
  fetchImpl = fetch,
  apiKey = resolvePlacesApiKey(),
  timeoutMs = resolveTripGeocodeTimeoutMs(),
  concurrency = DEFAULT_GEOCODE_CONCURRENCY,
  readRetries = resolveExternalReadRetries(),
} = {}) {
  if (!trip || typeof trip !== "object") {
    return {
      trip,
      changed: false,
      stats: {
        geocodedStopCount: 0,
        unresolvedStopCount: 0,
      },
    };
  }

  const destination = resolveDestination(trip);
  const attemptedAt = new Date().toISOString();
  const geocodeCache = new Map();
  const telemetry = {
    worldPoiIndexHits: 0,
    liveLookupCount: 0,
    inferredPlaceCount: 0,
  };
  let cityBounds =
    trip?.mapEnrichment?.cityBounds && typeof trip.mapEnrichment.cityBounds === "object"
      ? trip.mapEnrichment.cityBounds
      : null;

  console.info("[trip-map-enrichment] Starting trip map enrichment", {
    tripId: trip?.id ?? null,
    destination,
    hasPlacesKey: Boolean(apiKey),
    hasExistingCityBounds: Boolean(cityBounds),
    timeoutMs,
    concurrency,
    readRetries,
  });

  if (!cityBounds && apiKey && destination) {
    cityBounds = await geocodeCityBounds({
      destination,
      apiKey,
      fetchImpl,
      timeoutMs,
      retries: readRetries,
    });
  }

  const nextDays = await mapConcurrently(
    Array.isArray(trip?.itinerary?.days) ? trip.itinerary.days : [],
    concurrency,
    async (day) => {
      const places = Array.isArray(day?.places) ? day.places : [];

      const nextPlaces = await mapConcurrently(
        places,
        concurrency,
        async (place) => {
          const basePlace = {
            ...place,
            location: normalizeText(place?.location, destination),
          };
          const existingCoordinates = normalizeGeoCoordinates(basePlace.geoCoordinates);
          const existingHasCoordinates = hasCoordinates(existingCoordinates);

          if (existingHasCoordinates) {
            return {
              ...basePlace,
              geoCoordinates: existingCoordinates,
              mapsUrl: buildPlaceMapsUrl(basePlace, destination, existingCoordinates),
              geocodeStatus: normalizeLowerText(
                basePlace.geocodeStatus,
                "resolved"
              ),
              geocodeSource: normalizeLowerText(
                basePlace.geocodeSource,
                "stored"
              ),
              geocodedAt: normalizeText(basePlace.geocodedAt, attemptedAt),
            };
          }

          const geocodedPlace = await geocodePlaceWithPlaces({
            place: basePlace,
            destination,
            apiKey,
            fetchImpl,
            timeoutMs,
            geocodeCache,
            cityBounds,
            telemetry,
            retries: readRetries,
          });
          const resolvedCoordinates = normalizeGeoCoordinates(
            geocodedPlace?.geoCoordinates
          );

          if (!hasCoordinates(resolvedCoordinates) || !isWithinBounds(resolvedCoordinates, cityBounds)) {
            return {
              ...basePlace,
              geoCoordinates: existingCoordinates,
              mapsUrl: buildPlaceMapsUrl(basePlace, destination, existingCoordinates),
              geocodeStatus: "unresolved",
              geocodeSource: "",
              geocodedAt: normalizeText(basePlace.geocodedAt),
            };
          }

          return {
            ...basePlace,
            placeName: normalizeText(
              geocodedPlace?.resolvedName,
              basePlace.placeName
            ),
            geoCoordinates: resolvedCoordinates,
            location: normalizeText(geocodedPlace?.location, basePlace.location),
            mapsUrl: normalizeText(
              geocodedPlace?.mapsUrl,
              buildPlaceMapsUrl(basePlace, destination, resolvedCoordinates)
            ),
            geocodeStatus: "resolved",
            geocodeSource:
              normalizeLowerText(geocodedPlace?.provider) === "world_poi_index"
                ? "world_poi_index"
                : "google_places",
            geocodedAt: attemptedAt,
          };
        }
      );

      return {
        ...day,
        places: nextPlaces,
      };
    }
  );

  const nextMarkerDays = await mapConcurrently(
    nextDays,
    concurrency,
    async (day) => {
      const dayNumber = Number.parseInt(day?.dayNumber, 10) || 1;
      const aiPlanDay = findAiPlanDayByNumber(trip, dayNumber);
      const itineraryPlaces = Array.isArray(day?.places) ? day.places : [];
      const inferredPlaces = createActivityDerivedPlacesForDay({
        day,
        aiPlanDay,
        destination,
        existingPlaces: itineraryPlaces,
      });
      telemetry.inferredPlaceCount += inferredPlaces.length;

      const mergedPlaces = [...itineraryPlaces, ...inferredPlaces];
      const nextPlaces = await mapConcurrently(
        mergedPlaces,
        concurrency,
        async (place) => {
          const basePlace = {
            ...place,
            location: normalizeText(place?.location, destination),
          };
          const existingCoordinates = normalizeGeoCoordinates(basePlace.geoCoordinates);
          const existingHasCoordinates = hasCoordinates(existingCoordinates);

          if (existingHasCoordinates) {
            return {
              ...basePlace,
              geoCoordinates: existingCoordinates,
              mapsUrl: buildPlaceMapsUrl(basePlace, destination, existingCoordinates),
              geocodeStatus: normalizeLowerText(
                basePlace.geocodeStatus,
                "resolved"
              ),
              geocodeSource: normalizeLowerText(
                basePlace.geocodeSource,
                "stored"
              ),
              geocodedAt: normalizeText(basePlace.geocodedAt, attemptedAt),
            };
          }

          const geocodedPlace = await geocodePlaceWithPlaces({
            place: basePlace,
            destination,
            apiKey,
            fetchImpl,
            timeoutMs,
            geocodeCache,
            cityBounds,
            telemetry,
          });
          const resolvedCoordinates = normalizeGeoCoordinates(
            geocodedPlace?.geoCoordinates
          );

          if (
            !hasCoordinates(resolvedCoordinates) ||
            !isWithinBounds(resolvedCoordinates, cityBounds)
          ) {
            return {
              ...basePlace,
              geoCoordinates: existingCoordinates,
              mapsUrl: buildPlaceMapsUrl(basePlace, destination, existingCoordinates),
              geocodeStatus: normalizeLowerText(
                basePlace.geocodeStatus,
                basePlace.geocodeSource === "fallback_inferred"
                  ? "inferred"
                  : "unresolved"
              ),
              geocodeSource: normalizeLowerText(basePlace.geocodeSource),
              geocodedAt: normalizeText(basePlace.geocodedAt),
            };
          }

          return {
            ...basePlace,
            placeName: normalizeText(
              geocodedPlace?.resolvedName,
              basePlace.placeName
            ),
            geoCoordinates: resolvedCoordinates,
            location: normalizeText(geocodedPlace?.location, basePlace.location),
            mapsUrl: normalizeText(
              geocodedPlace?.mapsUrl,
              buildPlaceMapsUrl(basePlace, destination, resolvedCoordinates)
            ),
            geocodeStatus: "resolved",
            geocodeSource:
              normalizeLowerText(geocodedPlace?.provider) === "world_poi_index"
                ? "world_poi_index"
                : "google_places",
            geocodedAt: attemptedAt,
          };
        }
      );

      return {
        dayNumber,
        title: normalizeText(day?.title ?? aiPlanDay?.title, `Day ${dayNumber}`),
        places: nextPlaces,
      };
    }
  );

  const nextTrip = {
    ...trip,
    itinerary: {
      ...(trip?.itinerary ?? {}),
      days: nextDays,
    },
  };
  const mapEnrichment = createMapEnrichment(
    nextTrip.itinerary,
    attemptedAt,
    cityBounds,
    nextMarkerDays
  );
  nextTrip.mapEnrichment = mapEnrichment;

  const changed =
    JSON.stringify(trip?.itinerary ?? {}) !== JSON.stringify(nextTrip.itinerary) ||
    JSON.stringify(trip?.mapEnrichment ?? {}) !== JSON.stringify(mapEnrichment);

  return {
    trip: nextTrip,
    changed,
    stats: {
      geocodedStopCount: mapEnrichment.geocodedStopCount,
      unresolvedStopCount: mapEnrichment.unresolvedStopCount,
      status: mapEnrichment.status,
      hasPlacesKey: Boolean(apiKey),
      hasCityBounds: Boolean(cityBounds),
      worldPoiIndexHits: telemetry.worldPoiIndexHits,
      liveLookupCount: telemetry.liveLookupCount,
      inferredPlaceCount: telemetry.inferredPlaceCount,
    },
  };
}
