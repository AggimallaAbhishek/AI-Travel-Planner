import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  buildTransportDatasetFromSources,
  validateTransportDataset,
} from "../scripts/buildTransportDataset.mjs";
import { createTransportDatasetService } from "../server/services/transportDataset.js";

const SAMPLE_SCOPE = [
  {
    destinationKey: "tokyo__jp",
    destinationLabel: "Tokyo, Japan",
    locality: "Tokyo",
    countryCode: "JP",
    countryName: "Japan",
    cityBounds: {
      north: 35.76,
      south: 35.62,
      east: 139.86,
      west: 139.68,
    },
    center: {
      latitude: 35.6895,
      longitude: 139.6917,
    },
  },
];

const SAMPLE_OUR_AIRPORTS = `id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent,iso_country,iso_region,municipality,scheduled_service,gps_code,iata_code,local_code,home_link,wikipedia_link,keywords
1,RJTT,large_airport,Haneda Airport,35.552258,139.779694,35,AS,JP,JP-13,Tokyo,yes,RJTT,HND,,,,,
2,WSSS,large_airport,Singapore Changi Airport,1.35019,103.994003,22,AS,SG,SG-01,Singapore,yes,WSSS,SIN,,,,,
`;

const SAMPLE_OPENFLIGHTS_AIRPORTS = `"1","Haneda Airport","Tokyo","Japan","HND","RJTT","35.552258","139.779694","35","9","N","Asia/Tokyo","airport","OurAirports"
"2","Singapore Changi Airport","Singapore","Singapore","SIN","WSSS","1.35019","103.994003","22","8","N","Asia/Singapore","airport","OurAirports"
`;

const SAMPLE_OPENFLIGHTS_AIRLINES = `"24","Singapore Airlines","","SQ","SIA","SINGAPORE","Singapore","Y"`;
const SAMPLE_OPENFLIGHTS_ROUTES = `SQ,24,HND,1,SIN,2,,0,359`;

test("transport dataset builder keeps rail and metro separate and validates flight routes", () => {
  const dataset = buildTransportDatasetFromSources({
    scope: SAMPLE_SCOPE,
    ourAirportsCsvText: SAMPLE_OUR_AIRPORTS,
    openFlightsAirportsText: SAMPLE_OPENFLIGHTS_AIRPORTS,
    openFlightsAirlinesText: SAMPLE_OPENFLIGHTS_AIRLINES,
    openFlightsRoutesText: SAMPLE_OPENFLIGHTS_ROUTES,
    overpassElementsByDestinationKey: {
      tokyo__jp: [
        {
          type: "node",
          id: 1001,
          lat: 35.6812,
          lon: 139.7671,
          tags: {
            name: "Tokyo Station",
            railway: "station",
          },
        },
        {
          type: "node",
          id: 1002,
          lat: 35.658,
          lon: 139.7016,
          tags: {
            name: "Shibuya Station",
            station: "subway",
            railway: "station",
          },
        },
        {
          type: "node",
          id: 1003,
          lat: 35.6886,
          lon: 139.7006,
          tags: {
            name: "Busta Shinjuku",
            amenity: "bus_station",
          },
        },
      ],
    },
    generatedAt: "2026-04-01T15:00:00.000Z",
    logger: {
      info() {},
      warn() {},
    },
  });

  const validation = validateTransportDataset(dataset);
  const tokyo = dataset.destinations.tokyo__jp;

  assert.equal(validation.valid, true);
  assert.equal(tokyo.airports.length, 1);
  assert.equal(tokyo.flightRoutes.length, 1);
  assert.equal(tokyo.railStations.length, 1);
  assert.equal(tokyo.metroStations.length, 1);
  assert.equal(tokyo.busTerminals.length, 1);
  assert.equal(tokyo.railStations[0].transportType, "rail_station");
  assert.equal(tokyo.metroStations[0].transportType, "metro_station");
  assert.equal(Boolean(dataset.airportCatalog[tokyo.flightRoutes[0].originAirportId]), true);
  assert.equal(Boolean(dataset.airportCatalog[tokyo.flightRoutes[0].destinationAirportId]), true);
});

test("transport dataset loader resolves supported destinations and returns empty layers for misses", async () => {
  const dataset = buildTransportDatasetFromSources({
    scope: SAMPLE_SCOPE,
    ourAirportsCsvText: SAMPLE_OUR_AIRPORTS,
    openFlightsAirportsText: SAMPLE_OPENFLIGHTS_AIRPORTS,
    openFlightsAirlinesText: SAMPLE_OPENFLIGHTS_AIRLINES,
    openFlightsRoutesText: SAMPLE_OPENFLIGHTS_ROUTES,
    overpassElementsByDestinationKey: {},
    generatedAt: "2026-04-01T15:00:00.000Z",
    logger: {
      info() {},
      warn() {},
    },
  });
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "transport-dataset-"));
  const datasetFile = path.join(tempDir, "transport.json");

  await writeFile(datasetFile, JSON.stringify(dataset, null, 2), "utf8");

  try {
    const service = createTransportDatasetService({
      datasetFile,
    });

    const tokyo = await service.getDestinationTransport({
      destination: "Tokyo, Japan",
    });
    const missing = await service.getDestinationTransport({
      destination: "Atlantis",
    });

    assert.equal(tokyo.destination.destinationLabel, "Tokyo, Japan");
    assert.equal(tokyo.airports.length, 1);
    assert.equal(tokyo.flightRoutes.length, 1);
    assert.equal(Array.isArray(missing.airports), true);
    assert.equal(missing.airports.length, 0);
    assert.equal(missing.metroStations.length, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
