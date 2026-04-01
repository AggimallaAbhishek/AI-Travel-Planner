const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_STALE_TTL_MS = 5 * 60 * 1000;

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function normalizeInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeCacheEnvelope(raw = {}, now = Date.now()) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const createdAt = normalizeInteger(raw.createdAt, now);
  const freshUntil = normalizeInteger(raw.freshUntil, createdAt);
  const staleUntil = normalizeInteger(raw.staleUntil, freshUntil);

  if (!("value" in raw)) {
    return null;
  }

  return {
    createdAt,
    freshUntil,
    staleUntil,
    value: raw.value,
  };
}

function createMemoryCacheStore({
  now = () => Date.now(),
  defaultTtlMs = DEFAULT_CACHE_TTL_MS,
  defaultStaleTtlMs = DEFAULT_STALE_TTL_MS,
} = {}) {
  const values = new Map();
  const stats = {
    hits: 0,
    staleHits: 0,
    misses: 0,
    writes: 0,
    deletes: 0,
  };

  function setEnvelope(key, envelope) {
    values.set(key, envelope);
    stats.writes += 1;
  }

  function getEnvelope(key) {
    const envelope = values.get(key);
    if (!envelope) {
      stats.misses += 1;
      return null;
    }

    const current = now();
    if (current <= envelope.freshUntil) {
      stats.hits += 1;
      return {
        ...envelope,
        isStale: false,
      };
    }

    if (current <= envelope.staleUntil) {
      stats.staleHits += 1;
      return {
        ...envelope,
        isStale: true,
      };
    }

    values.delete(key);
    stats.misses += 1;
    return null;
  }

  async function get(key, options = {}) {
    const envelope = getEnvelope(String(key));
    if (!envelope) {
      return null;
    }

    if (envelope.isStale && options.allowStale !== true) {
      return null;
    }

    return {
      value: envelope.value,
      isStale: envelope.isStale,
      createdAt: envelope.createdAt,
      freshUntil: envelope.freshUntil,
      staleUntil: envelope.staleUntil,
    };
  }

  async function set(key, value, options = {}) {
    const current = now();
    const ttlMs = normalizeInteger(options.ttlMs, defaultTtlMs);
    const staleTtlMs = normalizeInteger(options.staleTtlMs, defaultStaleTtlMs);
    const freshUntil = current + ttlMs;
    const staleUntil = freshUntil + staleTtlMs;

    setEnvelope(String(key), {
      createdAt: current,
      freshUntil,
      staleUntil,
      value,
    });
  }

  async function del(key) {
    values.delete(String(key));
    stats.deletes += 1;
  }

  return {
    mode: "memory",
    get,
    set,
    del,
    stats: () => ({
      ...stats,
      size: values.size,
    }),
  };
}

async function createRedisClient(redisUrl) {
  try {
    const redisModule = await import("redis");
    const client = redisModule.createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 2_500,
      },
    });

    client.on("error", (error) => {
      console.warn("[cache] Redis client error", {
        message: error instanceof Error ? error.message : String(error),
      });
    });

    await client.connect();
    return client;
  } catch (error) {
    console.warn("[cache] Redis unavailable, using in-memory cache", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function createCacheStore({
  redisUrl = process.env.REDIS_URL,
  now = () => Date.now(),
  defaultTtlMs = normalizeInteger(
    process.env.CACHE_DEFAULT_TTL_MS,
    DEFAULT_CACHE_TTL_MS
  ),
  defaultStaleTtlMs = normalizeInteger(
    process.env.CACHE_DEFAULT_STALE_TTL_MS,
    DEFAULT_STALE_TTL_MS
  ),
} = {}) {
  const memoryStore = createMemoryCacheStore({
    now,
    defaultTtlMs,
    defaultStaleTtlMs,
  });
  const normalizedRedisUrl = normalizeText(redisUrl);

  if (!normalizedRedisUrl) {
    return memoryStore;
  }

  const redisClient = await createRedisClient(normalizedRedisUrl);
  if (!redisClient) {
    return memoryStore;
  }

  console.info("[cache] Redis cache connected", {
    url: normalizedRedisUrl.replace(/:[^:@/]+@/, ":***@"),
  });

  return {
    mode: "redis+memory",
    async get(key, options = {}) {
      const cacheKey = String(key);
      const memoryHit = await memoryStore.get(cacheKey, options);
      if (memoryHit) {
        return memoryHit;
      }

      const rawValue = await redisClient.get(cacheKey);
      if (!rawValue) {
        return null;
      }

      try {
        const envelope = normalizeCacheEnvelope(JSON.parse(rawValue), now());
        if (!envelope) {
          return null;
        }

        await memoryStore.set(cacheKey, envelope.value, {
          ttlMs: Math.max(1, envelope.freshUntil - now()),
          staleTtlMs: Math.max(1, envelope.staleUntil - envelope.freshUntil),
        });

        if (envelope.freshUntil >= now()) {
          return {
            value: envelope.value,
            isStale: false,
            createdAt: envelope.createdAt,
            freshUntil: envelope.freshUntil,
            staleUntil: envelope.staleUntil,
          };
        }

        if (options.allowStale && envelope.staleUntil >= now()) {
          return {
            value: envelope.value,
            isStale: true,
            createdAt: envelope.createdAt,
            freshUntil: envelope.freshUntil,
            staleUntil: envelope.staleUntil,
          };
        }

        return null;
      } catch (error) {
        console.warn("[cache] Failed to parse Redis cache envelope", {
          key: cacheKey,
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    async set(key, value, options = {}) {
      const cacheKey = String(key);
      await memoryStore.set(cacheKey, value, options);
      const ttlMs = normalizeInteger(options.ttlMs, defaultTtlMs);
      const staleTtlMs = normalizeInteger(options.staleTtlMs, defaultStaleTtlMs);
      const current = now();
      const envelope = {
        createdAt: current,
        freshUntil: current + ttlMs,
        staleUntil: current + ttlMs + staleTtlMs,
        value,
      };

      await redisClient.set(cacheKey, JSON.stringify(envelope), {
        PX: ttlMs + staleTtlMs,
      });
    },
    async del(key) {
      const cacheKey = String(key);
      await memoryStore.del(cacheKey);
      await redisClient.del(cacheKey);
    },
    stats() {
      return {
        ...memoryStore.stats(),
        mode: "redis+memory",
      };
    },
    async close() {
      await redisClient.quit();
    },
  };
}

export { createMemoryCacheStore };
