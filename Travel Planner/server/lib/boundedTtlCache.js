function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

export function createBoundedTtlCache(options = {}) {
  const defaultTtlMs = parsePositiveInteger(options.defaultTtlMs, 300_000);
  const fallbackMaxEntries = parsePositiveInteger(options.maxEntries, 100);
  const resolveMaxEntries =
    typeof options.resolveMaxEntries === "function"
      ? options.resolveMaxEntries
      : () => fallbackMaxEntries;
  const cache = new Map();

  function pruneExpired() {
    const now = Date.now();

    for (const [key, entry] of cache.entries()) {
      if (entry.expiresAt <= now) {
        cache.delete(key);
      }
    }
  }

  function enforceMaxEntries() {
    const maxEntries = parsePositiveInteger(resolveMaxEntries(), fallbackMaxEntries);

    while (cache.size > maxEntries) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }

      cache.delete(oldestKey);
    }
  }

  return {
    get(key) {
      pruneExpired();
      const entry = cache.get(key);
      if (!entry) {
        return null;
      }

      cache.delete(key);
      cache.set(key, entry);
      return entry.value;
    },
    set(key, value, ttlMs = defaultTtlMs) {
      pruneExpired();

      const safeTtlMs = parsePositiveInteger(ttlMs, defaultTtlMs);
      if (cache.has(key)) {
        cache.delete(key);
      }

      cache.set(key, {
        value,
        expiresAt: Date.now() + safeTtlMs,
      });
      enforceMaxEntries();
      return value;
    },
    delete(key) {
      return cache.delete(key);
    },
    clear() {
      cache.clear();
    },
  };
}
