import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGroundedNarrativePrompt,
  generateGroundedNarrative,
} from "../server/services/gemini.js";

const PLANNING_REQUEST = {
  destination: "Kyoto, Japan",
  days: 1,
  budgetAmount: 1800,
  travelStyle: "Cultural",
  pace: "Balanced",
  foodPreferences: ["Vegetarian"],
};

const GROUNDED_PLAN = {
  destination: "Kyoto, Japan",
  days: [
    {
      day: 1,
      title: "Day 1 in Kyoto, Japan",
      summary: "",
      tips: [],
      places: [
        {
          id: "pl_1",
          name: "Fushimi Inari Taisha",
          category: "attraction",
          description: "Verified shrine stop.",
          travelTimeFromPreviousMinutes: 18,
        },
      ],
      restaurants: [
        {
          id: "rs_1",
          name: "Mumokuteki Cafe",
          foodTags: ["Vegetarian"],
        },
      ],
      hotels: [
        {
          id: "ht_1",
          name: "Hotel The Celestine Kyoto Gion",
          distanceToClusterMeters: 900,
        },
      ],
      route: ["ht_1", "pl_1", "rs_1"],
      estimatedTimeMinutes: 420,
      estimatedCostAmount: 210,
    },
  ],
};

test("buildGroundedNarrativePrompt contains strict anti-hallucination instructions", () => {
  const prompt = buildGroundedNarrativePrompt({
    planningRequest: PLANNING_REQUEST,
    groundedPlan: GROUNDED_PLAN,
  });

  assert.match(prompt, /ONLY use the provided JSON data/i);
  assert.match(prompt, /Do NOT invent/i);
  assert.match(prompt, /Return valid JSON only/i);
  assert.match(prompt, /Fushimi Inari Taisha/);
});

test("generateGroundedNarrative falls back to template output without Gemini credentials", async () => {
  const originalApiKey = process.env.GOOGLE_GEMINI_API_KEY;
  const originalGeminiKey = process.env.GEMINI_API_KEY;

  try {
    delete process.env.GOOGLE_GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const narrative = await generateGroundedNarrative({
      planningRequest: PLANNING_REQUEST,
      groundedPlan: GROUNDED_PLAN,
    });

    assert.equal(narrative.source, "template");
    assert.equal(narrative.days.length, 1);
    assert.equal(narrative.days[0].title.includes("Kyoto"), true);
    assert.equal(Array.isArray(narrative.days[0].tips), true);
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.GOOGLE_GEMINI_API_KEY;
    } else {
      process.env.GOOGLE_GEMINI_API_KEY = originalApiKey;
    }

    if (originalGeminiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiKey;
    }
  }
});
