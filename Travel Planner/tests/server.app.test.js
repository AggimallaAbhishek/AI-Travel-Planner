import test from "node:test";
import assert from "node:assert/strict";
import app from "../server/app.js";

function createMockRequest({ method = "GET", url = "/", headers = {} } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [String(name).toLowerCase(), value])
  );

  return {
    method,
    url,
    headers: normalizedHeaders,
    socket: { remoteAddress: "127.0.0.1" },
    connection: { remoteAddress: "127.0.0.1" },
    get(name) {
      return this.headers[String(name).toLowerCase()];
    },
  };
}

async function invokeApp({ method = "GET", url = "/", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const req = createMockRequest({ method, url, headers });
    const res = {
      statusCode: 200,
      headers: {},
      locals: {},
      setHeader(name, value) {
        this.headers[String(name).toLowerCase()] = value;
      },
      getHeader(name) {
        return this.headers[String(name).toLowerCase()];
      },
      removeHeader(name) {
        delete this.headers[String(name).toLowerCase()];
      },
      write(chunk) {
        if (chunk !== undefined) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
      },
      end(chunk) {
        this.write(chunk);
        const rawBody = Buffer.concat(chunks).toString("utf8");
        const contentType = String(this.getHeader("content-type") ?? "");

        let body = rawBody;
        if (contentType.includes("application/json") && rawBody) {
          try {
            body = JSON.parse(rawBody);
          } catch (error) {
            reject(error);
            return;
          }
        }

        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body,
        });
      },
    };

    try {
      app.handle(req, res, (error) => {
        if (error) {
          reject(error);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

test("GET /api/health returns ok", async () => {
  const response = await invokeApp({
    method: "GET",
    url: "/api/health",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { status: "ok" });
});

test("GET /api/my-trips requires authentication", async () => {
  const response = await invokeApp({
    method: "GET",
    url: "/api/my-trips",
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.message, "Authentication is required.");
});

test("GET /api/trips/:tripId/recommendations requires authentication", async () => {
  const response = await invokeApp({
    method: "GET",
    url: "/api/trips/sample-trip/recommendations",
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.message, "Authentication is required.");
});

test("GET /api/trips/:tripId/routes requires authentication", async () => {
  const response = await invokeApp({
    method: "GET",
    url: "/api/trips/sample-trip/routes?day=1",
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.message, "Authentication is required.");
});
