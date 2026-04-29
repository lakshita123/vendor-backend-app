// ============================================================
// documents/cto.js
// Extraction + per-document validation for CTO / CTE / PWP certificates
// ============================================================

const { normalizeText } = require("../validation/normalizers");
const { extractGroup } = require("../validation/extractors");

// ── Data extraction ──────────────────────────────────────────

function extractCtoData(text) {
  const cleaned = normalizeText(text);

  const issueDate =
    extractGroup(/(?:issue\s*date|date\s*of\s*issue|issued\s*on)[:\s]+([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i, cleaned);

  const expiryDate =
    extractGroup(/(?:valid(?:\s*till|\s*upto|\s*up\s*to)?|expir(?:y|es?|ation)[:\s]*date|validity)[:\s]+([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i, cleaned);

  const authorityName =
    extractGroup(/((?:state|central)?\s*pollution\s*control\s*board[^,\n]{0,60})/i, cleaned) ||
    extractGroup(/(SPCB[^,\n]{0,40})/i, cleaned) ||
    extractGroup(/(CPCB[^,\n]{0,40})/i, cleaned);

  return { issueDate, expiryDate, authorityName };
}

// ── Per-document validation issues (used in Private Limited checks) ──

function validateCtoExpiry(document, issues) {
  if (!document.extractedData || !document.extractedData.expiryDate) return;

  try {
    const parts = document.extractedData.expiryDate.split(/[\/\-]/);
    if (parts.length === 3) {
      const year   = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
      const expiry = new Date(`${year}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`);
      if (!isNaN(expiry.getTime()) && expiry < new Date()) {
        issues.push({
          severity: "high",
          title: "CTO certificate expired",
          detail: `CTO valid till ${document.extractedData.expiryDate} has expired.`,
        });
      }
    }
  } catch (_) { /* ignore date parse errors */ }
}

module.exports = { extractCtoData, validateCtoExpiry };
