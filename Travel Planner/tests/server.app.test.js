import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import app from "../server/app.js";

async function withServer(runAssertion) {
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address();

  try {
    await runAssertion(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}

test("GET /api/health returns ok", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
  });
});

test("GET /api/my-trips requires authentication", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/my-trips`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.message, "Authentication is required.");
  });
});

test("GET /api/trips/:tripId/recommendations requires authentication", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/trips/sample-trip/recommendations`
    );
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.message, "Authentication is required.");
  });
});
