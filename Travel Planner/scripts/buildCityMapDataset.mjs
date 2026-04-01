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

async function fetchNominatimOutline({
  destinationLabel,
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
        ? {
            south: parseCoordinate(result.boundingbox[0]),
            north: parseCoordinate(result.boundingbox[1]),
            west: parseCoordinate(result.boundingbox[2]),
            east: parseCoordinate(result.boundingbox[3]),
          }
        : null;

      return {
        name: normalizeText(result?.display_name, destinationLabel),
        polygons,
        cityBounds:
          boundingBox &&
          boundingBox.north !== null &&
          boundingBox.south !== null &&
          boundingBox.east !== null &&
          boundingBox.west !== null
            ? boundingBox
            : null,
      };
    })
    .filter(Boolean)[0];

  return match
    ? {
        source: "administrative_boundary",
        name: match.name,
        polygons: match.polygons,
        cityBounds: match.cityBounds,
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
