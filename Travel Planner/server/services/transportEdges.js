import { replaceStructuredTransportEdges } from "../data/hybridStore.js";
import { safeFetch } from "../lib/safeFetch.js";
import {
  buildCompleteTransportEdges,
  hasCoordinates,
} from "./geo.js";

const GOOGLE_DISTANCE_MATRIX_URL =
  "https://maps.googleapis.com/maps/api/distancematrix/json";
const DEFAULT_EDGE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 20;

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function normalizeMode(value) {
  const normalized = normalizeText(value, "drive").toLowerCase();
  if (normalized === "walk" || normalized === "walking") {
    return "walk";
  }

  if (normalized === "transit") {
    return "transit";
  }

  return "drive";
}

function resolveDistanceMatrixMode(mode) {
  if (mode === "walk") {
    return "walking";
  }

  return mode;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function resolveTransportEdgeTtlMs() {
  return parsePositiveInteger(
    process.env.TRANSPORT_EDGE_TTL_MS,
    DEFAULT_EDGE_TTL_MS
  );
}

function resolveDistanceMatrixBatchSize() {
  return Math.min(
    25,
    parsePositiveInteger(process.env.DISTANCE_MATRIX_BATCH_SIZE, DEFAULT_BATCH_SIZE)
  );
}

export function resolveDistanceMatrixApiKey() {
  return normalizeText(
    process.env.GOOGLE_MAPS_API_KEY ??
      process.env.GOOGLE_DISTANCE_MATRIX_API_KEY ??
      process.env.GOOGLE_PLACES_API_KEY
  );
}

function buildEdgeKey(fromPlaceId, toPlaceId, mode = "drive") {
  return `${fromPlaceId}:${toPlaceId}:${mode}`;
}

function isEdgeFresh(edge, ttlMs) {
  const updatedAt = Date.parse(edge?.updatedAt ?? "");
  if (!Number.isFinite(updatedAt)) {
    return false;
  }

  return updatedAt + ttlMs > Date.now();
}

function buildEdgeLookup(edges = [], mode = "drive") {
  const lookup = new Map();
  for (const edge of edges) {
    const key = buildEdgeKey(edge.fromPlaceId, edge.toPlaceId, edge.mode ?? mode);
    lookup.set(key, edge);
  }

  return lookup;
}

function chunkArray(values = [], size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function toCoordinateString(place = {}) {
  return `${place.coordinates.latitude},${place.coordinates.longitude}`;
}

function buildFallbackEdge(fromPlace, toPlace, mode) {
  return buildCompleteTransportEdges([fromPlace, toPlace], {
    mode,
    source: "haversine_fallback",
  }).find(
    (edge) =>
      edge.fromPlaceId === fromPlace.id && edge.toPlaceId === toPlace.id
  );
}

async function fetchDistanceMatrixBatch({
  origin,
  destinations,
  apiKey,
  mode,
  traceId: _traceId = "",
}) {
  const endpoint = new URL(GOOGLE_DISTANCE_MATRIX_URL);
  endpoint.searchParams.set("origins", toCoordinateString(origin));
  endpoint.searchParams.set(
    "destinations",
    destinations.map((destination) => toCoordinateString(destination)).join("|")
  );
  endpoint.searchParams.set("mode", resolveDistanceMatrixMode(mode));
  endpoint.searchParams.set("units", "metric");
  endpoint.searchParams.set("key", apiKey);

  const response = await safeFetch(endpoint);
  if (!response.ok) {
    throw new Error(
      `Distance Matrix request failed with status ${response.status}.`
    );
  }

  const payload = await response.json();
  const status = normalizeText(payload?.status);
  if (status && status !== "OK") {
    throw new Error(`Distance Matrix returned status ${status}.`);
  }

  const elements = Array.isArray(payload?.rows?.[0]?.elements)
    ? payload.rows[0].elements
    : [];

  return destinations.map((destination, index) => {
    const element = elements[index] ?? {};
    const elementStatus = normalizeText(element.status, "UNKNOWN_ERROR");

    if (elementStatus !== "OK") {
      return {
        fromPlaceId: origin.id,
        toPlaceId: destination.id,
        mode,
        distanceMeters: null,
        durationSeconds: null,
        weight: null,
        source: `distance_matrix_${elementStatus.toLowerCase()}`,
      };
    }

    return {
      fromPlaceId: origin.id,
      toPlaceId: destination.id,
      mode,
      distanceMeters: Number.parseFloat(element?.distance?.value) || 0,
      durationSeconds: Number.parseFloat(element?.duration?.value) || 0,
      weight: Number.parseFloat(element?.duration?.value) || 0,
      source: "distance_matrix",
    };
  });
}

export async function buildGroundedTransportEdges({
  destinationId,
  places = [],
  existingEdges = [],
  mode = "drive",
  forceRefresh = false,
  traceId = "",
} = {}) {
  const normalizedMode = normalizeMode(mode);
  const relevantPlaces = places.filter(
    (place) => place?.id && hasCoordinates(place?.coordinates)
  );

  if (!destinationId || relevantPlaces.length < 2) {
    return {
      edges: existingEdges,
      cacheHits: 0,
      liveRefreshedEdges: 0,
      fallbackEdges: 0,
      usedFallbackEdges: false,
    };
  }

  const ttlMs = resolveTransportEdgeTtlMs();
  const batchSize = resolveDistanceMatrixBatchSize();
  const apiKey = resolveDistanceMatrixApiKey();
  const existingLookup = buildEdgeLookup(existingEdges, normalizedMode);
  const mergedLookup = buildEdgeLookup(existingEdges, normalizedMode);
  const refreshTargetsByOrigin = new Map();
  let cacheHits = 0;
  let liveRefreshedEdges = 0;
  let fallbackEdges = 0;

  for (const origin of relevantPlaces) {
    for (const destination of relevantPlaces) {
      if (origin.id === destination.id) {
        continue;
      }

      const key = buildEdgeKey(origin.id, destination.id, normalizedMode);
      const existingEdge = existingLookup.get(key);

      if (
        !forceRefresh &&
        existingEdge &&
        isEdgeFresh(existingEdge, ttlMs)
      ) {
        cacheHits += 1;
        continue;
      }

      const originTargets = refreshTargetsByOrigin.get(origin.id) ?? [];
      originTargets.push(destination);
      refreshTargetsByOrigin.set(origin.id, originTargets);
    }
  }

  if (refreshTargetsByOrigin.size === 0) {
    return {
      edges: existingEdges,
      cacheHits,
      liveRefreshedEdges,
      fallbackEdges,
      usedFallbackEdges: fallbackEdges > 0,
    };
  }

  const placeById = new Map(relevantPlaces.map((place) => [place.id, place]));
  const applyEdge = (edge) => {
    mergedLookup.set(
      buildEdgeKey(edge.fromPlaceId, edge.toPlaceId, edge.mode ?? normalizedMode),
      {
        ...edge,
        mode: edge.mode ?? normalizedMode,
      }
    );
  };

  if (!apiKey) {
    console.warn("[transport] Distance Matrix API key missing; using haversine fallback", {
      destinationId,
      traceId: traceId || null,
    });
  }

  for (const [originId, rawDestinations] of refreshTargetsByOrigin.entries()) {
    const origin = placeById.get(originId);
    if (!origin) {
      continue;
    }

    const destinationChunks = chunkArray(rawDestinations, batchSize);

    for (const destinationChunk of destinationChunks) {
      let batchEdges = [];

      if (apiKey) {
        try {
          console.info("[transport] Refreshing transport edges from Distance Matrix", {
            destinationId,
            originId,
            destinationCount: destinationChunk.length,
            traceId: traceId || null,
          });
          batchEdges = await fetchDistanceMatrixBatch({
            origin,
            destinations: destinationChunk,
            apiKey,
            mode: normalizedMode,
            traceId,
          });
        } catch (error) {
          console.warn("[transport] Distance Matrix refresh failed; using haversine fallback", {
            destinationId,
            originId,
            destinationCount: destinationChunk.length,
            message: error instanceof Error ? error.message : String(error),
            traceId: traceId || null,
          });
        }
      }

      for (const destination of destinationChunk) {
        const liveEdge = batchEdges.find(
          (edge) =>
            edge.fromPlaceId === origin.id && edge.toPlaceId === destination.id
        );

        if (
          liveEdge &&
          Number.isFinite(liveEdge.durationSeconds) &&
          liveEdge.durationSeconds > 0
        ) {
          applyEdge(liveEdge);
          liveRefreshedEdges += 1;
          continue;
        }

        const fallbackEdge = buildFallbackEdge(origin, destination, normalizedMode);
        if (fallbackEdge) {
          applyEdge(fallbackEdge);
          fallbackEdges += 1;
        }
      }
    }
  }

  const mergedEdges = [...mergedLookup.values()];
  const persistedEdges = await replaceStructuredTransportEdges({
    destinationId,
    mode: normalizedMode,
    edges: mergedEdges,
  });

  return {
    edges: persistedEdges,
    cacheHits,
    liveRefreshedEdges,
    fallbackEdges,
    usedFallbackEdges: fallbackEdges > 0,
  };
}
