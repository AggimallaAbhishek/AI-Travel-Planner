const PDF_LAYOUT = {
  marginX: 16,
  marginTop: 18,
  marginBottom: 16,
  sectionGap: 10,
};

const PDF_COLORS = {
  ink: [31, 41, 55],
  muted: [96, 108, 128],
  faint: [153, 161, 175],
  gold: [184, 144, 47],
  goldSoft: [246, 238, 224],
  greenDeep: [36, 59, 46],
  greenSoft: [232, 240, 235],
  surface: [255, 255, 255],
  surfaceAlt: [249, 246, 240],
  border: [227, 232, 240],
};

const PDF_BRAND = {
  appTitle: "AI Travel Planner",
  subtitle: "Professional AI-generated itinerary and travel brief",
};

const DEFAULT_PDF_LOGO_URL = `${
  typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
    ? import.meta.env.BASE_URL
    : "/"
}logo-1.png`;

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
  return normalizeText(typeof value === "string" ? value : String(value ?? ""), fallback);
}

function buildDayFromAiPlan(day, index) {
  const dayNumber = Number.isFinite(day?.day) ? day.day : index + 1;
  const activities = normalizeStringArray(day?.activities, []);

  return {
    day: dayNumber,
    label: `Day ${dayNumber}`,
    title: normalizeText(day?.title, `Day ${dayNumber}`),
    activities: activities.length > 0 ? activities : ["No activities available."],
    notes: normalizeText(day?.tips),
    estimatedCost: normalizeText(day?.estimatedCost, "Not specified"),
  };
}

function buildDayFromItinerary(day, index) {
  const dayNumber = Number.isFinite(day?.dayNumber) ? day.dayNumber : index + 1;
  const places = Array.isArray(day?.places) ? day.places : [];
  const activities = places
    .map((place) => normalizeText(place?.placeName))
    .filter(Boolean);
  const notes =
    places.map((place) => normalizeText(place?.placeDetails)).find(Boolean) ?? "";
  const estimatedCost =
    places
      .map((place) => normalizeText(place?.ticketPricing))
      .find((value) => value && value.toLowerCase() !== "n/a") ?? "Not specified";

  return {
    day: dayNumber,
    label: `Day ${dayNumber}`,
    title: normalizeText(day?.title, `Day ${dayNumber}`),
    activities: activities.length > 0 ? activities : ["No activities available."],
    notes,
    estimatedCost,
  };
}

function buildHotelEntry(hotel, index) {
  return {
    id: `${normalizeText(hotel?.hotelName, "hotel")}-${index}`,
    name: normalizeText(hotel?.hotelName, `Hotel ${index + 1}`),
    address: normalizeText(hotel?.hotelAddress, "Address not provided"),
    price: normalizeText(hotel?.price, "Price not specified"),
    rating: hotel?.rating == null ? "Rating not specified" : `${hotel.rating}/5`,
    description: normalizeText(
      hotel?.description,
      "No additional hotel details were provided."
    ),
  };
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
    {
      label: "Duration",
      value: `${durationDays} day${durationDays === 1 ? "" : "s"}`,
    },
    {
      label: "Budget",
      value: normalizeValue(selection?.budget, "Not specified"),
    },
    {
      label: "Travelers",
      value: normalizeValue(selection?.travelers, "Not specified"),
    },
    {
      label: "Created",
      value: formatCreatedAt(createdAt),
    },
    {
      label: "Generated",
      value: formatGeneratedAt(generatedAt),
    },
    {
      label: "Estimated Cost",
      value: totalEstimatedCost,
    },
  ];
}

function buildSummary(destination, days) {
  const activityCount = days.reduce(
    (total, day) => total + (Array.isArray(day.activities) ? day.activities.length : 0),
    0
  );

  if (!days.length) {
    return `A trip document for ${destination} with no itinerary days available yet.`;
  }

  const activityLabel = activityCount === 1 ? "activity" : "activities";
  return `${days.length}-day itinerary for ${destination} with ${activityCount} planned ${activityLabel}.`;
}

export function buildTripPdfDocumentModel(trip = {}, options = {}) {
  const destination = normalizeText(
    trip?.aiPlan?.destination ?? trip?.userSelection?.location?.label,
    "Unknown destination"
  );
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const aiPlanDays = Array.isArray(trip?.aiPlan?.days) ? trip.aiPlan.days : [];
  const itineraryDays = Array.isArray(trip?.itinerary?.days) ? trip.itinerary.days : [];
  const days = (aiPlanDays.length > 0 ? aiPlanDays.map(buildDayFromAiPlan) : itineraryDays.map(buildDayFromItinerary)).sort(
    (left, right) => left.day - right.day
  );
  const totalEstimatedCost = normalizeText(
    trip?.aiPlan?.totalEstimatedCost ?? trip?.totalEstimatedCost,
    "Not specified"
  );
  const hotels = Array.isArray(trip?.hotels) ? trip.hotels.map(buildHotelEntry) : [];
  const travelTips = normalizeStringArray(trip?.aiPlan?.travelTips, []);
  const model = {
    appTitle: PDF_BRAND.appTitle,
    brandSubtitle: PDF_BRAND.subtitle,
    title: `${destination} Trip Plan`,
    destination,
    fileName: buildTripFileName(destination),
    generatedAt,
    generatedAtLabel: formatGeneratedAt(generatedAt),
    overview: {
      summary: buildSummary(destination, days),
      items: buildOverviewItems({
        destination,
        selection: trip?.userSelection ?? {},
        totalEstimatedCost,
        createdAt: trip?.createdAt,
        generatedAt,
        dayCount: days.length,
      }),
    },
    days,
    itineraryEmptyMessage: "No day-wise itinerary is available for this trip yet.",
    hotels,
    hotelsEmptyMessage: "No hotel recommendations available.",
    totalEstimatedCost,
    travelTips: travelTips.length > 0 ? travelTips : ["No additional travel tips available."],
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

function drawSectionHeading(state, eyebrow, title) {
  ensureSpace(state, 16);

  const { doc } = state;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setTextColor(doc, PDF_COLORS.gold);
  doc.text(sanitizePdfText(eyebrow).toUpperCase(), PDF_LAYOUT.marginX, state.cursorY);
  state.cursorY += 4;

  doc.setFontSize(15);
  setTextColor(doc, PDF_COLORS.ink);
  doc.text(sanitizePdfText(title), PDF_LAYOUT.marginX, state.cursorY);
  state.cursorY += 7;
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
    return `data:${blob.type};base64,${globalThis.Buffer.from(arrayBuffer).toString("base64")}`;
  }

  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return `data:${blob.type};base64,${btoa(binary)}`;
}

async function resolvePdfLogoDataUrl(options = {}) {
  if (options.logoDataUrl) {
    return options.logoDataUrl;
  }

  const logoUrl = options.logoUrl ?? DEFAULT_PDF_LOGO_URL;

  if (!logoUrl || typeof fetch !== "function") {
    return "";
  }

  try {
    const response = await fetch(logoUrl);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } catch (error) {
    console.warn("[trip-pdf] Unable to load PDF logo asset", {
      logoUrl,
      message: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
}

function drawBrandBadge(doc, x, y, size, logoDataUrl = "") {
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, resolveImageFormat(logoDataUrl), x, y, size, size);
      return;
    } catch (error) {
      console.warn("[trip-pdf] Failed to embed logo image into PDF", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  setFillColor(doc, PDF_COLORS.greenDeep);
  doc.roundedRect(x, y, size, size, 6, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  setTextColor(doc, PDF_COLORS.surface);
  doc.text("AI", x + size / 2, y + size / 2 + 2, { align: "center" });
}

function drawHeader(state, model, logoDataUrl = "") {
  const { doc, contentWidth } = state;
  const summaryLines = splitLines(doc, model.overview.summary, contentWidth - 24);
  const titleLines = splitLines(doc, model.title, contentWidth - 42);
  const subtitleLines = splitLines(doc, model.brandSubtitle, contentWidth - 42);
  const blockHeight =
    24 +
    estimateLinesHeight(titleLines, 6.8) +
    estimateLinesHeight(subtitleLines, 4.3) +
    estimateLinesHeight(summaryLines, 4.4);

  ensureSpace(state, blockHeight);

  setFillColor(doc, PDF_COLORS.greenSoft);
  setDrawColor(doc, PDF_COLORS.border);
  doc.roundedRect(
    PDF_LAYOUT.marginX,
    state.cursorY,
    contentWidth,
    blockHeight,
    5,
    5,
    "FD"
  );

  setFillColor(doc, PDF_COLORS.gold);
  doc.roundedRect(PDF_LAYOUT.marginX, state.cursorY, contentWidth, 8, 5, 5, "F");

  const logoSize = 18;
  const logoX = PDF_LAYOUT.marginX + 6;
  const logoY = state.cursorY + 12;
  drawBrandBadge(doc, logoX, logoY, logoSize, logoDataUrl);

  const textX = logoX + logoSize + 6;
  let textY = state.cursorY + 17;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  setTextColor(doc, PDF_COLORS.greenDeep);
  doc.text(sanitizePdfText(model.appTitle), textX, textY - 5.5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  setTextColor(doc, PDF_COLORS.ink);
  doc.text(titleLines, textX, textY);
  textY += estimateLinesHeight(titleLines, 6.8) + 2;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setTextColor(doc, PDF_COLORS.muted);
  doc.text(subtitleLines, textX, textY);
  textY += estimateLinesHeight(subtitleLines, 4.3) + 3;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  setTextColor(doc, PDF_COLORS.muted);
  doc.text(summaryLines, textX, textY);

  const timestampWidth = 52;
  const timestampX = PDF_LAYOUT.marginX + contentWidth - timestampWidth - 6;
  const timestampY = state.cursorY + 14;
  setFillColor(doc, PDF_COLORS.surface);
  setDrawColor(doc, PDF_COLORS.border);
  doc.roundedRect(timestampX, timestampY, timestampWidth, 17, 4, 4, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  setTextColor(doc, PDF_COLORS.gold);
  doc.text("GENERATED", timestampX + 4, timestampY + 5.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setTextColor(doc, PDF_COLORS.ink);
  doc.text(
    splitLines(doc, model.generatedAtLabel, timestampWidth - 8),
    timestampX + 4,
    timestampY + 10.5
  );

  state.cursorY += blockHeight + PDF_LAYOUT.sectionGap;
}

function drawOverview(state, model) {
  drawSectionHeading(state, "Overview", "Trip overview");

  const { doc, contentWidth } = state;
  const summaryLines = splitLines(doc, model.overview.summary, contentWidth - 12);
  const rowHeight = 14;
  const rows = Math.ceil(model.overview.items.length / 2);
  const blockHeight = 12 + estimateLinesHeight(summaryLines, 4.8) + rows * rowHeight + 8;

  ensureSpace(state, blockHeight);

  const x = PDF_LAYOUT.marginX;
  const y = state.cursorY;
  setFillColor(doc, PDF_COLORS.surface);
  setDrawColor(doc, PDF_COLORS.border);
  doc.roundedRect(x, y, contentWidth, blockHeight, 4, 4, "FD");

  let cursorY = y + 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  setTextColor(doc, PDF_COLORS.muted);
  doc.text(summaryLines, x + 6, cursorY);
  cursorY += estimateLinesHeight(summaryLines, 4.8) + 5;

  const columnGap = 8;
  const columnWidth = (contentWidth - 12 - columnGap) / 2;

  model.overview.items.forEach((item, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const itemX = x + 6 + column * (columnWidth + columnGap);
    const itemY = cursorY + row * rowHeight;

    setFillColor(doc, PDF_COLORS.surfaceAlt);
    doc.roundedRect(itemX - 2, itemY - 4.5, columnWidth + 2, 11, 3, 3, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    setTextColor(doc, PDF_COLORS.gold);
    doc.text(sanitizePdfText(item.label).toUpperCase(), itemX, itemY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.4);
    setTextColor(doc, PDF_COLORS.ink);
    doc.text(splitLines(doc, item.value, columnWidth), itemX, itemY + 4.2);
  });

  state.cursorY += blockHeight + PDF_LAYOUT.sectionGap;
}

function estimateDayBlockHeight(doc, day, width) {
  const titleLines = splitLines(doc, day.title, width - 54);
  const activityHeights = day.activities
    .map((activity) => estimateLinesHeight(splitLines(doc, `- ${activity}`, width - 14), 4.3))
    .reduce((total, height) => total + height + 1, 0);
  const noteLines = day.notes ? splitLines(doc, `Notes: ${day.notes}`, width - 14) : [];
  const noteHeight = estimateLinesHeight(noteLines, 4.2);

  return 18 + estimateLinesHeight(titleLines, 5.2) + activityHeights + (noteHeight ? noteHeight + 6 : 0);
}

function drawDayBlocks(state, model) {
  drawSectionHeading(state, "Itinerary", "Day-wise itinerary");

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
    const pillText = sanitizePdfText(day.estimatedCost, "Not specified");
    const pillWidth = Math.min(Math.max(doc.getTextWidth(pillText) + 10, 34), 54);
    const titleWidth = contentWidth - 18 - pillWidth;
    const titleLines = splitLines(doc, day.title, titleWidth);

    setFillColor(doc, PDF_COLORS.surface);
    setDrawColor(doc, PDF_COLORS.border);
    doc.roundedRect(x, y, contentWidth, blockHeight, 4, 4, "FD");
    setFillColor(doc, PDF_COLORS.gold);
    doc.roundedRect(x, y, 3, blockHeight, 2, 2, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    setTextColor(doc, PDF_COLORS.gold);
    doc.text(sanitizePdfText(day.label).toUpperCase(), x + 6, y + 7);

    setFillColor(doc, PDF_COLORS.goldSoft);
    doc.roundedRect(x + contentWidth - pillWidth - 6, y + 5, pillWidth, 8, 4, 4, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.2);
    setTextColor(doc, PDF_COLORS.gold);
    doc.text(pillText, x + contentWidth - pillWidth - 1, y + 10.2, {
      align: "right",
    });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    setTextColor(doc, PDF_COLORS.ink);
    doc.text(titleLines, x + 6, y + 13);

    let contentY = y + 15 + estimateLinesHeight(titleLines, 5.2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.3);
    setTextColor(doc, PDF_COLORS.ink);

    day.activities.forEach((activity) => {
      const lines = splitLines(doc, `- ${activity}`, contentWidth - 14);
      doc.text(lines, x + 6, contentY);
      contentY += estimateLinesHeight(lines, 4.3) + 1;
    });

    if (day.notes) {
      contentY += 3;
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      setTextColor(doc, PDF_COLORS.muted);
      const noteLines = splitLines(doc, `Notes: ${day.notes}`, contentWidth - 14);
      doc.text(noteLines, x + 6, contentY);
    }

    state.cursorY += blockHeight + 5;
  });

  state.cursorY += 3;
}

function estimateHotelBlockHeight(doc, hotel, width) {
  const nameLines = splitLines(doc, hotel.name, width - 12);
  const addressLines = splitLines(doc, hotel.address, width - 12);
  const descriptionLines = splitLines(doc, hotel.description, width - 12);

  return (
    18 +
    estimateLinesHeight(nameLines, 5) +
    estimateLinesHeight(addressLines, 4.2) +
    estimateLinesHeight(descriptionLines, 4.2)
  );
}

function drawHotels(state, model) {
  drawSectionHeading(state, "Stay", "Hotel recommendations");

  if (!model.hotels.length) {
    ensureSpace(state, 18);
    const { doc, contentWidth } = state;
    setFillColor(doc, PDF_COLORS.surfaceAlt);
    setDrawColor(doc, PDF_COLORS.border);
    doc.roundedRect(PDF_LAYOUT.marginX, state.cursorY, contentWidth, 18, 4, 4, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.4);
    setTextColor(doc, PDF_COLORS.muted);
    doc.text(
      splitLines(doc, model.hotelsEmptyMessage, contentWidth - 12),
      PDF_LAYOUT.marginX + 6,
      state.cursorY + 9
    );
    state.cursorY += 18 + PDF_LAYOUT.sectionGap;
    return;
  }

  const { doc, contentWidth } = state;

  model.hotels.forEach((hotel) => {
    const blockHeight = estimateHotelBlockHeight(doc, hotel, contentWidth);
    ensureSpace(state, blockHeight);

    const x = PDF_LAYOUT.marginX;
    const y = state.cursorY;

    setFillColor(doc, PDF_COLORS.surface);
    setDrawColor(doc, PDF_COLORS.border);
    doc.roundedRect(x, y, contentWidth, blockHeight, 4, 4, "FD");
    setFillColor(doc, PDF_COLORS.greenDeep);
    doc.roundedRect(x, y, 3, blockHeight, 2, 2, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.4);
    setTextColor(doc, PDF_COLORS.ink);
    doc.text(splitLines(doc, hotel.name, contentWidth - 12), x + 6, y + 8);

    const metaText = `${hotel.price} | ${hotel.rating}`;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.6);
    setTextColor(doc, PDF_COLORS.gold);
    doc.text(
      splitLines(doc, metaText, contentWidth - 12),
      x + 6,
      y + 13 + estimateLinesHeight(splitLines(doc, hotel.name, contentWidth - 12), 5)
    );

    let contentY =
      y + 20 + estimateLinesHeight(splitLines(doc, hotel.name, contentWidth - 12), 5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setTextColor(doc, PDF_COLORS.muted);
    const addressLines = splitLines(doc, hotel.address, contentWidth - 12);
    doc.text(addressLines, x + 6, contentY);
    contentY += estimateLinesHeight(addressLines, 4.2) + 2;

    const descriptionLines = splitLines(doc, hotel.description, contentWidth - 12);
    doc.text(descriptionLines, x + 6, contentY);

    state.cursorY += blockHeight + 5;
  });

  state.cursorY += 3;
}

function drawTotalCost(state, model) {
  drawSectionHeading(state, "Budget", "Estimated total cost");

  const { doc, contentWidth } = state;
  const summary =
    "Use this estimate as a planning baseline and keep a contingency buffer for local transport, taxes, and last-minute changes.";
  const summaryLines = splitLines(doc, summary, contentWidth - 12);
  const blockHeight = 18 + estimateLinesHeight(summaryLines, 4.2);

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
  doc.setFontSize(16);
  setTextColor(doc, PDF_COLORS.ink);
  doc.text(sanitizePdfText(model.totalEstimatedCost), PDF_LAYOUT.marginX + 6, state.cursorY + 10);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.8);
  setTextColor(doc, PDF_COLORS.muted);
  doc.text(summaryLines, PDF_LAYOUT.marginX + 6, state.cursorY + 16);

  state.cursorY += blockHeight + PDF_LAYOUT.sectionGap;
}

function drawTravelTips(state, model) {
  drawSectionHeading(state, "Tips", "Additional travel tips");

  const { doc, contentWidth } = state;

  model.travelTips.forEach((tip) => {
    const lines = splitLines(doc, `- ${tip}`, contentWidth - 12);
    const blockHeight = 8 + estimateLinesHeight(lines, 4.2);
    ensureSpace(state, blockHeight);

    setFillColor(doc, PDF_COLORS.surfaceAlt);
    setDrawColor(doc, PDF_COLORS.border);
    doc.roundedRect(
      PDF_LAYOUT.marginX,
      state.cursorY,
      contentWidth,
      blockHeight,
      3,
      3,
      "FD"
    );

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setTextColor(doc, PDF_COLORS.ink);
    doc.text(lines, PDF_LAYOUT.marginX + 5, state.cursorY + 6.5);
    state.cursorY += blockHeight + 3;
  });
}

function decoratePages(doc, model) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageCount = doc.getNumberOfPages();

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber);
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
    doc.text(sanitizePdfText(model.appTitle), PDF_LAYOUT.marginX, pageHeight - 5.5);
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
  const logoDataUrl = await resolvePdfLogoDataUrl(options);
  const state = createRenderState(doc);

  doc.setProperties({
    title: model.title,
    subject: `Travel itinerary for ${model.destination}`,
    author: PDF_BRAND.appTitle,
    creator: PDF_BRAND.appTitle,
    keywords: "travel,itinerary,trip,pdf,ai travel planner",
  });

  drawHeader(state, model, logoDataUrl);
  drawOverview(state, model);
  drawDayBlocks(state, model);
  drawHotels(state, model);
  drawTotalCost(state, model);
  drawTravelTips(state, model);
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
