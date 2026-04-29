// ============================================================
// documents/cin.js
// Extraction + per-document validation for CIN certificate
// ============================================================

const { extractCin } = require("../validation/extractors");

// ── Per-document validation issues ──────────────────────────

function validateCinDocument(document, issues) {
  if (!document.identifiers.cin) {
    issues.push({
      severity: "medium",
      title: `CIN not found in ${document.key}`,
      detail: `The uploaded CIN document ${document.originalname} did not contain a detectable CIN.`,
    });
  }
}

module.exports = { validateCinDocument };
