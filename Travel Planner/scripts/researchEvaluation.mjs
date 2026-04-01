import { performance } from "node:perf_hooks";
import {
  buildFallbackGeneratedTrip,
  normalizeUserSelection,
} from "../shared/trips.js";
import {
  applyDeterministicTripRepairs,
  evaluateTripConstraints,
} from "../server/services/constraints.js";
import { buildTripFusionIndex } from "../server/services/dataFusion.js";
import { createTripRouteService } from "../server/services/routeOptimization.js";

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDurationMs(value) {
  return `${Math.round(value)} ms`;
}

function createSyntheticTrip(selection) {
  const fallback = buildFallbackGeneratedTrip(selection);
  const dayTemplates = [
    ["Historic walking district", "Local brunch market", "Sunset river promenade"],
    ["Museum cluster tour", "Signature lunch stop", "Evening cultural show"],
    ["Neighborhood food trail", "Panoramic viewpoint", "Night market exploration"],
  ];
  const destinationCoordinates = {
    "kyoto, japan": [
      { latitude: 35.0116, longitude: 135.7681 },
      { latitude: 35.0394, longitude: 135.7292 },
      { latitude: 35.0017, longitude: 135.7788 },
      { latitude: 35.0245, longitude: 135.7850 },
    ],
    "dubai, uae": [
      { latitude: 25.1972, longitude: 55.2744 },
      { latitude: 25.1412, longitude: 55.1853 },
      { latitude: 25.2048, longitude: 55.2708 },
      { latitude: 25.0763, longitude: 55.1324 },
    ],
  };
  const coordinateSet =
    destinationCoordinates[selection.location.label.toLowerCase()] ?? [
      { latitude: 48.8566, longitude: 2.3522 },
      { latitude: 48.8606, longitude: 2.3376 },
      { latitude: 48.8738, longitude: 2.2950 },
    ];
  const itineraryDays = Array.from({ length: selection.days }, (_, index) => ({
    dayNumber: index + 1,
    title: `Day ${index + 1} route`,
    places: dayTemplates[index % dayTemplates.length].map((activity, activityIndex) => ({
      placeName: activity,
      placeDetails: "Synthetic benchmark stop",
      category: "activity",
      geoCoordinates: coordinateSet[(index + activityIndex) % coordinateSet.length],
    })),
  }));

  return {
    ...fallback,
    destination: selection.location.label,
    days: Array.from({ length: selection.days }, (_, index) => ({
      day: index + 1,
      title: `Day ${index + 1} in ${selection.location.label}`,
      activities: dayTemplates[index % dayTemplates.length],
      estimated_cost: selection.budget === "Luxury" ? "$320-$480" : "$130-$220",
      tips: "Book timed-entry attractions early.",
    })),
    total_estimated_cost:
      selection.budget === "Luxury" ? "$1600-$2400" : "$650-$1200",
    travel_tips: [
      "Use contactless transit cards for shorter transfer times.",
      "Keep one flexible slot daily for weather or crowd disruption.",
    ],
    itinerary: {
      days: itineraryDays,
    },
  };
}

async function evaluateScenario(selectionInput) {
  const selection = normalizeUserSelection(selectionInput);
  const baselineStart = performance.now();
  const baselineTrip = buildFallbackGeneratedTrip(selection);
  const baselineLatency = performance.now() - baselineStart;
  const baselineConstraints = evaluateTripConstraints({
    generatedTrip: baselineTrip,
    userSelection: selection,
  });

  const a1Start = performance.now();
  const syntheticTrip = createSyntheticTrip(selection);
  const deterministicTrip = applyDeterministicTripRepairs({
    generatedTrip: syntheticTrip,
    userSelection: selection,
  });
  const a1Latency = performance.now() - a1Start;
  const a1Constraints = evaluateTripConstraints({
    generatedTrip: deterministicTrip,
    userSelection: selection,
  });

  const fusionStart = performance.now();
  const fusionIndex = buildTripFusionIndex({
    trip: {
      userSelection: selection,
      ...deterministicTrip,
    },
    recommendations: {
      destination: selection.location.label,
      provider: "mock",
      fetchedAt: new Date().toISOString(),
      hotels: [
        {
          name: "Atlas Haven",
          location: selection.location.label,
          category: "hotel",
        },
      ],
      restaurants: [
        {
          name: "Saffron Table",
          location: selection.location.label,
          category: "restaurant",
        },
      ],
    },
  });
  const fusionLatency = performance.now() - fusionStart;

  const routingStart = performance.now();
  const routeService = createTripRouteService({
    resolvePlacesKey: () => "",
    resolveRoutesKey: () => "",
    fetchImpl: async () => {
      throw new Error("network disabled for offline evaluation");
    },
  });
  const routes = await routeService.getRoutesForTrip({
    trip: {
      id: `eval-${selection.location.label}`,
      userSelection: selection,
      ...deterministicTrip,
      itinerary: syntheticTrip.itinerary,
    },
    objective: selection.objective,
    alternativesCount: selection.alternativesCount,
  });
  const routingLatency = performance.now() - routingStart;

  const readyRoutes = routes.days.filter((day) => day.status === "ready");
  const averageDurationSeconds =
    readyRoutes.length > 0
      ? readyRoutes.reduce(
          (total, day) => total + (day.totalDurationSeconds ?? 0),
          0
        ) / readyRoutes.length
      : 0;
  const averageFastestSeconds =
    readyRoutes.length > 0
      ? readyRoutes.reduce((total, day) => {
          const fastest =
            (day.alternatives ?? []).find(
              (alternative) => alternative.objective === "fastest"
            ) ?? day;
          return total + (fastest.totalDurationSeconds ?? 0);
        }, 0) / readyRoutes.length
      : 0;
  const routeEfficiencyRatio =
    averageFastestSeconds > 0 ? averageDurationSeconds / averageFastestSeconds : 1;

  return {
    destination: selection.location.label,
    days: selection.days,
    objective: selection.objective,
    baseline: {
      valid: baselineConstraints.valid,
      hardViolations: baselineConstraints.hardViolations.length,
      latencyMs: baselineLatency,
    },
    a1_deterministic: {
      valid: a1Constraints.valid,
      hardViolations: a1Constraints.hardViolations.length,
      latencyMs: a1Latency,
    },
    a2_fusion: {
      fusionItems: fusionIndex.items.length,
      highConfidenceItems: fusionIndex.stats.highConfidenceItems,
      latencyMs: fusionLatency,
    },
    full_system: {
      routeDayCount: readyRoutes.length,
      alternativesPerDay:
        readyRoutes.length > 0
          ? Math.round(
              readyRoutes.reduce(
                (total, day) => total + (day.alternatives?.length ?? 0),
                0
              ) / readyRoutes.length
            )
          : 0,
      routeEfficiencyRatio,
      latencyMs: routingLatency,
    },
  };
}

async function main() {
  const scenarios = [
    {
      location: { label: "Kyoto, Japan" },
      days: 3,
      budget: "Moderate",
      travelers: "Friends",
      objective: "best_experience",
      constraints: {
        dailyTimeLimitHours: 9,
        budgetCap: 2200,
        mobilityPref: "balanced",
        mealPrefs: ["Vegetarian"],
      },
      alternativesCount: 3,
    },
    {
      location: { label: "Dubai, UAE" },
      days: 4,
      budget: "Luxury",
      travelers: "A Couple",
      objective: "fastest",
      constraints: {
        dailyTimeLimitHours: 10,
        budgetCap: 5000,
        mobilityPref: "minimal-walking",
        mealPrefs: ["Seafood"],
      },
      alternativesCount: 3,
    },
  ];

  const scenarioResults = [];
  for (const scenario of scenarios) {
    const result = await evaluateScenario(scenario);
    scenarioResults.push(result);
  }

  const baselineValidRate =
    scenarioResults.filter((result) => result.baseline.valid).length /
    scenarioResults.length;
  const fullValidRate =
    scenarioResults.filter((result) => result.a1_deterministic.valid).length /
    scenarioResults.length;
  const avgRouteEfficiency =
    scenarioResults.reduce(
      (total, result) => total + result.full_system.routeEfficiencyRatio,
      0
    ) / scenarioResults.length;
  const avgRoutingLatencyMs =
    scenarioResults.reduce(
      (total, result) => total + result.full_system.latencyMs,
      0
    ) / scenarioResults.length;

  console.info("\nResearch Evaluation Summary");
  console.info("--------------------------");
  console.info(`Scenarios evaluated: ${scenarioResults.length}`);
  console.info(`Baseline constraint satisfaction: ${formatPercent(baselineValidRate)}`);
  console.info(`Deterministic+fusion satisfaction: ${formatPercent(fullValidRate)}`);
  console.info(`Average route efficiency ratio: ${avgRouteEfficiency.toFixed(3)}`);
  console.info(`Average routing latency: ${formatDurationMs(avgRoutingLatencyMs)}`);
  console.info("\nScenario Details:");
  console.info(JSON.stringify(scenarioResults, null, 2));
}

main().catch((error) => {
  console.error("[evaluation] Failed to run research evaluation", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
