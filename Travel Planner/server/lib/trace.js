import { randomUUID } from "node:crypto";

const REQUEST_ID_HEADER = "x-request-id";
const TRACE_ID_HEADER = "x-trace-id";

function normalizeHeaderValue(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

export function createTraceId() {
  return randomUUID();
}

export function getRequestTraceId(req) {
  const requestId = normalizeHeaderValue(req?.headers?.[REQUEST_ID_HEADER]);
  if (requestId) {
    return requestId;
  }

  const traceId = normalizeHeaderValue(req?.headers?.[TRACE_ID_HEADER]);
  if (traceId) {
    return traceId;
  }

  return "";
}

export function attachRequestTrace(req, res, next) {
  const existingTraceId = getRequestTraceId(req);
  const traceId = existingTraceId || createTraceId();
  req.traceId = traceId;
  res.setHeader(TRACE_ID_HEADER, traceId);
  next();
}

