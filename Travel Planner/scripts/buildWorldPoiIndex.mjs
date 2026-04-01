import { gzipSync, gunzipSync } from "node:zlib";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDestinationLookupKeys,
  normalizePoiKey,
  normalizeWorldPoiRecord,
} from "../shared/worldPoi.js";
import {
  WORLD_POI_DATASET_VERSION,
  WORLD_POI_SEED_DATA,
} from "./worldPoiSeedData.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_WORLD_POI_OUT_DIR = path.resolve(
  __dirname,
  "../data/world-poi"
);
const DEFAULT_SIZE_BUDGET_BYTES = 2_500_000;

function toPosixRelativePath(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
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

function createShardFileName(destinationKey = "", index = 0) {
  const safeKey = normalizePoiKey(destinationKey).replace(/\s+/g, "-");
  return `${String(index + 1).padStart(3, "0")}-${safeKey || "global"}.json.gz`;
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

function buildArtifactPayload(items = []) {
  const normalized = items
    .map((item) => normalizeWorldPoiRecord(item))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.destinationKey !== right.destinationKey) {
        return left.destinationKey.localeCompare(right.destinationKey);
      }
      return right.popularityScore - left.popularityScore;
    });

  const destinationIndex = {};
  const nameIndex = {};
  const shards = [];
  const shardFileByDestinationKey = new Map();
  const itemsByDestinationKey = new Map();

  for (const record of normalized) {
    const destinationKey = record.destinationKey || "global";
    const bucket = itemsByDestinationKey.get(destinationKey) ?? [];
    bucket.push(record);
    itemsByDestinationKey.set(destinationKey, bucket);
  }

  for (const [destinationKey, destinationItems] of itemsByDestinationKey.entries()) {
    const shardFile = createShardFileName(destinationKey, shards.length);
    shardFileByDestinationKey.set(destinationKey, shardFile);

    const exemplar = destinationItems[0];
    const destinationPayload = {
      destinationKey,
      destination: summarizeDestination(exemplar),
      itemCount: destinationItems.length,
      items: destinationItems,
    };

    shards.push({
      destinationKey,
      destination: summarizeDestination(exemplar),
      itemCount: destinationItems.length,
      file: `shards/${shardFile}`,
      payload: destinationPayload,
    });

    for (const lookupKey of buildDestinationLookupKeys(exemplar)) {
      destinationIndex[lookupKey] ??= [];
      destinationIndex[lookupKey].push({
        destinationKey,
        shardFile: `shards/${shardFile}`,
        locality: exemplar.locality,
        countryCode: exemplar.countryCode,
        countryName: exemplar.countryName,
        itemCount: destinationItems.length,
      });
    }
  }

  for (const record of normalized) {
    for (const searchKey of record.searchKeys) {
      nameIndex[searchKey] ??= [];
      nameIndex[searchKey].push({
        id: record.id,
        destinationKey: record.destinationKey,
        shardFile: `shards/${shardFileByDestinationKey.get(record.destinationKey)}`,
        popularityScore: record.popularityScore,
      });
    }
  }

  for (const references of Object.values(nameIndex)) {
    references.sort((left, right) => right.popularityScore - left.popularityScore);
  }

  const manifest = {
    datasetVersion: WORLD_POI_DATASET_VERSION,
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    totalItemCount: normalized.length,
    destinationCount: shards.length,
    shardCount: shards.length,
    shardMap: shards.map((shard) => ({
      destinationKey: shard.destinationKey,
      file: shard.file,
      itemCount: shard.itemCount,
      locality: shard.destination.locality,
      countryCode: shard.destination.countryCode,
      countryName: shard.destination.countryName,
    })),
  };

  return {
    manifest,
    destinationIndex,
    nameIndex,
    shards,
  };
}

async function writeCompressedJson(filePath, value) {
  const raw = JSON.stringify(value, null, 2);
  await writeFile(filePath, gzipSync(raw));
  return Buffer.byteLength(raw);
}

export async function buildWorldPoiArtifacts({
  items = WORLD_POI_SEED_DATA,
  outDir = DEFAULT_WORLD_POI_OUT_DIR,
} = {}) {
  const payload = buildArtifactPayload(items);
  const shardsDir = path.join(outDir, "shards");

  await rm(outDir, { recursive: true, force: true });
  await mkdir(shardsDir, { recursive: true });

  await writeFile(
    path.join(outDir, "manifest.json"),
    JSON.stringify(payload.manifest, null, 2)
  );
  await writeFile(
    path.join(outDir, "destination-index.json"),
    JSON.stringify(payload.destinationIndex, null, 2)
  );
  await writeFile(
    path.join(outDir, "name-index.json"),
    JSON.stringify(payload.nameIndex, null, 2)
  );

  let shardPayloadBytes = 0;
  for (const shard of payload.shards) {
    const filePath = path.join(outDir, shard.file);
    shardPayloadBytes += await writeCompressedJson(filePath, shard.payload);
  }

  const summary = await summarizeWorldPoiArtifacts({ outDir });

  return {
    ...summary,
    shardPayloadBytes,
    manifest: payload.manifest,
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readCompressedJson(filePath) {
  const compressed = await readFile(filePath);
  return JSON.parse(gunzipSync(compressed).toString("utf8"));
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

export async function summarizeWorldPoiArtifacts({
  outDir = DEFAULT_WORLD_POI_OUT_DIR,
} = {}) {
  const manifest = await readJson(path.join(outDir, "manifest.json"));
  const sizeBytes = await getDirectorySize(outDir);

  return {
    datasetVersion: manifest.datasetVersion,
    destinationCount: manifest.destinationCount,
    shardCount: manifest.shardCount,
    totalItemCount: manifest.totalItemCount,
    sizeBytes,
    sizeLabel: formatBytes(sizeBytes),
  };
}

export async function verifyWorldPoiArtifacts({
  outDir = DEFAULT_WORLD_POI_OUT_DIR,
  sizeBudgetBytes = DEFAULT_SIZE_BUDGET_BYTES,
} = {}) {
  const manifest = await readJson(path.join(outDir, "manifest.json"));
  const destinationIndex = await readJson(path.join(outDir, "destination-index.json"));
  const nameIndex = await readJson(path.join(outDir, "name-index.json"));
  const shardRoot = path.join(outDir, "shards");
  const shardEntries = await readdir(shardRoot);

  if (manifest.shardCount !== shardEntries.length) {
    throw new Error(
      `World POI shard count mismatch: manifest=${manifest.shardCount} actual=${shardEntries.length}`
    );
  }

  if (!manifest.totalItemCount || manifest.totalItemCount < 1) {
    throw new Error("World POI manifest contains no items.");
  }

  if (Object.keys(destinationIndex).length < 1) {
    throw new Error("Destination index is empty.");
  }

  if (Object.keys(nameIndex).length < manifest.totalItemCount) {
    throw new Error("Name index is unexpectedly sparse.");
  }

  for (const shard of manifest.shardMap ?? []) {
    const shardPath = path.join(outDir, shard.file);
    const payload = await readCompressedJson(shardPath);

    if (payload.destinationKey !== shard.destinationKey) {
      throw new Error(`Shard destination mismatch for ${shard.file}`);
    }

    if (!Array.isArray(payload.items) || payload.items.length !== shard.itemCount) {
      throw new Error(`Shard item count mismatch for ${shard.file}`);
    }
  }

  const sizeBytes = await getDirectorySize(outDir);
  if (sizeBytes > sizeBudgetBytes) {
    throw new Error(
      `World POI artifacts exceed budget: ${formatBytes(sizeBytes)} > ${formatBytes(sizeBudgetBytes)}`
    );
  }

  return {
    ok: true,
    datasetVersion: manifest.datasetVersion,
    totalItemCount: manifest.totalItemCount,
    shardCount: manifest.shardCount,
    sizeBytes,
    sizeLabel: formatBytes(sizeBytes),
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));

  if (args.has("--verify")) {
    const summary = await verifyWorldPoiArtifacts();
    console.info("[world-poi] Verification complete", summary);
    return;
  }

  if (args.has("--stats")) {
    const summary = await summarizeWorldPoiArtifacts();
    console.info("[world-poi] Dataset summary", summary);
    return;
  }

  const summary = await buildWorldPoiArtifacts();
  console.info("[world-poi] Build complete", summary);
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error("[world-poi] Build failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
