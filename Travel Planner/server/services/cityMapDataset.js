import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDestinationLookupKeys } from "../../shared/worldPoi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CITY_MAP_DATA_DIR = path.resolve(
  __dirname,
  "../../data/city-maps"
);

const datasetCache = {
  manifests: new Map(),
  destinationIndexes: new Map(),
  artifacts: new Map(),
};

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readCompressedJson(filePath) {
  return JSON.parse(gunzipSync(await readFile(filePath)).toString("utf8"));
}

function getDatasetKey(dataDir = DEFAULT_CITY_MAP_DATA_DIR) {
  return path.resolve(dataDir);
}

async function loadManifest(dataDir = DEFAULT_CITY_MAP_DATA_DIR) {
  const datasetKey = getDatasetKey(dataDir);
  if (!datasetCache.manifests.has(datasetKey)) {
    datasetCache.manifests.set(
      datasetKey,
      readJson(path.join(datasetKey, "manifest.json"))
    );
  }

  return datasetCache.manifests.get(datasetKey);
}

async function loadDestinationIndex(dataDir = DEFAULT_CITY_MAP_DATA_DIR) {
  const datasetKey = getDatasetKey(dataDir);
  if (!datasetCache.destinationIndexes.has(datasetKey)) {
    datasetCache.destinationIndexes.set(
      datasetKey,
      readJson(path.join(datasetKey, "destination-index.json"))
    );
  }

  return datasetCache.destinationIndexes.get(datasetKey);
}

async function loadArtifact(artifactFile = "", dataDir = DEFAULT_CITY_MAP_DATA_DIR) {
  const datasetKey = getDatasetKey(dataDir);
  const artifactPath = path.join(datasetKey, artifactFile);
  if (!datasetCache.artifacts.has(artifactPath)) {
    datasetCache.artifacts.set(artifactPath, readCompressedJson(artifactPath));
  }

  return datasetCache.artifacts.get(artifactPath);
}

export async function getPrebuiltCityMapReferences({
  destination = "",
  dataDir = DEFAULT_CITY_MAP_DATA_DIR,
} = {}) {
  const normalizedDestination = normalizeText(destination);
  if (!normalizedDestination) {
    return [];
  }

  await loadManifest(dataDir);
  const destinationIndex = await loadDestinationIndex(dataDir);
  const references = [];
  const seen = new Set();

  for (const lookupKey of buildDestinationLookupKeys(normalizedDestination)) {
    for (const reference of destinationIndex[lookupKey] ?? []) {
      const uniqueKey = `${reference.destinationKey}::${reference.artifactFile}`;
      if (seen.has(uniqueKey)) {
        continue;
      }

      references.push(reference);
      seen.add(uniqueKey);
    }
  }

  return references;
}

export async function getPrebuiltCityMapArtifact({
  destination = "",
  dataDir = DEFAULT_CITY_MAP_DATA_DIR,
} = {}) {
  try {
    const references = await getPrebuiltCityMapReferences({
      destination,
      dataDir,
    });
    if (references.length === 0) {
      return null;
    }

    const artifact = await loadArtifact(references[0].artifactFile, dataDir);
    return artifact?.basemap ?? artifact ?? null;
  } catch (error) {
    const message = normalizeText(error?.message);
    if (
      message.includes("ENOENT") ||
      message.includes("no such file or directory")
    ) {
      return null;
    }

    throw error;
  }
}
