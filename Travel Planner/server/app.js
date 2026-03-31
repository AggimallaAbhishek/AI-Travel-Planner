import cors from "cors";
import express from "express";
import tripsRouter from "./routes/trips.js";

const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

function parseAllowedOrigins(rawValue) {
  const configuredOrigins = (rawValue ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  return DEFAULT_ALLOWED_ORIGINS;
}

const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);

function isOriginAllowed(origin) {
  if (!origin) {
    return true;
  }

  return allowedOrigins.includes("*") || allowedOrigins.includes(origin);
}

const app = express();

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.use(
  cors({
    origin(origin, callback) {
      const isAllowed = isOriginAllowed(origin);

      if (!isAllowed) {
        console.warn("[cors] Blocked origin", { origin });
      }

      callback(null, isAllowed);
    },
    credentials: false,
    optionsSuccessStatus: 204,
  })
);
app.use(express.json({ limit: "1mb" }));

app.use((error, _req, res, next) => {
  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({
      message: "Request body must be valid JSON.",
    });
    return;
  }

  next(error);
});

app.use((req, _res, next) => {
  if (req.path.startsWith("/api")) {
    console.info("[api] Incoming request", {
      method: req.method,
      path: req.originalUrl,
    });
  }

  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
  });
});

app.use("/api", tripsRouter);

app.use((error, _req, res, _next) => {
  console.error("[server] Unhandled error", error);
  res.status(500).json({
    message: "Unexpected server error.",
  });
});

export default app;
