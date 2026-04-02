import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const routeOptimizerPath = path.resolve(currentDirPath, "../../route_optimizer.py");
const transportProcessorPath = path.resolve(
  currentDirPath,
  "../../transport_data_processor.py"
);

function runPythonJson(scriptPath, payload) {
  const result = spawnSync("python3", [scriptPath], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error(
      `Python script failed (${scriptPath}): ${result.stderr || "unknown error"}`
    );
  }

  try {
    return JSON.parse(result.stdout || "{}");
  } catch (error) {
    throw new Error(
      `Failed to parse Python JSON output (${scriptPath}): ${
        error instanceof Error ? error.message : String(error)
      }\nstdout=${result.stdout}`
    );
  }
}

test("transport_data_processor.py normalizes routes and quarantines invalid rows", () => {
  const payload = runPythonJson(transportProcessorPath, {
    cityRows: [
      {
        city_id: "city--delhi",
        canonical_name: "Delhi",
        state_ut_name: "Delhi",
      },
      {
        city_id: "city--jaipur",
        canonical_name: "Jaipur",
        state_ut_name: "Rajasthan",
      },
    ],
    routeRows: [
      {
        route_id: "route-a",
        source_city_id: "city--delhi",
        destination_city_id: "city--jaipur",
        mode: "flight",
        duration_minutes: 70,
        source_quality: "high",
      },
      {
        route_id: "route-b",
        source_city_id: "city--delhi",
        destination_city_id: "city--jaipur",
        mode: "flight",
        duration_minutes: 90,
        source_quality: "medium",
      },
      {
        route_id: "route-c",
        source_city_id: "city--jaipur",
        destination_city_id: "city--jaipur",
        mode: "road",
        duration_minutes: 40,
      },
      {
        route_id: "route-d",
        source_city_id: "city--delhi",
        destination_city_id: "city--jaipur",
        mode: "road",
        duration_minutes: 0,
      },
    ],
    hubRows: [
      {
        destination_id: "rajasthan--jaipur",
        city_id: "city--jaipur",
        hub_rank: 1,
      },
    ],
  });

  assert.equal(payload.metrics.city_count, 2);
  assert.equal(payload.metrics.route_count, 1);
  assert.equal(payload.metrics.quarantined_route_count >= 2, true);
  assert.equal(payload.routes[0].duration_minutes, 70);
  assert.equal(payload.routes[0].source_quality, "high");
});

test("route_optimizer.py finds fastest feasible multimodal path", () => {
  const payload = runPythonJson(routeOptimizerPath, {
    mode: "multimodal",
    objective: "fastest_feasible",
    originCityId: "city--delhi",
    destinationCityIds: ["city--varanasi"],
    maxTransfers: 3,
    topK: 3,
    cities: [
      { city_id: "city--delhi", canonical_name: "Delhi" },
      { city_id: "city--jaipur", canonical_name: "Jaipur" },
      { city_id: "city--varanasi", canonical_name: "Varanasi" },
    ],
    routes: [
      {
        route_id: "r1",
        source_city_id: "city--delhi",
        destination_city_id: "city--jaipur",
        mode: "train",
        submode: "superfast",
        duration_minutes: 100,
        availability_status: "yes",
        source_quality: "high",
      },
      {
        route_id: "r2",
        source_city_id: "city--jaipur",
        destination_city_id: "city--varanasi",
        mode: "road",
        submode: "road_intercity",
        duration_minutes: 70,
        availability_status: "yes",
        source_quality: "medium",
      },
      {
        route_id: "r3",
        source_city_id: "city--delhi",
        destination_city_id: "city--varanasi",
        mode: "flight",
        submode: "flight_standard",
        duration_minutes: 220,
        availability_status: "yes",
        source_quality: "high",
      },
    ],
    destinationHubs: [
      {
        destination_id: "uttar-pradesh--varanasi",
        city_id: "city--varanasi",
        hub_rank: 1,
        access_distance_km: 5,
        access_duration_minutes: 20,
        matching_method: "exact_city",
      },
    ],
  });

  assert.equal(payload.algorithm, "python-multimodal-dijkstra-v2");
  assert.equal(payload.transportOptions.length > 0, true);
  assert.equal(payload.transportOptions[0].total_duration_minutes, 170);
  assert.deepEqual(payload.transportOptions[0].mode_mix, ["train", "road"]);
  assert.equal(payload.transportOptions[0].last_mile?.matching_method, "exact_city");
});

test("route_optimizer.py respects preferred mode filtering when feasible", () => {
  const payload = runPythonJson(routeOptimizerPath, {
    mode: "multimodal",
    originCityId: "city--delhi",
    destinationCityIds: ["city--varanasi"],
    preferredModes: ["flight"],
    cities: [
      { city_id: "city--delhi", canonical_name: "Delhi" },
      { city_id: "city--jaipur", canonical_name: "Jaipur" },
      { city_id: "city--varanasi", canonical_name: "Varanasi" },
    ],
    routes: [
      {
        route_id: "r1",
        source_city_id: "city--delhi",
        destination_city_id: "city--jaipur",
        mode: "train",
        submode: "superfast",
        duration_minutes: 100,
        availability_status: "yes",
        source_quality: "high",
      },
      {
        route_id: "r2",
        source_city_id: "city--jaipur",
        destination_city_id: "city--varanasi",
        mode: "road",
        submode: "road_intercity",
        duration_minutes: 70,
        availability_status: "yes",
        source_quality: "medium",
      },
      {
        route_id: "r3",
        source_city_id: "city--delhi",
        destination_city_id: "city--varanasi",
        mode: "flight",
        submode: "flight_standard",
        duration_minutes: 220,
        availability_status: "yes",
        source_quality: "high",
      },
    ],
    destinationHubs: [
      {
        destination_id: "uttar-pradesh--varanasi",
        city_id: "city--varanasi",
        hub_rank: 1,
      },
    ],
  });

  assert.equal(payload.transportOptions.length > 0, true);
  assert.equal(payload.transportOptions[0].mode_mix[0], "flight");
  assert.equal(payload.transportOptions[0].total_duration_minutes, 220);
});
