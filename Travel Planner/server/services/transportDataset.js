import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTransportLookupKeys,
  cloneTransportDestinationRecord,
  createTransportDestinationRecord,
} from "../../shared/transportDataset.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_TRANSPORT_DATASET_FILE = path.resolve(
  __dirname,
  "../../data/transport/transport.json"
);

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export function createTransportDatasetService({
  datasetFile = DEFAULT_TRANSPORT_DATASET_FILE,
} = {}) {
  const cache = {
    dataset: null,
    destinationKeyByLookup: null,
  };

  async function loadDataset() {
    if (!cache.dataset) {
      console.info("[transport-dataset] Loading dataset", {
        datasetFile,
      });

      try {
        cache.dataset = await readJson(datasetFile);
      } catch (error) {
        console.warn("[transport-dataset] Failed to load dataset", {
          datasetFile,
          message: error instanceof Error ? error.message : String(error),
        });
        cache.dataset = {
          destinations: {},
          airportCatalog: {},
        };
      }
    }

    return cache.dataset;
  }

  async function loadLookupIndex() {
    if (!cache.destinationKeyByLookup) {
      const dataset = await loadDataset();
      const lookup = new Map();

      for (const [destinationKey, record] of Object.entries(dataset.destinations ?? {})) {
        const destination = record?.destination ?? {};
        const keys = buildTransportLookupKeys({
          destinationKey,
          destinationLabel: destination.destinationLabel,
          locality: destination.locality,
          countryCode: destination.countryCode,
          countryName: destination.countryName,
        });

        for (const key of keys) {
          if (key && !lookup.has(key)) {
            lookup.set(key, destinationKey);
          }
        }
      }

      cache.destinationKeyByLookup = lookup;
    }

    return cache.destinationKeyByLookup;
  }

  async function getDestinationTransport({ destination = "" } = {}) {
    const dataset = await loadDataset();
    const lookupIndex = await loadLookupIndex();
    const lookupKeys = buildTransportLookupKeys(
      typeof destination === "string" ? destination : destination ?? {}
    );

    for (const key of lookupKeys) {
      const destinationKey = lookupIndex.get(key);
      if (!destinationKey) {
        continue;
      }

      const record = dataset.destinations?.[destinationKey];
      if (!record) {
        continue;
      }

      console.info("[transport-dataset] Resolved destination transport", {
        destination: normalizeText(
          typeof destination === "string"
            ? destination
            : destination?.destinationLabel ?? destination?.locality
        ),
        destinationKey,
        airports: record.airports?.length ?? 0,
        flightRoutes: record.flightRoutes?.length ?? 0,
        railStations: record.railStations?.length ?? 0,
        metroStations: record.metroStations?.length ?? 0,
        busTerminals: record.busTerminals?.length ?? 0,
      });

      return cloneTransportDestinationRecord(record);
    }

    console.info("[transport-dataset] No transport data found for destination", {
      destination: normalizeText(
        typeof destination === "string"
          ? destination
          : destination?.destinationLabel ?? destination?.locality
      ),
    });

    return createTransportDestinationRecord({
      destinationLabel:
        typeof destination === "string"
          ? destination
          : destination?.destinationLabel ?? [destination?.locality, destination?.countryName].filter(Boolean).join(", "),
      destination:
        typeof destination === "string"
          ? undefined
          : destination,
    });
  }

  return {
    getDestinationTransport,
  };
}

const transportDatasetService = createTransportDatasetService();

export const getDestinationTransport = transportDatasetService.getDestinationTransport;
