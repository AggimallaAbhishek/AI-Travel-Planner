import test from "node:test";
import assert from "node:assert/strict";
import {
  createCacheStore,
  createMemoryCacheStore,
} from "../server/services/cacheStore.js";

test("createMemoryCacheStore returns fresh then stale entries", async () => {
  let currentTime = 0;
  const store = createMemoryCacheStore({
    now: () => currentTime,
    defaultTtlMs: 1_000,
    defaultStaleTtlMs: 2_000,
  });

  await store.set("demo-key", { value: 1 }, { ttlMs: 1_000, staleTtlMs: 2_000 });

  const fresh = await store.get("demo-key", { allowStale: true });
  assert.equal(fresh.isStale, false);
  assert.deepEqual(fresh.value, { value: 1 });

  currentTime = 1_500;
  const stale = await store.get("demo-key", { allowStale: true });
  assert.equal(stale.isStale, true);

  currentTime = 3_500;
  const expired = await store.get("demo-key", { allowStale: true });
  assert.equal(expired, null);
});

test("createCacheStore falls back to memory cache when redis is unavailable", async () => {
  const store = await createCacheStore({
    redisUrl: "redis://127.0.0.1:65000",
    defaultTtlMs: 1_000,
    defaultStaleTtlMs: 1_000,
  });

  assert.ok(["memory", "redis+memory"].includes(store.mode));
  await store.set("fallback-key", { ok: true }, { ttlMs: 1_000, staleTtlMs: 1_000 });
  const value = await store.get("fallback-key", { allowStale: true });
  assert.equal(value?.value?.ok, true);
});
