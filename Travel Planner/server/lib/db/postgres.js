import { Pool } from "pg";

let cachedPool = null;

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || fallback;
}

function resolveBoolean(value, fallback = false) {
  const normalized = normalizeText(String(value ?? ""), "").toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(normalized);
}

function resolvePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function isPostgresConfigured(env = process.env) {
  return Boolean(normalizeText(env.DATABASE_URL));
}

function resolveSslConfig(env = process.env) {
  const sslMode = normalizeText(env.PGSSLMODE, "").toLowerCase();
  const forceSsl = resolveBoolean(env.PG_FORCE_SSL, false);

  if (sslMode === "disable" && !forceSsl) {
    return false;
  }

  if (sslMode === "require" || sslMode === "verify-ca" || sslMode === "verify-full" || forceSsl) {
    return {
      rejectUnauthorized: false,
    };
  }

  return false;
}

export function getPostgresPool(env = process.env) {
  if (!isPostgresConfigured(env)) {
    const error = new Error("DATABASE_URL is not configured for PostgreSQL persistence.");
    error.code = "database/not-configured";
    throw error;
  }

  if (!cachedPool) {
    cachedPool = new Pool({
      connectionString: normalizeText(env.DATABASE_URL),
      max: resolvePositiveInteger(env.PGPOOL_MAX, 10),
      idleTimeoutMillis: resolvePositiveInteger(env.PG_IDLE_TIMEOUT_MS, 30_000),
      connectionTimeoutMillis: resolvePositiveInteger(
        env.PG_CONNECTION_TIMEOUT_MS,
        10_000
      ),
      ssl: resolveSslConfig(env),
    });

    cachedPool.on("error", (error) => {
      console.error("[postgres] Pool error", {
        message: error instanceof Error ? error.message : String(error),
        code: error?.code ?? null,
      });
    });

    console.info("[postgres] Initialized PostgreSQL pool", {
      maxConnections: resolvePositiveInteger(env.PGPOOL_MAX, 10),
      sslEnabled: Boolean(resolveSslConfig(env)),
    });
  }

  return cachedPool;
}

export async function closePostgresPool() {
  if (!cachedPool) {
    return;
  }

  const pool = cachedPool;
  cachedPool = null;
  await pool.end();
}
