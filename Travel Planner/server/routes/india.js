import express from "express";
import {
  getIndiaDestinationDetail,
  getIndiaTransportOptions,
  searchIndiaDestinations,
} from "../services/indiaData.js";

const router = express.Router();

function getErrorText(error) {
  if (!error) {
    return "";
  }

  if (error instanceof Error) {
    return error.message ?? "";
  }

  return String(error);
}

router.get("/destinations", (req, res) => {
  try {
    const destinations = searchIndiaDestinations(req.query.q, {
      limit: req.query.limit,
    });
    res.json({ destinations });
  } catch (error) {
    console.error("[india-api] Failed to search destinations", {
      query: String(req.query.q ?? ""),
      errorMessage: getErrorText(error),
    });
    res.status(500).json({
      message: "Unable to search India destinations right now.",
    });
  }
});

router.get("/destinations/:destinationId", (req, res) => {
  try {
    const detail = getIndiaDestinationDetail(req.params.destinationId);
    if (!detail) {
      res.status(404).json({
        message: "India destination was not found.",
      });
      return;
    }

    res.json(detail);
  } catch (error) {
    console.error("[india-api] Failed to load destination detail", {
      destinationId: String(req.params.destinationId ?? ""),
      errorMessage: getErrorText(error),
    });
    res.status(500).json({
      message: "Unable to load India destination details right now.",
    });
  }
});

router.get("/transport/options", async (req, res) => {
  const parseModesFromQuery = (value) =>
    String(value ?? "")
      .split(",")
      .map((mode) => mode.trim().toLowerCase())
      .filter((mode) => ["flight", "train", "road"].includes(mode));
  const parseBooleanQueryFlag = (value) => {
    const normalized = String(value ?? "")
      .trim()
      .toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  };

  const origin = String(req.query.origin ?? "").trim();
  const destination = String(req.query.destination ?? "").trim();

  if (!origin || !destination) {
    res.status(400).json({
      message: "Both origin and destination are required.",
    });
    return;
  }

  try {
    const payload = await getIndiaTransportOptions({
      origin,
      destination,
      preferredModes: parseModesFromQuery(req.query.preferredModes),
      maxTransfers: req.query.maxTransfers,
      topK: req.query.topK,
      forceRefresh: parseBooleanQueryFlag(req.query.force),
      traceId: req.traceId ?? "",
    });
    res.json(payload);
  } catch (error) {
    if (error?.code === "india-data/destination-not-found") {
      res.status(404).json({
        message: error.message,
      });
      return;
    }

    if (error?.code === "india-data/origin-not-found") {
      res.status(404).json({
        message: error.message,
      });
      return;
    }

    console.error("[india-api] Failed to resolve transport options", {
      origin,
      destination,
      errorMessage: getErrorText(error),
    });
    res.status(500).json({
      message: "Unable to load India transport options right now.",
    });
  }
});

export default router;
