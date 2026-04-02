const SQL_DISABLED_ERROR_CODE = "sql/disabled";
let poolPromise = null;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function isFalseLike(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "no";
}

function resolveSqlDriverPackage() {
  return String(process.env.SQL_DRIVER_PACKAGE ?? "pg").trim() || "pg";
}

export function isSqlConfigured() {
  return Boolean(String(process.env.SQL_DATABASE_URL ?? "").trim());
}

export function isSqlEnabled() {
  if (!isSqlConfigured()) {
    return false;
  }

  return !isFalseLike(process.env.SQL_ENABLE);
}

function buildDisabledSqlError(message = "SQL data store is not configured.") {
  const error = new Error(message);
  error.code = SQL_DISABLED_ERROR_CODE;
  return error;
}

function resolveSslConfig() {
  const mode = String(process.env.SQL_SSL_MODE ?? "")
    .trim()
    .toLowerCase();

  if (!mode || mode === "disable" || mode === "off") {
    return undefined;
  }

  if (mode === "require") {
    return {
      rejectUnauthorized: !isFalseLike(process.env.SQL_SSL_ALLOW_SELF_SIGNED),
    };
  }

  return undefined;
}

async function createPool() {
  if (!isSqlEnabled()) {
    throw buildDisabledSqlError();
  }

  const driverPackage = resolveSqlDriverPackage();
  let pg;
  try {
    pg = await import(driverPackage);
  } catch (error) {
    const wrappedError = new Error(
      `SQL mode is enabled but the \`${driverPackage}\` package is unavailable. Install \`pg\` (or the configured driver) to use PostgreSQL mode.`
    );
    wrappedError.code = "sql/missing-driver";
    wrappedError.cause = error;
    throw wrappedError;
  }

  const { Pool } = pg;
  const pool = new Pool({
    connectionString: process.env.SQL_DATABASE_URL,
    max: parsePositiveInteger(process.env.SQL_MAX_POOL_SIZE, 10),
    idleTimeoutMillis: parsePositiveInteger(process.env.SQL_IDLE_TIMEOUT_MS, 30_000),
    connectionTimeoutMillis: parsePositiveInteger(
      process.env.SQL_CONNECT_TIMEOUT_MS,
      10_000
    ),
    ssl: resolveSslConfig(),
  });

  pool.on("error", (error) => {
    console.error("[sql] Unexpected PostgreSQL pool error", {
      message: error instanceof Error ? error.message : String(error),
    });
  });

  return pool;
}

async function getPool() {
  if (!poolPromise) {
    poolPromise = createPool();
  }

  return poolPromise;
}

export async function withSqlClient(callback) {
  if (!isSqlEnabled()) {
    throw buildDisabledSqlError();
  }

  const pool = await getPool();
  const client = await pool.connect();

  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function withSqlTransaction(callback) {
  return withSqlClient(async (client) => {
    await client.query("BEGIN");

    try {
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export async function querySql(text, params = []) {
  return withSqlClient(async (client) => client.query(text, params));
}

export async function closeSqlPool() {
  if (!poolPromise) {
    return;
  }

  try {
    const pool = await poolPromise;
    await pool.end();
  } catch (_error) {
    // Pool initialization can fail (for example, missing SQL driver). Reset state anyway.
  } finally {
    poolPromise = null;
  }
}

export function isSqlDisabledError(error) {
  return String(error?.code ?? "").toLowerCase() === SQL_DISABLED_ERROR_CODE;
}
