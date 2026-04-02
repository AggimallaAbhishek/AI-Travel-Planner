function normalizeSnapshot(snapshot) {
  if (typeof snapshot !== "string") {
    return "";
  }

  return snapshot.replace(/\s+/g, " ").trim();
}

export function analyzeTripPdfUiSnapshot(snapshot) {
  const normalized = normalizeSnapshot(snapshot);

  const hasAuthGate =
    /sign in to view this trip/i.test(normalized) ||
    /sign in with google/i.test(normalized);
  const hasDownloadButton = /download pdf/i.test(normalized);
  const hasPrintButton = /\bprint\b/i.test(normalized);

  return {
    hasAuthGate,
    hasDownloadButton,
    hasPrintButton,
    hasRequiredButtons: hasDownloadButton && hasPrintButton,
  };
}

export function summarizeBrowserErrors(logOutput) {
  const normalized = normalizeSnapshot(logOutput);
  const hasErrorEntries = /\[error\]/i.test(normalized);

  return {
    hasErrorEntries,
    normalized,
  };
}
