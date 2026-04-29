// ============================================================
// documents/pan.js
// Extraction + per-document validation for PAN card
// ============================================================

const { normalizeText } = require("../validation/normalizers");
const { extractPan, extractPersonName, extractGroup } = require("../validation/extractors");
const { firstMeaningfulNameTokens } = require("../validation/normalizers");

// ── Data extraction ──────────────────────────────────────────

function extractPanData(text) {
  const cleaned = normalizeText(text);
  const panHolderCandidate =
    extractGroup(
      /Permanent Account Number Card\s+[A-Z0-9]{10}\s+GOVT\.?\s+OF\s+INDIA\s+(.+?)(?=\s+For\b|\s+Father'?s Name|\s+\d{2}[\/\-]\d{2}[\/\-]\d{4}|$)/i,
      cleaned
    ) ||
    extractGroup(
      /GOVT\.?\s+OF\s+INDIA\s+(.+?)(?=\s+For\b|\s+Father'?s Name|\s+\d{2}[\/\-]\d{2}[\/\-]\d{4}|$)/i,
      cleaned
    ) ||
    extractGroup(
      /Permanent Account Number Card\s+[A-Z0-9]{10}\s+(.+?)(?=\s+For\b|\s+Father'?s Name|\s+\d{2}[\/\-]\d{2}[\/\-]\d{4}|$)/i,
      cleaned
    ) ||
    extractPersonName(text);

  return {
    name: firstMeaningfulNameTokens(panHolderCandidate, 3),
    panNumber: extractPan(text),
  };
}

// ── Per-document validation issues ──────────────────────────

function validatePanDocument(document, issues) {
  if (!document.identifiers.pan) {
    issues.push({
      severity: "high",
      title: `PAN number not found in ${document.key}`,
      detail: `The uploaded PAN document ${document.originalname} did not contain a detectable PAN number.`,
    });
  }

  if (!document.extractedData.name) {
    issues.push({
      severity: "medium",
      title: `Name not found in ${document.key}`,
      detail: `The uploaded PAN document ${document.originalname} did not contain a detectable name.`,
    });
  }
}

module.exports = { extractPanData, validatePanDocument };
