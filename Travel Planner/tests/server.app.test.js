import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import app from "../server/app.js";

async function withServer(t, runAssertion) {
  const server = http.createServer(app);

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("Sandbox does not allow binding a local HTTP port.");
      return;
    }

    throw error;
  }

  const { port } = server.address();

  try {
    await runAssertion(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}

test("GET /api/health returns ok", async (t) => {
  await withServer(t, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
  });
});

test("GET /api/my-trips requires authentication", async (t) => {
  await withServer(t, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/my-trips`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.message, "Authentication is required.");
  });
});

test("GET /api/trips/:tripId/recommendations requires authentication", async (t) => {
  await withServer(t, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/trips/demo-trip/recommendations`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.message, "Authentication is required.");
  });
});

test("GET /api/trips/:tripId/routes requires authentication", async (t) => {
  await withServer(t, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/trips/demo-trip/routes`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.message, "Authentication is required.");
  });
});

test("GET /api/trips/:tripId/alternatives requires authentication", async (t) => {
  await withServer(t, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/trips/demo-trip/alternatives`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.message, "Authentication is required.");
  });
});

test("POST /api/trips/:tripId/replan requires authentication", async (t) => {
  await withServer(t, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/trips/demo-trip/replan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        disruptions: [
          {
            type: "traffic_delay",
            dayNumber: 1,
            placeName: "Downtown Museum",
          },
        ],
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.message, "Authentication is required.");
  });
});
