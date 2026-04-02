import { safeFetch } from "./safeFetch.js";

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function toCacheKey(namespace, key) {
  const normalizedNamespace = normalizeText(namespace) || "cache";
  const normalizedKey = normalizeText(key);
  return `${normalizedNamespace}:${normalizedKey}`;
}

function encodeCacheValue(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function decodeCacheValue(value) {
  if (typeof value !== "string" || !value) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch (_error) {
    return null;
  }
}

function createUpstashClient(config = {}) {
  const baseUrl = normalizeText(config.url ?? process.env.UPSTASH_REDIS_REST_URL);
  const token = normalizeText(config.token ?? process.env.UPSTASH_REDIS_REST_TOKEN);

  if (!baseUrl || !token) {
    return null;
  }

  const normalizedUrl = baseUrl.replace(/\/+$/, "");
  let hasLoggedFailure = false;

  async function request(path) {
    try {
      const response = await safeFetch(`${normalizedUrl}${path}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Upstash cache request failed with status ${response.status}.`);
      }

      return response.json();
    } catch (error) {
      if (!hasLoggedFailure) {
        hasLoggedFailure = true;
        console.warn("[cache] L2 cache request failed; continuing with L1 cache only.", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return null;
    }
  }

  return {
    async get(key) {
      const payload = await request(`/get/${encodeURIComponent(key)}`);
      return decodeCacheValue(payload?.result);
    },
    async set(key, value, ttlSeconds) {
      const encodedValue = encodeURIComponent(encodeCacheValue(value));
      const safeTtlSeconds = Math.max(1, Math.floor(ttlSeconds));
      await request(`/set/${encodeURIComponent(key)}/${encodedValue}?EX=${safeTtlSeconds}`);
    },
    async delete(key) {
      await request(`/del/${encodeURIComponent(key)}`);
    },
  };
}

export function createMultiLayerCache(options = {}) {
  const namespace = normalizeText(options.namespace) || "cache";
  const defaultTtlMs = parsePositiveInteger(options.defaultTtlMs, 300_000);
  const l1 = new Map();
  const l2 = options.disableL2 ? null : createUpstashClient(options.l2);

  function readL1(key) {
    const entry = l1.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      l1.delete(key);
      return null;
    }

    return entry.value;
  }

  function writeL1(key, value, ttlMs) {
    l1.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  return {
    async get(rawKey) {
      const key = toCacheKey(namespace, rawKey);
      const fromL1 = readL1(key);
      if (fromL1 !== null) {
        return { value: fromL1, layer: "l1" };
      }

      if (!l2) {
        return { value: null, layer: "none" };
      }

      const fromL2 = await l2.get(key);
      if (fromL2 !== null) {
        writeL1(key, fromL2, defaultTtlMs);
        return { value: fromL2, layer: "l2" };
      }

      return { value: null, layer: "none" };
    },
    async set(rawKey, value, ttlMs = defaultTtlMs) {
      const key = toCacheKey(namespace, rawKey);
      const safeTtlMs = parsePositiveInteger(ttlMs, defaultTtlMs);
      writeL1(key, value, safeTtlMs);

      if (l2) {
        await l2.set(key, value, safeTtlMs / 1_000);
      }
    },
    async delete(rawKey) {
      const key = toCacheKey(namespace, rawKey);
      l1.delete(key);
      if (l2) {
        await l2.delete(key);
      }
    },
    clearL1() {
      l1.clear();
    },
  };
}

