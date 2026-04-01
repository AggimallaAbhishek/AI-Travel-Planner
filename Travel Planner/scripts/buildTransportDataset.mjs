import { gunzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGoogleMapsSearchUrl, normalizeGeoCoordinates } from "../shared/maps.js";
import {
  createTransportDestinationRecord,
  createTransportMapsUrl,
  TRANSPORT_DATASET_SCHEMA_VERSION,
} from "../shared/transportDataset.js";
import { normalizePoiKey } from "../shared/worldPoi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_TRANSPORT_OUT_FILE = path.resolve(
  __dirname,
  "../data/transport/transport.json"
);
const CITY_MAP_DIR = path.resolve(__dirname, "../data/city-maps");
const OUR_AIRPORTS_URL =
  "https://davidmegginson.github.io/ourairports-data/airports.csv";
const OPENFLIGHTS_AIRPORTS_URL =
  "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat";
const OPENFLIGHTS_AIRLINES_URL =
  "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat";
const OPENFLIGHTS_ROUTES_URL =
  "https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const AIRPORT_RADIUS_KM = 160;
const MAX_AIRPORTS_PER_DESTINATION = 8;
const MAX_RAIL_STATIONS_PER_DESTINATION = 18;
const MAX_METRO_STATIONS_PER_DESTINATION = 28;
const MAX_BUS_TERMINALS_PER_DESTINATION = 16;
const MAX_FLIGHT_ROUTES_PER_DESTINATION = 24;
const FETCH_TIMEOUT_MS = 20_000;
const OVERPASS_TIMEOUT_MS = 30_000;

const OPENFLIGHTS_AIRPORT_FIELDS = [
  "airportId",
  "name",
  "city",
  "country",
  "iata",
  "icao",
  "latitude",
  "longitude",
  "altitudeFeet",
  "utcOffset",
  "dst",
  "timezone",
  "type",
  "source",
];

const OPENFLIGHTS_AIRLINE_FIELDS = [
  "airlineId",
  "name",
  "alias",
  "iata",
  "icao",
  "callsign",
  "country",
  "active",
];

const OPENFLIGHTS_ROUTE_FIELDS = [
  "airlineCode",
  "airlineId",
  "originCode",
  "originAirportSourceId",
  "destinationCode",
  "destinationAirportSourceId",
  "codeshare",
  "stops",
  "equipmentCodes",
];

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function normalizeNumber(value, fallback = null) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeInteger(value, fallback = null) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function normalizeBounds(bounds = null) {
  if (!bounds || typeof bounds !== "object") {
    return null;
  }

  const north = normalizeNumber(bounds.north);
  const south = normalizeNumber(bounds.south);
  const east = normalizeNumber(bounds.east);
  const west = normalizeNumber(bounds.west);

  if (
    north === null ||
    south === null ||
    east === null ||
    west === null ||
    north < south ||
    east < west
  ) {
    return null;
  }

  return { north, south, east, west };
}

function getBoundsCenter(bounds = null) {
  const normalizedBounds = normalizeBounds(bounds);
  if (!normalizedBounds) {
    return { latitude: null, longitude: null };
  }

  return {
    latitude: Number(((normalizedBounds.north + normalizedBounds.south) / 2).toFixed(6)),
    longitude: Number(((normalizedBounds.east + normalizedBounds.west) / 2).toFixed(6)),
  };
}

function expandBounds(bounds = null, paddingRatio = 0.08) {
  const normalizedBounds = normalizeBounds(bounds);
  if (!normalizedBounds) {
    return null;
  }

  const latitudeSpan = Math.max(normalizedBounds.north - normalizedBounds.south, 0.04);
  const longitudeSpan = Math.max(normalizedBounds.east - normalizedBounds.west, 0.04);
  const latitudePadding = latitudeSpan * paddingRatio;
  const longitudePadding = longitudeSpan * paddingRatio;

  return {
    north: Number((normalizedBounds.north + latitudePadding).toFixed(6)),
    south: Number((normalizedBounds.south - latitudePadding).toFixed(6)),
    east: Number((normalizedBounds.east + longitudePadding).toFixed(6)),
    west: Number((normalizedBounds.west - longitudePadding).toFixed(6)),
  };
}

function isPointInsideBounds(point = {}, bounds = null) {
  const coordinates = normalizeGeoCoordinates(point);
  const normalizedBounds = normalizeBounds(bounds);

  return Boolean(
    normalizedBounds &&
      coordinates.latitude !== null &&
      coordinates.longitude !== null &&
      coordinates.latitude <= normalizedBounds.north &&
      coordinates.latitude >= normalizedBounds.south &&
      coordinates.longitude <= normalizedBounds.east &&
      coordinates.longitude >= normalizedBounds.west
  );
}

function haversineDistanceKm(left = {}, right = {}) {
  const leftPoint = normalizeGeoCoordinates(left);
  const rightPoint = normalizeGeoCoordinates(right);
  if (
    leftPoint.latitude === null ||
    leftPoint.longitude === null ||
    rightPoint.latitude === null ||
    rightPoint.longitude === null
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latitudeDelta = toRadians(rightPoint.latitude - leftPoint.latitude);
  const longitudeDelta = toRadians(rightPoint.longitude - leftPoint.longitude);
  const latitudeA = toRadians(leftPoint.latitude);
  const latitudeB = toRadians(rightPoint.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;

  return Number((2 * earthRadiusKm * Math.asin(Math.sqrt(haversine))).toFixed(3));
}

function parseDelimitedLine(line = "", delimiter = ",") {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === delimiter && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current);
  return values;
}

function parseCsvTable(text = "") {
  const rows = normalizeText(text)
    ? text.split(/\r?\n/).filter(Boolean)
    : [];

  if (rows.length === 0) {
    return [];
  }

  const headers = parseDelimitedLine(rows[0]).map((header) => normalizeText(header));
  return rows.slice(1).map((line) => {
    const values = parseDelimitedLine(line);
    return headers.reduce((record, header, index) => {
      record[header] = values[index] ?? "";
      return record;
    }, {});
  });
}

function parseDatTable(text = "", fields = []) {
  return (normalizeText(text) ? text.split(/\r?\n/) : [])
    .filter(Boolean)
    .map((line) => {
      const values = parseDelimitedLine(line);
      return fields.reduce((record, field, index) => {
        record[field] = values[index] ?? "";
        return record;
      }, {});
    });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readCompressedJson(filePath) {
  return JSON.parse(gunzipSync(await readFile(filePath)).toString("utf8"));
}

function buildDatasetVersion(timestamp = new Date().toISOString()) {
  const [year, month] = timestamp.slice(0, 10).split("-");
  return `${year}.${month}-transport-v1`;
}

async function loadSupportedDestinationScope() {
  const manifest = await readJson(path.join(CITY_MAP_DIR, "manifest.json"));
  const scope = [];

  for (const artifactMeta of manifest.artifactMap ?? []) {
    const artifact = await readCompressedJson(
      path.join(CITY_MAP_DIR, artifactMeta.artifactFile)
    );
    const cityBounds = normalizeBounds(
      artifact?.basemap?.cityBounds ?? artifact?.cityBounds ?? null
    );
    const center = normalizeGeoCoordinates(
      artifact?.basemap?.center ?? artifact?.center ?? getBoundsCenter(cityBounds)
    );

    scope.push({
      destinationKey: normalizeText(artifactMeta.destinationKey),
      destinationLabel: normalizeText(
        artifact?.destinationLabel,
        [artifactMeta.locality, artifactMeta.countryName].filter(Boolean).join(", ")
      ),
      locality: normalizeText(artifactMeta.locality),
      countryCode: normalizeText(artifactMeta.countryCode).toUpperCase(),
      countryName: normalizeText(artifactMeta.countryName),
      cityBounds,
      center,
    });
  }

  return scope;
}

async function fetchText(url, { fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "AI-Travel-Planner/transport-dataset-builder",
        accept: "text/plain, text/csv, application/json;q=0.9, */*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed with ${response.status} for ${url}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function buildOverpassQuery(bounds = null) {
  const expandedBounds = expandBounds(bounds);
  if (!expandedBounds) {
    return "";
  }

  const bbox = `${expandedBounds.south},${expandedBounds.west},${expandedBounds.north},${expandedBounds.east}`;
  return `
[out:json][timeout:25];
(
  node["railway"="station"](${bbox});
  way["railway"="station"](${bbox});
  relation["railway"="station"](${bbox});
  node["station"="subway"](${bbox});
  way["station"="subway"](${bbox});
  relation["station"="subway"](${bbox});
  node["subway"="yes"](${bbox});
  way["subway"="yes"](${bbox});
  relation["subway"="yes"](${bbox});
  node["amenity"="bus_station"](${bbox});
  way["amenity"="bus_station"](${bbox});
  relation["amenity"="bus_station"](${bbox});
  node["public_transport"="station"]["bus"="yes"](${bbox});
  way["public_transport"="station"]["bus"="yes"](${bbox});
  relation["public_transport"="station"]["bus"="yes"](${bbox});
);
out center tags;
  `.trim();
}

async function fetchOverpassTransportElements({
  bounds = null,
  fetchImpl = fetch,
  logger = console,
}) {
  const query = buildOverpassQuery(bounds);
  if (!query) {
    return [];
  }

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);

    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": "AI-Travel-Planner/transport-dataset-builder",
          accept: "application/json",
        },
        body: new URLSearchParams({ data: query }).toString(),
      });

      if (!response.ok) {
        throw new Error(`Overpass ${response.status}`);
      }

      const payload = await response.json();
      return Array.isArray(payload?.elements) ? payload.elements : [];
    } catch (error) {
      logger.warn("[transport-dataset] Overpass request failed", {
        endpoint,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  return [];
}

function createAirportId({
  iata = "",
  icao = "",
  ident = "",
  sourceId = "",
} = {}) {
  const candidate = normalizeText(iata) || normalizeText(icao) || normalizeText(ident) || normalizeText(sourceId);
  return `airport_${normalizePoiKey(candidate || "unknown").replace(/\s+/g, "_")}`;
}

function createRouteId({
  originAirportId = "",
  destinationAirportId = "",
  airlineCode = "",
  equipmentCodes = "",
} = {}) {
  return `route_${[
    normalizePoiKey(originAirportId),
    normalizePoiKey(destinationAirportId),
    normalizePoiKey(airlineCode || "direct"),
    normalizePoiKey(equipmentCodes || "na"),
  ]
    .filter(Boolean)
    .join("_")}`;
}

function buildCountryNameByCode(scope = []) {
  return (Array.isArray(scope) ? scope : []).reduce((map, entry) => {
    const countryCode = normalizeText(entry?.countryCode).toUpperCase();
    const countryName = normalizeText(entry?.countryName);
    if (countryCode && countryName && !map.has(countryCode)) {
      map.set(countryCode, countryName);
    }
    return map;
  }, new Map());
}

function createAirportRecord(input = {}) {
  const coordinates = normalizeGeoCoordinates(input.coordinates);
  const locality = normalizeText(input.locality);
  const countryCode = normalizeText(input.countryCode).toUpperCase();
  const countryName = normalizeText(input.countryName);
  const name = normalizeText(input.name);
  const id = normalizeText(
    input.id,
    createAirportId({
      iata: input.iata,
      icao: input.icao,
      ident: input.ident,
      sourceId: input.sourceId,
    })
  );

  return {
    id,
    name,
    transportType: "airport",
    coordinates,
    locality,
    countryCode,
    countryName,
    address: normalizeText(input.address, [locality, countryName].filter(Boolean).join(", ")),
    mapsUrl: createTransportMapsUrl({
      name,
      locality,
      countryName,
      coordinates,
    }),
    provider: normalizeText(input.provider, "unknown"),
    iata: normalizeText(input.iata),
    icao: normalizeText(input.icao),
    ident: normalizeText(input.ident),
    airportType: normalizeText(input.airportType),
    scheduledService: normalizeText(input.scheduledService),
  };
}

function pruneAirportRecord(record = {}) {
  const {
    _distanceKm,
    ident,
    airportType,
    scheduledService,
    ...rest
  } = record;

  return {
    ...rest,
    ...(record.iata ? { iata: record.iata } : {}),
    ...(record.icao ? { icao: record.icao } : {}),
    ...(airportType ? { airportType } : {}),
    ...(scheduledService ? { scheduledService } : {}),
  };
}

function buildAirportCatalog({
  ourAirportsRows = [],
  openFlightsAirports = [],
  scope = [],
}) {
  const catalog = new Map();
  const byIata = new Map();
  const byIcao = new Map();
  const byOpenFlightsId = new Map();
  const countryNameByCode = buildCountryNameByCode(scope);
  const openFlightsByIata = new Map();
  const openFlightsByIcao = new Map();

  for (const airport of openFlightsAirports) {
    const iata = normalizeText(airport.iata);
    const icao = normalizeText(airport.icao);
    if (iata && iata !== "\\N") {
      openFlightsByIata.set(iata, airport);
    }
    if (icao && icao !== "\\N") {
      openFlightsByIcao.set(icao, airport);
    }
  }

  for (const row of ourAirportsRows) {
    const airportType = normalizeText(row.type);
    if (!airportType.endsWith("_airport")) {
      continue;
    }

    const coordinates = {
      latitude: normalizeNumber(row.latitude_deg),
      longitude: normalizeNumber(row.longitude_deg),
    };
    if (coordinates.latitude === null || coordinates.longitude === null) {
      continue;
    }

    const iata = normalizeText(row.iata_code);
    const icao = normalizeText(row.gps_code || row.ident);
    const openFlightsMatch = openFlightsByIata.get(iata) ?? openFlightsByIcao.get(icao) ?? null;
    const record = createAirportRecord({
      id: createAirportId({
        iata,
        icao,
        ident: row.ident,
        sourceId: row.id,
      }),
      name: row.name,
      coordinates,
      locality: row.municipality || openFlightsMatch?.city,
      countryCode: row.iso_country,
      countryName:
        openFlightsMatch?.country ||
        countryNameByCode.get(normalizeText(row.iso_country).toUpperCase()) ||
        "",
      provider: "ourairports",
      iata,
      icao,
      ident: row.ident,
      sourceId: row.id,
      airportType,
      scheduledService: row.scheduled_service,
    });

    catalog.set(record.id, record);
    if (record.iata) {
      byIata.set(record.iata, record);
    }
    if (record.icao) {
      byIcao.set(record.icao, record);
    }
  }

  for (const airport of openFlightsAirports) {
    const iata = normalizeText(airport.iata);
    const icao = normalizeText(airport.icao);
    const existing =
      (iata && byIata.get(iata)) ||
      (icao && byIcao.get(icao)) ||
      null;
    const record =
      existing ??
      createAirportRecord({
        id: createAirportId({
          iata,
          icao,
          sourceId: airport.airportId,
        }),
        name: airport.name,
        coordinates: {
          latitude: normalizeNumber(airport.latitude),
          longitude: normalizeNumber(airport.longitude),
        },
        locality: airport.city,
        countryName: airport.country,
        provider: "openflights",
        iata,
        icao,
        sourceId: airport.airportId,
      });

    if (!catalog.has(record.id)) {
      catalog.set(record.id, record);
    }
    if (record.iata) {
      byIata.set(record.iata, record);
    }
    if (record.icao) {
      byIcao.set(record.icao, record);
    }
    byOpenFlightsId.set(normalizeText(airport.airportId), record);
  }

  return { catalog, byIata, byIcao, byOpenFlightsId };
}

function resolveAirportRecord({ code = "", sourceId = "" } = {}, airportIndex = {}) {
  const normalizedCode = normalizeText(code);
  if (normalizedCode && normalizedCode !== "\\N") {
    return (
      airportIndex.byIata?.get(normalizedCode) ??
      airportIndex.byIcao?.get(normalizedCode) ??
      null
    );
  }

  const normalizedSourceId = normalizeText(sourceId);
  if (normalizedSourceId && normalizedSourceId !== "\\N") {
    return airportIndex.byOpenFlightsId?.get(normalizedSourceId) ?? null;
  }

  return null;
}

function parseEquipmentCodes(value = "") {
  return normalizeText(value)
    .split(/\s+/)
    .map((code) => normalizeText(code))
    .filter(Boolean)
    .slice(0, 8);
}

function buildAirlineIndex(rows = []) {
  const airlinesById = new Map();
  const airlinesByCode = new Map();

  for (const airline of rows) {
    const normalizedId = normalizeText(airline.airlineId);
    const normalizedIata = normalizeText(airline.iata);
    const normalizedIcao = normalizeText(airline.icao);
    const normalizedAirline = {
      name: normalizeText(airline.name),
      iata: normalizedIata && normalizedIata !== "\\N" ? normalizedIata : "",
      icao: normalizedIcao && normalizedIcao !== "\\N" ? normalizedIcao : "",
    };

    if (normalizedId && normalizedId !== "\\N") {
      airlinesById.set(normalizedId, normalizedAirline);
    }
    if (normalizedAirline.iata) {
      airlinesByCode.set(normalizedAirline.iata, normalizedAirline);
    }
    if (normalizedAirline.icao) {
      airlinesByCode.set(normalizedAirline.icao, normalizedAirline);
    }
  }

  return { airlinesById, airlinesByCode };
}

function buildAddressFromTags(tags = {}, fallbackLocality = "", fallbackCountryName = "") {
  const parts = [
    normalizeText(tags["addr:housenumber"]),
    normalizeText(tags["addr:street"]),
    normalizeText(tags["addr:suburb"]),
    normalizeText(tags["addr:city"], fallbackLocality),
    normalizeText(tags["addr:country"], fallbackCountryName),
  ].filter(Boolean);

  return parts.join(", ");
}

function classifyOsmTransportLayer(tags = {}) {
  const amenity = normalizeText(tags.amenity).toLowerCase();
  const railway = normalizeText(tags.railway).toLowerCase();
  const station = normalizeText(tags.station).toLowerCase();
  const subway = normalizeText(tags.subway).toLowerCase();
  const publicTransport = normalizeText(tags.public_transport).toLowerCase();
  const network = normalizeText(tags.network).toLowerCase();
  const bus = normalizeText(tags.bus).toLowerCase();

  if (
    amenity === "bus_station" ||
    bus === "yes" ||
    publicTransport === "station" && bus === "yes"
  ) {
    return "busTerminals";
  }

  if (
    station === "subway" ||
    subway === "yes" ||
    network.includes("metro") ||
    network.includes("subway")
  ) {
    return "metroStations";
  }

  if (railway === "station" || (publicTransport === "station" && normalizeText(tags.train).toLowerCase() === "yes")) {
    return "railStations";
  }

  return "";
}

function normalizeOsmNode(element = {}, destination = {}) {
  const tags = element.tags ?? {};
  const layerKey = classifyOsmTransportLayer(tags);
  if (!layerKey) {
    return null;
  }

  const coordinates = normalizeGeoCoordinates({
    latitude: element.lat ?? element.center?.lat,
    longitude: element.lon ?? element.center?.lon,
  });
  if (coordinates.latitude === null || coordinates.longitude === null) {
    return null;
  }

  const name = normalizeText(tags.name || tags.ref || tags.official_name);
  if (!name) {
    return null;
  }

  const transportTypeMap = {
    railStations: "rail_station",
    metroStations: "metro_station",
    busTerminals: "bus_terminal",
  };

  return {
    layerKey,
    record: {
      id: `osm_${normalizeText(element.type)}_${normalizeText(String(element.id))}`,
      name,
      transportType: transportTypeMap[layerKey],
      coordinates,
      locality: normalizeText(tags["addr:city"], destination.locality),
      countryCode: normalizeText(destination.countryCode),
      countryName: normalizeText(tags["addr:country"], destination.countryName),
      address: buildAddressFromTags(tags, destination.locality, destination.countryName),
      mapsUrl: buildGoogleMapsSearchUrl({
        name,
        location: [destination.locality, destination.countryName].filter(Boolean).join(", "),
        coordinates,
      }),
      provider: "openstreetmap-overpass",
      operator: normalizeText(tags.operator),
      network: normalizeText(tags.network || tags.networks),
      _distanceKm: haversineDistanceKm(coordinates, destination.center),
    },
  };
}

function dedupeTransportNodes(records = []) {
  const deduped = [];
  const seen = new Set();

  for (const record of records) {
    const key = [
      normalizeText(record.name).toLowerCase(),
      normalizeText(record.transportType).toLowerCase(),
      record.coordinates?.latitude ?? "",
      record.coordinates?.longitude ?? "",
    ].join("::");

    if (!record.name || seen.has(key)) {
      continue;
    }

    deduped.push(record);
    seen.add(key);
  }

  return deduped;
}

function buildOsmTransportLayers({
  elements = [],
  destination = {},
}) {
  const grouped = {
    railStations: [],
    metroStations: [],
    busTerminals: [],
  };
  const clipBounds = expandBounds(destination.cityBounds, 0.06);

  for (const element of Array.isArray(elements) ? elements : []) {
    const normalized = normalizeOsmNode(element, destination);
    if (!normalized) {
      continue;
    }

    if (!isPointInsideBounds(normalized.record.coordinates, clipBounds)) {
      continue;
    }

    grouped[normalized.layerKey].push(normalized.record);
  }

  const capByLayer = {
    railStations: MAX_RAIL_STATIONS_PER_DESTINATION,
    metroStations: MAX_METRO_STATIONS_PER_DESTINATION,
    busTerminals: MAX_BUS_TERMINALS_PER_DESTINATION,
  };

  for (const layerKey of Object.keys(grouped)) {
    grouped[layerKey] = dedupeTransportNodes(grouped[layerKey])
      .sort((left, right) => {
        if ((left._distanceKm ?? Infinity) !== (right._distanceKm ?? Infinity)) {
          return (left._distanceKm ?? Infinity) - (right._distanceKm ?? Infinity);
        }

        return left.name.localeCompare(right.name);
      })
      .slice(0, capByLayer[layerKey])
      .map(({ _distanceKm, ...record }) => record);
  }

  return grouped;
}

function selectDestinationAirports({
  airportCatalog = new Map(),
  destination = {},
}) {
  function getAirportPriority(record = {}) {
    let score = 0;

    if (normalizeText(record.scheduledService).toLowerCase() === "yes") {
      score += 120;
    }
    if (normalizeText(record.iata)) {
      score += 45;
    }
    if (record.airportType === "large_airport") {
      score += 30;
    } else if (record.airportType === "medium_airport") {
      score += 22;
    } else if (record.airportType === "small_airport") {
      score += 6;
    }

    return score;
  }

  return [...airportCatalog.values()]
    .map((record) => ({
      ...record,
      _distanceKm: haversineDistanceKm(record.coordinates, destination.center),
      _priority: getAirportPriority(record),
    }))
    .filter(
      (record) =>
        record._distanceKm <= AIRPORT_RADIUS_KM ||
        isPointInsideBounds(record.coordinates, expandBounds(destination.cityBounds, 0.08))
    )
    .sort((left, right) => {
      if ((right._priority ?? 0) !== (left._priority ?? 0)) {
        return (right._priority ?? 0) - (left._priority ?? 0);
      }
      if ((left._distanceKm ?? Infinity) !== (right._distanceKm ?? Infinity)) {
        return (left._distanceKm ?? Infinity) - (right._distanceKm ?? Infinity);
      }

      return left.name.localeCompare(right.name);
    })
    .slice(0, MAX_AIRPORTS_PER_DESTINATION)
    .map(({ _priority, ...record }) => pruneAirportRecord(record));
}

function buildFlightRoutesForDestination({
  destinationAirports = [],
  routeRows = [],
  airlinesIndex = {},
  airportIndex = {},
}) {
  const localAirportIds = new Set(destinationAirports.map((airport) => airport.id));
  if (localAirportIds.size === 0) {
    return [];
  }

  const routes = [];
  const seen = new Set();

  for (const route of routeRows) {
    const originAirport = resolveAirportRecord(
      {
        code: route.originCode,
        sourceId: route.originAirportSourceId,
      },
      airportIndex
    );

    if (!originAirport || !localAirportIds.has(originAirport.id)) {
      continue;
    }

    const destinationAirport = resolveAirportRecord(
      {
        code: route.destinationCode,
        sourceId: route.destinationAirportSourceId,
      },
      airportIndex
    );

    if (!destinationAirport || destinationAirport.id === originAirport.id) {
      continue;
    }

    const airline =
      airlinesIndex.airlinesById?.get(normalizeText(route.airlineId)) ??
      airlinesIndex.airlinesByCode?.get(normalizeText(route.airlineCode)) ??
      null;
    const equipmentCodes = parseEquipmentCodes(route.equipmentCodes);
    const routeId = createRouteId({
      originAirportId: originAirport.id,
      destinationAirportId: destinationAirport.id,
      airlineCode: airline?.iata ?? airline?.icao ?? route.airlineCode,
      equipmentCodes: equipmentCodes.join("-"),
    });

    if (seen.has(routeId)) {
      continue;
    }

    routes.push({
      id: routeId,
      originAirportId: originAirport.id,
      destinationAirportId: destinationAirport.id,
      originLabel: [originAirport.name, originAirport.locality].filter(Boolean).join(", "),
      destinationLabel: [destinationAirport.name, destinationAirport.locality].filter(Boolean).join(", "),
      airlineName: normalizeText(airline?.name),
      airlineIata: normalizeText(airline?.iata),
      airlineIcao: normalizeText(airline?.icao),
      equipmentCodes,
      provider: "openflights",
    });
    seen.add(routeId);

    if (routes.length >= MAX_FLIGHT_ROUTES_PER_DESTINATION) {
      break;
    }
  }

  return routes;
}

function buildSourceManifest() {
  return [
    {
      provider: "ourairports",
      sourceType: "airports",
      url: OUR_AIRPORTS_URL,
    },
    {
      provider: "openflights",
      sourceType: "flight-routes",
      url: OPENFLIGHTS_ROUTES_URL,
    },
    {
      provider: "openflights",
      sourceType: "airports-reference",
      url: OPENFLIGHTS_AIRPORTS_URL,
    },
    {
      provider: "openstreetmap-overpass",
      sourceType: "stations",
      url: OVERPASS_ENDPOINTS[0],
    },
  ];
}

export function buildTransportDatasetFromSources({
  scope = [],
  ourAirportsCsvText = "",
  openFlightsAirportsText = "",
  openFlightsAirlinesText = "",
  openFlightsRoutesText = "",
  overpassElementsByDestinationKey = {},
  generatedAt = new Date().toISOString(),
  logger = console,
} = {}) {
  const ourAirportsRows = parseCsvTable(ourAirportsCsvText);
  const openFlightsAirports = parseDatTable(openFlightsAirportsText, OPENFLIGHTS_AIRPORT_FIELDS);
  const openFlightsAirlines = parseDatTable(openFlightsAirlinesText, OPENFLIGHTS_AIRLINE_FIELDS);
  const openFlightsRoutes = parseDatTable(openFlightsRoutesText, OPENFLIGHTS_ROUTE_FIELDS);
  const airportIndex = buildAirportCatalog({
    ourAirportsRows,
    openFlightsAirports,
    scope,
  });
  const airlinesIndex = buildAirlineIndex(openFlightsAirlines);
  const destinations = {};
  const referencedAirportIds = new Set();

  for (const destination of Array.isArray(scope) ? scope : []) {
    const record = createTransportDestinationRecord({
      destinationKey: destination.destinationKey,
      destinationLabel: destination.destinationLabel,
      destination: {
        ...destination,
      },
    });
    const destinationAirports = selectDestinationAirports({
      airportCatalog: airportIndex.catalog,
      destination,
    });
    const osmLayers = buildOsmTransportLayers({
      elements: overpassElementsByDestinationKey[destination.destinationKey] ?? [],
      destination,
    });
    const flightRoutes = buildFlightRoutesForDestination({
      destinationAirports,
      routeRows: openFlightsRoutes,
      airlinesIndex,
      airportIndex,
    });

    for (const airport of destinationAirports) {
      referencedAirportIds.add(airport.id);
    }
    for (const route of flightRoutes) {
      referencedAirportIds.add(route.originAirportId);
      referencedAirportIds.add(route.destinationAirportId);
    }

    record.airports = destinationAirports;
    record.flightRoutes = flightRoutes;
    record.railStations = osmLayers.railStations;
    record.metroStations = osmLayers.metroStations;
    record.busTerminals = osmLayers.busTerminals;
    destinations[destination.destinationKey] = record;

    logger.info("[transport-dataset] Built destination transport layers", {
      destination: destination.destinationLabel,
      airports: record.airports.length,
      flightRoutes: record.flightRoutes.length,
      railStations: record.railStations.length,
      metroStations: record.metroStations.length,
      busTerminals: record.busTerminals.length,
    });
  }

  const airportCatalog = {};
  for (const airportId of referencedAirportIds) {
    const airport = airportIndex.catalog.get(airportId);
    if (!airport) {
      continue;
    }

    airportCatalog[airportId] = pruneAirportRecord(airport);
  }

  return {
    datasetVersion: buildDatasetVersion(generatedAt),
    generatedAt,
    schemaVersion: TRANSPORT_DATASET_SCHEMA_VERSION,
    sources: buildSourceManifest(),
    airportCatalog,
    destinations,
  };
}

export function summarizeTransportDataset(dataset = {}) {
  const destinations = Object.values(dataset?.destinations ?? {});

  return {
    destinationCount: destinations.length,
    airportCount: destinations.reduce((total, entry) => total + (entry.airports?.length ?? 0), 0),
    flightRouteCount: destinations.reduce(
      (total, entry) => total + (entry.flightRoutes?.length ?? 0),
      0
    ),
    railStationCount: destinations.reduce(
      (total, entry) => total + (entry.railStations?.length ?? 0),
      0
    ),
    metroStationCount: destinations.reduce(
      (total, entry) => total + (entry.metroStations?.length ?? 0),
      0
    ),
    busTerminalCount: destinations.reduce(
      (total, entry) => total + (entry.busTerminals?.length ?? 0),
      0
    ),
  };
}

export function validateTransportDataset(dataset = {}) {
  const errors = [];
  const airportIds = new Set([
    ...Object.keys(dataset?.airportCatalog ?? {}),
    ...Object.values(dataset?.destinations ?? {}).flatMap((entry) =>
      Array.isArray(entry?.airports) ? entry.airports.map((airport) => airport.id) : []
    ),
  ]);

  if (dataset?.schemaVersion !== TRANSPORT_DATASET_SCHEMA_VERSION) {
    errors.push(
      `Expected schemaVersion ${TRANSPORT_DATASET_SCHEMA_VERSION} but received ${dataset?.schemaVersion ?? "missing"}`
    );
  }

  for (const [destinationKey, entry] of Object.entries(dataset?.destinations ?? {})) {
    for (const layerKey of [
      "airports",
      "flightRoutes",
      "railStations",
      "metroStations",
      "busTerminals",
    ]) {
      if (!Array.isArray(entry?.[layerKey])) {
        errors.push(`${destinationKey} is missing ${layerKey}`);
      }
    }

    for (const airport of entry?.airports ?? []) {
      if (airport.transportType !== "airport") {
        errors.push(`${destinationKey} airport layer contains ${airport.transportType || "unknown"}`);
      }
    }
    for (const railStation of entry?.railStations ?? []) {
      if (railStation.transportType !== "rail_station") {
        errors.push(`${destinationKey} railStations layer contains ${railStation.transportType || "unknown"}`);
      }
    }
    for (const metroStation of entry?.metroStations ?? []) {
      if (metroStation.transportType !== "metro_station") {
        errors.push(`${destinationKey} metroStations layer contains ${metroStation.transportType || "unknown"}`);
      }
    }
    for (const busTerminal of entry?.busTerminals ?? []) {
      if (busTerminal.transportType !== "bus_terminal") {
        errors.push(`${destinationKey} busTerminals layer contains ${busTerminal.transportType || "unknown"}`);
      }
    }
    for (const route of entry?.flightRoutes ?? []) {
      if (!airportIds.has(route.originAirportId)) {
        errors.push(`${destinationKey} route ${route.id} has unknown origin airport ${route.originAirportId}`);
      }
      if (!airportIds.has(route.destinationAirportId)) {
        errors.push(
          `${destinationKey} route ${route.id} has unknown destination airport ${route.destinationAirportId}`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    summary: summarizeTransportDataset(dataset),
  };
}

export async function buildTransportDataset({
  fetchImpl = fetch,
  outFile = DEFAULT_TRANSPORT_OUT_FILE,
  logger = console,
  write = true,
} = {}) {
  const scope = await loadSupportedDestinationScope();
  logger.info("[transport-dataset] Loaded supported destination scope", {
    destinationCount: scope.length,
  });

  const [ourAirportsCsvText, openFlightsAirportsText, openFlightsAirlinesText, openFlightsRoutesText] =
    await Promise.all([
      fetchText(OUR_AIRPORTS_URL, { fetchImpl }),
      fetchText(OPENFLIGHTS_AIRPORTS_URL, { fetchImpl }),
      fetchText(OPENFLIGHTS_AIRLINES_URL, { fetchImpl }),
      fetchText(OPENFLIGHTS_ROUTES_URL, { fetchImpl }),
    ]);

  const overpassElementsByDestinationKey = {};
  for (const destination of scope) {
    logger.info("[transport-dataset] Fetching station overlays", {
      destination: destination.destinationLabel,
    });
    overpassElementsByDestinationKey[destination.destinationKey] =
      await fetchOverpassTransportElements({
        bounds: destination.cityBounds,
        fetchImpl,
        logger,
      });
  }

  const dataset = buildTransportDatasetFromSources({
    scope,
    ourAirportsCsvText,
    openFlightsAirportsText,
    openFlightsAirlinesText,
    openFlightsRoutesText,
    overpassElementsByDestinationKey,
    logger,
  });
  const validation = validateTransportDataset(dataset);

  if (!validation.valid) {
    throw new Error(`Transport dataset validation failed: ${validation.errors.join("; ")}`);
  }

  if (write) {
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
    logger.info("[transport-dataset] Wrote transport dataset artifact", {
      outFile,
      ...validation.summary,
    });
  }

  return dataset;
}

async function readExistingTransportDataset(outFile = DEFAULT_TRANSPORT_OUT_FILE) {
  return readJson(outFile);
}

async function main() {
  const args = new Set(process.argv.slice(2));

  if (args.has("--verify")) {
    const dataset = await readExistingTransportDataset();
    const validation = validateTransportDataset(dataset);
    if (!validation.valid) {
      throw new Error(validation.errors.join("; "));
    }
    console.info("[transport-dataset] Verification passed", validation.summary);
    return;
  }

  if (args.has("--stats")) {
    const dataset = await readExistingTransportDataset();
    console.info("[transport-dataset] Stats", summarizeTransportDataset(dataset));
    return;
  }

  await buildTransportDataset();
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  main().catch((error) => {
    console.error("[transport-dataset] Build failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
