import { getPlaceImage, getTripImage } from "./destinationImages.js";
import { getCategoryFallback, getManifestImageForQuery } from "./imageManifest.js";

const PDF_LAYOUT = {
  marginX: 16,
  marginTop: 16,
  marginBottom: 16,
  sectionGap: 10,
  cardRadius: 5,
};

const PDF_COLORS = {
  ink: [31, 41, 55],
  muted: [96, 108, 128],
  faint: [153, 161, 175],
  gold: [184, 144, 47],
  goldSoft: [246, 238, 224],
  greenDeep: [36, 59, 46],
  greenSoft: [232, 240, 235],
  navyDeep: [17, 29, 45],
  navySoft: [229, 236, 244],
  sand: [247, 243, 236],
  surface: [255, 255, 255],
  surfaceAlt: [249, 246, 240],
  border: [227, 232, 240],
};

const PDF_BRAND = {
  appTitle: "AI Travel Planner",
  subtitle: "Curated itinerary and travel brief",
};

const DEFAULT_PDF_LOGO_URL = `${
  typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
    ? import.meta.env.BASE_URL
    : "/"
}logo-1.png`;

const BUDGET_BREAKDOWN_SHARES = [
  { label: "Stay", share: 0.42, note: "Accommodation and service charges" },
  { label: "Dining", share: 0.18, note: "Restaurants, brunches, and drinks" },
  { label: "Experiences", share: 0.24, note: "Tours, tickets, and premium access" },
  { label: "Local Transport", share: 0.08, note: "Transfers, taxis, and short rides" },
  { label: "Buffer", share: 0.08, note: "Taxes, fees, and last-minute changes" },
];

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function normalizeStringArray(values, fallback = []) {
  if (!Array.isArray(values)) {
    return fallback;
  }

  return values
    .map((value) => normalizeText(typeof value === "string" ? value : ""))
    .filter(Boolean);
}

function sanitizePdfText(value, fallback = "") {
  return normalizeText(value, fallback)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[•]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x20-\x7E]/g, "");
}

function buildTripFileName(destination) {
  const slug = sanitizePdfText(destination, "trip")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${slug || "trip"}-trip-plan.pdf`;
}

function formatCreatedAt(value) {
  if (!value) {
    return "Not specified";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Not specified";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function formatGeneratedAt(value) {
  return formatCreatedAt(value);
}

function normalizeValue(value, fallback = "Not specified") {
  return normalizeText(
    typeof value === "string" ? value : String(value ?? ""),
    fallback
  );
}

function getPrimaryDestinationName(destination) {
  return normalizeText(destination)
    .split(",")
    .map((entry) => entry.trim())
    .find(Boolean) ?? "Your destination";
}

function hasMeaningfulValue(value) {
  const normalized = normalizeText(value).toLowerCase();
  return Boolean(normalized) && normalized !== "not specified" && normalized !== "n/a";
}

function lowerFirst(value) {
  const safeValue = normalizeText(value);
  if (!safeValue) {
    return "";
  }

  return `${safeValue.charAt(0).toLowerCase()}${safeValue.slice(1)}`;
}

function joinReadable(values = []) {
  const items = values.filter(Boolean);

  if (items.length === 0) {
    return "";
  }

  if (items.length === 1) {
    return items[0];
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function resolveTravelerTone(travelers) {
  const normalized = normalizeText(travelers).toLowerCase();

  if (normalized.includes("just me") || normalized.includes("solo")) {
    return "solo travel";
  }

  if (normalized.includes("couple")) {
    return "a couple's trip";
  }

  if (normalized.includes("family")) {
    return "family travel";
  }

  if (normalized.includes("friend")) {
    return "a friends' getaway";
  }

  return "an independent trip";
}

function resolveBudgetTone(budget) {
  const normalized = normalizeText(budget).toLowerCase();

  if (/luxury|premium/.test(normalized)) {
    return "luxury";
  }

  if (/cheap|budget|economy/.test(normalized)) {
    return "smart-value";
  }

  return "curated";
}

function buildCoverTitle(destination, budget) {
  const primaryName = getPrimaryDestinationName(destination);
  const normalizedBudget = normalizeText(budget).toLowerCase();

  if (/luxury|premium/.test(normalizedBudget)) {
    return `${primaryName} Luxury Escape`;
  }

  if (/cheap|budget|economy/.test(normalizedBudget)) {
    return `${primaryName} Smart Escape`;
  }

  return `${primaryName} Curated Journey`;
}

function buildCoverSubtitle(destination, selection, dayCount) {
  const duration = dayCount || Number.parseInt(selection?.days, 10) || 0;
  const budgetTone = resolveBudgetTone(selection?.budget);
  const travelerTone = resolveTravelerTone(selection?.travelers);

  return `A ${duration}-day ${budgetTone} itinerary designed for ${travelerTone} in ${destination}.`;
}

function buildSignatureMoment(day) {
  const activities = Array.isArray(day?.activities) ? day.activities : [];
  const priorityMatch = activities.find((activity) =>
    /private|sky|burj|sunset|desert|yacht|michelin|fine dining|rooftop|heritage|cultural|temple|brunch|beach/i.test(
      activity
    )
  );

  return normalizeText(priorityMatch ?? activities[0], normalizeText(day?.title));
}

function buildDayIntro(day) {
  const activityLead = joinReadable(
    (Array.isArray(day?.activities) ? day.activities : []).slice(0, 2).map(lowerFirst)
  );
  const title = normalizeText(day?.title, `Day ${day?.day ?? ""}`.trim());

  if (activityLead) {
    return `Center this day around ${lowerFirst(title)}, with highlights including ${activityLead}.`;
  }

  return `Use this day to explore ${lowerFirst(title)} at a balanced, unhurried pace.`;
}

function inferThemeCategory(text) {
  const normalized = normalizeText(text).toLowerCase();

  if (/beach|coast|coastal|yacht|marina|waterfront|island|palm/i.test(normalized)) {
    return "beach";
  }

  if (/heritage|historical|history|culture|cultural|museum|temple|souk|market|creek/i.test(normalized)) {
    return "culture";
  }

  if (/dinner|brunch|tea|restaurant|cafe|food|dining/i.test(normalized)) {
    return "food";
  }

  if (/shopping|design|art|gallery|skyline|city|downtown|mall|desert|safari/i.test(normalized)) {
    return "city";
  }

  return "destination";
}

function buildDayImageUrl(day, itineraryDay, destination) {
  const places = Array.isArray(itineraryDay?.places) ? itineraryDay.places : [];
  const featuredPlace = places.find((place) => normalizeText(place?.placeName));

  if (featuredPlace) {
    return getPlaceImage(featuredPlace);
  }

  const thematicQuery = `${day.title} ${(day.activities ?? []).join(" ")}`;
  const category = inferThemeCategory(`${thematicQuery} ${destination}`);

  return (
    getManifestImageForQuery(thematicQuery, { category }) ??
    getCategoryFallback(category)
  );
}

function buildDayFromAiPlan(day, index, itineraryDay, destination) {
  const dayNumber = Number.isFinite(day?.day) ? day.day : index + 1;
  const activities = normalizeStringArray(day?.activities, []);
  const title = normalizeText(day?.title, `Day ${dayNumber}`);
  const normalizedDay = {
    day: dayNumber,
    label: `Day ${dayNumber}`,
    title,
    activities: activities.length > 0 ? activities : ["No activities available."],
    notes: normalizeText(day?.tips),
    estimatedCost: normalizeText(day?.estimatedCost, "Not specified"),
  };

  return {
    ...normalizedDay,
    intro: buildDayIntro(normalizedDay),
    signatureMoment: buildSignatureMoment(normalizedDay),
    imageUrl: buildDayImageUrl(normalizedDay, itineraryDay, destination),
  };
}

function buildDayFromItinerary(day, index, destination) {
  const dayNumber = Number.isFinite(day?.dayNumber) ? day.dayNumber : index + 1;
  const places = Array.isArray(day?.places) ? day.places : [];
  const activities = places.map((place) => normalizeText(place?.placeName)).filter(Boolean);
  const notes =
    places.map((place) => normalizeText(place?.placeDetails)).find(Boolean) ?? "";
  const estimatedCost =
    places
      .map((place) => normalizeText(place?.ticketPricing))
      .find((value) => value && value.toLowerCase() !== "n/a") ?? "Not specified";
  const normalizedDay = {
    day: dayNumber,
    label: `Day ${dayNumber}`,
    title: normalizeText(day?.title, `Day ${dayNumber}`),
    activities: activities.length > 0 ? activities : ["No activities available."],
    notes,
    estimatedCost,
  };

  return {
    ...normalizedDay,
    intro: buildDayIntro(normalizedDay),
    signatureMoment: buildSignatureMoment(normalizedDay),
    imageUrl: buildDayImageUrl(normalizedDay, day, destination),
  };
}

function buildHotelEntry(hotel, index) {
  return {
    id: `${normalizeText(hotel?.hotelName, "hotel")}-${index}`,
    title: normalizeText(hotel?.hotelName, `Hotel ${index + 1}`),
    eyebrow: "Recommended stay",
    descriptor: `${normalizeText(hotel?.price, "Price not specified")} | ${
      hotel?.rating == null ? "Rating not specified" : `${hotel.rating}/5`
    }`,
    detail: normalizeText(hotel?.hotelAddress, "Address not provided"),
    description: normalizeText(
      hotel?.description,
      "No additional hotel details were provided."
    ),
  };
}

function buildCuratedStaySuggestions(destination, selection) {
  const normalizedDestination = normalizeText(destination).toLowerCase();
  const travelerTone = resolveTravelerTone(selection?.travelers);
  const budgetTone = resolveBudgetTone(selection?.budget);

  if (normalizedDestination.includes("dubai")) {
    return [
      {
        id: "downtown-dubai",
        eyebrow: "Best for iconic landmarks",
        title: "Downtown Dubai",
        descriptor: "Burj Khalifa, Dubai Mall, and polished skyline evenings",
        description:
          "Choose Downtown Dubai if you want quick access to major sights, refined dining, and a premium city-center base.",
      },
      {
        id: "palm-jumeirah",
        eyebrow: "Best for resort luxury",
        title: "Palm Jumeirah",
        descriptor: "Beach clubs, destination dining, and resort-style downtime",
        description:
          "Palm Jumeirah works well for travelers who want relaxed luxury between headline experiences and stronger resort amenities.",
      },
      {
        id: "dubai-marina",
        eyebrow: "Best for waterfront evenings",
        title: "Dubai Marina",
        descriptor: "Yacht departures, contemporary dining, and night views",
        description:
          "Dubai Marina is a strong fit for a more social, waterfront stay with easy access to coastal activities and polished evening plans.",
      },
    ];
  }

  return [
    {
      id: "central-district",
      eyebrow: "Best for first-time access",
      title: "Central District",
      descriptor: "Balanced access to landmarks, dining, and transport",
      description: `A reliable base for ${travelerTone}, especially when the itinerary is designed around a ${budgetTone} pace and short transfer times.`,
    },
    {
      id: "historic-quarter",
      eyebrow: "Best for local character",
      title: "Historic Quarter",
      descriptor: "Walkable streets, cultural sites, and neighborhood dining",
      description:
        "A good option when you want the trip to feel more local and design-forward rather than centered only on headline attractions.",
    },
    {
      id: "waterfront-area",
      eyebrow: "Best for slower evenings",
      title: "Waterfront Area",
      descriptor: "Relaxed views, premium stays, and stronger leisure time",
      description:
        "This is often the best fit when the trip mixes sightseeing with recovery time, dining, and more polished end-of-day experiences.",
    },
  ];
}

function parseCostRange(value) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  const currencyMatch = text.match(/([A-Z]{0,3}\$|[$€£₹]|AED|USD|EUR|GBP|INR|R\$)/);
  const currency = currencyMatch?.[1] ?? "$";
  const numbers = [...text.matchAll(/(\d[\d,]*)/g)]
    .map((match) => Number.parseInt(match[1].replace(/,/g, ""), 10))
    .filter(Number.isFinite);

  if (numbers.length < 2) {
    return null;
  }

  return {
    currency,
    min: Math.min(numbers[0], numbers[1]),
    max: Math.max(numbers[0], numbers[1]),
  };
}

function formatCurrencyRange(currency, min, max) {
  return `Approx. ${currency}${Math.round(min).toLocaleString("en-US")} - ${currency}${Math.round(max).toLocaleString("en-US")}`;
}

function buildBudgetBreakdown(totalEstimatedCost) {
  const parsed = parseCostRange(totalEstimatedCost);

  if (!parsed) {
    return BUDGET_BREAKDOWN_SHARES.map((item) => ({
      label: item.label,
      value: "Plan as part of total budget",
      note: item.note,
    }));
  }

  return BUDGET_BREAKDOWN_SHARES.map((item) => ({
    label: item.label,
    value: formatCurrencyRange(
      parsed.currency,
      parsed.min * item.share,
      parsed.max * item.share
    ),
    note: item.note,
  }));
}

function buildCoverSummary(destination, days) {
  const primaryName = getPrimaryDestinationName(destination);
  const highlightTitles = days.slice(0, 3).map((day) => lowerFirst(day.title));

  if (highlightTitles.length === 0) {
    return `A premium planning brief for ${primaryName}, ready to refine around your pace, priorities, and travel style.`;
  }

  return `Experience ${primaryName} through ${joinReadable(
    highlightTitles
  )}, with a pace that balances landmark moments, polished dining, and time to reset between major experiences.`;
}

function buildOverviewSummary(destination, days) {
  const primaryName = getPrimaryDestinationName(destination);
  const activityCount = days.reduce(
    (total, day) => total + (Array.isArray(day.activities) ? day.activities.length : 0),
    0
  );

  if (!days.length) {
    return `This itinerary document for ${primaryName} is ready to be expanded once day-by-day recommendations are available.`;
  }

  return `${primaryName} is presented here as a ${days.length}-day journey with ${activityCount} planned activities, moving from signature sights into more textured dining, cultural, and leisure moments.`;
}

function buildOverviewItems({
  destination,
  selection,
  totalEstimatedCost,
  createdAt,
  generatedAt,
  dayCount,
}) {
  const durationDays = dayCount || selection?.days || 0;

  return [
    { label: "Destination", value: destination },
    { label: "Duration", value: `${durationDays} day${durationDays === 1 ? "" : "s"}` },
    { label: "Budget", value: normalizeValue(selection?.budget, "Not specified") },
    { label: "Travelers", value: normalizeValue(selection?.travelers, "Not specified") },
    { label: "Created", value: formatCreatedAt(createdAt) },
    { label: "Generated", value: formatGeneratedAt(generatedAt) },
    { label: "Estimated Cost", value: totalEstimatedCost },
  ];
}

function buildOverviewHighlights(days) {
  return days
    .map((day) => normalizeText(day.signatureMoment))
    .filter(Boolean)
    .slice(0, 3);
}

export function buildTripPdfDocumentModel(trip = {}, options = {}) {
  const destination = normalizeText(
    trip?.aiPlan?.destination ?? trip?.userSelection?.location?.label,
    "Unknown destination"
  );
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const itineraryDays = Array.isArray(trip?.itinerary?.days) ? trip.itinerary.days : [];
  const aiPlanDays = Array.isArray(trip?.aiPlan?.days) ? trip.aiPlan.days : [];
  const days = (
    aiPlanDays.length > 0
      ? aiPlanDays.map((day, index) =>
          buildDayFromAiPlan(day, index, itineraryDays[index], destination)
        )
      : itineraryDays.map((day, index) => buildDayFromItinerary(day, index, destination))
  ).sort((left, right) => left.day - right.day);
  const totalEstimatedCost = normalizeText(
    trip?.aiPlan?.totalEstimatedCost ?? trip?.totalEstimatedCost,
    "Not specified"
  );
  const hotels = Array.isArray(trip?.hotels) ? trip.hotels.map(buildHotelEntry) : [];
  const stayRecommendations =
    hotels.length > 0
      ? hotels
      : buildCuratedStaySuggestions(destination, trip?.userSelection ?? {});
  const travelTips = normalizeStringArray(trip?.aiPlan?.travelTips, []);
  const model = {
    appTitle: PDF_BRAND.appTitle,
    brandSubtitle: PDF_BRAND.subtitle,
    title: `${destination} Trip Plan`,
    coverTitle: buildCoverTitle(destination, trip?.userSelection?.budget),
    coverSubtitle: buildCoverSubtitle(
      destination,
      trip?.userSelection ?? {},
      days.length
    ),
    coverSummary: buildCoverSummary(destination, days),
    heroImageUrl: getTripImage(destination),
    destination,
    fileName: buildTripFileName(destination),
    generatedAt,
    generatedAtLabel: formatGeneratedAt(generatedAt),
    overview: {
      summary: buildOverviewSummary(destination, days),
      items: buildOverviewItems({
        destination,
        selection: trip?.userSelection ?? {},
        totalEstimatedCost,
        createdAt: trip?.createdAt,
        generatedAt,
        dayCount: days.length,
      }),
      highlights: buildOverviewHighlights(days),
    },
    days,
    itineraryEmptyMessage: "No day-wise itinerary is available for this trip yet.",
    hotels,
    staySection: {
      mode: hotels.length > 0 ? "real" : "curated",
      title: hotels.length > 0 ? "Hotel recommendations" : "Suggested stay areas",
      items: stayRecommendations,
    },
    hotelsEmptyMessage: "No hotel recommendations available.",
    totalEstimatedCost,
    budgetBreakdown: buildBudgetBreakdown(totalEstimatedCost),
    travelTips:
      travelTips.length > 0 ? travelTips : ["No additional travel tips available."],
  };

  console.info("[trip-pdf] Prepared trip PDF model", {
    tripId: trip?.id ?? null,
    destination: model.destination,
    dayCount: model.days.length,
    hotelCount: model.hotels.length,
    tipCount: model.travelTips.length,
  });

  return model;
}

async function resolvePdfClass(PdfClass) {
  if (PdfClass) {
    return PdfClass;
  }

  const module = await import("jspdf");
  return module.jsPDF ?? module.default?.jsPDF ?? module.default;
}

async function createPdfDocument(PdfClass) {
  const ResolvedPdfClass = await resolvePdfClass(PdfClass);

  return new ResolvedPdfClass({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });
}

function createRenderState(doc) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  return {
    doc,
    cursorY: PDF_LAYOUT.marginTop,
    pageWidth,
    pageHeight,
    contentWidth: pageWidth - PDF_LAYOUT.marginX * 2,
  };
}

function setFillColor(doc, color) {
  doc.setFillColor(...color);
}

function setDrawColor(doc, color) {
  doc.setDrawColor(...color);
}

function setTextColor(doc, color) {
  doc.setTextColor(...color);
}

function addPage(state) {
  state.doc.addPage();
  state.cursorY = PDF_LAYOUT.marginTop;
}

function ensureSpace(state, requiredHeight) {
  const remaining = state.pageHeight - PDF_LAYOUT.marginBottom - state.cursorY;
  if (requiredHeight <= remaining) {
    return;
  }

  addPage(state);
}

function splitLines(doc, text, width) {
  const safeText = sanitizePdfText(text);
  if (!safeText) {
    return [];
  }

  return doc.splitTextToSize(safeText, width);
}

function estimateLinesHeight(lines, lineHeight) {
  return lines.length > 0 ? lines.length * lineHeight : 0;
}

function resolveImageFormat(dataUrl) {
  if (typeof dataUrl !== "string") {
    return "PNG";
  }

  if (dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")) {
    return "JPEG";
  }

  if (dataUrl.startsWith("data:image/webp")) {
    return "WEBP";
  }

  return "PNG";
}

async function blobToDataUrl(blob) {
  const arrayBuffer = await blob.arrayBuffer();

  if (typeof globalThis.Buffer !== "undefined") {
    return `data:${blob.type};base64,${globalThis.Buffer.from(arrayBuffer).toString(
      "base64"
    )}`;
  }

  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return `data:${blob.type};base64,${btoa(binary)}`;
}

async function resolvePdfImageDataUrl(url, options = {}, cache = new Map()) {
  if (options.disableImages || !url || typeof fetch !== "function") {
    return "";
  }

  if (cache.has(url)) {
    return cache.get(url);
  }

  const promise = (async () => {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) {
        throw new Error(`Unexpected asset type: ${blob.type}`);
      }

      return await blobToDataUrl(blob);
    } catch (error) {
      console.warn("[trip-pdf] Unable to load image asset for PDF", {
        url,
        message: error instanceof Error ? error.message : String(error),
      });
      return "";
    }
  })();

  cache.set(url, promise);
  return promise;
}

async function resolvePdfLogoDataUrl(options = {}, cache = new Map()) {
  if (options.logoDataUrl) {
    return options.logoDataUrl;
  }

  const logoUrl = options.logoUrl ?? DEFAULT_PDF_LOGO_URL;
  return resolvePdfImageDataUrl(logoUrl, options, cache);
}

async function resolvePdfAssets(model, options = {}) {
  const cache = new Map();
  const logoDataUrlPromise = resolvePdfLogoDataUrl(options, cache);
  const heroImagePromise = resolvePdfImageDataUrl(model.heroImageUrl, options, cache);
  const dayImagePromises = model.days.map((day) =>
    resolvePdfImageDataUrl(day.imageUrl, options, cache)
  );

  const [logoDataUrl, heroImageDataUrl, ...dayImageDataUrls] = await Promise.all([
    logoDataUrlPromise,
    heroImagePromise,
    ...dayImagePromises,
  ]);

  model.heroImageDataUrl = heroImageDataUrl;
  model.days = model.days.map((day, index) => ({
    ...day,
    imageDataUrl: dayImageDataUrls[index] ?? "",
  }));

  return {
    logoDataUrl,
  };
}

function drawImageContained(doc, dataUrl, x, y, width, height) {
  if (!dataUrl) {
    return false;
  }

  try {
    const imageProps = doc.getImageProperties(dataUrl);
    const imageWidth = imageProps?.width ?? width;
    const imageHeight = imageProps?.height ?? height;
    const scale = Math.min(width / imageWidth, height / imageHeight);
    const renderWidth = imageWidth * scale;
    const renderHeight = imageHeight * scale;
    const renderX = x + (width - renderWidth) / 2;
    const renderY = y + (height - renderHeight) / 2;

    doc.addImage(
      dataUrl,
      resolveImageFormat(dataUrl),
      renderX,
      renderY,
      renderWidth,
      renderHeight
    );
    return true;
  } catch (error) {
    console.warn("[trip-pdf] Failed to embed image into PDF", {
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function drawBrandBadge(doc, x, y, size, logoDataUrl = "") {
  if (logoDataUrl && drawImageContained(doc, logoDataUrl, x, y, size, size)) {
    return;
  }

  setFillColor(doc, PDF_COLORS.greenDeep);
  doc.roundedRect(x, y, size, size, 6, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  setTextColor(doc, PDF_COLORS.surface);
  doc.text("AI", x + size / 2, y + size / 2 + 2, { align: "center" });
}

function drawSectionHeading(state, eyebrow, title) {
  ensureSpace(state, 16);

  const { doc } = state;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setTextColor(doc, PDF_COLORS.gold);
  doc.text(sanitizePdfText(eyebrow).toUpperCase(), PDF_LAYOUT.marginX, state.cursorY);
  state.cursorY += 4;

  doc.setFont("times", "bold");
  doc.setFontSize(18);
  setTextColor(doc, PDF_COLORS.navyDeep);
  doc.text(sanitizePdfText(title), PDF_LAYOUT.marginX, state.cursorY);
  state.cursorY += 8;
}

function drawCoverChip(doc, x, y, label, value) {
  const pillWidth = Math.max(doc.getTextWidth(label) + doc.getTextWidth(value) + 12, 34);

  setFillColor(doc, PDF_COLORS.surface);
  doc.roundedRect(x, y, pillWidth, 12, 6, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  setTextColor(doc, PDF_COLORS.gold);
  doc.text(sanitizePdfText(label).toUpperCase(), x + 4, y + 4.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.7);
  setTextColor(doc, PDF_COLORS.ink);
  doc.text(sanitizePdfText(value), x + 4, y + 9.2);

  return pillWidth;
}

function drawCoverPage(state, model, logoDataUrl = "") {
  const { doc, pageWidth, pageHeight, contentWidth } = state;

  setFillColor(doc, PDF_COLORS.sand);
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  const heroX = PDF_LAYOUT.marginX;
  const heroY = 22;
  const heroWidth = contentWidth;
  const heroHeight = 88;

  setFillColor(doc, PDF_COLORS.greenSoft);
  setDrawColor(doc, PDF_COLORS.border);
  doc.roundedRect(heroX, heroY, heroWidth, heroHeight, 8, 8, "FD");
  drawImageContained(doc, model.heroImageDataUrl, heroX, heroY, heroWidth, heroHeight);

  setFillColor(doc, PDF_COLORS.greenDeep);
  doc.roundedRect(heroX + 8, heroY + heroHeight - 24, 92, 18, 6, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setTextColor(doc, PDF_COLORS.surface);
  doc.text(sanitizePdfText(PDF_BRAND.appTitle), heroX + 14, heroY + heroHeight - 16.2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text("Premium travel brief", heroX + 14, heroY + heroHeight - 10.5);

  const badgeX = PDF_LAYOUT.marginX;
  const badgeY = 8;
  drawBrandBadge(doc, badgeX, badgeY, 10, logoDataUrl);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.8);
  setTextColor(doc, PDF_COLORS.greenDeep);
  doc.text(sanitizePdfText(model.appTitle), badgeX + 14, badgeY + 6.6);

  const generatedLabel = `Generated ${sanitizePdfText(model.generatedAtLabel)}`;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setTextColor(doc, PDF_COLORS.muted);
  doc.text(generatedLabel, pageWidth - PDF_LAYOUT.marginX, badgeY + 6.6, {
    align: "right",
  });

  const titleLines = splitLines(doc, model.coverTitle, contentWidth);
  const subtitleLines = splitLines(doc, model.coverSubtitle, contentWidth);
  const summaryLines = splitLines(doc, model.coverSummary, contentWidth - 2);
  let textY = 126;

  doc.setFont("times", "bold");
  doc.setFontSize(26);
  setTextColor(doc, PDF_COLORS.navyDeep);
  doc.text(titleLines, PDF_LAYOUT.marginX, textY);
  textY += estimateLinesHeight(titleLines, 9) + 1;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  setTextColor(doc, PDF_COLORS.gold);
  doc.text(subtitleLines, PDF_LAYOUT.marginX, textY);
  textY += estimateLinesHeight(subtitleLines, 5) + 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  setTextColor(doc, PDF_COLORS.muted);
  doc.text(summaryLines, PDF_LAYOUT.marginX, textY);
  textY += estimateLinesHeight(summaryLines, 4.8) + 7;

  const durationValue =
    model.overview.items.find((item) => item.label === "Duration")?.value ?? "";
  const budgetValue =
    model.overview.items.find((item) => item.label === "Budget")?.value ?? "";
  const travelersValue =
    model.overview.items.find((item) => item.label === "Travelers")?.value ?? "";

  let chipX = PDF_LAYOUT.marginX;
  chipX += drawCoverChip(doc, chipX, textY, "Duration", durationValue) + 4;
  chipX += drawCoverChip(doc, chipX, textY, "Budget", budgetValue) + 4;
  drawCoverChip(doc, chipX, textY, "Travelers", travelersValue);
  textY += 18;

  const highlightsHeight = 38;
  setFillColor(doc, PDF_COLORS.surface);
  setDrawColor(doc, PDF_COLORS.border);
  doc.roundedRect(
    PDF_LAYOUT.marginX,
    pageHeight - PDF_LAYOUT.marginBottom - highlightsHeight,
    contentWidth,
    highlightsHeight,
    5,
    5,
    "FD"
  );
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setTextColor(doc, PDF_COLORS.gold);
  doc.text(
    "HIGHLIGHTS",
    PDF_LAYOUT.marginX + 6,
    pageHeight - PDF_LAYOUT.marginBottom - highlightsHeight + 6.5
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.2);
  setTextColor(doc, PDF_COLORS.ink);
  model.overview.highlights.slice(0, 3).forEach((highlight, index) => {
    doc.text(
      `- ${sanitizePdfText(highlight)}`,
      PDF_LAYOUT.marginX + 6,
      pageHeight - PDF_LAYOUT.marginBottom - highlightsHeight + 13 + index * 7.5
    );
  });

  addPage(state);
}

function drawOverviewSpread(state, model) {
  drawSectionHeading(state, "Overview", "Journey overview");

  const { doc, contentWidth } = state;
  const summaryLines = splitLines(doc, model.overview.summary, contentWidth - 14);
  const summaryHeight = 16 + estimateLinesHeight(summaryLines, 5);

  ensureSpace(state, summaryHeight + 60);

  setFillColor(doc, PDF_COLORS.navySoft);
  setDrawColor(doc, PDF_COLORS.border);
  doc.roundedRect(
    PDF_LAYOUT.marginX,
    state.cursorY,
    contentWidth,
    summaryHeight,
    PDF_LAYOUT.cardRadius,
    PDF_LAYOUT.cardRadius,
    "FD"
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  setTextColor(doc, PDF_COLORS.ink);
  doc.text(summaryLines, PDF_LAYOUT.marginX + 7, state.cursorY + 10);
  state.cursorY += summaryHeight + 8;

  const columnGap = 6;
  const cardWidth = (contentWidth - columnGap) / 2;
  const cardHeight = 18;

  model.overview.items.forEach((item, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = PDF_LAYOUT.marginX + column * (cardWidth + columnGap);
    const y = state.cursorY + row * (cardHeight + 4);

    setFillColor(doc, PDF_COLORS.surface);
    setDrawColor(doc, PDF_COLORS.border);
    doc.roundedRect(x, y, cardWidth, cardHeight, 4, 4, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.4);
    setTextColor(doc, PDF_COLORS.gold);
    doc.text(sanitizePdfText(item.label).toUpperCase(), x + 5, y + 6);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.6);
    setTextColor(doc, PDF_COLORS.navyDeep);
    doc.text(splitLines(doc, item.value, cardWidth - 10), x + 5, y + 12);
  });

  state.cursorY += Math.ceil(model.overview.items.length / 2) * (cardHeight + 4) + 8;

  if (model.overview.highlights.length > 0) {
    const highlightLines = model.overview.highlights.map((highlight) =>
      splitLines(doc, highlight, contentWidth - 16)
    );
    const highlightsHeight =
      12 +
      highlightLines.reduce(
        (total, lines) => total + estimateLinesHeight(lines, 4.5) + 2,
        0
      );

    ensureSpace(state, highlightsHeight);
    setFillColor(doc, PDF_COLORS.surfaceAlt);
    setDrawColor(doc, PDF_COLORS.border);
    doc.roundedRect(
      PDF_LAYOUT.marginX,
      state.cursorY,
      contentWidth,
      highlightsHeight,
      4,
      4,
      "FD"
    );

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setTextColor(doc, PDF_COLORS.gold);
    doc.text("Trip highlights".toUpperCase(), PDF_LAYOUT.marginX + 6, state.cursorY + 6.5);

    let highlightY = state.cursorY + 13;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.2);
    setTextColor(doc, PDF_COLORS.ink);
    highlightLines.forEach((lines) => {
      doc.text(lines, PDF_LAYOUT.marginX + 8, highlightY);
      highlightY += estimateLinesHeight(lines, 4.5) + 2;
    });

    state.cursorY += highlightsHeight + PDF_LAYOUT.sectionGap;
  }

  addPage(state);
}

function estimateDayBlockHeight(doc, day, width) {
  const imageHeight = day.imageDataUrl ? 34 : 0;
  const costPillWidth = hasMeaningfulValue(day.estimatedCost)
    ? Math.min(Math.max(doc.getTextWidth(sanitizePdfText(day.estimatedCost)) + 12, 38), 58)
    : 0;
  const titleLines = splitLines(doc, day.title, width - 14 - costPillWidth);
  const introLines = splitLines(doc, day.intro, width - 14);
  const signatureLines = splitLines(doc, day.signatureMoment, width - 18);
  const activityHeight = day.activities.reduce((total, activity) => {
    const lines = splitLines(doc, activity, width - 20);
    return total + estimateLinesHeight(lines, 4.2) + 2;
  }, 0);
  const noteLines = day.notes ? splitLines(doc, day.notes, width - 18) : [];

  return (
    16 +
    imageHeight +
    estimateLinesHeight(titleLines, 5.5) +
    estimateLinesHeight(introLines, 4.5) +
    14 +
    estimateLinesHeight(signatureLines, 4.2) +
    activityHeight +
    (noteLines.length > 0 ? estimateLinesHeight(noteLines, 4.1) + 10 : 0)
  );
}

function drawActivityList(doc, day, x, startY, width) {
  let cursorY = startY;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.2);
  setTextColor(doc, PDF_COLORS.ink);

  day.activities.forEach((activity) => {
    const lines = splitLines(doc, activity, width - 10);
    setFillColor(doc, PDF_COLORS.gold);
    doc.circle(x + 2, cursorY - 1.1, 0.85, "F");
    doc.text(lines, x + 6, cursorY);
    cursorY += estimateLinesHeight(lines, 4.2) + 2;
  });

  return cursorY;
}

function drawDaySections(state, model) {
  drawSectionHeading(state, "Itinerary", "Day-by-day journey");

  if (!model.days.length) {
    ensureSpace(state, 18);
    const { doc, contentWidth } = state;
    setFillColor(doc, PDF_COLORS.surfaceAlt);
    setDrawColor(doc, PDF_COLORS.border);
    doc.roundedRect(PDF_LAYOUT.marginX, state.cursorY, contentWidth, 18, 4, 4, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.4);
    setTextColor(doc, PDF_COLORS.muted);
    doc.text(
      splitLines(doc, model.itineraryEmptyMessage, contentWidth - 12),
      PDF_LAYOUT.marginX + 6,
      state.cursorY + 9
    );
    state.cursorY += 18 + PDF_LAYOUT.sectionGap;
    return;
  }

  const { doc, contentWidth } = state;

  model.days.forEach((day) => {
    const blockHeight = estimateDayBlockHeight(doc, day, contentWidth);
    ensureSpace(state, blockHeight);

    const x = PDF_LAYOUT.marginX;
    const y = state.cursorY;

    setFillColor(doc, PDF_COLORS.surface);
    setDrawColor(doc, PDF_COLORS.border);
    doc.roundedRect(x, y, contentWidth, blockHeight, 5, 5, "FD");

    let contentY = y + 6;
    if (day.imageDataUrl) {
      setFillColor(doc, PDF_COLORS.greenSoft);
      doc.roundedRect(x + 5, y + 5, contentWidth - 10, 34, 4, 4, "F");
      drawImageContained(doc, day.imageDataUrl, x + 5, y + 5, contentWidth - 10, 34);
      contentY += 38;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    setTextColor(doc, PDF_COLORS.gold);
    doc.text(sanitizePdfText(day.label).toUpperCase(), x + 6, contentY);

    const hasCost = hasMeaningfulValue(day.estimatedCost);
    let titleWidth = contentWidth - 14;
    let pillWidth = 0;
    if (hasCost) {
      pillWidth = Math.min(
        Math.max(doc.getTextWidth(sanitizePdfText(day.estimatedCost)) + 12, 38),
        58
      );
      titleWidth -= pillWidth + 4;
      setFillColor(doc, PDF_COLORS.goldSoft);
      doc.roundedRect(x + contentWidth - pillWidth - 6, contentY - 5, pillWidth, 8, 4, 4, "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.1);
      setTextColor(doc, PDF_COLORS.gold);
      doc.text(sanitizePdfText(day.estimatedCost), x + contentWidth - 8, contentY, {
        align: "right",
      });
    }

    const titleLines = splitLines(doc, day.title, titleWidth);
    contentY += 5;
    doc.setFont("times", "bold");
    doc.setFontSize(14);
    setTextColor(doc, PDF_COLORS.navyDeep);
    doc.text(titleLines, x + 6, contentY);
    contentY += estimateLinesHeight(titleLines, 5.5) + 2;

    const introLines = splitLines(doc, day.intro, contentWidth - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    setTextColor(doc, PDF_COLORS.muted);
    doc.text(introLines, x + 6, contentY);
    contentY += estimateLinesHeight(introLines, 4.5) + 4;

    const signatureLines = splitLines(doc, day.signatureMoment, contentWidth - 18);
    const signatureHeight = 11 + estimateLinesHeight(signatureLines, 4.2);
    setFillColor(doc, PDF_COLORS.goldSoft);
    doc.roundedRect(x + 6, contentY - 3.5, contentWidth - 12, signatureHeight, 4, 4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    setTextColor(doc, PDF_COLORS.gold);
    doc.text("Signature moment".toUpperCase(), x + 10, contentY + 1);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setTextColor(doc, PDF_COLORS.ink);
    doc.text(signatureLines, x + 10, contentY + 6);
    contentY += signatureHeight + 4;

    contentY = drawActivityList(doc, day, x + 6, contentY, contentWidth - 12);

    if (day.notes) {
      const noteLines = splitLines(doc, day.notes, contentWidth - 18);
      setDrawColor(doc, PDF_COLORS.border);
      doc.line(x + 6, contentY, x + contentWidth - 6, contentY);
      contentY += 5;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.2);
      setTextColor(doc, PDF_COLORS.gold);
      doc.text("Practical note".toUpperCase(), x + 6, contentY);
      contentY += 4.5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.9);
      setTextColor(doc, PDF_COLORS.muted);
      doc.text(noteLines, x + 6, contentY);
    }

    state.cursorY += blockHeight + 7;
  });
}

function estimateStayCardHeight(doc, item, width) {
  return (
    18 +
    estimateLinesHeight(splitLines(doc, item.title, width - 12), 5) +
    estimateLinesHeight(splitLines(doc, item.descriptor, width - 12), 4.1) +
    estimateLinesHeight(splitLines(doc, item.description, width - 12), 4.2)
  );
}

function drawStaySection(state, model) {
  drawSectionHeading(state, "Stay", model.staySection.title);

  const { doc, contentWidth } = state;

  model.staySection.items.forEach((item) => {
    const cardHeight = estimateStayCardHeight(doc, item, contentWidth);
    ensureSpace(state, cardHeight);

    setFillColor(doc, PDF_COLORS.surface);
    setDrawColor(doc, PDF_COLORS.border);
    doc.roundedRect(
      PDF_LAYOUT.marginX,
      state.cursorY,
      contentWidth,
      cardHeight,
      4,
      4,
      "FD"
    );

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    setTextColor(doc, PDF_COLORS.gold);
    doc.text(
      sanitizePdfText(item.eyebrow).toUpperCase(),
      PDF_LAYOUT.marginX + 6,
      state.cursorY + 7
    );

    doc.setFont("times", "bold");
    doc.setFontSize(12.2);
    setTextColor(doc, PDF_COLORS.navyDeep);
    doc.text(
      splitLines(doc, item.title, contentWidth - 12),
      PDF_LAYOUT.marginX + 6,
      state.cursorY + 14
    );

    let textY =
      state.cursorY +
      16 +
      estimateLinesHeight(splitLines(doc, item.title, contentWidth - 12), 5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.9);
    setTextColor(doc, PDF_COLORS.gold);
    doc.text(splitLines(doc, item.descriptor, contentWidth - 12), PDF_LAYOUT.marginX + 6, textY);
    textY += estimateLinesHeight(splitLines(doc, item.descriptor, contentWidth - 12), 4.1) + 3;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setTextColor(doc, PDF_COLORS.muted);
    doc.text(
      splitLines(doc, item.description, contentWidth - 12),
      PDF_LAYOUT.marginX + 6,
      textY
    );

    state.cursorY += cardHeight + 5;
  });

  state.cursorY += 2;
}

function drawBudgetSnapshot(state, model) {
  drawSectionHeading(state, "Budget", "Investment snapshot");

  const { doc, contentWidth } = state;
  const rows = Math.ceil(model.budgetBreakdown.length / 2);
  const blockHeight = 28 + rows * 18;

  ensureSpace(state, blockHeight);

  setFillColor(doc, PDF_COLORS.goldSoft);
  setDrawColor(doc, PDF_COLORS.border);
  doc.roundedRect(
    PDF_LAYOUT.marginX,
    state.cursorY,
    contentWidth,
    blockHeight,
    4,
    4,
    "FD"
  );

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setTextColor(doc, PDF_COLORS.gold);
  doc.text("Estimated total".toUpperCase(), PDF_LAYOUT.marginX + 6, state.cursorY + 7);
  doc.setFont("times", "bold");
  doc.setFontSize(18);
  setTextColor(doc, PDF_COLORS.navyDeep);
  doc.text(sanitizePdfText(model.totalEstimatedCost), PDF_LAYOUT.marginX + 6, state.cursorY + 16);

  const columnGap = 6;
  const cardWidth = (contentWidth - 12 - columnGap) / 2;
  const startY = state.cursorY + 24;

  model.budgetBreakdown.forEach((item, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = PDF_LAYOUT.marginX + 6 + column * (cardWidth + columnGap);
    const y = startY + row * 18;

    setFillColor(doc, PDF_COLORS.surface);
    doc.roundedRect(x, y, cardWidth, 14, 3, 3, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    setTextColor(doc, PDF_COLORS.gold);
    doc.text(sanitizePdfText(item.label).toUpperCase(), x + 4, y + 4.8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.8);
    setTextColor(doc, PDF_COLORS.ink);
    doc.text(splitLines(doc, item.value, cardWidth - 8), x + 4, y + 10);
  });

  state.cursorY += blockHeight + PDF_LAYOUT.sectionGap;
}

function drawTravelNotes(state, model) {
  drawSectionHeading(state, "Tips", "Smart travel notes");

  const { doc, contentWidth } = state;

  model.travelTips.forEach((tip) => {
    const lines = splitLines(doc, tip, contentWidth - 18);
    const cardHeight = 11 + estimateLinesHeight(lines, 4.2);
    ensureSpace(state, cardHeight);

    setFillColor(doc, PDF_COLORS.surfaceAlt);
    setDrawColor(doc, PDF_COLORS.border);
    doc.roundedRect(
      PDF_LAYOUT.marginX,
      state.cursorY,
      contentWidth,
      cardHeight,
      3,
      3,
      "FD"
    );
    setFillColor(doc, PDF_COLORS.gold);
    doc.roundedRect(PDF_LAYOUT.marginX, state.cursorY, 3, cardHeight, 2, 2, "F");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setTextColor(doc, PDF_COLORS.ink);
    doc.text(lines, PDF_LAYOUT.marginX + 8, state.cursorY + 6.5);

    state.cursorY += cardHeight + 4;
  });
}

function decoratePages(doc, model) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageCount = doc.getNumberOfPages();

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber);

    if (pageNumber === 1) {
      continue;
    }

    setDrawColor(doc, PDF_COLORS.border);
    doc.line(
      PDF_LAYOUT.marginX,
      pageHeight - 10,
      pageWidth - PDF_LAYOUT.marginX,
      pageHeight - 10
    );

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setTextColor(doc, PDF_COLORS.muted);
    doc.text(
      sanitizePdfText(getPrimaryDestinationName(model.destination)),
      PDF_LAYOUT.marginX,
      pageHeight - 5.5
    );
    doc.text(
      `Page ${pageNumber} of ${pageCount}`,
      pageWidth - PDF_LAYOUT.marginX,
      pageHeight - 5.5,
      { align: "right" }
    );
  }
}

export async function createTripPdfDocument(trip, options = {}) {
  const model = buildTripPdfDocumentModel(trip, options);
  const doc = options.doc ?? (await createPdfDocument(options.PdfClass));
  const assets = await resolvePdfAssets(model, options);
  const state = createRenderState(doc);

  doc.setProperties({
    title: model.title,
    subject: `Travel itinerary for ${model.destination}`,
    author: PDF_BRAND.appTitle,
    creator: PDF_BRAND.appTitle,
    keywords: "travel,itinerary,trip,pdf,ai travel planner",
  });

  drawCoverPage(state, model, assets.logoDataUrl);
  drawOverviewSpread(state, model);
  drawDaySections(state, model);
  drawStaySection(state, model);
  drawBudgetSnapshot(state, model);
  drawTravelNotes(state, model);
  decoratePages(doc, model);

  console.debug("[trip-pdf] PDF document rendered", {
    destination: model.destination,
    pages: doc.getNumberOfPages(),
  });

  return { doc, model };
}

export async function downloadTripPlanPdf(trip, options = {}) {
  const { doc, model } = await createTripPdfDocument(trip, options);
  const saveFn = options.saveFn ?? ((pdfDocument, fileName) => pdfDocument.save(fileName));

  console.info("[trip-pdf] Saving trip PDF", {
    tripId: trip?.id ?? null,
    destination: model.destination,
    fileName: model.fileName,
  });

  saveFn(doc, model.fileName);

  return {
    doc,
    model,
    fileName: model.fileName,
  };
}
