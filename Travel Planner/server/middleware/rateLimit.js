function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function isAdminRequest(req) {
  return Boolean(req?.authContext?.isAdmin || req?.user?.isAdmin);
}

function getIdentity(req) {
  if (req.user?.uid) {
    return `uid:${req.user.uid}`;
  }

  return `ip:${req.ip ?? "unknown"}`;
}

function applyRateLimitHeaders(res, { maxRequests, remaining }) {
  res.setHeader("X-RateLimit-Limit", String(maxRequests));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, remaining)));
}

function applyAdminBypassHeaders(res, { maxRequests }) {
  applyRateLimitHeaders(res, { maxRequests, remaining: maxRequests });
  res.setHeader("X-RateLimit-Bypass", "admin");
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
    if (isAdminRequest(req)) {
      applyAdminBypassHeaders(res, { maxRequests });
      console.info("[rate-limit] Admin bypass applied", {
        label: "trip-generation",
        uid: req?.user?.uid ?? "",
        path: req?.originalUrl ?? req?.path ?? "",
      });
      next();
      return;
    }

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
      applyRateLimitHeaders(res, { maxRequests, remaining: 0 });

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
    applyRateLimitHeaders(res, {
      maxRequests,
      remaining: maxRequests - nextTimestamps.length,
    });
    next();
  };
}

export const tripGenerationRateLimit = createTripGenerationRateLimiter();

export function createEndpointRateLimiter(options = {}) {
  const windowMs = parsePositiveInteger(options.windowMs, 60_000);
  const maxRequests = parsePositiveInteger(options.maxRequests, 30);
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const rateLimitMessage = String(
    options.message ??
      "Too many requests. Please wait a moment and try again."
  );
  const label = String(options.label ?? "endpoint");
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

  return function endpointRateLimit(req, res, next) {
    if (isAdminRequest(req)) {
      applyAdminBypassHeaders(res, { maxRequests });
      console.info("[rate-limit] Admin bypass applied", {
        label,
        uid: req?.user?.uid ?? "",
        path: req?.originalUrl ?? req?.path ?? "",
      });
      next();
      return;
    }

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
      applyRateLimitHeaders(res, { maxRequests, remaining: 0 });

      console.warn("[rate-limit] Endpoint throttled", {
        label,
        identity,
        maxRequests,
        windowMs,
      });

      res.status(429).json({
        message: rateLimitMessage,
      });
      return;
    }

    const nextTimestamps = [...activeTimestamps, currentTime];
    requestLogByIdentity.set(identity, nextTimestamps);
    applyRateLimitHeaders(res, {
      maxRequests,
      remaining: maxRequests - nextTimestamps.length,
    });
    next();
  };
}

export function createPlacesAutocompleteRateLimiter(options = {}) {
  return createEndpointRateLimiter({
    label: "places-autocomplete",
    windowMs:
      options.windowMs ?? process.env.PLACES_AUTOCOMPLETE_RATE_LIMIT_WINDOW_MS,
    maxRequests:
      options.maxRequests ?? process.env.PLACES_AUTOCOMPLETE_RATE_LIMIT_MAX,
    message:
      options.message ??
      "Too many autocomplete requests. Please try again shortly.",
    now: options.now,
  });
}

export const placesAutocompleteRateLimit = createPlacesAutocompleteRateLimiter();

export const recommendationsRateLimit = createEndpointRateLimiter({
  label: "destination-recommendations",
  windowMs: process.env.RECOMMENDATIONS_RATE_LIMIT_WINDOW_MS,
  maxRequests: process.env.RECOMMENDATIONS_RATE_LIMIT_MAX,
  message: "Too many recommendation requests. Please try again shortly.",
});

export const routeOptimizationRateLimit = createEndpointRateLimiter({
  label: "route-optimization",
  windowMs: process.env.ROUTE_OPTIMIZATION_RATE_LIMIT_WINDOW_MS,
  maxRequests: process.env.ROUTE_OPTIMIZATION_RATE_LIMIT_MAX,
  message: "Too many route optimization requests. Please try again shortly.",
});
