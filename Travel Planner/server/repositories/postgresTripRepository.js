import { getPostgresPool } from "../lib/db/postgres.js";

const DEFAULT_TABLE_NAME = "trips";

let ensureTablePromise = null;

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || fallback;
}

function resolveTableName(env = process.env) {
  const configured = normalizeText(env.TRIPS_TABLE_NAME);
  const candidate = configured || DEFAULT_TABLE_NAME;

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate)) {
    const error = new Error(
      "TRIPS_TABLE_NAME must contain only letters, numbers, and underscores."
    );
    error.code = "database/invalid-table-name";
    throw error;
  }

  return candidate;
}

async function ensureTripsTable(env = process.env) {
  if (!ensureTablePromise) {
    const tableName = resolveTableName(env);
    const pool = getPostgresPool(env);

    ensureTablePromise = pool
      .query(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          trip_id UUID PRIMARY KEY,
          owner_id TEXT NOT NULL,
          owner_email TEXT,
          payload JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `)
      .then(() =>
        pool.query(`
          CREATE INDEX IF NOT EXISTS idx_${tableName}_owner_created
          ON ${tableName} (owner_id, created_at DESC);
        `)
      )
      .then(() =>
        pool.query(`
          CREATE INDEX IF NOT EXISTS idx_${tableName}_owner_email_created
          ON ${tableName} (owner_email, created_at DESC);
        `)
      )
      .then(() => {
        console.info("[postgres] Ensured trip persistence schema", {
          tableName,
        });
      })
      .catch((error) => {
        ensureTablePromise = null;
        throw error;
      });
  }

  await ensureTablePromise;
}

function mapRowToTrip(row) {
  const payload =
    row?.payload && typeof row.payload === "object" ? row.payload : {};

  return {
    ...payload,
    id: payload.id ?? row.trip_id,
    ownerId: payload.ownerId ?? row.owner_id ?? "",
    ownerEmail: payload.ownerEmail ?? row.owner_email ?? "",
    createdAt: payload.createdAt ?? row.created_at?.toISOString?.() ?? null,
    updatedAt: payload.updatedAt ?? row.updated_at?.toISOString?.() ?? null,
  };
}

export function createPostgresTripRepository(env = process.env) {
  const tableName = resolveTableName(env);

  return {
    driver: "postgres",

    async saveTrip(trip) {
      await ensureTripsTable(env);
      const pool = getPostgresPool(env);
      const createdAt = normalizeText(trip.createdAt, new Date().toISOString());
      const updatedAt = normalizeText(trip.updatedAt, createdAt);

      await pool.query(
        `
          INSERT INTO ${tableName} (
            trip_id,
            owner_id,
            owner_email,
            payload,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, $6::timestamptz)
          ON CONFLICT (trip_id)
          DO UPDATE SET
            owner_id = EXCLUDED.owner_id,
            owner_email = EXCLUDED.owner_email,
            payload = EXCLUDED.payload,
            updated_at = EXCLUDED.updated_at
        `,
        [
          trip.id,
          normalizeText(trip.ownerId),
          normalizeText(trip.ownerEmail),
          JSON.stringify(trip),
          createdAt,
          updatedAt,
        ]
      );

      return trip;
    },

    async getTripById(tripId) {
      await ensureTripsTable(env);
      const pool = getPostgresPool(env);
      const result = await pool.query(
        `
          SELECT trip_id, owner_id, owner_email, payload, created_at, updated_at
          FROM ${tableName}
          WHERE trip_id = $1
          LIMIT 1
        `,
        [tripId]
      );

      if (result.rowCount === 0) {
        return null;
      }

      return mapRowToTrip(result.rows[0]);
    },

    async listTripsByUser(user) {
      await ensureTripsTable(env);
      const pool = getPostgresPool(env);

      const result = user.email
        ? await pool.query(
            `
              SELECT trip_id, owner_id, owner_email, payload, created_at, updated_at
              FROM ${tableName}
              WHERE owner_id = $1 OR owner_email = $2
              ORDER BY created_at DESC
            `,
            [user.uid, user.email]
          )
        : await pool.query(
            `
              SELECT trip_id, owner_id, owner_email, payload, created_at, updated_at
              FROM ${tableName}
              WHERE owner_id = $1
              ORDER BY created_at DESC
            `,
            [user.uid]
          );

      return result.rows.map(mapRowToTrip);
    },
  };
}
