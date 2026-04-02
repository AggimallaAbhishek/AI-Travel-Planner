import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import app from "../server/app.js";
import {
  clearIndiaDataCache,
  getIndiaDestinationDetail,
  getIndiaDataDiagnostics,
  getIndiaTransportOptions,
  loadIndiaDataSnapshot,
  searchIndiaDestinations,
} from "../server/services/indiaData.js";

const fixturePayloadByFile = {
  "india_destinations.json": [
    {
      destination_id: "rajasthan--jaipur",
      state_ut_name: "Rajasthan",
      state_ut_slug: "rajasthan",
      destination_name: "Jaipur",
      destination_slug: "jaipur",
      destination_type: "city",
      country_code: "IN",
      latitude: 26.9124,
      longitude: 75.7873,
      description: "Jaipur is a heritage-rich capital city in Rajasthan.",
      tags: ["heritage", "fort", "markets"],
      image_url: "https://example.com/jaipur.jpg",
      official_url: "https://example.com/jaipur",
      content_source: "fixture",
      geo_source: "fixture",
      source_confidence: "high",
      last_synced_at: "2026-04-02T00:00:00Z",
    },
    {
      destination_id: "uttar-pradesh--agra",
      state_ut_name: "Uttar Pradesh",
      state_ut_slug: "uttar-pradesh",
      destination_name: "Agra",
      destination_slug: "agra",
      destination_type: "city",
      country_code: "IN",
      latitude: 27.1767,
      longitude: 78.0081,
      description: "Agra anchors the Taj Mahal circuit.",
      tags: ["heritage", "taj mahal"],
      image_url: "https://example.com/agra.jpg",
      official_url: "https://example.com/agra",
      content_source: "fixture",
      geo_source: "fixture",
      source_confidence: "high",
      last_synced_at: "2026-04-02T00:00:00Z",
    },
    {
      destination_id: "uttar-pradesh--varanasi",
      state_ut_name: "Uttar Pradesh",
      state_ut_slug: "uttar-pradesh",
      destination_name: "Varanasi",
      destination_slug: "varanasi",
      destination_type: "city",
      country_code: "IN",
      latitude: 25.3176,
      longitude: 82.9739,
      description: "Varanasi is one of India’s strongest spiritual destinations.",
      tags: ["spiritual", "ghats"],
      image_url: "https://example.com/varanasi.jpg",
      official_url: "https://example.com/varanasi",
      content_source: "fixture",
      geo_source: "fixture",
      source_confidence: "high",
      last_synced_at: "2026-04-02T00:00:00Z",
    },
    {
      destination_id: "karnataka--somnathpura",
      state_ut_name: "Karnataka",
      state_ut_slug: "karnataka",
      destination_name: "Somnathpura",
      destination_slug: "somnathpura",
      destination_type: "city",
      country_code: "IN",
      latitude: 12.2769,
      longitude: 76.8619,
      description: "Somnathpura is known for the Chennakesava Temple complex.",
      tags: ["heritage", "temple"],
      image_url: "https://example.com/somnathpura.jpg",
      official_url: "https://example.com/somnathpura",
      content_source: "fixture",
      geo_source: "fixture",
      source_confidence: "high",
      last_synced_at: "2026-04-02T00:00:00Z",
    },
  ],
  "india_attractions.json": [
    {
      attraction_id: "rajasthan--jaipur--hawa-mahal",
      destination_id: "rajasthan--jaipur",
      attraction_name: "Hawa Mahal",
      category: "palace",
      latitude: 26.9239,
      longitude: 75.8267,
      summary: "Iconic Jaipur facade and palace complex.",
      source_url: "https://example.com/hawa-mahal",
      source_type: "fixture",
      rank_within_destination: 1,
      source_confidence: "high",
    },
    {
      attraction_id: "rajasthan--jaipur--amer-fort",
      destination_id: "rajasthan--jaipur",
      attraction_name: "Amer Fort",
      category: "fort",
      latitude: 26.9855,
      longitude: 75.8513,
      summary: "Hilltop fort complex near Jaipur.",
      source_url: "https://example.com/amer-fort",
      source_type: "fixture",
      rank_within_destination: 2,
      source_confidence: "high",
    },
    {
      attraction_id: "uttar-pradesh--agra--taj-mahal",
      destination_id: "uttar-pradesh--agra",
      attraction_name: "Taj Mahal",
      category: "heritage",
      latitude: 27.1751,
      longitude: 78.0421,
      summary: "UNESCO World Heritage mausoleum.",
      source_url: "https://example.com/taj-mahal",
      source_type: "fixture",
      rank_within_destination: 1,
      source_confidence: "high",
    },
  ],
  "india_transport_cities.json": [
    {
      city_id: "city--delhi",
      canonical_name: "Delhi",
      state_ut_name: "Delhi",
      latitude: 28.6139,
      longitude: 77.209,
      aliases: ["New Delhi", "Delhi NCR"],
      has_flight: true,
      has_train: true,
      has_road: true,
    },
    {
      city_id: "city--jaipur",
      canonical_name: "Jaipur",
      state_ut_name: "Rajasthan",
      latitude: 26.9124,
      longitude: 75.7873,
      aliases: ["Pink City"],
      has_flight: true,
      has_train: true,
      has_road: true,
    },
    {
      city_id: "city--agra",
      canonical_name: "Agra",
      state_ut_name: "Uttar Pradesh",
      latitude: 27.1767,
      longitude: 78.0081,
      aliases: [],
      has_flight: false,
      has_train: true,
      has_road: true,
    },
    {
      city_id: "city--varanasi",
      canonical_name: "Varanasi",
      state_ut_name: "Uttar Pradesh",
      latitude: 25.3176,
      longitude: 82.9739,
      aliases: ["Banaras"],
      has_flight: false,
      has_train: true,
      has_road: true,
    },
  ],
  "india_transport_routes.json": [
    {
      route_id: "route--delhi-jaipur-flight",
      source_city_id: "city--delhi",
      destination_city_id: "city--jaipur",
      mode: "flight",
      submode: "flight_standard",
      distance_km: 241,
      duration_minutes: 65,
      availability_status: "yes",
      cost_general: null,
      cost_sleeper: null,
      cost_ac3: null,
      cost_ac2: null,
      cost_ac1: null,
      cost_is_estimated: false,
      source_dataset: "fixture_flight",
      source_quality: "high",
      raw_route_key: "delhi->jaipur",
    },
    {
      route_id: "route--delhi-jaipur-train",
      source_city_id: "city--delhi",
      destination_city_id: "city--jaipur",
      mode: "train",
      submode: "superfast",
      distance_km: 308,
      duration_minutes: 270,
      availability_status: "unknown",
      cost_general: 220,
      cost_sleeper: 345,
      cost_ac3: 780,
      cost_ac2: 1120,
      cost_ac1: 1850,
      cost_is_estimated: false,
      source_dataset: "fixture_train",
      source_quality: "high",
      raw_route_key: "delhi->jaipur",
    },
    {
      route_id: "route--delhi-jaipur-road",
      source_city_id: "city--delhi",
      destination_city_id: "city--jaipur",
      mode: "road",
      submode: "road_intercity",
      distance_km: 281,
      duration_minutes: 330,
      availability_status: "unknown",
      cost_general: null,
      cost_sleeper: null,
      cost_ac3: null,
      cost_ac2: null,
      cost_ac1: null,
      cost_is_estimated: false,
      source_dataset: "fixture_road",
      source_quality: "medium",
      raw_route_key: "delhi->jaipur",
    },
    {
      route_id: "route--delhi-agra-train",
      source_city_id: "city--delhi",
      destination_city_id: "city--agra",
      mode: "train",
      submode: "express",
      distance_km: 233,
      duration_minutes: 125,
      availability_status: "unknown",
      cost_general: 180,
      cost_sleeper: 250,
      cost_ac3: 640,
      cost_ac2: 920,
      cost_ac1: 1480,
      cost_is_estimated: false,
      source_dataset: "fixture_train",
      source_quality: "high",
      raw_route_key: "delhi->agra",
    },
  ],
  "india_destination_hubs.json": [
    {
      destination_id: "rajasthan--jaipur",
      city_id: "city--jaipur",
      hub_rank: 1,
      access_distance_km: 4,
      access_duration_minutes: 18,
      matching_method: "exact_city",
    },
    {
      destination_id: "uttar-pradesh--agra",
      city_id: "city--agra",
      hub_rank: 1,
      access_distance_km: 3,
      access_duration_minutes: 15,
      matching_method: "exact_city",
    },
    {
      destination_id: "uttar-pradesh--varanasi",
      city_id: "city--varanasi",
      hub_rank: 1,
      access_distance_km: 5,
      access_duration_minutes: 20,
      matching_method: "exact_city",
    },
  ],
};

let fixtureIndiaDataDirPath = "";
let previousIndiaDataDirPath = process.env.INDIA_DATA_DIR;

function toCsvCell(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function escapeCsvCell(value) {
  const normalized = toCsvCell(value);
  if (!normalized) {
    return "";
  }

  if (!/[",\n]/.test(normalized)) {
    return normalized;
  }

  return `"${normalized.replace(/"/g, "\"\"")}"`;
}

function toCsvPayload(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  const dataRows = rows.map((row) =>
    headers.map((header) => escapeCsvCell(row?.[header])).join(",")
  );

  return `${headers.join(",")}\n${dataRows.join("\n")}\n`;
}

function writeFixtureIndiaData(dataDirPath) {
  fs.mkdirSync(dataDirPath, { recursive: true });

  for (const [fileName, payload] of Object.entries(fixturePayloadByFile)) {
    const jsonPath = path.join(dataDirPath, fileName);
    fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    const csvPath = path.join(dataDirPath, fileName.replace(/\.json$/i, ".csv"));
    fs.writeFileSync(csvPath, toCsvPayload(payload), "utf8");
  }
}

function appendCsvRows(fileName, rows = []) {
  if (!fixtureIndiaDataDirPath) {
    return;
  }

  const csvPath = path.join(fixtureIndiaDataDirPath, fileName);
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, toCsvPayload(rows), "utf8");
    return;
  }

  const existingPayload = fs.readFileSync(csvPath, "utf8").trimEnd();
  const headers = (existingPayload.split(/\r?\n/)[0] ?? "").split(",");
  if (headers.length === 0 || rows.length === 0) {
    return;
  }

  const appendedRows = rows
    .map((row) => headers.map((header) => escapeCsvCell(row?.[header])).join(","))
    .join("\n");

  if (!appendedRows) {
    return;
  }

  fs.writeFileSync(csvPath, `${existingPayload}\n${appendedRows}\n`, "utf8");
}

function setupFixtureIndiaDataDir() {
  previousIndiaDataDirPath = process.env.INDIA_DATA_DIR;
  fixtureIndiaDataDirPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "india-data-test-")
  );
  process.env.INDIA_DATA_DIR = fixtureIndiaDataDirPath;
  writeFixtureIndiaData(fixtureIndiaDataDirPath);
  clearIndiaDataCache();
}

function cleanupFixtureIndiaDataDir() {
  clearIndiaDataCache();

  if (fixtureIndiaDataDirPath) {
    fs.rmSync(fixtureIndiaDataDirPath, { recursive: true, force: true });
    fixtureIndiaDataDirPath = "";
  }

  if (previousIndiaDataDirPath === undefined) {
    delete process.env.INDIA_DATA_DIR;
  } else {
    process.env.INDIA_DATA_DIR = previousIndiaDataDirPath;
  }
}

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

beforeEach(() => {
  setupFixtureIndiaDataDir();
});

afterEach(() => {
  cleanupFixtureIndiaDataDir();
});

after(() => {
  cleanupFixtureIndiaDataDir();
});

test("loadIndiaDataSnapshot loads indexed India data", () => {
  const snapshot = loadIndiaDataSnapshot();

  assert.equal(snapshot.destinations.length, 4);
  assert.equal(snapshot.transportCities.length, 4);
  assert.equal(snapshot.transportRoutes.length, 4);
  assert.equal(snapshot.destinationById.get("rajasthan--jaipur")?.destination_name, "Jaipur");
  assert.equal(snapshot.transportCityByLookupKey.get("new delhi")?.city_id, "city--delhi");
});

test("getIndiaDataDiagnostics reports warning when CSV parity diverges", () => {
  appendCsvRows("india_destinations.csv", [
    ...Array.from({ length: 60 }, (_unused, index) => ({
      destination_id: `extra-destination-${index + 1}`,
      state_ut_name: "Rajasthan",
      state_ut_slug: "rajasthan",
      destination_name: `Extra Destination ${index + 1}`,
      destination_slug: `extra-destination-${index + 1}`,
      destination_type: "city",
      country_code: "IN",
      latitude: 26.91,
      longitude: 75.78,
      description: "Diagnostics parity test row.",
      tags: "[]",
      image_url: "",
      official_url: "",
      content_source: "fixture",
      geo_source: "fixture",
      source_confidence: "high",
      last_synced_at: "2026-04-02T00:00:00Z",
    })),
  ]);
  clearIndiaDataCache();

  const diagnostics = getIndiaDataDiagnostics({ refresh: true });
  assert.equal(diagnostics.status, "warning");
  assert.equal(diagnostics.csvCounts.destinations > diagnostics.jsonCounts.destinations, true);
  assert.equal(
    diagnostics.parityWarnings.some((warning) =>
      warning.toLowerCase().includes("destinations")
    ),
    true
  );
});

test("searchIndiaDestinations ranks Jaipur for prefix matches", () => {
  const results = searchIndiaDestinations("jai", { limit: 5 });

  assert.equal(results.length > 0, true);
  assert.equal(results[0].destinationName, "Jaipur");
  assert.equal(results[0].source, "india_dataset");
  assert.equal(results[0].transportCoverage, "available");
});

test("getIndiaDestinationDetail returns attractions and hubs", () => {
  const detail = getIndiaDestinationDetail("rajasthan--jaipur");

  assert.equal(detail?.destination.destination_name, "Jaipur");
  assert.equal(detail?.attractions.length, 2);
  assert.equal(detail?.hubs.length, 1);
  assert.equal(detail?.hubs[0].city?.canonical_name, "Jaipur");
  assert.equal(detail?.transportCoverage, "available");
});

test("getIndiaDestinationDetail flags transportCoverage none when no hubs are available", () => {
  const detail = getIndiaDestinationDetail("karnataka--somnathpura");

  assert.equal(detail?.destination.destination_name, "Somnathpura");
  assert.equal(detail?.attractions.length, 0);
  assert.equal(detail?.hubs.length, 0);
  assert.equal(detail?.transportCoverage, "none");
});

test("getIndiaTransportOptions resolves origin aliases and returns multimodal options", async () => {
  const payload = await getIndiaTransportOptions({
    origin: "New Delhi",
    destination: "Jaipur",
  });

  assert.equal(payload.origin.city.canonical_name, "Delhi");
  assert.equal(payload.origin.matchedBy, "transport_city");
  assert.deepEqual(
    payload.options.map((option) => option.mode),
    ["flight", "train", "road"]
  );
  assert.equal(payload.options[0].destination_city, "Jaipur");
  assert.equal(payload.options[1].cost_ac3, 780);
  assert.equal(payload.options[0].last_mile?.matching_method, "exact_city");
  assert.equal(typeof payload.route_verification?.status, "string");
});

test("GET /api/india/destinations returns search results", async () => {
  const response = await invokeApp({
    method: "GET",
    url: "/api/india/destinations?q=jai",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.destinations.length > 0, true);
  assert.equal(response.body.destinations[0].destinationName, "Jaipur");
});

test("GET /api/india/destinations/:destinationId returns destination detail", async () => {
  const response = await invokeApp({
    method: "GET",
    url: "/api/india/destinations/rajasthan--jaipur",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.destination.destination_name, "Jaipur");
  assert.equal(response.body.hubs.length, 1);
});

test("GET /api/india/transport/options validates required query params", async () => {
  const response = await invokeApp({
    method: "GET",
    url: "/api/india/transport/options?origin=Delhi",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.message, "Both origin and destination are required.");
});

test("GET /api/india/transport/options returns structured no-route responses without 500", async () => {
  const response = await invokeApp({
    method: "GET",
    url: "/api/india/transport/options?origin=Delhi&destination=Varanasi",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.options, []);
  assert.equal(
    response.body.message,
    "No transport route was found for the selected origin and destination."
  );
});

test("GET /api/india/transport/options returns 404 for unknown destinations", async () => {
  const response = await invokeApp({
    method: "GET",
    url: "/api/india/transport/options?origin=Delhi&destination=Unknown",
  });

  assert.equal(response.statusCode, 404);
  assert.equal(
    response.body.message,
    "Destination was not found in the India tourism dataset."
  );
});
