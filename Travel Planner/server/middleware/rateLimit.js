function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function getIdentity(req) {
  if (req.user?.uid) {
    return `uid:${req.user.uid}`;
  }

  return `ip:${req.ip ?? "unknown"}`;
}

export function createTripGenerationRateLimiter(options = {}) {
  const windowMs = parsePositiveInteger(
    options.windowMs ?? process.env.TRIP_GENERATION_RATE_LIMIT_WINDOW_MS,
    60_000
  );
  const maxRequests = parsePositiveInteger(
    options.maxRequests ?? process.env.TRIP_GENERATION_RATE_LIMIT_MAX,
    6
  );
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const requestLogByIdentity = new Map();

  function clearExpiredBuckets(currentTime) {
    for (const [identity, timestamps] of requestLogByIdentity.entries()) {
      const activeTimestamps = timestamps.filter(
        (timestamp) => currentTime - timestamp < windowMs
      );

      if (activeTimestamps.length > 0) {
        requestLogByIdentity.set(identity, activeTimestamps);
      } else {
        requestLogByIdentity.delete(identity);
      }
    }
  }

  return function tripGenerationRateLimit(req, res, next) {
    const currentTime = now();
    clearExpiredBuckets(currentTime);

    const identity = getIdentity(req);
    const timestamps = requestLogByIdentity.get(identity) ?? [];
    const activeTimestamps = timestamps.filter(
      (timestamp) => currentTime - timestamp < windowMs
    );

    if (activeTimestamps.length >= maxRequests) {
      const oldestTimestamp = activeTimestamps[0];
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowMs - (currentTime - oldestTimestamp)) / 1_000)
      );

      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.setHeader("X-RateLimit-Limit", String(maxRequests));
      res.setHeader("X-RateLimit-Remaining", "0");

      console.warn("[rate-limit] Trip generation throttled", {
        identity,
        maxRequests,
        windowMs,
      });

      res.status(429).json({
        message:
          "Too many trip generation requests. Please wait a moment and try again.",
      });
      return;
    }

    const nextTimestamps = [...activeTimestamps, currentTime];
    requestLogByIdentity.set(identity, nextTimestamps);
    res.setHeader("X-RateLimit-Limit", String(maxRequests));
    res.setHeader(
      "X-RateLimit-Remaining",
      String(Math.max(0, maxRequests - nextTimestamps.length))
    );
    next();
  };
}

export const tripGenerationRateLimit = createTripGenerationRateLimiter();
