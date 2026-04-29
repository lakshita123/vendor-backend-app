// ============================================================
// documents/bank.js
// Extraction + per-document validation for Cancel Cheque & GST Bank Screenshot
// ============================================================

const { extractBankAccountNearLabel, extractAccountNumber } = require("../validation/extractors");

// ── Data extraction ──────────────────────────────────────────

function extractBankData(text) {
  return {
    accountNumber:
      extractBankAccountNearLabel(text) ||
      extractAccountNumber(text),
  };
}

// ── Per-document validation issues ──────────────────────────

function validateBankDocument(document, issues) {
  if (!document.extractedData.accountNumber) {
    issues.push({
      severity: "medium",
      title: `Account number not found in ${document.key}`,
      detail: `The uploaded bank document ${document.originalname} did not contain a detectable account number.`,
    });
  }
}

module.exports = { extractBankData, validateBankDocument };
