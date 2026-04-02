import {
  normalizeDestinationRecommendations,
  normalizeRecommendationItem,
} from "../../shared/recommendations.js";
import {
  getStructuredDestinationByName,
  getStructuredDestinationById,
  isStructuredDestinationFresh,
  listStructuredDestinationPlaces,
  listStructuredTransportEdges,
  markStructuredDestinationIngested,
  replaceStructuredDestinationPlaces,
  replaceStructuredTransportEdges,
  upsertStructuredDestination,
} from "../data/hybridStore.js";
import { getDestinationDataBundle } from "./recommendations.js";
import { buildCompleteTransportEdges, hasCoordinates } from "./geo.js";

const DEFAULT_DESTINATION_FRESHNESS_TTL_MS = 24 * 60 * 60 * 1_000;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function normalizeDestinationCountryCode(destination = "") {
  const parts = normalizeText(destination)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const country = parts.at(-1) ?? "";
  if (/^[A-Za-z]{2}$/.test(country)) {
    return country.toUpperCase();
  }

  return "";
}

function resolveDestinationFreshnessTtlMs() {
  return parsePositiveInteger(
    process.env.DESTINATION_FRESHNESS_TTL_MS,
    DEFAULT_DESTINATION_FRESHNESS_TTL_MS
  );
}

function estimateDestinationCenterFromPlaces(places = []) {
  const coordinatePoints = places
    .map((place) => place.coordinates)
    .filter((coordinates) => hasCoordinates(coordinates));

  if (coordinatePoints.length === 0) {
    return {
      latitude: null,
      longitude: null,
    };
  }

  const latitude =
    coordinatePoints.reduce((total, point) => total + point.latitude, 0) /
    coordinatePoints.length;
  const longitude =
    coordinatePoints.reduce((total, point) => total + point.longitude, 0) /
    coordinatePoints.length;

  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
  };
}

function flattenPlaceBundle(placeBundle = {}) {
  const hotels = Array.isArray(placeBundle.hotels) ? placeBundle.hotels : [];
  const restaurants = Array.isArray(placeBundle.restaurants)
    ? placeBundle.restaurants
    : [];
  const attractions = Array.isArray(placeBundle.attractions)
    ? placeBundle.attractions
    : [];

  return [...hotels, ...restaurants, ...attractions].map((place) => ({
    ...place,
    source: normalizeText(place.source, "mock"),
    externalPlaceId: normalizeText(place.externalPlaceId),
    category: normalizeText(place.category, "attraction").toLowerCase(),
    name: normalizeText(place.name, "Unknown Place"),
    address: normalizeText(place.address),
    coordinates: {
      latitude: Number.parseFloat(place?.coordinates?.latitude),
      longitude: Number.parseFloat(place?.coordinates?.longitude),
    },
    rating: Number.parseFloat(place.rating),
    priceLevel: normalizeText(place.priceLevel),
    description: normalizeText(place.description),
    metadata: place.metadata && typeof place.metadata === "object" ? place.metadata : {},
  }));
}

function groupPlacesByCategory(places = []) {
  const groups = {
    hotels: [],
    restaurants: [],
    attractions: [],
  };

  for (const place of places) {
    if (place.category === "hotel") {
      groups.hotels.push(place);
      continue;
    }

    if (place.category === "restaurant") {
      groups.restaurants.push(place);
      continue;
    }

    groups.attractions.push(place);
  }

  return groups;
}

function mapStoredPlaceToRecommendation(place = {}) {
  return normalizeRecommendationItem(
    {
      name: place.name,
      location: place.address,
      description: place.description,
      rating: place.rating,
      priceLabel: place.priceLevel,
      mapsUrl: place?.metadata?.mapsUrl,
      imageUrl: place?.metadata?.imageUrl,
      geoCoordinates: place.coordinates,
    },
    place.category
  );
}

export function buildRecommendationsFromStructuredPlaces({
  destination,
  provider = "structured_store",
  warning = "",
  places = [],
}) {
  const grouped = groupPlacesByCategory(places);

  return normalizeDestinationRecommendations({
    destination,
    provider,
    warning,
    hotels: grouped.hotels.map(mapStoredPlaceToRecommendation),
    restaurants: grouped.restaurants.map(mapStoredPlaceToRecommendation),
  });
}

export async function ensureStructuredDestinationData({
  destination,
  forceRefresh = false,
  traceId = "",
} = {}) {
  const normalizedDestination = normalizeText(destination);
  if (!normalizedDestination) {
    const error = new Error("Destination is required for structured ingestion.");
    error.code = "recommendations/invalid-destination";
    throw error;
  }

  const nowTimestamp = Date.now();
  const freshnessTtlMs = resolveDestinationFreshnessTtlMs();
  let destinationRecord = await getStructuredDestinationByName(normalizedDestination);

  if (!destinationRecord) {
    destinationRecord = await upsertStructuredDestination({
      canonicalName: normalizedDestination,
      countryCode: normalizeDestinationCountryCode(normalizedDestination),
      centerPoint: {
        latitude: null,
        longitude: null,
      },
    });
  }

  const canReuseStoredData =
    !forceRefresh &&
    isStructuredDestinationFresh(destinationRecord, nowTimestamp);

  if (canReuseStoredData) {
    const storedPlaces = await listStructuredDestinationPlaces({
      destinationId: destinationRecord.id,
    });

    if (storedPlaces.length > 0) {
      const storedEdges = await listStructuredTransportEdges({
        destinationId: destinationRecord.id,
        mode: "drive",
      });

      console.info("[ingestion] Using fresh structured destination data", {
        destination: normalizedDestination,
        placeCount: storedPlaces.length,
        edgeCount: storedEdges.length,
        traceId: traceId || null,
      });

      return {
        destination: destinationRecord,
        places: storedPlaces,
        placesByCategory: groupPlacesByCategory(storedPlaces),
        edges: storedEdges,
        provider: "structured_store",
        warning: "",
        cacheHit: true,
        freshness: {
          freshUntil: destinationRecord.freshUntil,
          source: "structured_store",
        },
      };
    }
  }

  const bundle = await getDestinationDataBundle({
    destination: normalizedDestination,
    forceRefresh,
  });
  const flattenedPlaces = flattenPlaceBundle(bundle.places);
  const destinationCenter = estimateDestinationCenterFromPlaces(flattenedPlaces);

  destinationRecord = await upsertStructuredDestination({
    id: destinationRecord.id,
    canonicalName: normalizedDestination,
    countryCode: normalizeDestinationCountryCode(normalizedDestination),
    centerPoint: destinationCenter,
    version: destinationRecord.version,
    freshUntil: destinationRecord.freshUntil,
    lastIngestedAt: destinationRecord.lastIngestedAt,
    createdAt: destinationRecord.createdAt,
  });

  const freshUntil = new Date(nowTimestamp + freshnessTtlMs).toISOString();
  const storedPlaces = await replaceStructuredDestinationPlaces({
    destinationId: destinationRecord.id,
    places: flattenedPlaces,
    freshUntil,
  });

  const ingestedDestination = await markStructuredDestinationIngested({
    destinationId: destinationRecord.id,
    freshUntil,
    ingestedAt: new Date(nowTimestamp).toISOString(),
  });

  const storedDestination = ingestedDestination
    ? await getStructuredDestinationById(ingestedDestination.id)
    : destinationRecord;

  const transportEdges = buildCompleteTransportEdges(storedPlaces, {
    mode: "drive",
    source: "haversine",
  });
  const storedEdges = await replaceStructuredTransportEdges({
    destinationId: destinationRecord.id,
    mode: "drive",
    edges: transportEdges,
  });

  console.info("[ingestion] Structured destination data refreshed", {
    destination: normalizedDestination,
    placeCount: storedPlaces.length,
    edgeCount: storedEdges.length,
    provider: bundle.provider,
    traceId: traceId || null,
  });

  return {
    destination: storedDestination ?? destinationRecord,
    places: storedPlaces,
    placesByCategory: groupPlacesByCategory(storedPlaces),
    edges: storedEdges,
    provider: bundle.provider,
    warning: bundle.warning ?? "",
    cacheHit: false,
    freshness: {
      freshUntil,
      source: bundle.provider,
    },
  };
}

