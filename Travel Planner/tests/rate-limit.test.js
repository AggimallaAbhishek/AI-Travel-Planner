import assert from "node:assert/strict";
import test from "node:test";
import {
  createEndpointRateLimiter,
  createPlacesAutocompleteRateLimiter,
  createTripGenerationRateLimiter,
} from "../server/middleware/rateLimit.js";

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function runLimiter(middleware, request, response) {
  let nextCalled = false;
  middleware(request, response, () => {
    nextCalled = true;
  });
  return nextCalled;
}

test("trip generation limiter blocks requests beyond configured threshold", () => {
  let currentTime = 0;
  const middleware = createTripGenerationRateLimiter({
    windowMs: 1_000,
    maxRequests: 2,
    now: () => currentTime,
  });
  const request = { user: { uid: "user-1" }, ip: "127.0.0.1" };

  const first = createMockResponse();
  assert.equal(runLimiter(middleware, request, first), true);
  assert.equal(first.headers["x-ratelimit-remaining"], "1");

  const second = createMockResponse();
  assert.equal(runLimiter(middleware, request, second), true);
  assert.equal(second.headers["x-ratelimit-remaining"], "0");

  const third = createMockResponse();
  assert.equal(runLimiter(middleware, request, third), false);
  assert.equal(third.statusCode, 429);
  assert.equal(
    third.body.message,
    "Too many trip generation requests. Please wait a moment and try again."
  );
  assert.equal(third.headers["retry-after"], "1");
});

test("trip generation limiter allows requests again after time window passes", () => {
  let currentTime = 0;
  const middleware = createTripGenerationRateLimiter({
    windowMs: 500,
    maxRequests: 1,
    now: () => currentTime,
  });
  const request = { user: { uid: "user-2" }, ip: "127.0.0.1" };

  const initial = createMockResponse();
  assert.equal(runLimiter(middleware, request, initial), true);

  const blocked = createMockResponse();
  assert.equal(runLimiter(middleware, request, blocked), false);
  assert.equal(blocked.statusCode, 429);

  currentTime = 800;

  const allowedAgain = createMockResponse();
  assert.equal(runLimiter(middleware, request, allowedAgain), true);
  assert.equal(allowedAgain.statusCode, 200);
});

test("endpoint limiter blocks requests beyond configured threshold", () => {
  let currentTime = 0;
  const middleware = createEndpointRateLimiter({
    windowMs: 1_000,
    maxRequests: 2,
    now: () => currentTime,
    label: "test-endpoint",
    message: "Too many endpoint requests.",
  });
  const request = { user: null, ip: "127.0.0.1" };

  const first = createMockResponse();
  assert.equal(runLimiter(middleware, request, first), true);
  assert.equal(first.headers["x-ratelimit-remaining"], "1");

  const second = createMockResponse();
  assert.equal(runLimiter(middleware, request, second), true);
  assert.equal(second.headers["x-ratelimit-remaining"], "0");

  const third = createMockResponse();
  assert.equal(runLimiter(middleware, request, third), false);
  assert.equal(third.statusCode, 429);
  assert.equal(third.body.message, "Too many endpoint requests.");
  assert.equal(third.headers["retry-after"], "1");
});

test("places autocomplete limiter uses env-backed defaults and message", () => {
  const originalWindowMs = process.env.PLACES_AUTOCOMPLETE_RATE_LIMIT_WINDOW_MS;
  const originalMax = process.env.PLACES_AUTOCOMPLETE_RATE_LIMIT_MAX;

  try {
    process.env.PLACES_AUTOCOMPLETE_RATE_LIMIT_WINDOW_MS = "1000";
    process.env.PLACES_AUTOCOMPLETE_RATE_LIMIT_MAX = "1";

    let currentTime = 0;
    const middleware = createPlacesAutocompleteRateLimiter({
      now: () => currentTime,
    });
    const request = { user: null, ip: "127.0.0.1" };

    const initial = createMockResponse();
    assert.equal(runLimiter(middleware, request, initial), true);
    assert.equal(initial.headers["x-ratelimit-limit"], "1");
    assert.equal(initial.headers["x-ratelimit-remaining"], "0");

    const blocked = createMockResponse();
    assert.equal(runLimiter(middleware, request, blocked), false);
    assert.equal(blocked.statusCode, 429);
    assert.equal(
      blocked.body.message,
      "Too many autocomplete requests. Please try again shortly."
    );
    assert.equal(blocked.headers["retry-after"], "1");
  } finally {
    if (originalWindowMs === undefined) {
      delete process.env.PLACES_AUTOCOMPLETE_RATE_LIMIT_WINDOW_MS;
    } else {
      process.env.PLACES_AUTOCOMPLETE_RATE_LIMIT_WINDOW_MS = originalWindowMs;
    }

    if (originalMax === undefined) {
      delete process.env.PLACES_AUTOCOMPLETE_RATE_LIMIT_MAX;
    } else {
      process.env.PLACES_AUTOCOMPLETE_RATE_LIMIT_MAX = originalMax;
    }
  }
});
