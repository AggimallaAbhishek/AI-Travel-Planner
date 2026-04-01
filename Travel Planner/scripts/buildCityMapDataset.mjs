import { gzipSync, gunzipSync } from "node:zlib";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDestinationLookupKeys,
  normalizePoiKey,
  normalizeWorldPoiRecord,
} from "../shared/worldPoi.js";
import { deriveCityMapBoundsFromPlaces } from "../src/lib/cityItineraryMap.js";
import { fetchRemoteCityBasemap } from "../server/services/cityStaticMap.js";
import { WORLD_POI_DATASET_VERSION, WORLD_POI_SEED_DATA } from "./worldPoiSeedData.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CITY_MAP_OUT_DIR = path.resolve(__dirname, "../data/city-maps");
export const CITY_MAP_DATASET_VERSION = `${WORLD_POI_DATASET_VERSION}-city-maps-v1`;
const DEFAULT_SIZE_BUDGET_BYTES = 4_500_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_NOMINATIM_TIMEOUT_MS = 20_000;
const DEFAULT_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function createArtifactFileName(destinationKey = "", index = 0) {
  const safeKey = normalizePoiKey(destinationKey).replace(/\s+/g, "-");
  return `${String(index + 1).padStart(3, "0")}-${safeKey || "destination"}.json.gz`;
}

function summarizeDestination(record = {}) {
  return {
    locality: record.locality,
    adminArea: record.adminArea,
    countryCode: record.countryCode,
    countryName: record.countryName,
    destinationKey: record.destinationKey,
  };
}

function buildDestinationLabel(record = {}) {
  return normalizeText(
    [record.locality, record.countryName].filter(Boolean).join(", "),
    record.destination ?? record.locality
  );
}

function parseCoordinate(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBounds(bounds = {}) {
  if (!bounds || typeof bounds !== "object") {
    return null;
  }

  const north = parseCoordinate(bounds.north);
  const south = parseCoordinate(bounds.south);
  const east = parseCoordinate(bounds.east);
  const west = parseCoordinate(bounds.west);

  if (
    north === null ||
    south === null ||
    east === null ||
    west === null ||
    north < south ||
    east < west
  ) {
    return null;
  }

  return { north, south, east, west };
}

function deriveBoundsFromPoints(points = []) {
  const normalizedPoints = (Array.isArray(points) ? points : [])
    .map((point) => ({
      latitude: parseCoordinate(point?.latitude),
      longitude: parseCoordinate(point?.longitude),
    }))
    .filter(
      (point) => point.latitude !== null && point.longitude !== null
    );

  if (normalizedPoints.length === 0) {
    return null;
  }

  return normalizedPoints.reduce(
    (bounds, point) => ({
      north: Math.max(bounds.north, point.latitude),
      south: Math.min(bounds.south, point.latitude),
      east: Math.max(bounds.east, point.longitude),
      west: Math.min(bounds.west, point.longitude),
    }),
    {
      north: normalizedPoints[0].latitude,
      south: normalizedPoints[0].latitude,
      east: normalizedPoints[0].longitude,
      west: normalizedPoints[0].longitude,
    }
  );
}

export function deriveBoundsFromPolygons(polygons = []) {
  const polygonBounds = (Array.isArray(polygons) ? polygons : [])
    .map((polygon) => deriveBoundsFromPoints(polygon))
    .filter(Boolean);

  if (polygonBounds.length === 0) {
    return null;
  }

  return polygonBounds.reduce(
    (bounds, polygonBoundsEntry) => ({
      north: Math.max(bounds.north, polygonBoundsEntry.north),
      south: Math.min(bounds.south, polygonBoundsEntry.south),
      east: Math.max(bounds.east, polygonBoundsEntry.east),
      west: Math.min(bounds.west, polygonBoundsEntry.west),
    }),
    polygonBounds[0]
  );
}

function expandBounds(bounds = null, paddingRatio = 0.12) {
  const normalizedBounds = normalizeBounds(bounds);
  if (!normalizedBounds) {
    return null;
  }

  const latitudeSpan = Math.max(
    normalizedBounds.north - normalizedBounds.south,
    0.0001
  );
  const longitudeSpan = Math.max(
    normalizedBounds.east - normalizedBounds.west,
    0.0001
  );
  const latitudePadding = latitudeSpan * paddingRatio;
  const longitudePadding = longitudeSpan * paddingRatio;

  return {
    north: normalizedBounds.north + latitudePadding,
    south: normalizedBounds.south - latitudePadding,
    east: normalizedBounds.east + longitudePadding,
    west: normalizedBounds.west - longitudePadding,
  };
}

function calculateBoundsArea(bounds = null) {
  const normalizedBounds = normalizeBounds(bounds);
  if (!normalizedBounds) {
    return 0;
  }

  return (
    Math.max(0, normalizedBounds.north - normalizedBounds.south) *
    Math.max(0, normalizedBounds.east - normalizedBounds.west)
  );
}

function calculateBoundsIntersectionArea(left = null, right = null) {
  const normalizedLeft = normalizeBounds(left);
  const normalizedRight = normalizeBounds(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  const north = Math.min(normalizedLeft.north, normalizedRight.north);
  const south = Math.max(normalizedLeft.south, normalizedRight.south);
  const east = Math.min(normalizedLeft.east, normalizedRight.east);
  const west = Math.max(normalizedLeft.west, normalizedRight.west);

  if (north <= south || east <= west) {
    return 0;
  }

  return (north - south) * (east - west);
}

function getBoundsCenter(bounds = null) {
  const normalizedBounds = normalizeBounds(bounds);
  if (!normalizedBounds) {
    return null;
  }

  return {
    latitude:
      normalizedBounds.south +
      (normalizedBounds.north - normalizedBounds.south) / 2,
    longitude:
      normalizedBounds.west +
      (normalizedBounds.east - normalizedBounds.west) / 2,
  };
}

function calculateBoundsCenterDistance(left = null, right = null) {
  const leftCenter = getBoundsCenter(left);
  const rightCenter = getBoundsCenter(right);
  if (!leftCenter || !rightCenter) {
    return Number.POSITIVE_INFINITY;
  }

  const latitudeDistance = leftCenter.latitude - rightCenter.latitude;
  const longitudeDistance = leftCenter.longitude - rightCenter.longitude;

  return Math.hypot(latitudeDistance, longitudeDistance);
}

export function filterOutlinePolygonsForReferenceBounds(
  polygons = [],
  referenceBounds = null
) {
  const normalizedReferenceBounds = normalizeBounds(referenceBounds);
  const polygonEntries = (Array.isArray(polygons) ? polygons : [])
    .map((polygon, index) => {
      const polygonBounds = deriveBoundsFromPoints(polygon);
      return polygonBounds
        ? { index, polygon, bounds: polygonBounds }
        : null;
    })
    .filter(Boolean);

  if (polygonEntries.length === 0) {
    return {
      polygons: [],
      cityBounds: normalizeBounds(referenceBounds),
      retainedIndexes: [],
    };
  }

  if (!normalizedReferenceBounds) {
    return {
      polygons: polygonEntries.map((entry) => entry.polygon),
      cityBounds: deriveBoundsFromPolygons(
        polygonEntries.map((entry) => entry.polygon)
      ),
      retainedIndexes: polygonEntries.map((entry) => entry.index),
    };
  }

  const focusBounds = expandBounds(normalizedReferenceBounds, 0.18);
  const intersectingEntries = polygonEntries.filter(
    (entry) => calculateBoundsIntersectionArea(entry.bounds, focusBounds) > 0
  );

  const selectedEntries =
    intersectingEntries.length > 0
      ? intersectingEntries
      : polygonEntries
          .slice()
          .sort((left, right) => {
            const distanceDelta =
              calculateBoundsCenterDistance(left.bounds, normalizedReferenceBounds) -
              calculateBoundsCenterDistance(right.bounds, normalizedReferenceBounds);
            if (distanceDelta !== 0) {
              return distanceDelta;
            }

            return calculateBoundsArea(right.bounds) - calculateBoundsArea(left.bounds);
          })
          .slice(0, 1);

  const filteredPolygons = selectedEntries.map((entry) => entry.polygon);

  return {
    polygons: filteredPolygons,
    cityBounds:
      deriveBoundsFromPolygons(filteredPolygons) ??
      deriveBoundsFromPolygons(polygonEntries.map((entry) => entry.polygon)) ??
      normalizedReferenceBounds,
    retainedIndexes: selectedEntries.map((entry) => entry.index),
  };
}

function normalizeDestinationRecords(items = WORLD_POI_SEED_DATA) {
  return items
    .map((item) => normalizeWorldPoiRecord(item))
    .filter(Boolean)
    .sort((left, right) => left.destinationKey.localeCompare(right.destinationKey));
}

function groupDestinationRecords(records = []) {
  const grouped = new Map();

  for (const record of records) {
    const bucket = grouped.get(record.destinationKey) ?? [];
    bucket.push(record);
    grouped.set(record.destinationKey, bucket);
  }

  return [...grouped.entries()].map(([destinationKey, destinationRecords]) => ({
    destinationKey,
    destination: summarizeDestination(destinationRecords[0]),
    destinationLabel: buildDestinationLabel(destinationRecords[0]),
    records: destinationRecords,
  }));
}

function deriveDestinationFetchBounds(records = []) {
  return deriveCityMapBoundsFromPlaces(
    records.map((record) => ({ geoCoordinates: record.geoCoordinates })),
    {
      paddingRatio: 0.55,
      minLatitudeSpan: 0.18,
      minLongitudeSpan: 0.18,
    }
  );
}

async function fetchBestRemoteBasemap({
  destinationLabel,
  cityBounds,
  endpoints = DEFAULT_ENDPOINTS,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  let lastBasemap = null;

  for (const endpoint of endpoints) {
    const basemap = await fetchRemoteCityBasemap({
      destination: destinationLabel,
      cityBounds,
      endpoint,
      fetchImpl,
      timeoutMs,
    });
    lastBasemap = basemap;

    const hasFeatures =
      (basemap.roads?.length ?? 0) +
        (basemap.water?.length ?? 0) +
        (basemap.parks?.length ?? 0) >
      0;

    if (hasFeatures) {
      return basemap;
    }
  }

  return lastBasemap;
}

function buildTimedFetchOptions(options = {}, timeoutMs = DEFAULT_NOMINATIM_TIMEOUT_MS) {
  return {
    ...options,
    ...(typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
      ? { signal: AbortSignal.timeout(timeoutMs) }
      : {}),
  };
}

function normalizeOutlinePolygon(points = []) {
  const normalizedPoints = (Array.isArray(points) ? points : [])
    .map((point) => ({
      latitude: parseCoordinate(point?.[1]),
      longitude: parseCoordinate(point?.[0]),
    }))
    .filter(
      (point) => point.latitude !== null && point.longitude !== null
    );

  if (normalizedPoints.length < 3) {
    return [];
  }

  const firstPoint = normalizedPoints[0];
  const lastPoint = normalizedPoints.at(-1);
  if (
    firstPoint.latitude !== lastPoint.latitude ||
    firstPoint.longitude !== lastPoint.longitude
  ) {
    normalizedPoints.push(firstPoint);
  }

  return normalizedPoints;
}

function normalizeNominatimOutline(geojson = null) {
  if (!geojson || typeof geojson !== "object") {
    return [];
  }

  if (geojson.type === "Polygon") {
    return geojson.coordinates
      .map((ring) => normalizeOutlinePolygon(ring))
      .filter((polygon) => polygon.length >= 4);
  }

  if (geojson.type === "MultiPolygon") {
    return geojson.coordinates
      .flatMap((polygon) =>
        polygon
          .map((ring) => normalizeOutlinePolygon(ring))
          .filter((ring) => ring.length >= 4)
      )
      .filter((polygon) => polygon.length >= 4);
  }

  return [];
}

function scoreNominatimMatch(match = {}, destinationLabel = "", referenceBounds = null) {
  const primaryDestinationLabel = normalizeText(destinationLabel)
    .split(",")[0]
    ?.toLowerCase() ?? "";
  const normalizedName = normalizeText(match?.name).toLowerCase();
  const normalizedAddressType = normalizeText(match?.addresstype).toLowerCase();
  const normalizedCategory = normalizeText(match?.category).toLowerCase();
  const normalizedType = normalizeText(match?.type).toLowerCase();
  const placeRank = Number.parseInt(match?.placeRank, 10);
  const addressTypeScoreMap = {
    city: 220,
    town: 200,
    municipality: 180,
    suburb: 150,
    borough: 145,
    quarter: 130,
    village: 120,
    province: 90,
    state: 85,
    island: 75,
    county: 65,
    region: 50,
  };
  let score = 0;

  if (primaryDestinationLabel && normalizedName.includes(primaryDestinationLabel)) {
    score += 160;
  }

  score += addressTypeScoreMap[normalizedAddressType] ?? 40;

  if (normalizedCategory === "boundary") {
    score += 70;
  }

  if (normalizedType === "administrative") {
    score += 90;
  }

  if (Number.isFinite(placeRank)) {
    score += Math.max(0, 52 - Math.abs(placeRank - 16) * 4);
  }

  if (referenceBounds && match?.cityBounds) {
    const referenceArea = calculateBoundsArea(referenceBounds);
    const candidateArea = calculateBoundsArea(match.cityBounds);
    const overlapArea = calculateBoundsIntersectionArea(
      referenceBounds,
      match.cityBounds
    );
    const overlapRatio = referenceArea > 0 ? overlapArea / referenceArea : 0;
    const candidateCoverageRatio =
      candidateArea > 0 ? overlapArea / candidateArea : 0;
    const centerDistance = calculateBoundsCenterDistance(
      referenceBounds,
      match.cityBounds
    );
    const areaDeltaPenalty =
      referenceArea > 0 && candidateArea > 0
        ? Math.abs(Math.log(candidateArea / referenceArea))
        : 0;

    score += overlapRatio * 1_600;
    score += candidateCoverageRatio * 320;
    score -= centerDistance * 180;
    score -= areaDeltaPenalty * 55;
  }

  score += Math.min(100, (match?.polygons?.length ?? 0) * 10);

  return score;
}

async function fetchNominatimOutline({
  destinationLabel,
  referenceBounds = null,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_NOMINATIM_TIMEOUT_MS,
} = {}) {
  const url = new URL(NOMINATIM_ENDPOINT);
  url.searchParams.set("q", destinationLabel);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("polygon_geojson", "1");

  const response = await fetchImpl(
    url,
    buildTimedFetchOptions(
      {
        headers: {
          Accept: "application/json",
          "User-Agent":
            process.env.OSM_USER_AGENT ??
            "AI-Travel-Planner/1.0 (city map dataset build)",
        },
      },
      timeoutMs
    )
  );

  if (!response.ok) {
    throw new Error(`Nominatim HTTP ${response.status}`);
  }

  const payload = await response.json();
  const results = Array.isArray(payload) ? payload : [];
  const match = results
    .map((result) => {
      const polygons = normalizeNominatimOutline(result?.geojson);
      if (polygons.length === 0) {
        return null;
      }

      const boundingBox = Array.isArray(result?.boundingbox)
        ? normalizeBounds({
            south: parseCoordinate(result.boundingbox[0]),
            north: parseCoordinate(result.boundingbox[1]),
            west: parseCoordinate(result.boundingbox[2]),
            east: parseCoordinate(result.boundingbox[3]),
          })
        : null;
      const filteredOutline = filterOutlinePolygonsForReferenceBounds(
        polygons,
        referenceBounds
      );

      return {
        name: normalizeText(result?.display_name, destinationLabel),
        addresstype: normalizeText(result?.addresstype),
        category: normalizeText(result?.category),
        type: normalizeText(result?.type),
        placeRank: result?.place_rank,
        polygons:
          filteredOutline.polygons.length > 0 ? filteredOutline.polygons : polygons,
        cityBounds:
          filteredOutline.cityBounds ??
          boundingBox ??
          deriveBoundsFromPolygons(polygons),
        retainedPolygonCount: filteredOutline.polygons.length,
        originalPolygonCount: polygons.length,
      };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        scoreNominatimMatch(right, destinationLabel, referenceBounds) -
        scoreNominatimMatch(left, destinationLabel, referenceBounds)
    )[0];

  return match
    ? {
        source: "administrative_boundary",
        name: match.name,
        polygons: match.polygons,
        cityBounds: match.cityBounds,
        retainedPolygonCount: match.retainedPolygonCount,
        originalPolygonCount: match.originalPolygonCount,
      }
    : null;
}

export function buildCityMapArtifactPayload(artifacts = []) {
  const normalizedArtifacts = artifacts
    .filter((artifact) => artifact?.destinationKey && artifact?.artifactFile)
    .sort((left, right) => left.destinationKey.localeCompare(right.destinationKey));
  const destinationIndex = {};

  for (const artifact of normalizedArtifacts) {
    const lookupKeys = new Set([
      ...buildDestinationLookupKeys(artifact.destinationLabel),
      ...buildDestinationLookupKeys(artifact.destination),
    ]);

    for (const lookupKey of lookupKeys) {
      destinationIndex[lookupKey] ??= [];
      destinationIndex[lookupKey].push({
        destinationKey: artifact.destinationKey,
        artifactFile: artifact.artifactFile,
        locality: artifact.destination.locality,
        countryCode: artifact.destination.countryCode,
        countryName: artifact.destination.countryName,
      });
    }
  }

  const manifest = {
    datasetVersion: CITY_MAP_DATASET_VERSION,
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    destinationCount: normalizedArtifacts.length,
    artifactCount: normalizedArtifacts.length,
    artifactMap: normalizedArtifacts.map((artifact) => ({
      destinationKey: artifact.destinationKey,
      artifactFile: artifact.artifactFile,
      locality: artifact.destination.locality,
      countryCode: artifact.destination.countryCode,
      countryName: artifact.destination.countryName,
      mapSource: artifact.basemap?.mapSource ?? artifact.basemap?.source ?? "",
      outlineSource: artifact.basemap?.outline?.source ?? "",
    })),
  };

  return {
    manifest,
    destinationIndex,
  };
}

async function writeCompressedJson(filePath, value) {
  await writeFile(filePath, gzipSync(JSON.stringify(value, null, 2)));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readCompressedJson(filePath) {
  return JSON.parse(gunzipSync(await readFile(filePath)).toString("utf8"));
}

async function getDirectorySize(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  let total = 0;

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySize(entryPath);
      continue;
    }

    total += (await stat(entryPath)).size;
  }

  return total;
}

export async function buildCityMapArtifacts({
  items = WORLD_POI_SEED_DATA,
  outDir = DEFAULT_CITY_MAP_OUT_DIR,
  fetchImpl = fetch,
  endpoints = DEFAULT_ENDPOINTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  includeBasemapFeatures = process.env.CITY_MAP_FETCH_FEATURES === "1",
} = {}) {
  const groupedDestinations = groupDestinationRecords(normalizeDestinationRecords(items));
  const artifactsDir = path.join(outDir, "artifacts");
  const artifacts = [];

  await rm(outDir, { recursive: true, force: true });
  await mkdir(artifactsDir, { recursive: true });

  for (const [index, destinationGroup] of groupedDestinations.entries()) {
    const artifactFile = `artifacts/${createArtifactFileName(destinationGroup.destinationKey, index)}`;
    const cityBounds = deriveDestinationFetchBounds(destinationGroup.records);

    console.info("[city-map-data] Fetching destination basemap", {
      destination: destinationGroup.destinationLabel,
      artifactFile,
    });

    const basemap = includeBasemapFeatures
      ? await fetchBestRemoteBasemap({
          destinationLabel: destinationGroup.destinationLabel,
          cityBounds,
          endpoints,
          fetchImpl,
          timeoutMs,
        })
      : {
          source: "prebuilt_city_map",
          mapSource: "prebuilt_city_map",
          destination: destinationGroup.destinationLabel,
          cityBounds,
          generatedAt: new Date().toISOString(),
          outline: null,
          roads: [],
          water: [],
          parks: [],
          reason: "outline_only_prebuild",
        };
    const nominatimOutline = await fetchNominatimOutline({
      destinationLabel: destinationGroup.destinationLabel,
      referenceBounds: cityBounds,
      fetchImpl,
    }).catch((error) => {
      console.warn("[city-map-data] Nominatim outline lookup failed", {
        destination: destinationGroup.destinationLabel,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    });

    const artifact = {
      destinationKey: destinationGroup.destinationKey,
      destinationLabel: destinationGroup.destinationLabel,
      destination: destinationGroup.destination,
      generatedAt: new Date().toISOString(),
      artifactFile,
      basemap: {
        ...basemap,
        source: "prebuilt_city_map",
        mapSource: "prebuilt_city_map",
        cityBounds: nominatimOutline?.cityBounds ?? basemap.cityBounds,
        outline: nominatimOutline
          ? {
              source: nominatimOutline.source,
              name: nominatimOutline.name,
              polygons: nominatimOutline.polygons,
            }
          : basemap.outline,
      },
    };

    if (
      nominatimOutline &&
      nominatimOutline.originalPolygonCount > nominatimOutline.retainedPolygonCount
    ) {
      console.info("[city-map-data] Trimmed destination outline polygons", {
        destination: destinationGroup.destinationLabel,
        originalPolygonCount: nominatimOutline.originalPolygonCount,
        retainedPolygonCount: nominatimOutline.retainedPolygonCount,
      });
    }

    artifacts.push(artifact);
    await writeCompressedJson(path.join(outDir, artifactFile), artifact);
  }

  const payload = buildCityMapArtifactPayload(artifacts);
  await writeFile(path.join(outDir, "manifest.json"), JSON.stringify(payload.manifest, null, 2));
  await writeFile(
    path.join(outDir, "destination-index.json"),
    JSON.stringify(payload.destinationIndex, null, 2)
  );

  return summarizeCityMapArtifacts({ outDir });
}

export async function summarizeCityMapArtifacts({
  outDir = DEFAULT_CITY_MAP_OUT_DIR,
} = {}) {
  const manifest = await readJson(path.join(outDir, "manifest.json"));
  const sizeBytes = await getDirectorySize(outDir);

  return {
    datasetVersion: manifest.datasetVersion,
    destinationCount: manifest.destinationCount,
    artifactCount: manifest.artifactCount,
    sizeBytes,
    sizeLabel: formatBytes(sizeBytes),
  };
}

export async function verifyCityMapArtifacts({
  outDir = DEFAULT_CITY_MAP_OUT_DIR,
  sizeBudgetBytes = DEFAULT_SIZE_BUDGET_BYTES,
  expectedDestinationCount = null,
} = {}) {
  const manifest = await readJson(path.join(outDir, "manifest.json"));
  const destinationIndex = await readJson(path.join(outDir, "destination-index.json"));
  const artifactEntries = await readdir(path.join(outDir, "artifacts"));

  if (manifest.artifactCount !== artifactEntries.length) {
    throw new Error(
      `City map artifact count mismatch: manifest=${manifest.artifactCount} actual=${artifactEntries.length}`
    );
  }

  if (
    Number.isFinite(expectedDestinationCount) &&
    manifest.destinationCount !== expectedDestinationCount
  ) {
    throw new Error(
      `Expected ${expectedDestinationCount} destinations but found ${manifest.destinationCount}`
    );
  }

  if (Object.keys(destinationIndex).length < manifest.destinationCount) {
    throw new Error("Destination index is unexpectedly sparse.");
  }

  for (const artifactMeta of manifest.artifactMap ?? []) {
    const payload = await readCompressedJson(path.join(outDir, artifactMeta.artifactFile));
    if (!payload?.basemap?.outline?.polygons?.length) {
      throw new Error(`Missing outline polygons for ${artifactMeta.destinationKey}`);
    }
  }

  const sizeBytes = await getDirectorySize(outDir);
  if (sizeBytes > sizeBudgetBytes) {
    throw new Error(
      `City map artifacts exceed size budget: ${formatBytes(sizeBytes)} > ${formatBytes(
        sizeBudgetBytes
      )}`
    );
  }

  return {
    datasetVersion: manifest.datasetVersion,
    destinationCount: manifest.destinationCount,
    sizeBytes,
    sizeLabel: formatBytes(sizeBytes),
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--verify")) {
    const summary = await verifyCityMapArtifacts();
    console.info("[city-map-data] Verification complete", summary);
    return;
  }

  if (args.has("--stats")) {
    const summary = await summarizeCityMapArtifacts();
    console.info("[city-map-data] Dataset summary", summary);
    return;
  }

  const summary = await buildCityMapArtifacts();
  console.info("[city-map-data] Build complete", summary);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error("[city-map-data] Build failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
