import { normalizeGeoCoordinates } from "../../shared/maps.js";
import {
  formatUnifiedMapDistanceLabel,
  normalizeUnifiedMapNode,
  normalizeUnifiedMapNodeCategory,
  normalizeUnifiedMapSegment,
} from "../../shared/unifiedMap.js";
import { getRecommendationsForDestination } from "./recommendations.js";
import { getRoutesForTrip } from "./routeOptimization.js";
import {
  listDestinationPois,
  resolvePlace as resolveWorldPoiPlace,
} from "./worldPoiIndex.js";

const OVERLAY_RESULT_LIMIT = 6;

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

function hasCoordinates(value) {
  const coordinates = normalizeGeoCoordinates(value);
  return coordinates.latitude !== null && coordinates.longitude !== null;
}

function mergeNodesById(items = []) {
  const merged = new Map();

  for (const item of items) {
    const id = normalizeText(item?.id);
    if (!id) {
      continue;
    }

    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, {
        ...item,
        dayNumbers: Array.isArray(item.dayNumbers) ? [...item.dayNumbers] : [],
      });
      continue;
    }

    merged.set(id, {
      ...existing,
      dayNumbers: [...new Set([...(existing.dayNumbers ?? []), ...(item.dayNumbers ?? [])])]
        .filter(Number.isFinite)
        .sort((left, right) => left - right),
    });
  }

  return [...merged.values()];
}

function dedupeByNameAndCategory(items = []) {
  const unique = [];
  const seen = new Set();

  for (const item of items) {
    const key = [
      normalizeText(item?.name).toLowerCase(),
      normalizeText(item?.category).toLowerCase(),
    ].join("::");

    if (!normalizeText(item?.name) || seen.has(key)) {
      continue;
    }

    unique.push(item);
    seen.add(key);
  }

  return unique;
}

function deriveViewport(nodes = [], fallbackBounds = null) {
  if (
    fallbackBounds &&
    Number.isFinite(fallbackBounds.north) &&
    Number.isFinite(fallbackBounds.south) &&
    Number.isFinite(fallbackBounds.east) &&
    Number.isFinite(fallbackBounds.west)
  ) {
    return {
      bounds: fallbackBounds,
      center: {
        latitude: (fallbackBounds.north + fallbackBounds.south) / 2,
        longitude: (fallbackBounds.east + fallbackBounds.west) / 2,
      },
    };
  }

  const coordinates = nodes
    .map((node) => normalizeGeoCoordinates(node?.coordinates))
    .filter((point) => point.latitude !== null && point.longitude !== null);

  if (coordinates.length === 0) {
    return {
      bounds: null,
      center: null,
    };
  }

  const latitudes = coordinates.map((point) => point.latitude);
  const longitudes = coordinates.map((point) => point.longitude);
  const north = Math.max(...latitudes);
  const south = Math.min(...latitudes);
  const east = Math.max(...longitudes);
  const west = Math.min(...longitudes);
  const latitudePadding = Math.max((north - south) * 0.18, 0.012);
  const longitudePadding = Math.max((east - west) * 0.18, 0.018);

  return {
    bounds: {
      north: Number((north + latitudePadding).toFixed(6)),
      south: Number((south - latitudePadding).toFixed(6)),
      east: Number((east + longitudePadding).toFixed(6)),
      west: Number((west - longitudePadding).toFixed(6)),
    },
    center: {
      latitude: Number(((north + south) / 2).toFixed(6)),
      longitude: Number(((east + west) / 2).toFixed(6)),
    },
  };
}

function toTouristStopNode(stop = {}, dayNumber) {
  return normalizeUnifiedMapNode(
    {
      id: stop.id,
      name: stop.name,
      category: "tourist_spot",
      subcategory: stop.category,
      coordinates: stop.geoCoordinates,
      address: stop.location,
      dayNumbers: [dayNumber],
      source: stop.source,
      confidence:
        stop.geocodeSource === "world_poi_index" || stop.geocodeSource === "stored"
          ? 0.96
          : 0.82,
      mapsUrl: stop.mapsUrl,
      provider: stop.geocodeSource,
      visitOrder: stop.visitOrder,
    },
    {
      category: "tourist_spot",
      subcategory: stop.category,
      source: stop.source,
      provider: stop.geocodeSource,
    }
  );
}

function buildDaySegments(dayRoute = {}, stopNodes = []) {
  const nodeById = new Map(stopNodes.map((node) => [node.id, node]));
  const rawSegments = Array.isArray(dayRoute.segmentsDetailed)
    ? dayRoute.segmentsDetailed
    : [];

  return rawSegments
    .map((segment) => {
      const fromNode = nodeById.get(normalizeText(segment.fromId));
      const toNode = nodeById.get(normalizeText(segment.toId));
      const polyline =
        fromNode && toNode && hasCoordinates(fromNode.coordinates) && hasCoordinates(toNode.coordinates)
          ? [fromNode.coordinates, toNode.coordinates]
          : [];

      return normalizeUnifiedMapSegment(
        {
          fromStopId: segment.fromId,
          toStopId: segment.toId,
          distanceMeters: segment.distanceMeters,
          durationSeconds: segment.durationSeconds,
          label: formatUnifiedMapDistanceLabel(segment.distanceMeters),
          polyline,
          provider: dayRoute.routeProvider,
        },
        {
          provider: dayRoute.routeProvider,
        }
      );
    })
    .filter((segment) => segment.fromStopId && segment.toStopId);
}

function buildDayPayload(dayRoute = {}) {
  const dayNumber = normalizeInteger(dayRoute.dayNumber, 0);
  const stopNodes = Array.isArray(dayRoute.orderedStops)
    ? dayRoute.orderedStops.map((stop, index) =>
        toTouristStopNode(
          {
            ...stop,
            visitOrder: index + 1,
          },
          dayNumber
        )
      )
    : [];
  const segments = buildDaySegments(dayRoute, stopNodes);
  const averageLegMeters =
    segments.length > 0
      ? Number(
          (
            segments.reduce(
              (total, segment) => total + (segment.distanceMeters ?? 0),
              0
            ) / segments.length
          ).toFixed(1)
        )
      : 0;

  return {
    dayNumber,
    title: normalizeText(dayRoute.title, `Day ${dayNumber}`),
    routeStatus: normalizeText(dayRoute.status, "needs_places"),
    routeSummary: {
      totalDistanceMeters: Number(dayRoute.totalDistanceMeters ?? 0),
      totalDurationSeconds: Number(dayRoute.totalDurationSeconds ?? 0),
      averageLegMeters,
      unresolvedStopCount: Number(dayRoute.unresolvedStopCount ?? 0),
      algorithm: normalizeText(dayRoute.algorithm, "not-applicable"),
      objective: normalizeText(dayRoute.objective),
      objectiveLabel: normalizeText(dayRoute.objectiveLabel),
      routeProvider: normalizeText(dayRoute.routeProvider, "not-applicable"),
      optimizationNotes: normalizeText(dayRoute.warning),
      statusMessage: normalizeText(dayRoute.statusMessage),
    },
    stops: stopNodes,
    unresolvedStops: Array.isArray(dayRoute.unresolvedStops)
      ? dayRoute.unresolvedStops.map((stop) => ({
          id: normalizeText(stop?.id),
          name: normalizeText(stop?.name),
        }))
      : [],
    segments,
    alternatives: Array.isArray(dayRoute.alternatives)
      ? dayRoute.alternatives.map((alternative) => ({
          rank: Number(alternative.rank ?? 0),
          objective: normalizeText(alternative.objective),
          objectiveLabel: normalizeText(alternative.objectiveLabel),
          algorithm: normalizeText(alternative.algorithm),
          paretoScore: Number(alternative.paretoScore ?? 0),
          totalDistanceMeters: Number(alternative.totalDistanceMeters ?? 0),
          totalDurationSeconds: Number(alternative.totalDurationSeconds ?? 0),
          estimatedCost: Number(alternative.estimatedCost ?? 0),
          experienceScore: Number(alternative.experienceScore ?? 0),
          tradeoffDelta: alternative.tradeoffDelta ?? null,
        }))
      : [],
  };
}

async function resolveRecommendationOverlayNodes({
  destination,
  items = [],
  category,
  resolvePlaceImpl,
  listDestinationPoisImpl,
}) {
  const normalizedCategory = normalizeUnifiedMapNodeCategory(category, category);
  const overlayNodes = [];

  for (const item of Array.isArray(items) ? items : []) {
    if (overlayNodes.length >= OVERLAY_RESULT_LIMIT) {
      break;
    }

    if (hasCoordinates(item?.geoCoordinates)) {
      overlayNodes.push(
        normalizeUnifiedMapNode(
          {
            id: `${normalizedCategory}-${normalizeText(item.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
            name: item.name,
            category: normalizedCategory,
            subcategory: item.typeLabel,
            coordinates: item.geoCoordinates,
            address: item.location,
            dayNumbers: [],
            source: "recommendations",
            confidence: 0.9,
            mapsUrl: item.mapsUrl,
            provider: item.provider ?? "recommendations",
          },
          {
            category: normalizedCategory,
            source: "recommendations",
          }
        )
      );
      continue;
    }

    const queryCandidates = [
      normalizeText(item?.name),
      normalizeText(
        [item?.name, item?.location].filter(Boolean).join(", ")
      ),
    ].filter(Boolean);

    let resolved = null;
    for (const query of queryCandidates) {
      resolved = await resolvePlaceImpl({
        destination,
        query,
      }).catch((error) => {
        console.warn("[unified-map] Recommendation POI resolution failed", {
          destination,
          category: normalizedCategory,
          query,
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      });

      if (!resolved) {
        continue;
      }

      if (
        normalizeUnifiedMapNodeCategory(resolved.categories?.[0]) ===
        normalizedCategory
      ) {
        break;
      }

      resolved = null;
    }

    if (!resolved) {
      continue;
    }

    overlayNodes.push(
      normalizeUnifiedMapNode(
        {
          id: resolved.id,
          name: item.name ?? resolved.name,
          category: normalizedCategory,
          subcategory: resolved.categories?.[0] ?? item.typeLabel,
          coordinates: resolved.geoCoordinates,
          address: item.location ?? [resolved.locality, resolved.countryName].filter(Boolean).join(", "),
          source: "recommendations",
          confidence: resolved.confidence ?? 0.82,
          mapsUrl: item.mapsUrl ?? resolved.mapsUrl,
          provider: "world_poi_index",
        },
        {
          category: normalizedCategory,
          source: "recommendations",
          provider: "world_poi_index",
        }
      )
    );
  }

  if (overlayNodes.length >= OVERLAY_RESULT_LIMIT) {
    return dedupeByNameAndCategory(overlayNodes).slice(0, OVERLAY_RESULT_LIMIT);
  }

  const localFallbackNodes = await listDestinationPoisImpl({
    destination,
    limit: OVERLAY_RESULT_LIMIT,
    categories: [normalizedCategory],
  }).catch((error) => {
    console.warn("[unified-map] Local overlay category listing failed", {
      destination,
      category: normalizedCategory,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  });

  const combined = [
    ...overlayNodes,
    ...localFallbackNodes.map((poi) =>
      normalizeUnifiedMapNode(
        {
          id: poi.id,
          name: poi.name,
          category: normalizedCategory,
          subcategory: poi.categories?.[0],
          coordinates: poi.geoCoordinates,
          address: [poi.locality, poi.countryName].filter(Boolean).join(", "),
          source: "world_poi_index",
          confidence: poi.confidence ?? poi.popularityScore ?? 0.78,
          mapsUrl: poi.mapsUrl,
          provider: "world_poi_index",
        },
        {
          category: normalizedCategory,
          source: "world_poi_index",
          provider: "world_poi_index",
        }
      )
    ),
  ];

  return dedupeByNameAndCategory(combined).slice(0, OVERLAY_RESULT_LIMIT);
}

async function buildTransitOverlayNodes({
  destination,
  categories = [],
  listDestinationPoisImpl,
  sourceCategory,
}) {
  const pois = await listDestinationPoisImpl({
    destination,
    limit: OVERLAY_RESULT_LIMIT,
    categories,
  }).catch((error) => {
    console.warn("[unified-map] Transit overlay listing failed", {
      destination,
      categories: categories.join(","),
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  });

  return pois.map((poi) =>
    normalizeUnifiedMapNode(
      {
        id: poi.id,
        name: poi.name,
        category: poi.categories?.[0] ?? sourceCategory,
        subcategory: poi.categories?.[0],
        coordinates: poi.geoCoordinates,
        address: [poi.locality, poi.countryName].filter(Boolean).join(", "),
        source: "world_poi_index",
        confidence: poi.confidence ?? poi.popularityScore ?? 0.82,
        mapsUrl: poi.mapsUrl,
        provider: "world_poi_index",
      },
      {
        category: poi.categories?.[0] ?? sourceCategory,
        source: "world_poi_index",
        provider: "world_poi_index",
      }
    )
  );
}

function buildStats({ days = [], layers = {} }) {
  const totalDistanceMeters = days.reduce(
    (total, day) => total + (day.routeSummary?.totalDistanceMeters ?? 0),
    0
  );
  const totalSegmentCount = days.reduce(
    (total, day) => total + (Array.isArray(day.segments) ? day.segments.length : 0),
    0
  );
  const unresolvedCount = days.reduce(
    (total, day) => total + (day.routeSummary?.unresolvedStopCount ?? 0),
    0
  );
  const touristSpots = Array.isArray(layers.touristSpots) ? layers.touristSpots.length : 0;
  const hotels = Array.isArray(layers.hotels) ? layers.hotels.length : 0;
  const restaurants = Array.isArray(layers.restaurants) ? layers.restaurants.length : 0;
  const airports = Array.isArray(layers.airports) ? layers.airports.length : 0;
  const railMetroStations = Array.isArray(layers.railMetroStations)
    ? layers.railMetroStations.length
    : 0;
  const busTerminals = Array.isArray(layers.busTerminals) ? layers.busTerminals.length : 0;
  const firstReadyDay = days.find((day) => day.routeStatus === "ready") ?? days[0] ?? null;

  return {
    stopCount: touristSpots,
    totalDistanceMeters,
    averageLegMeters:
      totalSegmentCount > 0 ? Number((totalDistanceMeters / totalSegmentCount).toFixed(1)) : 0,
    unresolvedCount,
    categoryCounts: {
      touristSpots,
      hotels,
      restaurants,
      airports,
      railMetroStations,
      busTerminals,
    },
    algorithmLabel: normalizeText(
      firstReadyDay?.routeSummary?.algorithm,
      "not-applicable"
    ),
  };
}

export function createUnifiedTripMapService({
  getRoutesForTripImpl = getRoutesForTrip,
  getRecommendationsForDestinationImpl = getRecommendationsForDestination,
  resolvePlaceImpl = resolveWorldPoiPlace,
  listDestinationPoisImpl = listDestinationPois,
} = {}) {
  async function getUnifiedTripMap({
    trip,
    dayNumber = null,
  } = {}) {
    const destination = normalizeText(
      trip?.userSelection?.location?.label ?? trip?.aiPlan?.destination
    );

    if (!destination) {
      throw new Error("Destination is required to build the trip map.");
    }

    const startTime = Date.now();
    const routeStart = Date.now();
    const routes = await getRoutesForTripImpl({
      trip,
      dayNumber,
    });
    const routeMs = Date.now() - routeStart;

    const recommendationStart = Date.now();
    const recommendations = await getRecommendationsForDestinationImpl({
      destination,
      userSelection: trip?.userSelection ?? {},
    });
    const recommendationMs = Date.now() - recommendationStart;

    const overlayStart = Date.now();
    const days = (Array.isArray(routes?.days) ? routes.days : []).map(buildDayPayload);
    const touristSpots = mergeNodesById(days.flatMap((day) => day.stops));
    const hotels = await resolveRecommendationOverlayNodes({
      destination,
      items: recommendations?.hotels,
      category: "hotel",
      resolvePlaceImpl,
      listDestinationPoisImpl,
    });
    const restaurants = await resolveRecommendationOverlayNodes({
      destination,
      items: recommendations?.restaurants,
      category: "restaurant",
      resolvePlaceImpl,
      listDestinationPoisImpl,
    });
    const airports = await buildTransitOverlayNodes({
      destination,
      categories: ["airport"],
      listDestinationPoisImpl,
      sourceCategory: "airport",
    });
    const railMetroStations = await buildTransitOverlayNodes({
      destination,
      categories: ["rail_station", "metro_station"],
      listDestinationPoisImpl,
      sourceCategory: "rail_station",
    });
    const busTerminals = await buildTransitOverlayNodes({
      destination,
      categories: ["bus_terminal"],
      listDestinationPoisImpl,
      sourceCategory: "bus_terminal",
    });
    const overlayMs = Date.now() - overlayStart;

    const layers = {
      touristSpots,
      hotels,
      restaurants,
      airports,
      railMetroStations,
      busTerminals,
    };
    const allNodes = [
      ...touristSpots,
      ...hotels,
      ...restaurants,
      ...airports,
      ...railMetroStations,
      ...busTerminals,
    ];
    const viewport = deriveViewport(allNodes, routes?.cityBounds ?? null);
    const stats = buildStats({
      days,
      layers,
    });
    const totalMs = Date.now() - startTime;

    console.info("[unified-map] Built unified trip map payload", {
      tripId: normalizeText(trip?.id),
      destination,
      dayCount: days.length,
      touristStops: touristSpots.length,
      hotels: hotels.length,
      restaurants: restaurants.length,
      airports: airports.length,
      railMetroStations: railMetroStations.length,
      busTerminals: busTerminals.length,
      unresolvedCount: stats.unresolvedCount,
      routeMs,
      recommendationMs,
      overlayMs,
      totalMs,
    });

    return {
      tripId: normalizeText(trip?.id),
      destination,
      viewport,
      activeDayDefault: routes?.selectedDayDefault ?? days[0]?.dayNumber ?? null,
      stats,
      days,
      layers,
      provenance: {
        primaryProvider: normalizeText(
          routes?.sourceProvenance?.primaryProvider ?? recommendations?.provider,
          "world_poi_index"
        ),
        sources: dedupeByNameAndCategory(
          [
            ...(Array.isArray(routes?.sourceProvenance?.sources)
              ? routes.sourceProvenance.sources
              : []),
            ...(Array.isArray(recommendations?.sourceProvenance?.sources)
              ? recommendations.sourceProvenance.sources
              : []),
            {
              provider: "world_poi_index",
              category: "local-index",
            },
          ].map((source, index) => ({
            id: `source-${index}-${normalizeText(source?.provider, "unknown")}`,
            name: normalizeText(source?.provider, "unknown"),
            category: normalizeText(source?.sourceType ?? source?.category, "source"),
          }))
        ).map((source) => ({
          provider: source.name,
          sourceType: source.category,
        })),
      },
      latencyBreakdownMs: {
        routeMs,
        recommendationMs,
        overlayMs,
        totalMs,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  return {
    getUnifiedTripMap,
  };
}

const unifiedTripMapService = createUnifiedTripMapService();

export const getUnifiedTripMap = unifiedTripMapService.getUnifiedTripMap;
