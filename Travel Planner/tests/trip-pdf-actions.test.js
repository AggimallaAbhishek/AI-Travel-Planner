import test from "node:test";
import assert from "node:assert/strict";
import {
  downloadTripPdf,
  printTripPdf,
  printBlob,
  saveBlobAsFile,
} from "../src/lib/trip-pdf/actions.js";

function buildSampleTrip() {
  return {
    userSelection: {
      location: { label: "Rome" },
      budget: "Moderate",
      travelers: "Friends",
      travelType: "City Break",
    },
    createdAt: "2026-02-08T10:00:00.000Z",
    aiPlan: {
      totalEstimatedCost: "$400 - $700",
      days: [
        {
          day: 1,
          title: "Arrival and Ancient Center",
          activities: ["Check in", "Colosseum visit", "Local dinner"],
          estimatedCost: "$150",
          tips: "Prebook Colosseum slots.",
        },
      ],
      travelTips: ["Carry a reusable water bottle."],
    },
    itinerary: {
      days: [
        {
          dayNumber: 1,
          title: "Arrival and Ancient Center",
          places: [
            {
              placeName: "Colosseum",
              geoCoordinates: { latitude: 41.8902, longitude: 12.4922 },
            },
          ],
        },
      ],
    },
    hotels: [],
  };
}

test("downloadTripPdf uses saveFn and returns telemetry payload", async () => {
  const trip = buildSampleTrip();
  let captured = null;

  const result = await downloadTripPdf({
    trip,
    recommendations: {},
    options: {
      disableImages: true,
      disableFontEmbedding: true,
      saveFn: (payload) => {
        captured = payload;
      },
    },
  });

  assert.ok(captured);
  assert.equal(captured.fileName, result.fileName);
  assert.equal(result.fileName.endsWith(".pdf"), true);
  assert.equal(result.pageCount >= 1, true);
  assert.ok(result.blob instanceof Blob);
});

test("printTripPdf uses printFn and returns printable payload", async () => {
  const trip = buildSampleTrip();
  let printInvocation = null;

  const result = await printTripPdf({
    trip,
    recommendations: {},
    options: {
      disableImages: true,
      disableFontEmbedding: true,
      printFn: (payload) => {
        printInvocation = payload;
      },
    },
  });

  assert.ok(printInvocation);
  assert.equal(printInvocation.fileName, result.fileName);
  assert.equal(result.pageCount >= 1, true);
  assert.ok(result.blob instanceof Blob);
});

test("printBlob throws when popup is blocked", () => {
  const fakeBlob = new Blob(["pdf"]);

  assert.throws(
    () =>
      printBlob(fakeBlob, "sample.pdf", {
        environment: {
          URL: {
            createObjectURL() {
              return "blob:blocked";
            },
            revokeObjectURL() {},
          },
          window: {
            open() {
              return null;
            },
          },
          setTimeout(handler) {
            handler();
          },
        },
      }),
    /blocked/
  );
});

test("saveBlobAsFile throws without browser document APIs", () => {
  assert.throws(
    () => saveBlobAsFile(new Blob(["pdf"]), "sample.pdf", { URL: {} }),
    /browser environment/
  );
});
