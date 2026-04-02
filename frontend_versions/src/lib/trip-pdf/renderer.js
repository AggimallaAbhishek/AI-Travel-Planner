import { buildTripPdfModel } from "./model.js";
import { registerPdfFonts, resolvePdfAssets } from "./assets.js";

const PAGE_LAYOUT = {
  marginX: 14,
  marginY: 14,
  sectionGap: 6,
};

const COLORS = {
  background: [247, 244, 238],
  surface: [255, 255, 255],
  border: [226, 223, 217],
  heading: [18, 40, 64],
  body: [56, 66, 80],
  muted: [104, 114, 126],
  accent: [188, 143, 63],
  accentSoft: [247, 239, 221],
  mapLine: [53, 122, 189],
  danger: [160, 70, 70],
};

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim() || fallback;
}

function sanitizePdfText(value, fallback = "") {
  return normalizeText(value, fallback)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[•]/g, "-")
    .replace(/\u00A0/g, " ");
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

function drawImageCover(doc, dataUrl, x, y, width, height) {
  if (!dataUrl) {
    return false;
  }

  try {
    const imageProperties = doc.getImageProperties(dataUrl);
    const sourceWidth = imageProperties?.width ?? width;
    const sourceHeight = imageProperties?.height ?? height;

    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const renderWidth = sourceWidth * scale;
    const renderHeight = sourceHeight * scale;
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
    console.warn("[trip-pdf:renderer] Failed to draw image", {
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function drawImageContain(doc, dataUrl, x, y, width, height) {
  if (!dataUrl) {
    return false;
  }

  try {
    const imageProperties = doc.getImageProperties(dataUrl);
    const sourceWidth = imageProperties?.width ?? width;
    const sourceHeight = imageProperties?.height ?? height;

    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    const renderWidth = sourceWidth * scale;
    const renderHeight = sourceHeight * scale;
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
    console.warn("[trip-pdf:renderer] Failed to draw contained image", {
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function createState(doc, fontSet) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  return {
    doc,
    pageWidth,
    pageHeight,
    contentWidth: pageWidth - PAGE_LAYOUT.marginX * 2,
    cursorY: PAGE_LAYOUT.marginY,
    fontSet,
  };
}

function applyBodyFont(state, weight = "normal") {
  const style = weight === "bold" ? "bold" : "normal";
  try {
    state.doc.setFont(state.fontSet.bodyFamily, style);
  } catch {
    state.doc.setFont("helvetica", style);
  }
}

function applyHeadingFont(state, weight = "bold") {
  const style = weight === "normal" ? "normal" : "bold";
  try {
    state.doc.setFont(state.fontSet.headingFamily, style);
  } catch {
    state.doc.setFont("helvetica", style);
  }
}

function addPage(state) {
  state.doc.addPage();
  state.cursorY = PAGE_LAYOUT.marginY;
}

function ensureSpace(state, requestedHeight) {
  const remaining = state.pageHeight - PAGE_LAYOUT.marginY - state.cursorY;
  if (requestedHeight <= remaining) {
    return;
  }

  addPage(state);
}

function splitLines(doc, text, maxWidth) {
  const safeText = sanitizePdfText(text);
  if (!safeText) {
    return [];
  }

  return doc.splitTextToSize(safeText, maxWidth);
}

function estimateTextHeight(lines, lineHeight) {
  return lines.length > 0 ? lines.length * lineHeight : 0;
}

function drawIconChip(state, { x, y, label, iconDataUrl }) {
  const { doc } = state;

  const chipWidth = Math.max(32, doc.getTextWidth(label) + 16);
  const chipHeight = 11;

  setFillColor(doc, COLORS.accentSoft);
  setDrawColor(doc, COLORS.border);
  doc.roundedRect(x, y, chipWidth, chipHeight, 5, 5, "FD");

  if (iconDataUrl) {
    drawImageContain(doc, iconDataUrl, x + 2.5, y + 2, 6.5, 6.5);
  }

  applyBodyFont(state, "bold");
  doc.setFontSize(8);
  setTextColor(doc, COLORS.heading);
  doc.text(label, x + 10.5, y + 7);

  return chipWidth;
}

function drawCoverPage(state, model, assets) {
  const { doc, contentWidth, pageWidth, pageHeight } = state;

  setFillColor(doc, COLORS.background);
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  const heroHeight = 86;
  const heroX = PAGE_LAYOUT.marginX;
  const heroY = 22;

  setFillColor(doc, COLORS.surface);
  setDrawColor(doc, COLORS.border);
  doc.roundedRect(heroX, heroY, contentWidth, heroHeight, 8, 8, "FD");
  drawImageCover(doc, assets.heroImageDataUrl, heroX, heroY, contentWidth, heroHeight);

  setFillColor(doc, [14, 24, 36]);
  doc.roundedRect(heroX, heroY + heroHeight - 24, contentWidth, 24, 0, 0, "F");

  applyBodyFont(state, "bold");
  doc.setFontSize(9);
  setTextColor(doc, [255, 255, 255]);
  doc.text("Premium Travel Brochure", heroX + 5, heroY + heroHeight - 9);

  if (assets.logoImageDataUrl) {
    drawImageContain(doc, assets.logoImageDataUrl, PAGE_LAYOUT.marginX, 9, 11, 11);
  }

  applyBodyFont(state, "bold");
  doc.setFontSize(8.5);
  setTextColor(doc, COLORS.heading);
  doc.text("AI Travel Planner", PAGE_LAYOUT.marginX + 13, 15.5);

  applyBodyFont(state, "normal");
  doc.setFontSize(8);
  setTextColor(doc, COLORS.muted);
  doc.text(
    `Generated ${sanitizePdfText(model.overview.generatedAt)}`,
    pageWidth - PAGE_LAYOUT.marginX,
    15.5,
    { align: "right" }
  );

  let textY = heroY + heroHeight + 11;

  applyHeadingFont(state, "bold");
  doc.setFontSize(24);
  setTextColor(doc, COLORS.heading);
  const titleLines = splitLines(doc, model.cover.title, contentWidth);
  doc.text(titleLines, PAGE_LAYOUT.marginX, textY);
  textY += estimateTextHeight(titleLines, 8.5) + 2;

  applyBodyFont(state, "bold");
  doc.setFontSize(10.5);
  setTextColor(doc, COLORS.accent);
  const subtitleLines = splitLines(doc, model.cover.subtitle, contentWidth);
  doc.text(subtitleLines, PAGE_LAYOUT.marginX, textY);
  textY += estimateTextHeight(subtitleLines, 4.8) + 3;

  applyBodyFont(state, "normal");
  doc.setFontSize(9.8);
  setTextColor(doc, COLORS.body);
  const summaryLines = splitLines(doc, model.cover.summary, contentWidth);
  doc.text(summaryLines, PAGE_LAYOUT.marginX, textY);
  textY += estimateTextHeight(summaryLines, 4.5) + 7;

  let chipX = PAGE_LAYOUT.marginX;
  chipX +=
    drawIconChip(state, {
      x: chipX,
      y: textY,
      label: model.overview.duration,
      iconDataUrl: assets.iconDataUrls.flight,
    }) + 4;
  chipX +=
    drawIconChip(state, {
      x: chipX,
      y: textY,
      label: model.overview.budget,
      iconDataUrl: assets.iconDataUrls.budget,
    }) + 4;

  drawIconChip(state, {
    x: chipX,
    y: textY,
    label: model.overview.travelStyle,
    iconDataUrl: assets.iconDataUrls.location,
  });

  addPage(state);
}

function drawSectionHeader(state, { title, subtitle = "", iconDataUrl = "" }) {
  ensureSpace(state, 16);

  const { doc } = state;
  const x = PAGE_LAYOUT.marginX;

  if (iconDataUrl) {
    drawImageContain(doc, iconDataUrl, x, state.cursorY - 1, 6.5, 6.5);
  }

  applyHeadingFont(state, "bold");
  doc.setFontSize(15);
  setTextColor(doc, COLORS.heading);
  doc.text(sanitizePdfText(title), x + 8, state.cursorY + 4.6);
  state.cursorY += 7;

  if (subtitle) {
    applyBodyFont(state, "normal");
    doc.setFontSize(9);
    setTextColor(doc, COLORS.muted);
    const lines = splitLines(doc, subtitle, state.contentWidth - 6);
    doc.text(lines, x, state.cursorY + 4);
    state.cursorY += estimateTextHeight(lines, 4.2);
  }

  state.cursorY += 3;
}

function drawOverviewSection(state, model, assets) {
  drawSectionHeader(state, {
    title: "Overview",
    subtitle: "Duration, budget, travel style, and generation metadata.",
    iconDataUrl: assets.iconDataUrls.location,
  });

  const { doc, contentWidth } = state;
  const cards = [
    { label: "Duration", value: model.overview.duration },
    { label: "Budget", value: model.overview.budget },
    { label: "Travel Style", value: model.overview.travelStyle },
    { label: "Travelers", value: model.overview.travelers },
    { label: "Created", value: model.overview.createdAt },
    { label: "Generated", value: model.overview.generatedAt },
  ];

  const columnGap = 4;
  const cardWidth = (contentWidth - columnGap) / 2;
  const cardHeight = 17;

  for (let index = 0; index < cards.length; index += 1) {
    if (index % 2 === 0) {
      ensureSpace(state, cardHeight + 2);
    }

    const column = index % 2;
    const rowOffset = Math.floor(index / 2) * (cardHeight + 2);
    const x = PAGE_LAYOUT.marginX + column * (cardWidth + columnGap);
    const y = state.cursorY + rowOffset;

    setFillColor(doc, COLORS.surface);
    setDrawColor(doc, COLORS.border);
    doc.roundedRect(x, y, cardWidth, cardHeight, 3.5, 3.5, "FD");

    applyBodyFont(state, "bold");
    doc.setFontSize(7.5);
    setTextColor(doc, COLORS.accent);
    doc.text(cards[index].label.toUpperCase(), x + 4, y + 5.5);

    applyBodyFont(state, "normal");
    doc.setFontSize(9.2);
    setTextColor(doc, COLORS.heading);
    const valueLines = splitLines(doc, cards[index].value, cardWidth - 8);
    doc.text(valueLines, x + 4, y + 10.5);
  }

  const totalRows = Math.ceil(cards.length / 2);
  state.cursorY += totalRows * (cardHeight + 2) + 1;

  const summaryHeight = 23;
  ensureSpace(state, summaryHeight);
  setFillColor(doc, COLORS.accentSoft);
  setDrawColor(doc, COLORS.border);
  doc.roundedRect(
    PAGE_LAYOUT.marginX,
    state.cursorY,
    contentWidth,
    summaryHeight,
    4,
    4,
    "FD"
  );

  applyBodyFont(state, "bold");
  doc.setFontSize(8);
  setTextColor(doc, COLORS.accent);
  doc.text("ESTIMATED TOTAL", PAGE_LAYOUT.marginX + 5, state.cursorY + 6.5);

  applyHeadingFont(state, "bold");
  doc.setFontSize(15);
  setTextColor(doc, COLORS.heading);
  doc.text(model.overview.totalEstimatedCost, PAGE_LAYOUT.marginX + 5, state.cursorY + 15.5);

  state.cursorY += summaryHeight + PAGE_LAYOUT.sectionGap;

  if (model.overview.highlights.length > 0) {
    const highlightLines = model.overview.highlights.map((item) =>
      splitLines(doc, item, contentWidth - 14)
    );
    const boxHeight =
      10 +
      highlightLines.reduce((sum, lines) => sum + estimateTextHeight(lines, 4.2) + 1.3, 0);

    ensureSpace(state, boxHeight);

    setFillColor(doc, COLORS.surface);
    setDrawColor(doc, COLORS.border);
    doc.roundedRect(
      PAGE_LAYOUT.marginX,
      state.cursorY,
      contentWidth,
      boxHeight,
      4,
      4,
      "FD"
    );

    applyBodyFont(state, "bold");
    doc.setFontSize(8);
    setTextColor(doc, COLORS.accent);
    doc.text("TRIP HIGHLIGHTS", PAGE_LAYOUT.marginX + 5, state.cursorY + 6.3);

    applyBodyFont(state, "normal");
    doc.setFontSize(9);
    setTextColor(doc, COLORS.body);

    let highlightY = state.cursorY + 12;
    for (const lines of highlightLines) {
      doc.text(`- ${sanitizePdfText(lines[0])}`, PAGE_LAYOUT.marginX + 5, highlightY);
      if (lines.length > 1) {
        doc.text(lines.slice(1), PAGE_LAYOUT.marginX + 8, highlightY + 4.1);
      }
      highlightY += estimateTextHeight(lines, 4.2) + 1.3;
    }

    state.cursorY += boxHeight + PAGE_LAYOUT.sectionGap;
  }
}

function drawItinerarySection(state, model, assets) {
  drawSectionHeader(state, {
    title: "Day-wise Itinerary",
    subtitle: "Daily activities, location cues, estimated costs, and practical tips.",
    iconDataUrl: assets.iconDataUrls.flight,
  });

  const { doc, contentWidth } = state;

  for (let dayIndex = 0; dayIndex < model.itinerary.days.length; dayIndex += 1) {
    const day = model.itinerary.days[dayIndex];
    const imageDataUrl = assets.dayImageDataUrls[dayIndex] || "";

    const activityLines = day.activities
      .slice(0, 6)
      .map((activity) => splitLines(doc, activity, contentWidth - 20));
    const tipLines = day.tip ? splitLines(doc, day.tip, contentWidth - 14) : [];

    const baseHeight =
      30 +
      (imageDataUrl ? 36 : 0) +
      activityLines.reduce((sum, lines) => sum + estimateTextHeight(lines, 3.9) + 1.4, 0) +
      (tipLines.length > 0 ? estimateTextHeight(tipLines, 3.9) + 7 : 0);

    ensureSpace(state, baseHeight);

    const cardX = PAGE_LAYOUT.marginX;
    const cardY = state.cursorY;

    setFillColor(doc, COLORS.surface);
    setDrawColor(doc, COLORS.border);
    doc.roundedRect(cardX, cardY, contentWidth, baseHeight, 4, 4, "FD");

    let innerY = cardY + 6;

    applyBodyFont(state, "bold");
    doc.setFontSize(7.8);
    setTextColor(doc, COLORS.accent);
    doc.text(`DAY ${day.dayNumber}`, cardX + 5, innerY);

    applyHeadingFont(state, "bold");
    doc.setFontSize(13);
    setTextColor(doc, COLORS.heading);
    const titleLines = splitLines(doc, day.title, contentWidth - 35);
    doc.text(titleLines, cardX + 5, innerY + 5.5);

    applyBodyFont(state, "bold");
    doc.setFontSize(8);
    setTextColor(doc, COLORS.accent);
    doc.text(day.estimatedCost || "Not specified", cardX + contentWidth - 5, innerY + 1, {
      align: "right",
    });

    innerY += estimateTextHeight(titleLines, 5) + 5;

    if (imageDataUrl) {
      setFillColor(doc, COLORS.background);
      doc.roundedRect(cardX + 5, innerY, contentWidth - 10, 32, 3, 3, "F");
      drawImageCover(doc, imageDataUrl, cardX + 5, innerY, contentWidth - 10, 32);
      innerY += 35;
    }

    applyBodyFont(state, "normal");
    doc.setFontSize(9);
    setTextColor(doc, COLORS.body);

    for (const lines of activityLines) {
      setFillColor(doc, COLORS.accent);
      doc.circle(cardX + 6.2, innerY - 1.2, 0.8, "F");
      doc.text(lines, cardX + 9, innerY);
      innerY += estimateTextHeight(lines, 3.9) + 1.4;
    }

    if (tipLines.length > 0) {
      setDrawColor(doc, COLORS.border);
      doc.line(cardX + 5, innerY + 1.2, cardX + contentWidth - 5, innerY + 1.2);
      innerY += 5;

      applyBodyFont(state, "bold");
      doc.setFontSize(7.7);
      setTextColor(doc, COLORS.accent);
      doc.text("TIP", cardX + 5, innerY);
      innerY += 3.5;

      applyBodyFont(state, "normal");
      doc.setFontSize(8.7);
      setTextColor(doc, COLORS.muted);
      doc.text(tipLines, cardX + 5, innerY);
    }

    state.cursorY += baseHeight + 4;
  }

  state.cursorY += 2;
}

function mapPointToFrame(point, frame) {
  const x = frame.x + ((point.longitude + 180) / 360) * frame.width;
  const y = frame.y + ((90 - point.latitude) / 180) * frame.height;
  return { x, y };
}

function drawMapRouteSection(state, model, assets) {
  drawSectionHeader(state, {
    title: "Map & Route",
    subtitle: "Embedded map panel with route explanation and map links.",
    iconDataUrl: assets.iconDataUrls.map,
  });

  const { doc, contentWidth } = state;
  const mapFrameHeight = 64;
  const linkLines = model.mapRoute.links.map((link) =>
    splitLines(doc, `${link.label}: ${link.url}`, contentWidth - 12)
  );
  const explanationLines = splitLines(doc, model.mapRoute.explanation, contentWidth - 12);

  const detailsHeight =
    12 +
    estimateTextHeight(explanationLines, 4.1) +
    linkLines.reduce((sum, lines) => sum + estimateTextHeight(lines, 3.7) + 1.1, 0);

  ensureSpace(state, mapFrameHeight + detailsHeight + 4);

  const frame = {
    x: PAGE_LAYOUT.marginX,
    y: state.cursorY,
    width: contentWidth,
    height: mapFrameHeight,
  };

  setFillColor(doc, COLORS.surface);
  setDrawColor(doc, COLORS.border);
  doc.roundedRect(frame.x, frame.y, frame.width, frame.height, 4, 4, "FD");

  drawImageContain(
    doc,
    assets.mapImageDataUrl,
    frame.x + 1,
    frame.y + 1,
    frame.width - 2,
    frame.height - 2
  );

  const routePoints = model.mapRoute.routePoints || [];
  const mappedPoints = routePoints.map((point) => mapPointToFrame(point, frame));

  if (mappedPoints.length >= 2) {
    setDrawColor(doc, COLORS.mapLine);
    doc.setLineWidth(0.7);
    for (let index = 0; index < mappedPoints.length - 1; index += 1) {
      const from = mappedPoints[index];
      const to = mappedPoints[index + 1];
      doc.line(from.x, from.y, to.x, to.y);
    }
  }

  if (mappedPoints.length > 0) {
    for (let index = 0; index < mappedPoints.length; index += 1) {
      const point = mappedPoints[index];
      setFillColor(doc, index === 0 ? COLORS.danger : COLORS.mapLine);
      doc.circle(point.x, point.y, index === 0 ? 1.5 : 1.2, "F");
    }
  }

  state.cursorY += mapFrameHeight + 4;

  setFillColor(doc, COLORS.surface);
  setDrawColor(doc, COLORS.border);
  doc.roundedRect(
    PAGE_LAYOUT.marginX,
    state.cursorY,
    contentWidth,
    detailsHeight,
    4,
    4,
    "FD"
  );

  applyBodyFont(state, "normal");
  doc.setFontSize(9);
  setTextColor(doc, COLORS.body);
  doc.text(explanationLines, PAGE_LAYOUT.marginX + 5, state.cursorY + 8);

  let linkY = state.cursorY + 10 + estimateTextHeight(explanationLines, 4.1);
  applyBodyFont(state, "bold");
  doc.setFontSize(7.6);
  setTextColor(doc, COLORS.accent);
  doc.text("MAP LINKS", PAGE_LAYOUT.marginX + 5, linkY);
  linkY += 3.5;

  applyBodyFont(state, "normal");
  doc.setFontSize(8.1);
  setTextColor(doc, COLORS.muted);

  if (linkLines.length === 0) {
    doc.text("No route links available for this itinerary.", PAGE_LAYOUT.marginX + 5, linkY + 1);
  } else {
    for (const lines of linkLines) {
      doc.text(lines, PAGE_LAYOUT.marginX + 5, linkY + 1.8);
      linkY += estimateTextHeight(lines, 3.7) + 1.1;
    }
  }

  state.cursorY += detailsHeight + PAGE_LAYOUT.sectionGap;
}

function drawRecommendationBlock(state, title, iconDataUrl, items, imageDataUrls) {
  const { doc, contentWidth } = state;

  ensureSpace(state, 14);

  if (iconDataUrl) {
    drawImageContain(doc, iconDataUrl, PAGE_LAYOUT.marginX, state.cursorY + 0.5, 6, 6);
  }

  applyHeadingFont(state, "bold");
  doc.setFontSize(12);
  setTextColor(doc, COLORS.heading);
  doc.text(title, PAGE_LAYOUT.marginX + 8, state.cursorY + 5);
  state.cursorY += 8;

  const cards = items.slice(0, 4);
  for (let index = 0; index < cards.length; index += 1) {
    const item = cards[index];
    const imageDataUrl = imageDataUrls[index] || "";

    const descriptionLines = splitLines(doc, item.description, contentWidth - 42);
    const locationLines = splitLines(doc, item.location, contentWidth - 42);
    const cardHeight =
      18 +
      estimateTextHeight(descriptionLines, 3.7) +
      estimateTextHeight(locationLines, 3.7);

    ensureSpace(state, cardHeight + 2);

    const cardX = PAGE_LAYOUT.marginX;
    const cardY = state.cursorY;

    setFillColor(doc, COLORS.surface);
    setDrawColor(doc, COLORS.border);
    doc.roundedRect(cardX, cardY, contentWidth, cardHeight, 3, 3, "FD");

    setFillColor(doc, COLORS.background);
    doc.roundedRect(cardX + 4, cardY + 3, 28, cardHeight - 6, 2, 2, "F");
    drawImageCover(doc, imageDataUrl, cardX + 4, cardY + 3, 28, cardHeight - 6);

    applyBodyFont(state, "bold");
    doc.setFontSize(9);
    setTextColor(doc, COLORS.heading);
    const titleLine = sanitizePdfText(item.name);
    doc.text(titleLine, cardX + 35, cardY + 7);

    applyBodyFont(state, "normal");
    doc.setFontSize(7.8);
    setTextColor(doc, COLORS.accent);
    const ratingText =
      item.rating !== null && item.rating !== undefined
        ? `${Number(item.rating).toFixed(1)} / 5`
        : "Rating N/A";
    const priceText = item.priceLabel || "Price N/A";
    doc.text(`${ratingText} | ${priceText}`, cardX + contentWidth - 4, cardY + 7, {
      align: "right",
    });

    applyBodyFont(state, "normal");
    doc.setFontSize(8);
    setTextColor(doc, COLORS.body);
    doc.text(locationLines, cardX + 35, cardY + 12);

    applyBodyFont(state, "normal");
    doc.setFontSize(8.1);
    setTextColor(doc, COLORS.muted);
    doc.text(descriptionLines, cardX + 35, cardY + 12 + estimateTextHeight(locationLines, 3.7));

    state.cursorY += cardHeight + 2;
  }

  state.cursorY += 2;
}

function drawRecommendationsSection(state, model, assets) {
  drawSectionHeader(state, {
    title: "Hotels & Restaurants",
    subtitle: "Recommended stays and dining picks with ratings and map links.",
    iconDataUrl: assets.iconDataUrls.stay,
  });

  drawRecommendationBlock(
    state,
    "Hotels",
    assets.iconDataUrls.stay,
    model.recommendations.hotels,
    assets.hotelImageDataUrls
  );

  drawRecommendationBlock(
    state,
    "Restaurants",
    assets.iconDataUrls.dining,
    model.recommendations.restaurants,
    assets.restaurantImageDataUrls
  );

  if (model.recommendations.note) {
    const { doc, contentWidth } = state;
    const noteLines = splitLines(doc, model.recommendations.note, contentWidth - 10);
    const noteHeight = 8 + estimateTextHeight(noteLines, 3.8);
    ensureSpace(state, noteHeight);

    setFillColor(doc, COLORS.accentSoft);
    setDrawColor(doc, COLORS.border);
    doc.roundedRect(PAGE_LAYOUT.marginX, state.cursorY, contentWidth, noteHeight, 3, 3, "FD");

    applyBodyFont(state, "normal");
    doc.setFontSize(8.2);
    setTextColor(doc, COLORS.body);
    doc.text(noteLines, PAGE_LAYOUT.marginX + 5, state.cursorY + 6);
    state.cursorY += noteHeight + PAGE_LAYOUT.sectionGap;
  }
}

function drawBudgetSection(state, model, assets) {
  drawSectionHeader(state, {
    title: "Budget Breakdown",
    subtitle: "Estimated allocation across travel, stay, and food.",
    iconDataUrl: assets.iconDataUrls.budget,
  });

  const { doc, contentWidth } = state;

  ensureSpace(state, 24);
  setFillColor(doc, COLORS.accentSoft);
  setDrawColor(doc, COLORS.border);
  doc.roundedRect(PAGE_LAYOUT.marginX, state.cursorY, contentWidth, 21, 4, 4, "FD");

  applyBodyFont(state, "bold");
  doc.setFontSize(8);
  setTextColor(doc, COLORS.accent);
  doc.text("TOTAL ESTIMATE", PAGE_LAYOUT.marginX + 5, state.cursorY + 7);

  applyHeadingFont(state, "bold");
  doc.setFontSize(15);
  setTextColor(doc, COLORS.heading);
  doc.text(model.budget.totalEstimatedCost, PAGE_LAYOUT.marginX + 5, state.cursorY + 15.5);

  state.cursorY += 24;

  const breakdown = model.budget.breakdown || [];
  const gap = 3;
  const cardWidth = (contentWidth - gap) / 2;
  const cardHeight = 20;

  for (let index = 0; index < breakdown.length; index += 1) {
    if (index % 2 === 0) {
      ensureSpace(state, cardHeight + 2);
    }

    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = PAGE_LAYOUT.marginX + column * (cardWidth + gap);
    const y = state.cursorY + row * (cardHeight + 2);

    setFillColor(doc, COLORS.surface);
    setDrawColor(doc, COLORS.border);
    doc.roundedRect(x, y, cardWidth, cardHeight, 3, 3, "FD");

    applyBodyFont(state, "bold");
    doc.setFontSize(7.4);
    setTextColor(doc, COLORS.accent);
    doc.text(breakdown[index].label.toUpperCase(), x + 4, y + 5.8);

    applyBodyFont(state, "bold");
    doc.setFontSize(8.5);
    setTextColor(doc, COLORS.heading);
    const amountLines = splitLines(doc, breakdown[index].amount, cardWidth - 8);
    doc.text(amountLines, x + 4, y + 10.8);

    applyBodyFont(state, "normal");
    doc.setFontSize(7.2);
    setTextColor(doc, COLORS.muted);
    const noteLines = splitLines(doc, breakdown[index].note, cardWidth - 8);
    doc.text(noteLines, x + 4, y + 16.8);
  }

  state.cursorY += Math.ceil(breakdown.length / 2) * (cardHeight + 2) + PAGE_LAYOUT.sectionGap;
}

function drawTipsSection(state, model, assets) {
  drawSectionHeader(state, {
    title: "Travel Tips",
    subtitle: "Important notes to keep the trip smooth and practical.",
    iconDataUrl: assets.iconDataUrls.tips,
  });

  const { doc, contentWidth } = state;
  const tips = (model.travelTips || []).slice(0, 10);

  if (tips.length === 0) {
    ensureSpace(state, 14);
    setFillColor(doc, COLORS.surface);
    setDrawColor(doc, COLORS.border);
    doc.roundedRect(PAGE_LAYOUT.marginX, state.cursorY, contentWidth, 14, 3, 3, "FD");

    applyBodyFont(state, "normal");
    doc.setFontSize(8.6);
    setTextColor(doc, COLORS.muted);
    doc.text("No additional travel tips available.", PAGE_LAYOUT.marginX + 5, state.cursorY + 8);
    state.cursorY += 16;
    return;
  }

  for (const tip of tips) {
    const lines = splitLines(doc, tip, contentWidth - 14);
    const cardHeight = 8 + estimateTextHeight(lines, 3.9);

    ensureSpace(state, cardHeight + 2);

    setFillColor(doc, COLORS.surface);
    setDrawColor(doc, COLORS.border);
    doc.roundedRect(PAGE_LAYOUT.marginX, state.cursorY, contentWidth, cardHeight, 3, 3, "FD");

    setFillColor(doc, COLORS.accent);
    doc.roundedRect(PAGE_LAYOUT.marginX, state.cursorY, 2.8, cardHeight, 2, 2, "F");

    applyBodyFont(state, "normal");
    doc.setFontSize(8.7);
    setTextColor(doc, COLORS.body);
    doc.text(lines, PAGE_LAYOUT.marginX + 5, state.cursorY + 5.8);

    state.cursorY += cardHeight + 2;
  }
}

function decoratePages(doc, model) {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);

    if (page === 1) {
      continue;
    }

    setDrawColor(doc, COLORS.border);
    doc.line(
      PAGE_LAYOUT.marginX,
      pageHeight - 10,
      pageWidth - PAGE_LAYOUT.marginX,
      pageHeight - 10
    );

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setTextColor(doc, COLORS.muted);

    doc.text(sanitizePdfText(model.destination), PAGE_LAYOUT.marginX, pageHeight - 5.8);
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - PAGE_LAYOUT.marginX, pageHeight - 5.8, {
      align: "right",
    });
  }
}

async function resolvePdfClass(PdfClass) {
  if (PdfClass) {
    return PdfClass;
  }

  const jspdfModule = await import("jspdf");
  return jspdfModule.jsPDF ?? jspdfModule.default?.jsPDF ?? jspdfModule.default;
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

export async function createTripPdfDocument({
  trip,
  recommendations,
  options = {},
} = {}) {
  const model =
    options.model ||
    buildTripPdfModel({
      trip,
      recommendations,
      generatedAt: options.generatedAt,
    });

  const doc = options.doc || (await createPdfDocument(options.PdfClass));
  const fontSet = await registerPdfFonts(doc, {
    disableFontEmbedding: options.disableFontEmbedding,
    signal: options.signal,
    cache: options.assetCache,
  });

  const assets =
    options.assets ||
    (await resolvePdfAssets(model, {
      timeoutMs: options.assetTimeoutMs,
      signal: options.signal,
      disableImages: options.disableImages,
      logoUrl: options.logoUrl,
      cache: options.assetCache,
    }));

  const state = createState(doc, fontSet);

  doc.setProperties({
    title: sanitizePdfText(model.title),
    subject: sanitizePdfText(`Travel itinerary for ${model.destination}`),
    author: "AI Travel Planner",
    creator: "AI Travel Planner",
    keywords: "travel,itinerary,pdf,brochure",
  });

  console.info("[trip-pdf:renderer] Rendering brochure PDF", {
    destination: model.destination,
    dayCount: model.itinerary.days.length,
  });

  drawCoverPage(state, model, assets);
  drawOverviewSection(state, model, assets);
  drawItinerarySection(state, model, assets);
  drawMapRouteSection(state, model, assets);
  drawRecommendationsSection(state, model, assets);
  drawBudgetSection(state, model, assets);
  drawTipsSection(state, model, assets);
  decoratePages(doc, model);

  const pageCount = doc.getNumberOfPages();

  console.info("[trip-pdf:renderer] Brochure PDF rendered", {
    destination: model.destination,
    pageCount,
  });

  return {
    doc,
    model,
    assets,
    pageCount,
    fonts: fontSet,
  };
}
