import { randomUUID } from "node:crypto";
import {
  isSqlDisabledError,
  isSqlEnabled,
  withSqlClient,
  withSqlTransaction,
} from "./sqlClient.js";
import { normalizeDestinationLabel } from "../../shared/recommendations.js";

const memoryState = {
  usersByFirebaseUid: new Map(),
  destinationsById: new Map(),
  destinationIdByName: new Map(),
  placesById: new Map(),
  placeIdsByDestination: new Map(),
  edgesByDestination: new Map(),
  tripsById: new Map(),
  candidatesByTripId: new Map(),
  routeRunsByTripDay: new Map(),
};

let hasLoggedSqlFallback = false;

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = normalizeText(String(value ?? ""), "").toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function normalizeNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toISOString(value, fallback = new Date().toISOString()) {
  if (!value) {
    return fallback;
  }

  const asDate = value instanceof Date ? value : new Date(value);
  const timestamp = asDate.getTime();
  if (!Number.isFinite(timestamp)) {
    return fallback;
  }

  return asDate.toISOString();
}

function normalizeDestinationName(value) {
  return normalizeDestinationLabel(value);
}

function destinationNameKey(value) {
  return normalizeDestinationName(value).toLowerCase();
}

function normalizeCoordinates(value = {}) {
  const latitude = normalizeNumber(value.latitude ?? value.lat);
  const longitude = normalizeNumber(value.longitude ?? value.lng);
  return {
    latitude,
    longitude,
  };
}

function normalizePriceLevel(value) {
  const normalized = normalizeText(String(value ?? ""));
  return normalized || "";
}

function normalizePlaceCategory(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return "attraction";
  }

  if (normalized.includes("hotel")) {
    return "hotel";
  }

  if (normalized.includes("restaurant") || normalized.includes("food")) {
    return "restaurant";
  }

  return "attraction";
}

function normalizeExternalPlaceId(place = {}) {
  const source = normalizeText(place.source, "unknown");
  const externalId = normalizeText(
    place.externalPlaceId ?? place.placeId ?? place.external_id
  );

  if (externalId) {
    return externalId;
  }

  const fallback = `${normalizePlaceCategory(place.category)}:${normalizeText(
    place.name,
    "place"
  )}:${normalizeText(place.address, "unknown-address")}`;
  return `${source}-${fallback}`.toLowerCase();
}

function normalizeStoredPlace(place = {}) {
  return {
    id: normalizeText(place.id) || randomUUID(),
    destinationId: normalizeText(place.destinationId),
    source: normalizeText(place.source, "unknown"),
    externalPlaceId: normalizeExternalPlaceId(place),
    category: normalizePlaceCategory(place.category),
    name: normalizeText(place.name, "Unknown Place"),
    address: normalizeText(place.address),
    coordinates: normalizeCoordinates(place.coordinates ?? place.geoCoordinates),
    rating: normalizeNumber(place.rating),
    priceLevel: normalizePriceLevel(place.priceLevel ?? place.priceLabel),
    description: normalizeText(place.description),
    metadata: place.metadata && typeof place.metadata === "object" ? place.metadata : {},
    freshUntil: toISOString(place.freshUntil),
    updatedAt: toISOString(place.updatedAt),
  };
}

function normalizeDestinationRecord(input = {}) {
  return {
    id: normalizeText(input.id) || randomUUID(),
    canonicalName: normalizeDestinationName(input.canonicalName ?? input.name),
    countryCode: normalizeText(input.countryCode).toUpperCase(),
    centerPoint: normalizeCoordinates(input.centerPoint),
    lastIngestedAt: input.lastIngestedAt ? toISOString(input.lastIngestedAt) : null,
    freshUntil: input.freshUntil ? toISOString(input.freshUntil) : null,
    version: Number.isInteger(input.version) ? input.version : 1,
    createdAt: toISOString(input.createdAt),
  };
}

function normalizeCandidate(candidate = {}) {
  return {
    tripId: normalizeText(candidate.tripId),
    placeId: normalizeText(candidate.placeId),
    preferenceScore: normalizeNumber(candidate.preferenceScore) ?? 0,
    clusterId: Number.isInteger(candidate.clusterId) ? candidate.clusterId : null,
    visitDay: Number.isInteger(candidate.visitDay) ? candidate.visitDay : null,
    visitOrder: Number.isInteger(candidate.visitOrder) ? candidate.visitOrder : null,
  };
}

function normalizeRouteRun(routeRun = {}) {
  return {
    id: normalizeText(routeRun.id) || randomUUID(),
    tripId: normalizeText(routeRun.tripId),
    dayNo: Number.parseInt(routeRun.dayNo, 10) || 1,
    algorithmVersion: normalizeText(routeRun.algorithmVersion, "python-nearest-neighbor-2opt"),
    inputHash: normalizeText(routeRun.inputHash),
    result: routeRun.result && typeof routeRun.result === "object" ? routeRun.result : {},
    createdAt: toISOString(routeRun.createdAt),
  };
}

function shouldFailIfSqlUnavailable() {
  return parseBoolean(process.env.SQL_STRICT_MODE, false);
}

function reportSqlFallback(error) {
  if (hasLoggedSqlFallback) {
    return;
  }

  hasLoggedSqlFallback = true;
  console.warn("[hybrid-store] SQL store unavailable; using in-memory fallback.", {
    message: error instanceof Error ? error.message : String(error),
  });
}

async function runInHybridMode(sqlOperation, memoryOperation) {
  if (!isSqlEnabled()) {
    return memoryOperation();
  }

  try {
    return await sqlOperation();
  } catch (error) {
    if (shouldFailIfSqlUnavailable() && !isSqlDisabledError(error)) {
      throw error;
    }

    reportSqlFallback(error);
    return memoryOperation();
  }
}

function mapDestinationRow(row = {}) {
  return normalizeDestinationRecord({
    id: row.id,
    canonicalName: row.canonical_name,
    countryCode: row.country_code,
    centerPoint: {
      latitude: row.center_lat,
      longitude: row.center_lng,
    },
    lastIngestedAt: row.last_ingested_at,
    freshUntil: row.fresh_until,
    version: Number.parseInt(row.version, 10),
    createdAt: row.created_at,
  });
}

function mapPlaceRow(row = {}) {
  return normalizeStoredPlace({
    id: row.id,
    destinationId: row.destination_id,
    source: row.source,
    externalPlaceId: row.external_place_id,
    category: row.category,
    name: row.name,
    address: row.address,
    coordinates: {
      latitude: row.lat,
      longitude: row.lng,
    },
    rating: row.rating,
    priceLevel: row.price_level,
    description: row.description,
    metadata: row.metadata_json,
    freshUntil: row.fresh_until,
    updatedAt: row.updated_at,
  });
}

function mapTripRow(row = {}) {
  return {
    id: normalizeText(row.id),
    userId: normalizeText(row.user_id),
    destinationId: normalizeText(row.destination_id),
    days: Number.parseInt(row.days, 10) || 1,
    budgetAmount: Number.parseInt(row.budget_amount, 10) || null,
    preferences: row.preferences_json && typeof row.preferences_json === "object"
      ? row.preferences_json
      : {},
    status: normalizeText(row.status, "active"),
    planningMeta: row.planning_meta_json && typeof row.planning_meta_json === "object"
      ? row.planning_meta_json
      : {},
    createdAt: toISOString(row.created_at),
  };
}

function mapCandidateRow(row = {}) {
  return normalizeCandidate({
    tripId: row.trip_id,
    placeId: row.place_id,
    preferenceScore: row.preference_score,
    clusterId: row.cluster_id,
    visitDay: row.visit_day,
    visitOrder: row.visit_order,
  });
}

function mapRouteRunRow(row = {}) {
  return normalizeRouteRun({
    id: row.id,
    tripId: row.trip_id,
    dayNo: row.day_no,
    algorithmVersion: row.algorithm_version,
    inputHash: row.input_hash,
    result: row.result_json,
    createdAt: row.created_at,
  });
}

function upsertUserInMemory({ firebaseUid, email }) {
  const normalizedFirebaseUid = normalizeText(firebaseUid);
  const normalizedEmail = normalizeText(email);

  const current = memoryState.usersByFirebaseUid.get(normalizedFirebaseUid);
  const user = {
    id: current?.id ?? randomUUID(),
    firebaseUid: normalizedFirebaseUid,
    email: normalizedEmail,
    createdAt: current?.createdAt ?? new Date().toISOString(),
  };

  memoryState.usersByFirebaseUid.set(normalizedFirebaseUid, user);
  return user;
}

function upsertDestinationInMemory(input = {}) {
  const normalized = normalizeDestinationRecord(input);
  const key = destinationNameKey(normalized.canonicalName);
  const existingId = memoryState.destinationIdByName.get(key);
  const existing = existingId ? memoryState.destinationsById.get(existingId) : null;

  const destination = {
    ...normalized,
    id: existing?.id ?? normalized.id,
    createdAt: existing?.createdAt ?? normalized.createdAt,
    version: existing?.version ?? normalized.version,
    lastIngestedAt: existing?.lastIngestedAt ?? normalized.lastIngestedAt,
    freshUntil: existing?.freshUntil ?? normalized.freshUntil,
  };

  memoryState.destinationsById.set(destination.id, destination);
  memoryState.destinationIdByName.set(key, destination.id);
  return destination;
}

function markDestinationIngestedInMemory({
  destinationId,
  freshUntil,
  ingestedAt = new Date().toISOString(),
}) {
  const destination = memoryState.destinationsById.get(destinationId);
  if (!destination) {
    return null;
  }

  const updated = {
    ...destination,
    lastIngestedAt: toISOString(ingestedAt),
    freshUntil: toISOString(freshUntil),
    version: destination.version + 1,
  };
  memoryState.destinationsById.set(destinationId, updated);
  memoryState.destinationIdByName.set(
    destinationNameKey(updated.canonicalName),
    destinationId
  );
  return updated;
}

function getDestinationByNameInMemory(name) {
  const key = destinationNameKey(name);
  const destinationId = memoryState.destinationIdByName.get(key);
  if (!destinationId) {
    return null;
  }

  return memoryState.destinationsById.get(destinationId) ?? null;
}

function getDestinationByIdInMemory(destinationId) {
  return memoryState.destinationsById.get(destinationId) ?? null;
}

function replaceDestinationPlacesInMemory({ destinationId, places, freshUntil }) {
  const currentPlaceIds = memoryState.placeIdsByDestination.get(destinationId) ?? [];
  for (const placeId of currentPlaceIds) {
    memoryState.placesById.delete(placeId);
  }

  const normalizedPlaces = places.map((place) =>
    normalizeStoredPlace({
      ...place,
      destinationId,
      freshUntil,
    })
  );

  for (const place of normalizedPlaces) {
    memoryState.placesById.set(place.id, place);
  }

  memoryState.placeIdsByDestination.set(
    destinationId,
    normalizedPlaces.map((place) => place.id)
  );
  return normalizedPlaces;
}

function listDestinationPlacesInMemory({ destinationId, categories = [] }) {
  const placeIds = memoryState.placeIdsByDestination.get(destinationId) ?? [];
  const normalizedCategories = categories.map(normalizePlaceCategory);

  const places = placeIds
    .map((placeId) => memoryState.placesById.get(placeId))
    .filter(Boolean)
    .filter((place) => {
      if (normalizedCategories.length === 0) {
        return true;
      }

      return normalizedCategories.includes(place.category);
    });

  return places.sort((left, right) => {
    const leftRating = Number.isFinite(left.rating) ? left.rating : -1;
    const rightRating = Number.isFinite(right.rating) ? right.rating : -1;
    return rightRating - leftRating;
  });
}

function replaceTransportEdgesInMemory({ destinationId, mode, edges }) {
  const key = `${destinationId}:${normalizeText(mode, "drive")}`;
  const normalizedEdges = edges.map((edge) => ({
    destinationId,
    fromPlaceId: normalizeText(edge.fromPlaceId),
    toPlaceId: normalizeText(edge.toPlaceId),
    mode: normalizeText(edge.mode ?? mode, "drive"),
    distanceMeters: normalizeNumber(edge.distanceMeters) ?? 0,
    durationSeconds: normalizeNumber(edge.durationSeconds) ?? 0,
    weight: normalizeNumber(edge.weight) ?? 0,
    source: normalizeText(edge.source, "haversine"),
    updatedAt: new Date().toISOString(),
  }));
  memoryState.edgesByDestination.set(key, normalizedEdges);
  return normalizedEdges;
}

function listTransportEdgesInMemory({ destinationId, mode = "drive" }) {
  const key = `${destinationId}:${normalizeText(mode, "drive")}`;
  return memoryState.edgesByDestination.get(key) ?? [];
}

function upsertTripInMemory(input = {}) {
  const normalizedTrip = {
    id: normalizeText(input.id),
    userId: normalizeText(input.userId),
    destinationId: normalizeText(input.destinationId),
    days: Number.parseInt(input.days, 10) || 1,
    budgetAmount: Number.parseInt(input.budgetAmount, 10) || null,
    preferences: input.preferences && typeof input.preferences === "object"
      ? input.preferences
      : {},
    status: normalizeText(input.status, "active"),
    planningMeta: input.planningMeta && typeof input.planningMeta === "object"
      ? input.planningMeta
      : {},
    createdAt: toISOString(input.createdAt),
  };

  memoryState.tripsById.set(normalizedTrip.id, normalizedTrip);
  return normalizedTrip;
}

function saveTripCandidatesInMemory(tripId, candidates = []) {
  const normalizedCandidates = candidates
    .map((candidate) => normalizeCandidate({ ...candidate, tripId }))
    .filter((candidate) => candidate.placeId);
  memoryState.candidatesByTripId.set(tripId, normalizedCandidates);
  return normalizedCandidates;
}

function listTripCandidatesInMemory(tripId) {
  return memoryState.candidatesByTripId.get(tripId) ?? [];
}

function saveRouteRunInMemory(routeRun = {}) {
  const normalized = normalizeRouteRun(routeRun);
  const key = `${normalized.tripId}:${normalized.dayNo}`;
  const runs = memoryState.routeRunsByTripDay.get(key) ?? [];
  runs.unshift(normalized);
  memoryState.routeRunsByTripDay.set(key, runs.slice(0, 10));
  return normalized;
}

function getLatestRouteRunInMemory({ tripId, dayNo, inputHash = "" }) {
  const key = `${tripId}:${dayNo}`;
  const runs = memoryState.routeRunsByTripDay.get(key) ?? [];

  if (!inputHash) {
    return runs[0] ?? null;
  }

  return runs.find((run) => run.inputHash === inputHash) ?? null;
}

export async function upsertStructuredUser({ firebaseUid, email }) {
  return runInHybridMode(
    async () => {
      const response = await withSqlClient((client) =>
        client.query(
          `INSERT INTO users (firebase_uid, email)
           VALUES ($1, $2)
           ON CONFLICT (firebase_uid)
           DO UPDATE SET email = EXCLUDED.email
           RETURNING id, firebase_uid, email, created_at`,
          [normalizeText(firebaseUid), normalizeText(email)]
        )
      );

      const row = response.rows[0];
      return {
        id: row.id,
        firebaseUid: row.firebase_uid,
        email: row.email,
        createdAt: toISOString(row.created_at),
      };
    },
    () => upsertUserInMemory({ firebaseUid, email })
  );
}

export async function upsertStructuredDestination(input = {}) {
  const normalizedInput = normalizeDestinationRecord(input);

  return runInHybridMode(
    async () => {
      const response = await withSqlClient((client) =>
        client.query(
          `INSERT INTO destinations (
            canonical_name,
            country_code,
            center_lat,
            center_lng,
            center_point
          ) VALUES (
            $1,
            $2,
            $3,
            $4,
            CASE
              WHEN $3 IS NULL OR $4 IS NULL THEN NULL
              ELSE ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography
            END
          )
          ON CONFLICT (canonical_name)
          DO UPDATE SET
            country_code = COALESCE(NULLIF(EXCLUDED.country_code, ''), destinations.country_code),
            center_lat = COALESCE(EXCLUDED.center_lat, destinations.center_lat),
            center_lng = COALESCE(EXCLUDED.center_lng, destinations.center_lng),
            center_point = COALESCE(EXCLUDED.center_point, destinations.center_point)
          RETURNING
            id,
            canonical_name,
            country_code,
            center_lat,
            center_lng,
            last_ingested_at,
            fresh_until,
            version,
            created_at`,
          [
            normalizedInput.canonicalName,
            normalizedInput.countryCode,
            normalizedInput.centerPoint.latitude,
            normalizedInput.centerPoint.longitude,
          ]
        )
      );

      return mapDestinationRow(response.rows[0]);
    },
    () => upsertDestinationInMemory(normalizedInput)
  );
}

export async function getStructuredDestinationByName(canonicalName) {
  return runInHybridMode(
    async () => {
      const response = await withSqlClient((client) =>
        client.query(
          `SELECT
              id,
              canonical_name,
              country_code,
              center_lat,
              center_lng,
              last_ingested_at,
              fresh_until,
              version,
              created_at
            FROM destinations
            WHERE LOWER(canonical_name) = LOWER($1)
            LIMIT 1`,
          [normalizeDestinationName(canonicalName)]
        )
      );

      if (response.rows.length === 0) {
        return null;
      }

      return mapDestinationRow(response.rows[0]);
    },
    () => getDestinationByNameInMemory(canonicalName)
  );
}

export async function getStructuredDestinationById(destinationId) {
  return runInHybridMode(
    async () => {
      const response = await withSqlClient((client) =>
        client.query(
          `SELECT
              id,
              canonical_name,
              country_code,
              center_lat,
              center_lng,
              last_ingested_at,
              fresh_until,
              version,
              created_at
            FROM destinations
            WHERE id = $1
            LIMIT 1`,
          [destinationId]
        )
      );

      if (response.rows.length === 0) {
        return null;
      }

      return mapDestinationRow(response.rows[0]);
    },
    () => getDestinationByIdInMemory(destinationId)
  );
}

export async function markStructuredDestinationIngested({
  destinationId,
  freshUntil,
  ingestedAt = new Date().toISOString(),
}) {
  return runInHybridMode(
    async () => {
      const response = await withSqlClient((client) =>
        client.query(
          `UPDATE destinations
           SET
            last_ingested_at = $2,
            fresh_until = $3,
            version = version + 1
           WHERE id = $1
           RETURNING
            id,
            canonical_name,
            country_code,
            center_lat,
            center_lng,
            last_ingested_at,
            fresh_until,
            version,
            created_at`,
          [destinationId, toISOString(ingestedAt), toISOString(freshUntil)]
        )
      );

      if (response.rows.length === 0) {
        return null;
      }

      return mapDestinationRow(response.rows[0]);
    },
    () =>
      markDestinationIngestedInMemory({
        destinationId,
        freshUntil,
        ingestedAt,
      })
  );
}

export async function replaceStructuredDestinationPlaces({
  destinationId,
  places = [],
  freshUntil,
}) {
  const normalizedPlaces = places.map((place) =>
    normalizeStoredPlace({ ...place, destinationId, freshUntil })
  );

  return runInHybridMode(
    async () =>
      withSqlTransaction(async (client) => {
        await client.query(`DELETE FROM places WHERE destination_id = $1`, [destinationId]);

        const savedPlaces = [];
        for (const place of normalizedPlaces) {
          const response = await client.query(
            `INSERT INTO places (
              destination_id,
              source,
              external_place_id,
              category,
              name,
              address,
              lat,
              lng,
              geo_point,
              rating,
              price_level,
              description,
              metadata_json,
              fresh_until,
              updated_at
            ) VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              CASE
                WHEN $7 IS NULL OR $8 IS NULL THEN NULL
                ELSE ST_SetSRID(ST_MakePoint($8, $7), 4326)::geography
              END,
              $9,
              $10,
              $11,
              $12::jsonb,
              $13,
              NOW()
            )
            ON CONFLICT (source, external_place_id)
            DO UPDATE SET
              destination_id = EXCLUDED.destination_id,
              category = EXCLUDED.category,
              name = EXCLUDED.name,
              address = EXCLUDED.address,
              lat = EXCLUDED.lat,
              lng = EXCLUDED.lng,
              geo_point = EXCLUDED.geo_point,
              rating = EXCLUDED.rating,
              price_level = EXCLUDED.price_level,
              description = EXCLUDED.description,
              metadata_json = EXCLUDED.metadata_json,
              fresh_until = EXCLUDED.fresh_until,
              updated_at = NOW()
            RETURNING
              id,
              destination_id,
              source,
              external_place_id,
              category,
              name,
              address,
              lat,
              lng,
              rating,
              price_level,
              description,
              metadata_json,
              fresh_until,
              updated_at`,
            [
              destinationId,
              place.source,
              place.externalPlaceId,
              place.category,
              place.name,
              place.address,
              place.coordinates.latitude,
              place.coordinates.longitude,
              place.rating,
              place.priceLevel,
              place.description,
              JSON.stringify(place.metadata ?? {}),
              toISOString(freshUntil),
            ]
          );
          savedPlaces.push(mapPlaceRow(response.rows[0]));
        }

        return savedPlaces;
      }),
    () =>
      replaceDestinationPlacesInMemory({
        destinationId,
        places: normalizedPlaces,
        freshUntil,
      })
  );
}

export async function listStructuredDestinationPlaces({
  destinationId,
  categories = [],
}) {
  const normalizedCategories = categories.map(normalizePlaceCategory);

  return runInHybridMode(
    async () => {
      const response = await withSqlClient((client) =>
        normalizedCategories.length > 0
          ? client.query(
              `SELECT
                  id,
                  destination_id,
                  source,
                  external_place_id,
                  category,
                  name,
                  address,
                  lat,
                  lng,
                  rating,
                  price_level,
                  description,
                  metadata_json,
                  fresh_until,
                  updated_at
                FROM places
                WHERE destination_id = $1
                  AND category = ANY($2::text[])
                ORDER BY rating DESC NULLS LAST, name ASC`,
              [destinationId, normalizedCategories]
            )
          : client.query(
              `SELECT
                  id,
                  destination_id,
                  source,
                  external_place_id,
                  category,
                  name,
                  address,
                  lat,
                  lng,
                  rating,
                  price_level,
                  description,
                  metadata_json,
                  fresh_until,
                  updated_at
                FROM places
                WHERE destination_id = $1
                ORDER BY rating DESC NULLS LAST, name ASC`,
              [destinationId]
            )
      );

      return response.rows.map(mapPlaceRow);
    },
    () =>
      listDestinationPlacesInMemory({
        destinationId,
        categories: normalizedCategories,
      })
  );
}

export async function replaceStructuredTransportEdges({
  destinationId,
  mode = "drive",
  edges = [],
}) {
  const normalizedMode = normalizeText(mode, "drive");
  const normalizedEdges = edges.map((edge) => ({
    destinationId,
    fromPlaceId: normalizeText(edge.fromPlaceId),
    toPlaceId: normalizeText(edge.toPlaceId),
    mode: normalizeText(edge.mode ?? normalizedMode, normalizedMode),
    distanceMeters: normalizeNumber(edge.distanceMeters) ?? 0,
    durationSeconds: normalizeNumber(edge.durationSeconds) ?? 0,
    weight: normalizeNumber(edge.weight) ?? 0,
    source: normalizeText(edge.source, "haversine"),
  }));

  return runInHybridMode(
    async () =>
      withSqlTransaction(async (client) => {
        await client.query(
          `DELETE FROM transport_edges
           WHERE destination_id = $1
             AND mode = $2`,
          [destinationId, normalizedMode]
        );

        const savedEdges = [];
        for (const edge of normalizedEdges) {
          const response = await client.query(
            `INSERT INTO transport_edges (
              destination_id,
              from_place_id,
              to_place_id,
              mode,
              distance_m,
              duration_s,
              weight,
              source,
              updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING
              destination_id,
              from_place_id,
              to_place_id,
              mode,
              distance_m,
              duration_s,
              weight,
              source,
              updated_at`,
            [
              destinationId,
              edge.fromPlaceId,
              edge.toPlaceId,
              edge.mode,
              edge.distanceMeters,
              edge.durationSeconds,
              edge.weight,
              edge.source,
            ]
          );
          const row = response.rows[0];
          savedEdges.push({
            destinationId: row.destination_id,
            fromPlaceId: row.from_place_id,
            toPlaceId: row.to_place_id,
            mode: row.mode,
            distanceMeters: row.distance_m,
            durationSeconds: row.duration_s,
            weight: row.weight,
            source: row.source,
            updatedAt: toISOString(row.updated_at),
          });
        }

        return savedEdges;
      }),
    () =>
      replaceTransportEdgesInMemory({
        destinationId,
        mode: normalizedMode,
        edges: normalizedEdges,
      })
  );
}

export async function listStructuredTransportEdges({
  destinationId,
  mode = "drive",
}) {
  const normalizedMode = normalizeText(mode, "drive");

  return runInHybridMode(
    async () => {
      const response = await withSqlClient((client) =>
        client.query(
          `SELECT
              destination_id,
              from_place_id,
              to_place_id,
              mode,
              distance_m,
              duration_s,
              weight,
              source,
              updated_at
            FROM transport_edges
            WHERE destination_id = $1
              AND mode = $2`,
          [destinationId, normalizedMode]
        )
      );

      return response.rows.map((row) => ({
        destinationId: row.destination_id,
        fromPlaceId: row.from_place_id,
        toPlaceId: row.to_place_id,
        mode: row.mode,
        distanceMeters: row.distance_m,
        durationSeconds: row.duration_s,
        weight: row.weight,
        source: row.source,
        updatedAt: toISOString(row.updated_at),
      }));
    },
    () =>
      listTransportEdgesInMemory({
        destinationId,
        mode: normalizedMode,
      })
  );
}

export async function upsertStructuredTrip(input = {}) {
  const normalizedInput = {
    id: normalizeText(input.id),
    userId: normalizeText(input.userId),
    destinationId: normalizeText(input.destinationId),
    days: Number.parseInt(input.days, 10) || 1,
    budgetAmount: Number.parseInt(input.budgetAmount, 10) || null,
    preferences:
      input.preferences && typeof input.preferences === "object" ? input.preferences : {},
    status: normalizeText(input.status, "active"),
    planningMeta:
      input.planningMeta && typeof input.planningMeta === "object" ? input.planningMeta : {},
    createdAt: toISOString(input.createdAt),
  };

  return runInHybridMode(
    async () => {
      const response = await withSqlClient((client) =>
        client.query(
          `INSERT INTO trips (
            id,
            user_id,
            destination_id,
            days,
            budget_amount,
            preferences_json,
            status,
            planning_meta_json,
            created_at
          ) VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6::jsonb,
            $7,
            $8::jsonb,
            $9
          )
          ON CONFLICT (id)
          DO UPDATE SET
            user_id = EXCLUDED.user_id,
            destination_id = EXCLUDED.destination_id,
            days = EXCLUDED.days,
            budget_amount = EXCLUDED.budget_amount,
            preferences_json = EXCLUDED.preferences_json,
            status = EXCLUDED.status,
            planning_meta_json = EXCLUDED.planning_meta_json
          RETURNING
            id,
            user_id,
            destination_id,
            days,
            budget_amount,
            preferences_json,
            status,
            planning_meta_json,
            created_at`,
          [
            normalizedInput.id,
            normalizedInput.userId,
            normalizedInput.destinationId,
            normalizedInput.days,
            normalizedInput.budgetAmount,
            JSON.stringify(normalizedInput.preferences),
            normalizedInput.status,
            JSON.stringify(normalizedInput.planningMeta),
            normalizedInput.createdAt,
          ]
        )
      );

      return mapTripRow(response.rows[0]);
    },
    () => upsertTripInMemory(normalizedInput)
  );
}

export async function saveStructuredTripCandidates(tripId, candidates = []) {
  const normalizedCandidates = candidates
    .map((candidate) => normalizeCandidate({ ...candidate, tripId }))
    .filter((candidate) => candidate.placeId);

  return runInHybridMode(
    async () =>
      withSqlTransaction(async (client) => {
        await client.query(`DELETE FROM trip_place_candidates WHERE trip_id = $1`, [tripId]);

        const saved = [];
        for (const candidate of normalizedCandidates) {
          const response = await client.query(
            `INSERT INTO trip_place_candidates (
              trip_id,
              place_id,
              preference_score,
              cluster_id,
              visit_day,
              visit_order
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING
              trip_id,
              place_id,
              preference_score,
              cluster_id,
              visit_day,
              visit_order`,
            [
              tripId,
              candidate.placeId,
              candidate.preferenceScore,
              candidate.clusterId,
              candidate.visitDay,
              candidate.visitOrder,
            ]
          );

          saved.push(mapCandidateRow(response.rows[0]));
        }

        return saved;
      }),
    () => saveTripCandidatesInMemory(tripId, normalizedCandidates)
  );
}

export async function listStructuredTripCandidates(tripId) {
  return runInHybridMode(
    async () => {
      const response = await withSqlClient((client) =>
        client.query(
          `SELECT
              trip_id,
              place_id,
              preference_score,
              cluster_id,
              visit_day,
              visit_order
            FROM trip_place_candidates
            WHERE trip_id = $1
            ORDER BY
              visit_day ASC NULLS LAST,
              visit_order ASC NULLS LAST,
              preference_score DESC`,
          [tripId]
        )
      );

      return response.rows.map(mapCandidateRow);
    },
    () => listTripCandidatesInMemory(tripId)
  );
}

export async function saveStructuredRouteRun(routeRun = {}) {
  const normalized = normalizeRouteRun(routeRun);

  return runInHybridMode(
    async () => {
      const response = await withSqlClient((client) =>
        client.query(
          `INSERT INTO route_runs (
            id,
            trip_id,
            day_no,
            algorithm_version,
            input_hash,
            result_json,
            created_at
          ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
          RETURNING
            id,
            trip_id,
            day_no,
            algorithm_version,
            input_hash,
            result_json,
            created_at`,
          [
            normalized.id,
            normalized.tripId,
            normalized.dayNo,
            normalized.algorithmVersion,
            normalized.inputHash,
            JSON.stringify(normalized.result),
            normalized.createdAt,
          ]
        )
      );

      return mapRouteRunRow(response.rows[0]);
    },
    () => saveRouteRunInMemory(normalized)
  );
}

export async function getLatestStructuredRouteRun({
  tripId,
  dayNo,
  inputHash = "",
}) {
  return runInHybridMode(
    async () => {
      const response = await withSqlClient((client) =>
        client.query(
          `SELECT
              id,
              trip_id,
              day_no,
              algorithm_version,
              input_hash,
              result_json,
              created_at
            FROM route_runs
            WHERE trip_id = $1
              AND day_no = $2
              AND ($3 = '' OR input_hash = $3)
            ORDER BY created_at DESC
            LIMIT 1`,
          [tripId, dayNo, normalizeText(inputHash)]
        )
      );

      if (response.rows.length === 0) {
        return null;
      }

      return mapRouteRunRow(response.rows[0]);
    },
    () =>
      getLatestRouteRunInMemory({
        tripId,
        dayNo,
        inputHash,
      })
  );
}

export function isStructuredDestinationFresh(destination = {}, now = Date.now()) {
  const freshnessTimestamp = Date.parse(destination?.freshUntil ?? "");
  return Number.isFinite(freshnessTimestamp) && freshnessTimestamp > now;
}

export function getHybridStoreMode() {
  return isSqlEnabled() ? "sql" : "memory";
}

export function resetHybridStoreMemory() {
  memoryState.usersByFirebaseUid.clear();
  memoryState.destinationsById.clear();
  memoryState.destinationIdByName.clear();
  memoryState.placesById.clear();
  memoryState.placeIdsByDestination.clear();
  memoryState.edgesByDestination.clear();
  memoryState.tripsById.clear();
  memoryState.candidatesByTripId.clear();
  memoryState.routeRunsByTripDay.clear();
  hasLoggedSqlFallback = false;
}

