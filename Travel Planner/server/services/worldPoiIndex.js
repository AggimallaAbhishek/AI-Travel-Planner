import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDestinationLookupKeys,
  createPoiMapsUrl,
  normalizePoiKey,
} from "../../shared/worldPoi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORLD_POI_DATA_DIR = path.resolve(__dirname, "../../data/world-poi");
const DEFAULT_RESOLVE_LIMIT = 12;
const DEFAULT_MIN_MATCH_SCORE = 0.72;

const cache = {
  manifest: null,
  destinationIndex: null,
  nameIndex: null,
  shards: new Map(),
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

async function loadManifest() {
  if (!cache.manifest) {
    cache.manifest = await readJson(path.join(WORLD_POI_DATA_DIR, "manifest.json"));
  }
  return cache.manifest;
}

async function loadDestinationIndex() {
  if (!cache.destinationIndex) {
    cache.destinationIndex = await readJson(
      path.join(WORLD_POI_DATA_DIR, "destination-index.json")
    );
  }
  return cache.destinationIndex;
}

async function loadNameIndex() {
  if (!cache.nameIndex) {
    cache.nameIndex = await readJson(path.join(WORLD_POI_DATA_DIR, "name-index.json"));
  }
  return cache.nameIndex;
}

async function loadShard(shardFile = "") {
  const shardPath = path.join(WORLD_POI_DATA_DIR, shardFile);
  if (!cache.shards.has(shardPath)) {
    console.info("[world-poi-index] Loading shard", { shardFile });
    cache.shards.set(shardPath, readCompressedJson(shardPath));
  }

  return cache.shards.get(shardPath);
}

function normalizeCandidateTexts(texts = []) {
  const unique = [];
  const seen = new Set();

  for (const text of texts) {
    const normalized = normalizeText(text);
    const key = normalizePoiKey(normalized);

    if (!normalized || !key || seen.has(key)) {
      continue;
    }

    unique.push(normalized);
    seen.add(key);
  }

  return unique;
}

function extractTextCandidates(value = "") {
  const text = normalizeText(value);
  if (!text) {
    return [];
  }

  const candidates = [];
  const rawMatches = new Set();
  const phrasePattern =
    /\b(?:in|at|near|around|through|towards?|to|from|inside|by|along)\s+([^.;:()]+)/gi;
  const capitalizedPattern =
    /\b[A-Z][A-Za-z'/-]*(?:\s+(?:[A-Z][A-Za-z'/-]*|of|the|and|\/)){0,5}/g;
  let match;

  while ((match = phrasePattern.exec(text)) !== null) {
    rawMatches.add(match[1]);
  }

  for (const phrase of text.match(capitalizedPattern) ?? []) {
    rawMatches.add(phrase);
  }

  if (rawMatches.size === 0) {
    rawMatches.add(text);
  }

  for (const rawMatch of rawMatches) {
    const fragments = rawMatch
      .split(/\s*(?:\/|&|,| and | or )\s*/i)
      .map((fragment) => normalizeText(fragment))
      .filter(Boolean);

    if (fragments.length === 0) {
      candidates.push(rawMatch);
      continue;
    }

    candidates.push(...fragments);
  }

  return normalizeCandidateTexts(candidates);
}

function tokenizeKey(value = "") {
  return normalizePoiKey(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function scorePoiMatch(record = {}, query = "") {
  const queryKey = normalizePoiKey(query);
  if (!queryKey) {
    return 0;
  }

  const searchKeys = Array.isArray(record?.searchKeys) ? record.searchKeys : [];
  if (searchKeys.includes(queryKey)) {
    return 1;
  }

  for (const key of searchKeys) {
    if (key.includes(queryKey) || queryKey.includes(key)) {
      return 0.9;
    }
  }

  const queryTokens = new Set(tokenizeKey(query));
  if (queryTokens.size === 0) {
    return 0;
  }

  let bestScore = 0;
  for (const key of searchKeys) {
    const keyTokens = tokenizeKey(key);
    if (keyTokens.length === 0) {
      continue;
    }

    const overlap = keyTokens.filter((token) => queryTokens.has(token)).length;
    const score = overlap / Math.max(queryTokens.size, keyTokens.length);
    bestScore = Math.max(bestScore, score);
  }

  return bestScore >= 0.5 ? Number((bestScore * 0.88).toFixed(3)) : 0;
}

function toResolvedPoi(record = {}, score = 1, query = "", matchType = "exact") {
  return {
    ...record,
    provider: "world_poi_index",
    confidence: Number(Math.max(score, record?.popularityScore ?? 0).toFixed(3)),
    matchedQuery: normalizeText(query),
    matchType,
    mapsUrl: normalizeText(record?.mapsUrl, createPoiMapsUrl(record)),
  };
}

async function getDestinationShardReferences(destination = "") {
  await loadManifest();
  const destinationIndex = await loadDestinationIndex();
  const lookupKeys = buildDestinationLookupKeys(destination);
  const references = [];
  const seen = new Set();

  for (const key of lookupKeys) {
    for (const reference of destinationIndex[key] ?? []) {
      const refKey = `${reference.destinationKey}::${reference.shardFile}`;
      if (seen.has(refKey)) {
        continue;
      }

      references.push(reference);
      seen.add(refKey);
    }
  }

  return references;
}

async function loadDestinationRecords(destination = "") {
  const references = await getDestinationShardReferences(destination);
  const records = [];

  for (const reference of references) {
    const shard = await loadShard(reference.shardFile);
    records.push(...(Array.isArray(shard?.items) ? shard.items : []));
  }

  return records;
}

export async function resolvePlace({
  destination = "",
  query = "",
  limit = DEFAULT_RESOLVE_LIMIT,
  minScore = DEFAULT_MIN_MATCH_SCORE,
} = {}) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return null;
  }

  const records = await loadDestinationRecords(destination);
  if (records.length === 0) {
    return null;
  }

  const matches = [];
  for (const record of records) {
    const score = scorePoiMatch(record, normalizedQuery);
    if (score < minScore) {
      continue;
    }

    matches.push(
      toResolvedPoi(
        record,
        score,
        normalizedQuery,
        score >= 0.99 ? "exact" : score >= 0.9 ? "alias" : "fuzzy"
      )
    );
  }

  matches.sort((left, right) => {
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }
    return (right.popularityScore ?? 0) - (left.popularityScore ?? 0);
  });

  const topMatches = matches.slice(0, Math.max(1, limit));
  if (topMatches[0]) {
    console.info("[world-poi-index] Resolved destination-scoped place", {
      destination,
      query: normalizedQuery,
      matched: topMatches[0].name,
      matchType: topMatches[0].matchType,
      confidence: topMatches[0].confidence,
    });
  }

  return topMatches[0] ?? null;
}

export async function resolvePlacesForDay({
  destination = "",
  texts = [],
  limit = DEFAULT_RESOLVE_LIMIT,
  minScore = DEFAULT_MIN_MATCH_SCORE,
} = {}) {
  const queries = normalizeCandidateTexts(
    texts.flatMap((text) => extractTextCandidates(text))
  );
  if (queries.length === 0) {
    return [];
  }

  const resolved = [];
  const seen = new Set();

  for (const query of queries) {
    const match = await resolvePlace({
      destination,
      query,
      limit: 1,
      minScore,
    });

    if (!match || seen.has(match.id)) {
      continue;
    }

    resolved.push(match);
    seen.add(match.id);

    if (resolved.length >= limit) {
      break;
    }
  }

  return resolved;
}

export async function listDestinationPois({
  destination = "",
  limit = 24,
  categories = [],
} = {}) {
  const normalizedCategories = new Set(
    (Array.isArray(categories) ? categories : [categories])
      .map((value) => normalizePoiKey(value))
      .filter(Boolean)
  );
  const records = await loadDestinationRecords(destination);

  return records
    .filter((record) => {
      if (normalizedCategories.size === 0) {
        return true;
      }

      return (record.categories ?? []).some((category) =>
        normalizedCategories.has(normalizePoiKey(category))
      );
    })
    .sort((left, right) => right.popularityScore - left.popularityScore)
    .slice(0, Math.max(1, limit))
    .map((record) => toResolvedPoi(record, record.popularityScore, "", "index"));
}

export async function searchGlobalPoiNameIndex({
  query = "",
  limit = DEFAULT_RESOLVE_LIMIT,
} = {}) {
  const queryKey = normalizePoiKey(query);
  if (!queryKey) {
    return [];
  }

  const nameIndex = await loadNameIndex();
  return (nameIndex[queryKey] ?? []).slice(0, limit);
}

export function clearWorldPoiIndexCacheForTests() {
  cache.manifest = null;
  cache.destinationIndex = null;
  cache.nameIndex = null;
  cache.shards.clear();
}
