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

export function createAdaptiveApiRateLimiter(options = {}) {
  const name = String(options.name ?? "adaptive-api");
  const windowMs = parsePositiveInteger(
    options.windowMs ?? process.env.ADAPTIVE_RATE_LIMIT_WINDOW_MS,
    60_000
  );
  const maxRequests = parsePositiveInteger(
    options.maxRequests ?? process.env.ADAPTIVE_RATE_LIMIT_MAX,
    8
  );
  const maxPenalty = parsePositiveInteger(
    options.maxPenalty ?? process.env.ADAPTIVE_RATE_LIMIT_MAX_PENALTY,
    4
  );
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const stateByIdentity = new Map();

  function getState(identity) {
    const existing = stateByIdentity.get(identity);
    if (existing) {
      return existing;
    }

    const nextState = {
      timestamps: [],
      violations: 0,
      blockedUntil: 0,
    };
    stateByIdentity.set(identity, nextState);
    return nextState;
  }

  return function adaptiveRateLimit(req, res, next) {
    const currentTime = now();
    const identity = getIdentity(req);
    const state = getState(identity);

    state.timestamps = state.timestamps.filter(
      (timestamp) => currentTime - timestamp < windowMs
    );

    if (state.blockedUntil > currentTime) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((state.blockedUntil - currentTime) / 1_000)
      );

      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.setHeader("X-RateLimit-Limit", String(Math.max(1, maxRequests - state.violations)));
      res.setHeader("X-RateLimit-Remaining", "0");
      res.status(429).json({
        message:
          "Too many requests for this action. Please wait briefly and try again.",
      });
      return;
    }

    const penalty = Math.min(state.violations, maxPenalty);
    const effectiveLimit = Math.max(1, maxRequests - penalty);

    if (state.timestamps.length >= effectiveLimit) {
      state.violations += 1;
      state.blockedUntil = currentTime + Math.min(windowMs, state.violations * 1_000);
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((state.blockedUntil - currentTime) / 1_000)
      );

      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.setHeader("X-RateLimit-Limit", String(effectiveLimit));
      res.setHeader("X-RateLimit-Remaining", "0");

      console.warn("[rate-limit] Adaptive limiter throttled request", {
        name,
        identity,
        violations: state.violations,
        effectiveLimit,
      });

      res.status(429).json({
        message:
          "Too many requests for this action. Please wait briefly and try again.",
      });
      return;
    }

    state.timestamps.push(currentTime);
    if (state.violations > 0 && state.timestamps.length <= Math.ceil(effectiveLimit / 2)) {
      state.violations = Math.max(0, state.violations - 1);
    }

    res.setHeader("X-RateLimit-Limit", String(effectiveLimit));
    res.setHeader(
      "X-RateLimit-Remaining",
      String(Math.max(0, effectiveLimit - state.timestamps.length))
    );
    next();
  };
}

export const replanRateLimit = createAdaptiveApiRateLimiter({
  name: "replan",
  windowMs: parsePositiveInteger(
    process.env.REPLAN_RATE_LIMIT_WINDOW_MS,
    60_000
  ),
  maxRequests: parsePositiveInteger(
    process.env.REPLAN_RATE_LIMIT_MAX,
    6
  ),
});
