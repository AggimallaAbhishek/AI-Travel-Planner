import { buildGoogleMapsSearchUrl } from "../../shared/maps.js";
import { normalizeDestinationRecommendations } from "../../shared/recommendations.js";
import { enrichDestinationRecommendationImages } from "./recommendationImages.js";

const GOOGLE_PLACES_TEXT_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchText";
const NOMINATIM_SEARCH_URL =
  "https://nominatim.openstreetmap.org/search";
const OVERPASS_API_URL = "https://overpass-api.de/api/interpreter";
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_RESULT_LIMIT = 6;
const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_RECOMMENDATION_RADIUS_METERS = 3_000;
const DEFAULT_NOMINATIM_MIN_INTERVAL_MS = 1_000;

const GOOGLE_PLACES_FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.shortFormattedAddress",
  "places.rating",
  "places.priceLevel",
  "places.primaryTypeDisplayName",
  "places.editorialSummary",
  "places.location",
  "places.googleMapsUri",
].join(",");

const HOTEL_DISTRICTS = [
  "City Center",
  "Old Town",
  "Waterfront",
  "Cultural Quarter",
  "Garden District",
  "Riverside",
  "Marina District",
  "Arts Quarter",
];

const HOTEL_PREFIXES = [
  "Harbor",
  "Luma",
  "Atlas",
  "Solstice",
  "Cedar",
  "Vista",
  "Drift",
  "Crown",
];

const HOTEL_SUFFIXES = [
  "Suites",
  "Residences",
  "Retreat",
  "House",
  "Stay",
  "Haven",
  "Lodge",
  "Grand",
];

const RESTAURANT_PREFIXES = [
  "Saffron",
  "Olive",
  "Ember",
  "Tamarind",
  "Salt",
  "Juniper",
  "Golden",
  "Cedar",
];

const RESTAURANT_SUFFIXES = [
  "Kitchen",
  "Table",
  "House",
  "Bistro",
  "Social",
  "Grill",
  "Atelier",
  "Garden",
];

const DINING_STYLES = [
  "Regional tasting menus",
  "Modern local plates",
  "Seafood-forward dining",
  "Street-food inspired comfort dishes",
  "Rooftop sunset dining",
  "Chef-led seasonal specials",
  "Cafe and brunch staples",
  "Late-evening sharing plates",
];

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function normalizeNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
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

function formatCuisineLabel(value) {
  const cuisine = normalizeText(value);
  if (!cuisine) {
    return "";
  }

  return cuisine
    .split(";")
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, 2)
    .join(", ");
}

function formatAddressFromTags(tags = {}, fallback = "") {
  const parts = [
    normalizeText(tags["addr:housenumber"]),
    normalizeText(tags["addr:street"]),
    normalizeText(tags["addr:suburb"]),
    normalizeText(tags["addr:city"]),
    normalizeText(tags["addr:state"]),
    normalizeText(tags["addr:country"]),
  ].filter(Boolean);

  const distinctParts = [];
  const seen = new Set();

  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    distinctParts.push(part);
    seen.add(key);
  }

  return normalizeText(
    tags["addr:full"] ?? distinctParts.join(", "),
    fallback
  );
}

function extractOsmCoordinates(element = {}) {
  const latitude = normalizeNumber(element.lat ?? element.center?.lat);
  const longitude = normalizeNumber(element.lon ?? element.center?.lon);

  return {
    latitude,
    longitude,
  };
}

function calculateDistanceMeters(
  fromLatitude,
  fromLongitude,
  toLatitude,
  toLongitude
) {
  const coordinates = [
    fromLatitude,
    fromLongitude,
    toLatitude,
    toLongitude,
  ].map(normalizeNumber);

  if (coordinates.some((value) => value === null)) {
    return Number.POSITIVE_INFINITY;
  }

  const [safeFromLatitude, safeFromLongitude, safeToLatitude, safeToLongitude] =
    coordinates;
  const earthRadiusMeters = 6_371_000;
  const toRadians = (value) => (value * Math.PI) / 180;
  const deltaLatitude = toRadians(safeToLatitude - safeFromLatitude);
  const deltaLongitude = toRadians(safeToLongitude - safeFromLongitude);
  const originLatitude = toRadians(safeFromLatitude);
  const targetLatitude = toRadians(safeToLatitude);
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(targetLatitude) *
      Math.sin(deltaLongitude / 2) ** 2;

  return (
    2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function formatDistanceLabel(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) {
    return "";
  }

  if (distanceMeters < 950) {
    return `${Math.max(1, Math.round(distanceMeters / 50) * 50)} m`;
  }

  return `${(distanceMeters / 1_000).toFixed(1)} km`;
}

function buildOpenStreetMapNote() {
  return "Live destination data from OpenStreetMap. © OpenStreetMap contributors.";
}

function buildOpenStreetMapTypeLabel(tags = {}, category) {
  if (category === "hotel") {
    const stars = normalizeText(tags.stars);
    if (stars) {
      return `${stars}-star stay`;
    }

    return normalizeText(tags.tourism, "Hotel");
  }

  const cuisine = formatCuisineLabel(tags.cuisine);
  if (cuisine) {
    return cuisine;
  }

  return normalizeText(tags.amenity, "Restaurant");
}

function buildOpenStreetMapDescription({
  tags = {},
  category,
  destination,
  distanceLabel,
}) {
  const explicitDescription = normalizeText(tags.description);
  if (explicitDescription) {
    return explicitDescription;
  }

  if (category === "hotel") {
    return distanceLabel
      ? `Live hotel listing near ${destination}, approximately ${distanceLabel} from the selected location.`
      : `Live hotel listing near ${destination}.`;
  }

  const cuisine = formatCuisineLabel(tags.cuisine);
  if (cuisine) {
    return distanceLabel
      ? `${cuisine} dining option near ${destination}, approximately ${distanceLabel} from the selected location.`
      : `${cuisine} dining option near ${destination}.`;
  }

  return distanceLabel
    ? `Live restaurant listing near ${destination}, approximately ${distanceLabel} from the selected location.`
    : `Live restaurant listing near ${destination}.`;
}

function buildOpenStreetMapQuery({
  category,
  latitude,
  longitude,
  radiusMeters,
  limit,
  timeoutMs,
}) {
  const safeLatitude = normalizeNumber(latitude);
  const safeLongitude = normalizeNumber(longitude);
  const timeoutSeconds = Math.max(5, Math.ceil(timeoutMs / 1_000));
  const resultLimit = Math.max(limit * 6, 18);
  const filter =
    category === "hotel"
      ? '["tourism"~"hotel|hostel|guest_house|motel|apartment"]["name"]'
      : '["amenity"~"restaurant|cafe|fast_food|food_court"]["name"]';

  return `[out:json][timeout:${timeoutSeconds}];
(
  node(around:${radiusMeters},${safeLatitude},${safeLongitude})${filter};
  way(around:${radiusMeters},${safeLatitude},${safeLongitude})${filter};
  relation(around:${radiusMeters},${safeLatitude},${safeLongitude})${filter};
);
out body center ${resultLimit};`;
}

function resolveRecommendationLimit() {
  const parsed = Number.parseInt(
    process.env.DESTINATION_RECOMMENDATION_LIMIT ?? "",
    10
  );

  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 12) {
    return parsed;
  }

  return DEFAULT_RESULT_LIMIT;
}

function resolveRecommendationCacheTtlMs() {
  const parsed = Number.parseInt(
    process.env.DESTINATION_RECOMMENDATION_CACHE_TTL_MS ?? "",
    10
  );

  if (Number.isInteger(parsed) && parsed >= 30_000 && parsed <= 86_400_000) {
    return parsed;
  }

  return DEFAULT_CACHE_TTL_MS;
}

function resolveRequestTimeoutMs() {
  const parsed = Number.parseInt(
    process.env.DESTINATION_RECOMMENDATION_TIMEOUT_MS ?? "",
    10
  );

  if (Number.isInteger(parsed) && parsed >= 2_000 && parsed <= 30_000) {
    return parsed;
  }

  return DEFAULT_REQUEST_TIMEOUT_MS;
}

function resolveRecommendationRadiusMeters() {
  const parsed = Number.parseInt(
    process.env.DESTINATION_RECOMMENDATION_RADIUS_METERS ?? "",
    10
  );

  if (Number.isInteger(parsed) && parsed >= 1_000 && parsed <= 20_000) {
    return parsed;
  }

  return DEFAULT_RECOMMENDATION_RADIUS_METERS;
}

export function resolveGooglePlacesApiKey() {
  return process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";
}

function resolveNominatimSearchUrl() {
  return normalizeText(process.env.NOMINATIM_SEARCH_URL, NOMINATIM_SEARCH_URL);
}

function resolveOverpassApiUrl() {
  return normalizeText(process.env.OVERPASS_API_URL, OVERPASS_API_URL);
}

function resolveOpenStreetMapUserAgent() {
  return normalizeText(
    process.env.OSM_USER_AGENT,
    "AI-Travel-Planner/1.0 (destination recommendations)"
  );
}

function createSeed(value) {
  return [...normalizeText(value)].reduce(
    (total, character, index) => total + character.charCodeAt(0) * (index + 1),
    0
  );
}

function selectBySeed(values, seed, offset = 0) {
  return values[(seed + offset) % values.length];
}

function formatHotelPriceLabel(budget, offset) {
  const normalizedBudget = normalizeText(budget).toLowerCase();

  if (/luxury|premium/.test(normalizedBudget)) {
    return [`$260-$340 / night`, `$320-$420 / night`, `$380-$520 / night`][
      offset % 3
    ];
  }

  if (/cheap|budget|economy/.test(normalizedBudget)) {
    return [`$70-$110 / night`, `$85-$130 / night`, `$95-$145 / night`][
      offset % 3
    ];
  }

  return [`$130-$190 / night`, `$150-$220 / night`, `$180-$260 / night`][
    offset % 3
  ];
}

function formatRestaurantPriceLabel(budget, offset) {
  const normalizedBudget = normalizeText(budget).toLowerCase();

  if (/luxury|premium/.test(normalizedBudget)) {
    return [`$$$ Signature dining`, `$$$$ Fine dining`, `$$$ Chef's table`][
      offset % 3
    ];
  }

  if (/cheap|budget|economy/.test(normalizedBudget)) {
    return [`$ Casual`, `$$ Neighborhood spot`, `$ Street food favorite`][
      offset % 3
    ];
  }

  return [`$$ Casual`, `$$$ Elevated local`, `$$ Bistro`][offset % 3];
}

function buildMockHotelDescription({
  destination,
  district,
  travelers,
  budget,
}) {
  const travelerTone = normalizeText(travelers, "travelers").toLowerCase();
  const budgetTone = normalizeText(budget, "balanced").toLowerCase();

  return `A ${budgetTone} stay in ${district} with dependable access to ${destination}'s main sights, well-suited for ${travelerTone} who want a smooth home base between activities.`;
}

function buildMockRestaurantDescription({
  destination,
  diningStyle,
  district,
}) {
  return `${diningStyle} near ${district}, chosen to make it easy to pair a memorable meal with the rest of your ${destination} itinerary.`;
}

function mapPriceLevel(priceLevel) {
  switch (priceLevel) {
    case "PRICE_LEVEL_FREE":
      return "Free";
    case "PRICE_LEVEL_INEXPENSIVE":
      return "$ Budget-friendly";
    case "PRICE_LEVEL_MODERATE":
      return "$$ Moderate";
    case "PRICE_LEVEL_EXPENSIVE":
      return "$$$ Upscale";
    case "PRICE_LEVEL_VERY_EXPENSIVE":
      return "$$$$ Premium";
    default:
      return "";
  }
}

function buildLiveDescription(place, category, destination) {
  const editorialSummary = normalizeText(place.editorialSummary?.text);
  if (editorialSummary) {
    return editorialSummary;
  }

  const typeLabel = normalizeText(place.primaryTypeDisplayName?.text);
  if (typeLabel && category === "hotel") {
    return `${typeLabel} in ${destination} with easy access to nearby attractions and transport.`;
  }

  if (typeLabel && category === "restaurant") {
    return `${typeLabel} in ${destination} known for convenient dining access near popular travel zones.`;
  }

  return category === "hotel"
    ? `Recommended stay in ${destination} with convenient access to the surrounding neighborhoods.`
    : `Recommended dining stop in ${destination} for easy inclusion in your itinerary.`;
}

function mapGooglePlaceToRecommendation(place, category, destination) {
  const name = normalizeText(place.displayName?.text);
  const location = normalizeText(
    place.shortFormattedAddress ?? place.formattedAddress,
    destination
  );

  return {
    name,
    location,
    rating: place.rating,
    description: buildLiveDescription(place, category, destination),
    priceLabel: mapPriceLevel(place.priceLevel),
    mapsUrl: normalizeText(
      place.googleMapsUri,
      buildGoogleMapsSearchUrl({ name, location })
    ),
    typeLabel: normalizeText(place.primaryTypeDisplayName?.text),
    geoCoordinates: place.location,
    category,
  };
}

let nextNominatimRequestAt = 0;

async function parseErrorResponse(response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = await response.json();
    return (
      payload?.error?.message ??
      payload?.message ??
      `HTTP ${response.status}`
    );
  }

  const text = await response.text();
  return normalizeText(text, `HTTP ${response.status}`);
}

async function geocodeDestinationWithNominatim({
  destination,
  fetchImpl,
  timeoutMs,
  userAgent,
  searchUrl,
  minIntervalMs,
}) {
  const now = Date.now();
  const scheduledAt = Math.max(nextNominatimRequestAt, now);
  const waitMs = Math.max(0, scheduledAt - now);
  nextNominatimRequestAt = scheduledAt + minIntervalMs;

  if (waitMs > 0) {
    console.info("[recommendations] Waiting before Nominatim request", {
      destination,
      waitMs,
    });
    await sleep(waitMs);
  }

  const query = new URLSearchParams({
    q: destination,
    format: "jsonv2",
    limit: "1",
    addressdetails: "1",
  });
  const requestUrl = `${searchUrl}?${query.toString()}`;

  console.info("[recommendations] Geocoding destination with Nominatim", {
    destination,
  });

  const response = await fetchImpl(
    requestUrl,
    buildTimedFetchOptions(
      {
        headers: {
          Accept: "application/json",
          "Accept-Language": "en",
          "User-Agent": userAgent,
        },
      },
      timeoutMs
    )
  );

  if (!response.ok) {
    const message = await parseErrorResponse(response);
    throw new Error(
      `Nominatim geocoding failed with status ${response.status}: ${message}`
    );
  }

  const results = await response.json();
  const bestMatch = Array.isArray(results) ? results[0] : null;
  const latitude = normalizeNumber(bestMatch?.lat);
  const longitude = normalizeNumber(bestMatch?.lon);

  if (latitude === null || longitude === null) {
    throw new Error(`No usable coordinates found for ${destination}.`);
  }

  return {
    latitude,
    longitude,
    displayName: normalizeText(bestMatch?.display_name, destination),
  };
}

function mapOpenStreetMapElementToRecommendation({
  element,
  category,
  destination,
  searchCenter,
}) {
  const tags = element?.tags ?? {};
  const name = normalizeText(tags.name);
  if (!name) {
    return null;
  }

  const geoCoordinates = extractOsmCoordinates(element);
  const distanceMeters = calculateDistanceMeters(
    searchCenter.latitude,
    searchCenter.longitude,
    geoCoordinates.latitude,
    geoCoordinates.longitude
  );
  const distanceLabel = formatDistanceLabel(distanceMeters);
  const location = formatAddressFromTags(tags, destination);

  return {
    name,
    location,
    description: buildOpenStreetMapDescription({
      tags,
      category,
      destination,
      distanceLabel,
    }),
    priceLabel: "",
    mapsUrl: buildGoogleMapsSearchUrl({
      name,
      location,
      coordinates: geoCoordinates,
    }),
    typeLabel: buildOpenStreetMapTypeLabel(tags, category),
    sourceImageUrl: normalizeText(tags.image),
    wikidataId: normalizeText(tags.wikidata),
    wikimediaCommonsTitle: normalizeText(tags.wikimedia_commons),
    geoCoordinates,
    category,
    distanceMeters,
  };
}

async function searchOpenStreetMapCategory({
  destination,
  category,
  center,
  fetchImpl,
  limit,
  timeoutMs,
  userAgent,
  overpassApiUrl,
  radiusMeters,
}) {
  const query = buildOpenStreetMapQuery({
    category,
    latitude: center.latitude,
    longitude: center.longitude,
    radiusMeters,
    limit,
    timeoutMs,
  });

  console.info("[recommendations] Fetching OpenStreetMap results", {
    destination,
    category,
    limit,
    radiusMeters,
  });

  const response = await fetchImpl(
    overpassApiUrl,
    buildTimedFetchOptions(
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": userAgent,
        },
        body: new URLSearchParams({
          data: query,
        }),
      },
      timeoutMs
    )
  );

  if (!response.ok) {
    const message = await parseErrorResponse(response);
    throw new Error(
      `OpenStreetMap ${category} search failed with status ${response.status}: ${message}`
    );
  }

  const payload = await response.json();
  const elements = Array.isArray(payload?.elements) ? payload.elements : [];

  return elements
    .map((element) =>
      mapOpenStreetMapElementToRecommendation({
        element,
        category,
        destination,
        searchCenter: center,
      })
    )
    .filter(Boolean)
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
    .slice(0, limit)
    .map(({ distanceMeters: _distanceMeters, ...recommendation }) => recommendation);
}

async function searchGooglePlacesCategory({
  destination,
  category,
  apiKey,
  fetchImpl,
  limit,
  timeoutMs,
}) {
  const textQuery =
    category === "hotel"
      ? `best hotels in ${destination}`
      : `best restaurants in ${destination}`;

  console.info("[recommendations] Fetching Google Places results", {
    destination,
    category,
    limit,
  });

  const response = await fetchImpl(GOOGLE_PLACES_TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": GOOGLE_PLACES_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery,
      languageCode: "en",
      includedType: category === "hotel" ? "lodging" : "restaurant",
      strictTypeFiltering: true,
      minRating: 3.8,
      maxResultCount: limit,
      openNow: false,
      rankPreference: "RELEVANCE",
    }),
    ...(typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
      ? { signal: AbortSignal.timeout(timeoutMs) }
      : {}),
  });

  if (!response.ok) {
    const message = await parseErrorResponse(response);
    throw new Error(
      `Google Places ${category} search failed with status ${response.status}: ${message}`
    );
  }

  const data = await response.json();
  const places = Array.isArray(data.places) ? data.places : [];

  return places
    .map((place) => mapGooglePlaceToRecommendation(place, category, destination))
    .filter((place) => place.name);
}

async function fetchGooglePlacesRecommendations({
  destination,
  apiKey,
  fetchImpl,
  limit,
  timeoutMs,
  enrichRecommendationImages,
}) {
  const [hotels, restaurants] = await Promise.all([
    searchGooglePlacesCategory({
      destination,
      category: "hotel",
      apiKey,
      fetchImpl,
      limit,
      timeoutMs,
    }),
    searchGooglePlacesCategory({
      destination,
      category: "restaurant",
      apiKey,
      fetchImpl,
      limit,
      timeoutMs,
    }),
  ]);
  const enrichedRecommendations = await enrichRecommendationImages({
    destination,
    hotels,
    restaurants,
  });

  return normalizeDestinationRecommendations({
    destination,
    hotels: enrichedRecommendations.hotels,
    restaurants: enrichedRecommendations.restaurants,
    provider: "google-places",
    fetchedAt: new Date().toISOString(),
  });
}

async function fetchOpenStreetMapRecommendations({
  destination,
  fetchImpl,
  limit,
  timeoutMs,
  userAgent,
  nominatimSearchUrl,
  overpassApiUrl,
  radiusMeters,
  minIntervalMs,
  enrichRecommendationImages,
}) {
  const center = await geocodeDestinationWithNominatim({
    destination,
    fetchImpl,
    timeoutMs,
    userAgent,
    searchUrl: nominatimSearchUrl,
    minIntervalMs,
  });

  const results = await Promise.allSettled([
    searchOpenStreetMapCategory({
      destination,
      category: "hotel",
      center,
      fetchImpl,
      limit,
      timeoutMs,
      userAgent,
      overpassApiUrl,
      radiusMeters,
    }),
    searchOpenStreetMapCategory({
      destination,
      category: "restaurant",
      center,
      fetchImpl,
      limit,
      timeoutMs,
      userAgent,
      overpassApiUrl,
      radiusMeters,
    }),
  ]);

  const [hotelsResult, restaurantsResult] = results;
  const hotels =
    hotelsResult.status === "fulfilled" ? hotelsResult.value : [];
  const restaurants =
    restaurantsResult.status === "fulfilled" ? restaurantsResult.value : [];
  const failures = [hotelsResult, restaurantsResult].filter(
    (result) => result.status === "rejected"
  );

  if (failures.length > 0) {
    console.error("[recommendations] OpenStreetMap category request failed", {
      destination,
      failures: failures.map((result) =>
        result.reason instanceof Error ? result.reason.message : String(result.reason)
      ),
    });
  }

  if (hotels.length === 0 && restaurants.length === 0 && failures.length > 0) {
    throw new Error(
      failures
        .map((result) =>
          result.reason instanceof Error ? result.reason.message : String(result.reason)
        )
        .join(" | ")
    );
  }

  const warning = failures.length > 0
    ? `${buildOpenStreetMapNote()} Some categories could not be loaded right now, so available live results are shown.`
    : buildOpenStreetMapNote();
  const enrichedRecommendations = await enrichRecommendationImages({
    destination,
    hotels,
    restaurants,
  });

  return normalizeDestinationRecommendations({
    destination,
    hotels: enrichedRecommendations.hotels,
    restaurants: enrichedRecommendations.restaurants,
    provider: "openstreetmap",
    warning,
    fetchedAt: new Date().toISOString(),
  });
}

export function buildMockDestinationRecommendations({
  destination,
  userSelection = {},
  limit = DEFAULT_RESULT_LIMIT,
  warning = "",
}) {
  const normalizedDestination = normalizeText(destination, "Unknown destination");
  const seed = createSeed(normalizedDestination);
  const hotels = Array.from({ length: limit }, (_, index) => {
    const district = selectBySeed(HOTEL_DISTRICTS, seed, index);
    const hotelPrefix = selectBySeed(HOTEL_PREFIXES, seed, index);
    const hotelSuffix = selectBySeed(HOTEL_SUFFIXES, seed, index + 2);
    const name = `${hotelPrefix} ${hotelSuffix}`;

    return {
      name,
      location: `${district}, ${normalizedDestination}`,
      rating: (4.1 + ((seed + index) % 8) * 0.1).toFixed(1),
      description: buildMockHotelDescription({
        destination: normalizedDestination,
        district,
        travelers: userSelection.travelers,
        budget: userSelection.budget,
      }),
      priceLabel: formatHotelPriceLabel(userSelection.budget, index),
      mapsUrl: buildGoogleMapsSearchUrl({
        name,
        location: `${district}, ${normalizedDestination}`,
      }),
      typeLabel: "Curated stay",
      category: "hotel",
    };
  });

  const restaurants = Array.from({ length: limit }, (_, index) => {
    const district = selectBySeed(HOTEL_DISTRICTS, seed, index + 3);
    const name = `${selectBySeed(RESTAURANT_PREFIXES, seed, index)} ${selectBySeed(
      RESTAURANT_SUFFIXES,
      seed,
      index + 1
    )}`;

    return {
      name,
      location: `${district}, ${normalizedDestination}`,
      rating: (4.2 + ((seed + index + 2) % 7) * 0.1).toFixed(1),
      description: buildMockRestaurantDescription({
        destination: normalizedDestination,
        district,
        diningStyle: selectBySeed(DINING_STYLES, seed, index),
      }),
      priceLabel: formatRestaurantPriceLabel(userSelection.budget, index),
      mapsUrl: buildGoogleMapsSearchUrl({
        name,
        location: `${district}, ${normalizedDestination}`,
      }),
      typeLabel: "Curated dining spot",
      category: "restaurant",
    };
  });

  return normalizeDestinationRecommendations({
    destination: normalizedDestination,
    hotels,
    restaurants,
    provider: "mock",
    warning,
    fetchedAt: new Date().toISOString(),
  });
}

export function createDestinationRecommendationService({
  now = () => Date.now(),
  cache = new Map(),
  fetchImpl = fetch,
  cacheTtlMs = resolveRecommendationCacheTtlMs(),
  limit = resolveRecommendationLimit(),
  timeoutMs = resolveRequestTimeoutMs(),
  resolveApiKey = resolveGooglePlacesApiKey,
  nominatimSearchUrl = resolveNominatimSearchUrl(),
  overpassApiUrl = resolveOverpassApiUrl(),
  osmUserAgent = resolveOpenStreetMapUserAgent(),
  radiusMeters = resolveRecommendationRadiusMeters(),
  nominatimMinIntervalMs = DEFAULT_NOMINATIM_MIN_INTERVAL_MS,
  enrichRecommendationImages = enrichDestinationRecommendationImages,
} = {}) {
  async function getRecommendationsForDestination({
    destination,
    userSelection = {},
  }) {
    const normalizedDestination = normalizeText(destination);

    if (!normalizedDestination) {
      throw new Error("Destination is required to load recommendations.");
    }

    const cacheKey = [
      normalizedDestination.toLowerCase(),
      normalizeText(userSelection.budget).toLowerCase(),
      normalizeText(userSelection.travelers).toLowerCase(),
    ].join("::");
    const cached = cache.get(cacheKey);

    if (cached && now() - cached.createdAt < cacheTtlMs) {
      console.info("[recommendations] Cache hit", {
        destination: normalizedDestination,
        provider: cached.value.provider,
      });
      return cached.value;
    }

    console.info("[recommendations] Cache miss", {
      destination: normalizedDestination,
    });

    const apiKey = normalizeText(resolveApiKey());
    let recommendations;

    async function loadOpenStreetMapRecommendations() {
      return fetchOpenStreetMapRecommendations({
        destination: normalizedDestination,
        fetchImpl,
        limit,
        timeoutMs,
        userAgent: osmUserAgent,
        nominatimSearchUrl,
        overpassApiUrl,
        radiusMeters,
        minIntervalMs: nominatimMinIntervalMs,
        enrichRecommendationImages,
      });
    }

    if (apiKey) {
      try {
        recommendations = await fetchGooglePlacesRecommendations({
          destination: normalizedDestination,
          apiKey,
          fetchImpl,
          limit,
          timeoutMs,
          enrichRecommendationImages,
        });
      } catch (error) {
        console.error("[recommendations] Google Places failed, trying OpenStreetMap", {
          destination: normalizedDestination,
          message: error instanceof Error ? error.message : String(error),
        });
        try {
          recommendations = await loadOpenStreetMapRecommendations();
        } catch (fallbackError) {
          console.error("[recommendations] OpenStreetMap fallback failed, using mock data", {
            destination: normalizedDestination,
            message:
              fallbackError instanceof Error
                ? fallbackError.message
                : String(fallbackError),
          });
          recommendations = buildMockDestinationRecommendations({
            destination: normalizedDestination,
            userSelection,
            limit,
            warning:
              "Live destination data is temporarily unavailable, so curated sample recommendations are being shown instead.",
          });
        }
      }
    } else {
      console.info("[recommendations] Google Places not configured, trying OpenStreetMap", {
        destination: normalizedDestination,
      });
      try {
        recommendations = await loadOpenStreetMapRecommendations();
      } catch (error) {
        console.error("[recommendations] OpenStreetMap failed, using mock data", {
          destination: normalizedDestination,
          message: error instanceof Error ? error.message : String(error),
        });
        recommendations = buildMockDestinationRecommendations({
          destination: normalizedDestination,
          userSelection,
          limit,
          warning:
            "Live destination data is not configured, so curated sample recommendations are being shown.",
        });
      }
    }

    cache.set(cacheKey, {
      createdAt: now(),
      value: recommendations,
    });

    return recommendations;
  }

  return {
    getRecommendationsForDestination,
    cache,
  };
}

const destinationRecommendationService = createDestinationRecommendationService();

export const getRecommendationsForDestination =
  destinationRecommendationService.getRecommendationsForDestination;
