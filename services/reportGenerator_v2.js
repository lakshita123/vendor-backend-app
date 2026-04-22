const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const COLORS = {
  ink: "#14213d",
  muted: "#6b7280",
  border: "#dbe3ef",
  surface: "#f8fbff",
  surfaceStrong: "#eef4ff",
  success: "#0f9d58",
  successSoft: "#e9f8ef",
  successMid: "#bbf7d0",
  warning: "#f59e0b",
  warningSoft: "#fff5dd",
  danger: "#dc2626",
  dangerSoft: "#feecec",
  dangerMid: "#fca5a5",
  info: "#2563eb",
  infoSoft: "#eaf2ff",
  purple: "#7c3aed",
  purpleSoft: "#f3eeff",
  teal: "#0d9488",
  tealSoft: "#e6faf8",
};

const MAX_PAGES = 4;
const MARGIN = 36;

// ─────────────────────────────────────────────────────────────────────────────
// CORE RULE: Every text call inside a card MUST use an absolute pinned Y.
//   doc.text(str, x, y, opts)   ← x and y are BOTH pinned = no auto page break
//   doc.text(str, { width })    ← relative = PDFKit may auto-break = blank pages
//
// Use measureText() to pre-calculate heights, then ensureSpace() before drawing.
// Never let PDFKit decide when to page-break inside a card.
// ─────────────────────────────────────────────────────────────────────────────

function formatLabel(key) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function safeText(value) {
  if (value === null || value === undefined || value === "") return "Not available";
  if (typeof value === "number") return String(value);
  return String(value).replace(/\s+/g, " ").trim() || "Not available";
}

function statusLabel(status) {
  return status === "clear" ? "Looks Good" : "Needs Review";
}

function checkStatusColors(passed) {
  return passed
    ? { fill: COLORS.successSoft, stroke: COLORS.successMid, text: COLORS.success }
    : { fill: COLORS.dangerSoft, stroke: COLORS.dangerMid, text: COLORS.danger };
}

function issueSeverityColors(severity) {
  if (severity === "high") return { fill: COLORS.dangerSoft, stroke: COLORS.dangerMid, text: COLORS.danger };
  if (severity === "medium") return { fill: COLORS.warningSoft, stroke: "#f2d38a", text: "#9a6700" };
  return { fill: COLORS.infoSoft, stroke: "#bfd4ff", text: COLORS.info };
}

// Measure text height at given font/size/width WITHOUT rendering
function measureText(doc, text, font, size, width) {
  doc.font(font).fontSize(size);
  return doc.heightOfString(String(text || ""), { width });
}

// Content width (page minus both margins)
function contentW(doc) {
  return doc.page.width - MARGIN * 2;
}

// Remaining space on current page
function remainingSpace(doc) {
  return doc.page.height - doc.page.margins.bottom - doc.y;
}

// Add a new page if needed. Returns false if at hard cap.
function ensureSpace(doc, needed) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
    if (doc.bufferedPageRange().count >= MAX_PAGES) return false;
    doc.addPage();
    doc.y = MARGIN;
  }
  return true;
}

function drawRoundedCard(doc, { x, y, w, h, fill, stroke, r = 10 }) {
  doc.save();
  doc.roundedRect(x, y, w, h, r);
  if (fill) doc.fillAndStroke(fill, stroke || fill);
  else doc.stroke(stroke || COLORS.border);
  doc.restore();
}

function drawDivider(doc) {
  const y = doc.y + 5;
  doc.save()
    .moveTo(MARGIN, y)
    .lineTo(doc.page.width - MARGIN, y)
    .strokeColor(COLORS.border)
    .lineWidth(0.7)
    .stroke()
    .restore();
  doc.y = y + 9;
}

function drawSectionTitle(doc, title, subtitle, accent) {
  const needed = subtitle ? 42 : 28;
  if (!ensureSpace(doc, needed)) return;

  const y = doc.y;
  accent = accent || COLORS.info;

  doc.save().roundedRect(MARGIN, y, 4, subtitle ? 28 : 18, 2).fill(accent).restore();

  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(11.5)
    .text(title, MARGIN + 12, y, { lineBreak: false });

  if (subtitle) {
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8)
      .text(subtitle, MARGIN + 12, y + 15, { width: contentW(doc) - 12, lineBreak: false });
    doc.y = y + 30;
  } else {
    doc.y = y + 24;
  }
}


// ── Page Header ───────────────────────────────────────────────────────────────
function drawHeader(doc, submission, validation) {
  const x = MARGIN;
  const y = doc.y;
  const w = contentW(doc);
  const h = 108;

  drawRoundedCard(doc, { x, y, w, h, fill: COLORS.surfaceStrong, stroke: "#c5d8fc", r: 16 });

  // Left accent stripe
  doc.save().roundedRect(x, y, 5, h, 3).fill(COLORS.info).restore();

  // Label
  doc.fillColor(COLORS.info).font("Helvetica-Bold").fontSize(7.5)
    .text("VENDOR REVIEW REPORT", x + 18, y + 13, { lineBreak: false });

  // Title
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(18)
    .text("Submission Quality Summary", x + 18, y + 25, { lineBreak: false });

  // Subtitle line 1
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9)
    .text(
      `Prepared for ${safeText(submission.name)} · ${new Date().toLocaleString("en-IN")}`,
      x + 18, y + 52, { width: w - 170, lineBreak: false }
    );

  // Subtitle line 2
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5)
    .text(
      `${safeText(submission.vendorType)} · ${safeText(submission.constitution)} · ${safeText(submission.product)}`,
      x + 18, y + 67, { width: w - 170, lineBreak: false }
    );

  // Status badge
  const sc = validation.status === "clear"
    ? { fill: COLORS.successSoft, stroke: COLORS.successMid, text: COLORS.success }
    : { fill: COLORS.warningSoft, stroke: "#f2d38a", text: "#9a6700" };

  drawRoundedCard(doc, { x: x + w - 140, y: y + 22, w: 122, h: 28, fill: sc.fill, stroke: sc.stroke, r: 14 });
  doc.fillColor(sc.text).font("Helvetica-Bold").fontSize(10)
    .text(statusLabel(validation.status), x + w - 140, y + 30, { width: 122, align: "center", lineBreak: false });

  doc.y = y + h + 10;
}


// ── Summary stat cards ────────────────────────────────────────────────────────
function drawSummaryCards(doc, validation) {
  const checks = validation.validationChecks || [];
  const faceChecks = checks.filter((c) => c.isFaceCheck);
  const regularChecks = checks.filter((c) => !c.isFaceCheck);
  const passedRegular = regularChecks.filter((c) => c.passed).length;
  const passedFace = faceChecks.filter((c) => c.passed).length;

  const cards = [
    { label: "Docs Uploaded", value: validation.summary.totalDocuments, fill: COLORS.infoSoft, stroke: "#bfd4ff", text: COLORS.info },
    { label: "Readable Files", value: validation.summary.readableDocuments, fill: COLORS.successSoft, stroke: COLORS.successMid, text: COLORS.success },
    { label: "Checks Passed", value: `${passedRegular}/${regularChecks.length}`, fill: COLORS.purpleSoft, stroke: "#d0bcff", text: COLORS.purple },
    {
      label: "Face Checks",
      value: faceChecks.length ? `${passedFace}/${faceChecks.length}` : "N/A",
      fill: faceChecks.length && passedFace === faceChecks.length ? COLORS.tealSoft : faceChecks.length ? COLORS.dangerSoft : COLORS.surface,
      stroke: faceChecks.length && passedFace === faceChecks.length ? "#99e6df" : faceChecks.length ? COLORS.dangerMid : COLORS.border,
      text: faceChecks.length && passedFace === faceChecks.length ? COLORS.teal : faceChecks.length ? COLORS.danger : COLORS.muted,
    },
    {
      label: "Open Issues",
      value: validation.issues.length,
      fill: validation.issues.length ? COLORS.dangerSoft : COLORS.successSoft,
      stroke: validation.issues.length ? COLORS.dangerMid : COLORS.successMid,
      text: validation.issues.length ? COLORS.danger : COLORS.success,
    },
  ];

  const cw = contentW(doc);
  const gap = 8;
  const cardW = (cw - gap * (cards.length - 1)) / cards.length;
  const cardH = 64;

  if (!ensureSpace(doc, cardH + 10)) return;

  const y = doc.y;
  cards.forEach((card, i) => {
    const x = MARGIN + i * (cardW + gap);
    drawRoundedCard(doc, { x, y, w: cardW, h: cardH, fill: card.fill, stroke: card.stroke, r: 12 });
    doc.fillColor(card.text).font("Helvetica-Bold").fontSize(7.5)
      .text(card.label.toUpperCase(), x + 8, y + 9, { width: cardW - 16, lineBreak: false });
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(19)
      .text(String(card.value), x + 8, y + 26, { width: cardW - 16, lineBreak: false });
  });

  doc.y = y + cardH + 10;
}


// ── Key-value grid ────────────────────────────────────────────────────────────
function drawKeyValueGrid(doc, entries) {
  const printable = entries.filter((e) => e && e.value != null && e.value !== "");
  if (!printable.length) return;

  const cw = contentW(doc);
  const gap = 8;
  const colW = (cw - gap) / 2;
  const ROW_H = 46;

  for (let i = 0; i < printable.length; i += 2) {
    if (!ensureSpace(doc, ROW_H + 6)) break;

    const y = doc.y;
    const row = printable.slice(i, i + 2);

    row.forEach((entry, ci) => {
      const x = MARGIN + ci * (colW + gap);
      drawRoundedCard(doc, { x, y, w: colW, h: ROW_H, fill: COLORS.surface, stroke: COLORS.border, r: 8 });
      doc.fillColor(COLORS.info).font("Helvetica-Bold").fontSize(7.5)
        .text(String(entry.label).toUpperCase(), x + 10, y + 8, { width: colW - 20, lineBreak: false });
      // Truncate long values to prevent overflow
      const val = safeText(entry.value);
      const truncated = val.length > 80 ? val.slice(0, 77) + "…" : val;
      doc.fillColor(COLORS.ink).font("Helvetica").fontSize(9)
        .text(truncated, x + 10, y + 21, { width: colW - 20, lineBreak: false });
    });

    doc.y = y + ROW_H + 6;
  }
}


// ── Document cards ────────────────────────────────────────────────────────────
function drawDocumentCards(doc, documents) {
  const cw = contentW(doc);

  documents.forEach((document, index) => {
    if (document.key === "geo_tag_photo") return;
    if (document.key.includes("gstr3b") && index > 1) return;

    const rows = [];
    Object.entries(document.identifiers || {}).forEach(([k, v]) => {
      if (v) rows.push({ label: formatLabel(k), value: v });
    });
    Object.entries(document.extractedData || {}).forEach(([k, v]) => {
      if (!v || (typeof v === "object" && !Array.isArray(v))) return;
      rows.push({ label: formatLabel(k), value: v });
    });

    // Pre-calculate card height
    const rowCount = rows.length ? Math.ceil(rows.length / 2) : 1;
    const cardH = 50 + rowCount * 26;

    if (!ensureSpace(doc, cardH + 10)) return;

    const x = MARGIN;
    const y = doc.y;

    drawRoundedCard(doc, { x, y, w: cw, h: cardH, fill: "#ffffff", stroke: COLORS.border, r: 12 });

    // Status dot
    const dotColor = document.extractionStatus === "success" ? COLORS.success : COLORS.warning;
    doc.save().circle(x + 17, y + 17, 4).fill(dotColor).restore();

    // Title
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9.5)
      .text(`${index + 1}. ${formatLabel(document.key)}`, x + 28, y + 10, { width: cw - 140, lineBreak: false });

    // Filename
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7.5)
      .text(safeText(document.originalname), x + 28, y + 23, { width: cw - 140, lineBreak: false });

    // Status badge
    const sc = document.extractionStatus === "success"
      ? { fill: COLORS.successSoft, stroke: COLORS.successMid, text: COLORS.success }
      : { fill: COLORS.warningSoft, stroke: "#f2d38a", text: "#9a6700" };
    drawRoundedCard(doc, { x: x + cw - 100, y: y + 11, w: 86, h: 18, fill: sc.fill, stroke: sc.stroke, r: 9 });
    doc.fillColor(sc.text).font("Helvetica-Bold").fontSize(7)
      .text(document.extractionStatus.toUpperCase(), x + cw - 100, y + 17, { width: 86, align: "center", lineBreak: false });

    if (!rows.length) {
      doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5)
        .text("No useful fields extracted.", x + 12, y + 40, { lineBreak: false });
    } else {
      const colW = (cw - 24) / 2;
      rows.forEach((row, ri) => {
        const col = ri % 2;
        const line = Math.floor(ri / 2);
        const rx = x + 12 + col * (colW + 0);
        const ry = y + 40 + line * 26;
        doc.fillColor(COLORS.info).font("Helvetica-Bold").fontSize(7)
          .text(row.label.toUpperCase(), rx, ry, { width: colW - 4, lineBreak: false });
        const val = safeText(row.value);
        doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8.5)
          .text(val.length > 60 ? val.slice(0, 57) + "…" : val, rx, ry + 10, { width: colW - 4, lineBreak: false });
      });
    }

    doc.y = y + cardH + 8;
  });
}


// ── Validation check cards ────────────────────────────────────────────────────
function drawValidationCards(doc, checks) {
  const regular = (checks || []).filter((c) => !c.isFaceCheck);
  const cw = contentW(doc);

  if (!regular.length) {
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9)
      .text("No cross-document checks were run.", MARGIN, doc.y, { lineBreak: false });
    doc.y += 14;
    return;
  }

  regular.forEach((check) => {
    const colors = checkStatusColors(check.passed);
    const colW = (cw - 50) / 2;

    // Pre-measure text heights
    const expH = measureText(doc, safeText(check.expected), "Helvetica", 8.5, colW - 4);
    const actH = measureText(doc, safeText(check.actual), "Helvetica", 8.5, colW - 4);
    const textH = Math.max(expH, actH);
    const cardH = Math.max(60, 44 + textH + 4);

    if (!ensureSpace(doc, cardH + 8)) return;

    const x = MARGIN;
    const y = doc.y;

    drawRoundedCard(doc, { x, y, w: cw, h: cardH, fill: "#ffffff", stroke: colors.stroke, r: 12 });

    // Pass/Review badge
    drawRoundedCard(doc, { x: x + 10, y: y + 10, w: 52, h: 18, fill: colors.fill, stroke: colors.stroke, r: 9 });
    doc.fillColor(colors.text).font("Helvetica-Bold").fontSize(7.5)
      .text(check.passed ? "PASS" : "REVIEW", x + 10, y + 16, { width: 52, align: "center", lineBreak: false });

    // Title
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9)
      .text(check.title, x + 70, y + 12, { width: cw - 80, lineBreak: false });

    // Expected column
    const col2X = x + 14 + colW + 8;
    doc.fillColor(COLORS.info).font("Helvetica-Bold").fontSize(7)
      .text("EXPECTED", x + 14, y + 34, { width: colW, lineBreak: false });
    doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8.5)
      .text(safeText(check.expected), x + 14, y + 44, { width: colW - 4, lineBreak: false });

    // Actual column
    doc.fillColor(COLORS.info).font("Helvetica-Bold").fontSize(7)
      .text("ACTUAL", col2X, y + 34, { width: colW, lineBreak: false });
    doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8.5)
      .text(safeText(check.actual), col2X, y + 44, { width: colW - 4, lineBreak: false });

    doc.y = y + cardH + 7;
  });
}


// ── Face verification ─────────────────────────────────────────────────────────
function drawFaceVerificationSection(doc, validation) {
  const faceResults = validation.faceResults || [];
  const cw = contentW(doc);

  if (!faceResults.length) {
    if (!ensureSpace(doc, 42)) return;
    const y = doc.y;
    drawRoundedCard(doc, { x: MARGIN, y, w: cw, h: 36, fill: COLORS.surface, stroke: COLORS.border, r: 10 });
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9)
      .text("No geo tag photo uploaded. Face verification was not performed.", MARGIN + 12, y + 12, { lineBreak: false });
    doc.y = y + 44;
    return;
  }

  faceResults.forEach((result) => {
    if (result.error) {
      if (!ensureSpace(doc, 58)) return;
      const y = doc.y;
      drawRoundedCard(doc, { x: MARGIN, y, w: cw, h: 52, fill: COLORS.warningSoft, stroke: "#f2d38a", r: 12 });
      drawRoundedCard(doc, { x: MARGIN + 10, y: y + 10, w: 60, h: 18, fill: "#fff5dd", stroke: "#f2d38a", r: 9 });
      doc.fillColor("#9a6700").font("Helvetica-Bold").fontSize(7.5)
        .text("SKIPPED", MARGIN + 10, y + 16, { width: 60, align: "center", lineBreak: false });
      doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9.5)
        .text(`Geo Tag vs ${result.label}`, MARGIN + 80, y + 12, { lineBreak: false });
      doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5)
        .text(String(result.error).slice(0, 120), MARGIN + 80, y + 26, { width: cw - 90, lineBreak: false });
      doc.y = y + 60;
      return;
    }

    const pct = Math.round((result.confidence || 0) * 100);
    const colors = result.match
      ? { fill: COLORS.tealSoft, stripe: COLORS.teal, badge: "#e6faf8", stroke: "#99e6df", text: COLORS.teal }
      : { fill: COLORS.dangerSoft, stripe: COLORS.danger, badge: "#feecec", stroke: COLORS.dangerMid, text: COLORS.danger };

    const cardH = 108;
    if (!ensureSpace(doc, cardH + 10)) return;

    const x = MARGIN;
    const y = doc.y;

    drawRoundedCard(doc, { x, y, w: cw, h: cardH, fill: "#ffffff", stroke: colors.stroke, r: 14 });

    // Top stripe
    doc.save().roundedRect(x, y, cw, 34, 14).fill(colors.fill).restore();
    doc.save().rect(x, y + 20, cw, 14).fill(colors.fill).restore();

    // Badge
    drawRoundedCard(doc, { x: x + 12, y: y + 9, w: 80, h: 20, fill: colors.badge, stroke: colors.stroke, r: 10 });
    doc.fillColor(colors.text).font("Helvetica-Bold").fontSize(8.5)
      .text(result.match ? "✓  MATCH" : "✗  NO MATCH", x + 12, y + 15, { width: 80, align: "center", lineBreak: false });

    // Title
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(11)
      .text(`Geo Tag vs ${result.label} Card`, x + 104, y + 11, { lineBreak: false });
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8)
      .text("128-D facial descriptor comparison", x + 104, y + 24, { lineBreak: false });

    // Confidence bar
    const barX = x + 14;
    const barY = y + 46;
    const barW = cw - 28;
    const barH = 8;
    const fillW = Math.max(8, (barW * pct) / 100);
    const barColor = pct >= 60 ? COLORS.success : pct >= 40 ? COLORS.warning : COLORS.danger;

    doc.save().roundedRect(barX, barY, barW, barH, 4).fill("#e5e7eb").restore();
    doc.save().roundedRect(barX, barY, fillW, barH, 4).fill(barColor).restore();

    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(8.5)
      .text("Similarity Confidence", barX, barY - 11, { lineBreak: false });
    doc.fillColor(barColor).font("Helvetica-Bold").fontSize(15)
      .text(`${pct}%`, x + cw - 54, y + 38, { width: 40, align: "right", lineBreak: false });

    // Detail row
    const detailY = y + 68;
    const colW = (cw - 24) / 4;
    const details = [
      { label: "Distance", value: result.distance != null ? String(result.distance) : "N/A" },
      { label: "Threshold", value: "0.55" },
      { label: "Geo Faces", value: result.details ? String(result.details.geoTagFaceCount) : "N/A" },
      { label: `${result.label} Faces`, value: result.details ? String(result.details.documentFaceCount) : "N/A" },
    ];
    details.forEach((d, ci) => {
      const dx = x + 12 + ci * colW;
      doc.fillColor(COLORS.info).font("Helvetica-Bold").fontSize(7)
        .text(d.label.toUpperCase(), dx, detailY, { width: colW - 4, lineBreak: false });
      doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8.5)
        .text(safeText(d.value), dx, detailY + 10, { width: colW - 4, lineBreak: false });
    });

    doc.y = y + cardH + 8;
  });
}


// ── Issue cards ───────────────────────────────────────────────────────────────
function drawIssueCards(doc, issues) {
  const cw = contentW(doc);

  if (!issues.length) {
    if (!ensureSpace(doc, 44)) return;
    const y = doc.y;
    drawRoundedCard(doc, { x: MARGIN, y, w: cw, h: 38, fill: COLORS.successSoft, stroke: COLORS.successMid, r: 12 });
    doc.fillColor(COLORS.success).font("Helvetica-Bold").fontSize(9.5)
      .text("No issues detected. This submission looks healthy.", MARGIN + 14, y + 13, { lineBreak: false });
    doc.y = y + 46;
    return;
  }

  const ordered = [
    ...issues.filter((i) => i.severity === "high"),
    ...issues.filter((i) => i.severity === "medium"),
    ...issues.filter((i) => i.severity !== "high" && i.severity !== "medium"),
  ];

  ordered.forEach((issue, index) => {
    const colors = issueSeverityColors(issue.severity);
    const detailText = safeText(issue.detail);
    // Pre-measure detail text
    const detailH = measureText(doc, detailText, "Helvetica", 8.5, cw - 26);
    const cardH = Math.max(56, 40 + detailH + 4);

    if (!ensureSpace(doc, cardH + 8)) return;

    const x = MARGIN;
    const y = doc.y;

    drawRoundedCard(doc, { x, y, w: cw, h: cardH, fill: colors.fill, stroke: colors.stroke, r: 12 });

    // Severity badge
    drawRoundedCard(doc, { x: x + 10, y: y + 10, w: 62, h: 18, fill: "#ffffff", stroke: colors.stroke, r: 9 });
    doc.fillColor(colors.text).font("Helvetica-Bold").fontSize(7.5)
      .text(issue.severity.toUpperCase(), x + 10, y + 16, { width: 62, align: "center", lineBreak: false });

    // Issue title
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9.5)
      .text(`${index + 1}. ${issue.title}`, x + 82, y + 12, { width: cw - 92, lineBreak: false });

    // Issue detail — pinned Y, lineBreak allowed so long text wraps within the card
    doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8.5)
      .text(detailText, x + 12, y + 34, { width: cw - 26, lineBreak: true });

    doc.y = y + cardH + 7;
  });
}


// ── Accuracy meter ────────────────────────────────────────────────────────────
function computeAccuracy(validation) {
  const summary = validation.summary || {};
  const checks = (validation.validationChecks || []).filter((c) => !c.isFaceCheck);
  const faceChecks = (validation.validationChecks || []).filter((c) => c.isFaceCheck);

  const readableRatio = summary.totalDocuments
    ? summary.readableDocuments / Math.max(summary.totalDocuments, 1)
    : 1;
  const passedRatio = checks.length ? checks.filter((c) => c.passed).length / checks.length : 1;
  const facePenalty = faceChecks.filter((c) => !c.passed).length * 0.12;
  const penalty = Math.min((validation.issues || []).length * 0.03, 0.35) + facePenalty;
  const score = Math.max(0, Math.min(100, Math.round((readableRatio * 0.4 + passedRatio * 0.6 - penalty) * 100)));

  let label = "High confidence";
  if (score < 80) label = "Moderate confidence";
  if (score < 60) label = "Needs manual review";

  return { score, label };
}

function drawAccuracyMeter(doc, validation) {
  const { score, label } = computeAccuracy(validation);
  const cw = contentW(doc);
  const cardH = 66;

  if (!ensureSpace(doc, cardH + 8)) return;

  const x = MARGIN;
  const y = doc.y;

  drawRoundedCard(doc, { x, y, w: cw, h: cardH, fill: COLORS.surfaceStrong, stroke: "#d8e5ff", r: 14 });

  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(10.5)
    .text("Report Accuracy Meter", x + 14, y + 10, { lineBreak: false });
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8)
    .text("Reliability estimate based on readable files, passed checks, face results, and open issues.", x + 14, y + 25, { width: cw - 130, lineBreak: false });

  const barX = x + 14;
  const barY = y + 46;
  const barW = cw - 130;
  const barH = 10;
  const barColor = score >= 80 ? COLORS.success : score >= 60 ? COLORS.warning : COLORS.danger;
  const fillW = Math.max(10, (barW * score) / 100);

  doc.save().roundedRect(barX, barY, barW, barH, 5).fill("#e5e7eb").restore();
  doc.save().roundedRect(barX, barY, fillW, barH, 5).fill(barColor).restore();

  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(20)
    .text(`${score}%`, x + cw - 96, y + 10, { width: 82, align: "right", lineBreak: false });
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5)
    .text(label, x + cw - 96, y + 36, { width: 82, align: "right", lineBreak: false });

  doc.y = y + cardH + 8;
}


// ── Main ──────────────────────────────────────────────────────────────────────
function generateIssueReport({ submission, validation, outputDir }) {
  return new Promise((resolve, reject) => {
    const fileName = `issue-report-${Date.now()}.pdf`;
    const outputPath = path.join(outputDir, fileName);

    const doc = new PDFDocument({
      margin: MARGIN,
      size: "A4",
      bufferPages: true,
      autoFirstPage: true,
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    // 1. Header + summary cards
    drawHeader(doc, submission, validation);
    drawSummaryCards(doc, validation);
    drawDivider(doc);

    // 2. Submission details
    drawSectionTitle(doc, "Submission Details", "Basic form data captured at upload time.", COLORS.info);
    drawKeyValueGrid(doc, [
      { label: "Full Name", value: submission.name },
      { label: "Phone Number", value: submission.phone },
      { label: "Email Address", value: submission.email },
      { label: "Constitution", value: submission.constitution },
      { label: "Vendor Type", value: submission.vendorType },
      { label: "Product", value: submission.product },
      { label: "HSN Code", value: submission.hsn },
      { label: "Geo Address", value: submission.geoAddress },
      {
        label: "Geo Coordinates",
        value: submission.geoLatitude && submission.geoLongitude
          ? `${submission.geoLatitude}, ${submission.geoLongitude}`
          : null,
      },
      { label: "Captured At", value: submission.geoCapturedAt },
      { label: "Maps Link", value: submission.geoMapsUrl },
    ]);
    drawDivider(doc);

    // 3. Extracted document data (cap at 6 docs)
    drawSectionTitle(doc, "Extracted Document Data", "Fields recovered via OCR and text parsing.", COLORS.purple);
    drawDocumentCards(doc, (validation.extractedDocuments || []).slice(0, 6));
    drawDivider(doc);

    // 4. Face verification
    drawSectionTitle(doc, "Face Verification", "Geo tag photo vs identity documents (Aadhaar, PAN).", COLORS.teal);
    drawFaceVerificationSection(doc, validation);
    drawDivider(doc);

    // 5. Validation checks (cap at 8)
    drawSectionTitle(doc, "Validation Review", "Cross-document field comparisons.", COLORS.info);
    drawValidationCards(doc, (validation.validationChecks || []).slice(0, 8));
    drawDivider(doc);

    // 6. Open issues (cap at 6)
    drawSectionTitle(doc, "Open Issues", "Items requiring manual attention before approval.", COLORS.danger);
    drawIssueCards(doc, (validation.issues || []).slice(0, 6));
    drawDivider(doc);

    // 7. Accuracy meter
    drawSectionTitle(doc, "Accuracy Summary", "Overall confidence estimate.", COLORS.purple);
    drawAccuracyMeter(doc, validation);

    // Page footers
    const pageRange = doc.bufferedPageRange();
    for (let i = 0; i < pageRange.count; i++) {
      doc.switchToPage(i);
      doc.save()
        .moveTo(MARGIN, doc.page.height - 26)
        .lineTo(doc.page.width - MARGIN, doc.page.height - 26)
        .strokeColor(COLORS.border).lineWidth(0.6).stroke()
        .restore();
      doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7.5)
        .text(
          `Vendor Review Report  ·  ${safeText(submission.name)}  ·  Page ${i + 1} of ${pageRange.count}`,
          MARGIN, doc.page.height - 18,
          { width: doc.page.width - MARGIN * 2, align: "center", lineBreak: false }
        );
    }

    doc.end();
    stream.on("finish", () => resolve(outputPath));
    stream.on("error", reject);
  });
}

module.exports = { generateIssueReport };
