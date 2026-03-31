import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTripPdfDocumentModel,
  createTripPdfDocument,
  downloadTripPlanPdf,
} from "../src/lib/tripPdf.js";

function buildFullTripFixture() {
  return {
    id: "trip-123",
    createdAt: "2026-04-01T09:30:00.000Z",
    userSelection: {
      location: { label: "Bali, Indonesia" },
      days: 7,
      budget: "Moderate",
      travelers: "A Couple",
    },
    aiPlan: {
      destination: "Bali, Indonesia",
      days: [
        {
          day: 1,
          title: "Arrival in Ubud & Monkey Forest Fun",
          activities: [
            "Check in at the villa",
            "Explore Ubud Market",
            "Walk through Monkey Forest",
            "Sunset dinner in central Ubud",
          ],
          estimatedCost: "$120-$180",
          tips: "Carry small cash for local shops and donations.",
        },
        {
          day: 2,
          title: "Ubud's Cultural & Natural Wonders",
          activities: [
            "Visit Tegallalang Rice Terrace",
            "Temple stop at Tirta Empul",
            "Coffee tasting session",
          ],
          estimatedCost: "$90-$140",
          tips: "Leave early to avoid the tour-bus rush.",
        },
      ],
      totalEstimatedCost: "Approx. $980 - $1480",
      travelTips: [
        "Book high-demand attractions in Bali at least a few days ahead.",
        "Keep 10-15% of your budget as a contingency buffer.",
      ],
    },
    hotels: [
      {
        hotelName: "Canopy Ubud Retreat",
        hotelAddress: "Jalan Monkey Forest, Ubud",
        price: "$180/night",
        rating: 4.8,
        description: "Quiet boutique stay with easy access to central Ubud.",
      },
    ],
  };
}

test("buildTripPdfDocumentModel uses aiPlan data for overview and day sections", () => {
  const model = buildTripPdfDocumentModel(buildFullTripFixture(), {
    generatedAt: "2026-04-01T12:30:10.000Z",
  });

  assert.equal(model.appTitle, "AI Travel Planner");
  assert.equal(model.title, "Bali, Indonesia Trip Plan");
  assert.equal(model.coverTitle, "Bali Curated Journey");
  assert.equal(model.fileName, "bali-indonesia-trip-plan.pdf");
  assert.equal(model.generatedAtLabel, "Apr 1, 2026, 6:00 PM");
  assert.equal(model.days.length, 2);
  assert.equal(model.days[0].title, "Arrival in Ubud & Monkey Forest Fun");
  assert.equal(typeof model.days[0].intro, "string");
  assert.equal(typeof model.days[0].signatureMoment, "string");
  assert.equal(typeof model.days[0].imageUrl, "string");
  assert.equal(model.days[0].activities.length, 4);
  assert.equal(model.hotels[0].title, "Canopy Ubud Retreat");
  assert.equal(model.staySection.mode, "real");
  assert.equal(
    model.overview.items.find((item) => item.label === "Estimated Cost")?.value,
    "Approx. $980 - $1480"
  );
  assert.equal(model.overview.highlights.length > 0, true);
});

test("buildTripPdfDocumentModel falls back to itinerary data for legacy trips", () => {
  const model = buildTripPdfDocumentModel({
    userSelection: {
      location: { label: "Paris" },
      days: 2,
      budget: "Moderate",
      travelers: "Friends",
    },
    itinerary: {
      days: [
        {
          dayNumber: 1,
          title: "Arrival Day",
          places: [
            {
              placeName: "Eiffel Tower",
              placeDetails: "Visit in the evening for city lights.",
              ticketPricing: "EUR 20",
            },
            {
              placeName: "Seine River Walk",
            },
          ],
        },
      ],
    },
  }, {
    generatedAt: "2026-04-01T12:30:10.000Z",
  });

  assert.equal(model.days.length, 1);
  assert.deepEqual(model.days[0].activities, ["Eiffel Tower", "Seine River Walk"]);
  assert.equal(model.days[0].notes, "Visit in the evening for city lights.");
  assert.equal(model.days[0].estimatedCost, "EUR 20");
  assert.equal(model.totalEstimatedCost, "Not specified");
  assert.equal(model.staySection.mode, "curated");
});

test("buildTripPdfDocumentModel handles missing hotels, tips, and estimated cost", () => {
  const model = buildTripPdfDocumentModel({
    userSelection: {
      location: { label: "Kyoto" },
      days: 3,
      budget: "Luxury",
      travelers: "Family",
    },
    aiPlan: {
      destination: "Kyoto",
      days: [
        {
          day: 1,
          title: "Temple morning",
          activities: ["Visit Kiyomizu-dera"],
        },
      ],
    },
  }, {
    generatedAt: "2026-04-01T12:30:10.000Z",
  });

  assert.equal(model.hotels.length, 0);
  assert.equal(model.hotelsEmptyMessage, "No hotel recommendations available.");
  assert.deepEqual(model.travelTips, ["No additional travel tips available."]);
  assert.equal(model.totalEstimatedCost, "Not specified");
  assert.equal(model.staySection.items.length > 0, true);
});

test("createTripPdfDocument renders a PDF without throwing on special characters", async () => {
  const { doc, model } = await createTripPdfDocument({
    userSelection: {
      location: { label: "São Paulo, Brasil" },
      days: 2,
      budget: "Moderate",
      travelers: "Just Me",
    },
    aiPlan: {
      destination: "São Paulo, Brasil",
      days: [
        {
          day: 1,
          title: "Cafés, marchés & arquitetura",
          activities: [
            "Walk Avenida Paulista",
            "Visit a café with pão de queijo",
          ],
          estimatedCost: "R$180-R$240",
          tips: "Use metro cards for easier transfers.",
        },
      ],
      travelTips: ["Keep a rideshare backup for late evenings."],
    },
  }, {
    generatedAt: "2026-04-01T12:30:10.000Z",
    logoUrl: "",
    disableImages: true,
  });

  const output = doc.output("arraybuffer");

  assert.equal(model.appTitle, "AI Travel Planner");
  assert.equal(model.fileName, "sao-paulo-brasil-trip-plan.pdf");
  assert.ok(output instanceof ArrayBuffer);
  assert.ok(output.byteLength > 0);
});

test("downloadTripPlanPdf uses the computed filename and tolerates partial trip data", async () => {
  let capturedFileName = "";

  const result = await downloadTripPlanPdf(
    {
      userSelection: {
        location: { label: "Kyoto" },
      },
    },
    {
      saveFn: (_doc, fileName) => {
        capturedFileName = fileName;
      },
      generatedAt: "2026-04-01T12:30:10.000Z",
      logoUrl: "",
      disableImages: true,
    }
  );

  assert.equal(capturedFileName, "kyoto-trip-plan.pdf");
  assert.equal(result.fileName, "kyoto-trip-plan.pdf");
  assert.equal(result.model.title, "Kyoto Trip Plan");
  assert.equal(result.model.generatedAtLabel, "Apr 1, 2026, 6:00 PM");
});
