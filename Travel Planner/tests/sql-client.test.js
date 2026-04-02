import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  closeSqlPool,
  isSqlConfigured,
  isSqlDisabledError,
  isSqlEnabled,
  withSqlClient,
} from "../server/data/sqlClient.js";

const ENV_KEYS = [
  "SQL_ENABLE",
  "SQL_DATABASE_URL",
  "SQL_DRIVER_PACKAGE",
];

function captureEnv(keys = []) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(previous = {}) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(async () => {
  await closeSqlPool();
});

test("isSqlEnabled respects SQL_ENABLE=false even when database URL is present", () => {
  const previousEnv = captureEnv(ENV_KEYS);
  process.env.SQL_DATABASE_URL = "postgresql://localhost:5432/travel_planner";
  process.env.SQL_ENABLE = "false";

  try {
    assert.equal(isSqlConfigured(), true);
    assert.equal(isSqlEnabled(), false);
  } finally {
    restoreEnv(previousEnv);
  }
});

test("withSqlClient throws sql/disabled when SQL mode is off", async () => {
  const previousEnv = captureEnv(ENV_KEYS);
  process.env.SQL_DATABASE_URL = "postgresql://localhost:5432/travel_planner";
  process.env.SQL_ENABLE = "false";

  try {
    await assert.rejects(
      () => withSqlClient(async () => null),
      (error) => isSqlDisabledError(error)
    );
  } finally {
    restoreEnv(previousEnv);
  }
});

test("withSqlClient reports sql/missing-driver when configured driver package is unavailable", async () => {
  const previousEnv = captureEnv(ENV_KEYS);
  process.env.SQL_DATABASE_URL = "postgresql://localhost:5432/travel_planner";
  process.env.SQL_ENABLE = "true";
  process.env.SQL_DRIVER_PACKAGE = "pg-driver-that-does-not-exist";

  try {
    await assert.rejects(
      () => withSqlClient(async () => null),
      (error) =>
        String(error?.code ?? "").toLowerCase() === "sql/missing-driver"
    );
  } finally {
    restoreEnv(previousEnv);
  }
});
