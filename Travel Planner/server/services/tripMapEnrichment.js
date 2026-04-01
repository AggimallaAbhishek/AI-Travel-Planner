import { buildGoogleMapsSearchUrl, normalizeGeoCoordinates } from "../../shared/maps.js";

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

export function resolvePlacesApiKey() {
  return normalizeText(
    process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY
  );
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

function buildTimedFetchOptions(options = {}, timeoutMs) {
  return {
    ...options,
    ...(typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
      ? { signal: AbortSignal.timeout(timeoutMs) }
      : {}),
  };
}

async function parseErrorResponse(response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = await response.json();
    return payload?.error?.message ?? payload?.message ?? `HTTP ${response.status}`;
  }

  const text = await response.text();
  return normalizeText(text, `HTTP ${response.status}`);
}

async function geocodeCityBounds({
  destination,
  apiKey,
  fetchImpl,
  timeoutMs,
}) {
  const query = normalizeText(destination);
  if (!apiKey || !query) {
    return null;
  }

  const response = await fetchImpl(
    GOOGLE_PLACES_TEXT_SEARCH_URL,
    buildTimedFetchOptions(
      {
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
      timeoutMs
    )
  );

  if (!response.ok) {
    const message = await parseErrorResponse(response);
    console.warn("[trip-map-enrichment] City bounds lookup failed", {
      destination,
      message,
    });
    return null;
  }

  const payload = await response.json();
  const place = Array.isArray(payload?.places) ? payload.places[0] : null;
  return normalizeBounds(place?.viewport);
}

async function geocodePlaceWithPlaces({
  place,
  destination,
  apiKey,
  fetchImpl,
  timeoutMs,
  geocodeCache,
  cityBounds = null,
}) {
  const queries = buildGeocodeQueriesForPlace(place, destination);
  if (queries.length === 0 || !apiKey) {
    return null;
  }

  const cacheKey = queries.join("||").toLowerCase();
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey);
  }

  const geocodePromise = (async () => {
    for (const query of queries) {
      try {
        console.info("[trip-map-enrichment] Geocoding itinerary place", {
          placeName: normalizeText(place?.placeName ?? place?.name),
          destination,
          query,
        });

        const response = await fetchImpl(
          GOOGLE_PLACES_TEXT_SEARCH_URL,
          buildTimedFetchOptions(
            {
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
            timeoutMs
          )
        );

        if (!response.ok) {
          const message = await parseErrorResponse(response);
          console.warn("[trip-map-enrichment] Place geocode query failed", {
            query,
            message,
            status: response.status,
          });
          continue;
        }

        const payload = await response.json();
        const places = Array.isArray(payload?.places) ? payload.places : [];
        const resolvedPlace =
          places.find((candidate) =>
            isWithinBounds(candidate?.location, cityBounds)
          ) ?? places[0] ?? null;

        if (!resolvedPlace?.location) {
          continue;
        }

        return {
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

function createMapEnrichment(itinerary = {}, attemptedAt = "", cityBounds = null) {
  const places = Array.isArray(itinerary?.days)
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
  };
}

export async function enrichTripWithPersistedGeocodes({
  trip,
  fetchImpl = fetch,
  apiKey = resolvePlacesApiKey(),
  timeoutMs = DEFAULT_TRIP_GEOCODE_TIMEOUT_MS,
  concurrency = DEFAULT_GEOCODE_CONCURRENCY,
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
  let cityBounds =
    trip?.mapEnrichment?.cityBounds && typeof trip.mapEnrichment.cityBounds === "object"
      ? trip.mapEnrichment.cityBounds
      : null;

  console.info("[trip-map-enrichment] Starting trip map enrichment", {
    tripId: trip?.id ?? null,
    destination,
    hasPlacesKey: Boolean(apiKey),
    hasExistingCityBounds: Boolean(cityBounds),
  });

  if (!cityBounds && apiKey && destination) {
    cityBounds = await geocodeCityBounds({
      destination,
      apiKey,
      fetchImpl,
      timeoutMs,
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

          if (!apiKey) {
            return {
              ...basePlace,
              geoCoordinates: existingCoordinates,
              mapsUrl: buildPlaceMapsUrl(basePlace, destination, existingCoordinates),
              geocodeStatus: "unresolved",
              geocodeSource: "",
              geocodedAt: normalizeText(basePlace.geocodedAt),
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
            geocodeSource: "google_places",
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

  const nextTrip = {
    ...trip,
    itinerary: {
      ...(trip?.itinerary ?? {}),
      days: nextDays,
    },
  };
  const mapEnrichment = createMapEnrichment(nextTrip.itinerary, attemptedAt, cityBounds);
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
    },
  };
}
