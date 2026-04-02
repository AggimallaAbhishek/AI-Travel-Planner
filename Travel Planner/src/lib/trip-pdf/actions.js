import { createTripPdfDocument } from "./renderer.js";

function ensureBrowserApi(message) {
  throw new Error(message);
}

function createPdfBlob(doc) {
  return doc.output("blob");
}

function saveBlobAsFile(blob, fileName, environment = globalThis) {
  const URLApi = environment.URL;
  const documentApi = environment.document;

  if (!URLApi || !documentApi?.createElement || !documentApi.body) {
    ensureBrowserApi("Download is only available in a browser environment.");
  }

  const objectUrl = URLApi.createObjectURL(blob);

  try {
    const anchor = documentApi.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = "noopener";
    anchor.style.display = "none";

    documentApi.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URLApi.revokeObjectURL(objectUrl);
  }
}

function printBlob(blob, fileName, { environment = globalThis, revokeDelayMs = 45_000 } = {}) {
  const windowApi = environment.window;
  const URLApi = environment.URL;
  const setTimeoutApi = environment.setTimeout ?? setTimeout;

  if (!windowApi?.open || !URLApi?.createObjectURL) {
    ensureBrowserApi("Print is only available in a browser environment.");
  }

  const objectUrl = URLApi.createObjectURL(blob);
  const printWindow = windowApi.open(objectUrl, "_blank", "noopener,noreferrer");

  if (!printWindow) {
    URLApi.revokeObjectURL(objectUrl);
    throw new Error("Print window was blocked by the browser.");
  }

  setTimeoutApi(() => {
    try {
      printWindow.focus();
      printWindow.print();
    } catch (error) {
      console.warn("[trip-pdf:actions] Failed to trigger print dialog", {
        fileName,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, 400);

  setTimeoutApi(() => {
    URLApi.revokeObjectURL(objectUrl);
  }, revokeDelayMs);
}

export async function downloadTripPdf({ trip, recommendations, options = {} } = {}) {
  const renderResult = await createTripPdfDocument({
    trip,
    recommendations,
    options,
  });

  const { doc, model, pageCount } = renderResult;
  const blob = options.blob ?? createPdfBlob(doc);

  if (typeof options.saveFn === "function") {
    await options.saveFn({
      blob,
      fileName: model.fileName,
      doc,
      model,
      pageCount,
    });
  } else {
    saveBlobAsFile(blob, model.fileName, options.environment);
  }

  console.info("[trip-pdf:actions] PDF download completed", {
    destination: model.destination,
    fileName: model.fileName,
    pageCount,
  });

  return {
    fileName: model.fileName,
    pageCount,
    blob,
    model,
  };
}

export async function printTripPdf({ trip, recommendations, options = {} } = {}) {
  const renderResult = await createTripPdfDocument({
    trip,
    recommendations,
    options,
  });

  const { doc, model, pageCount } = renderResult;
  const blob = options.blob ?? createPdfBlob(doc);

  if (typeof options.printFn === "function") {
    await options.printFn({
      blob,
      fileName: model.fileName,
      doc,
      model,
      pageCount,
    });
  } else {
    printBlob(blob, model.fileName, {
      environment: options.environment,
      revokeDelayMs: options.revokeDelayMs,
    });
  }

  console.info("[trip-pdf:actions] PDF print flow started", {
    destination: model.destination,
    fileName: model.fileName,
    pageCount,
  });

  return {
    fileName: model.fileName,
    pageCount,
    blob,
    model,
  };
}

export { createPdfBlob, printBlob, saveBlobAsFile };
