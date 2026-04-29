// ============================================================
// documents/aadhaar.js
// Extraction + per-document validation for Aadhaar card
// ============================================================

const { normalizeText } = require("../validation/normalizers");
const { bestTrailingName } = require("../validation/normalizers");
const {
  extractAadhaar, extractGroup, extractPersonName,
  extractDateOfBirth, extractAddressBlock, parseAddress,
} = require("../validation/extractors");

// ── Data extraction ──────────────────────────────────────────

function extractAadhaarData(text) {
  const cleaned = normalizeText(text);

  const aadhaarNameCandidate =
    extractGroup(/([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+)\s+[=H]+(?:\s+[A-Za-z]+)?\s*\/\s*DOB/i, cleaned) ||
    extractGroup(/([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+)\s+[=H]+(?:\s+[A-Za-z]+)?\s+DOB/i, cleaned) ||
    extractGroup(/([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+)\s*=?\s*(?:dob|male|female)/i, cleaned) ||
    extractGroup(/([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+)\s+(?:dob|male|female|your aadhaar no)/i, cleaned) ||
    extractPersonName(text);

  const address = extractAddressBlock(text);

  let aadhaarNameCleaned = aadhaarNameCandidate || "";
  if (aadhaarNameCleaned) {
    aadhaarNameCleaned = aadhaarNameCleaned
      .replace(/(DOB|MALE|FEMALE|YEAR OF BIRTH).*/gi, "")
      .replace(/[^A-Z\s]/gi, "")
      .trim();
  }

  return {
    name: bestTrailingName(aadhaarNameCleaned || aadhaarNameCandidate, 2),
    aadhaarNumber: extractAadhaar(text),
    dob: extractDateOfBirth(text),
    address,
    addressParts: parseAddress(address),
  };
}

// ── Per-document validation issues ──────────────────────────

function validateAadhaarDocument(document, issues) {
  if (!document.identifiers.aadhaar) {
    issues.push({
      severity: "medium",
      title: `Aadhaar number not found in ${document.key}`,
      detail: `The uploaded Aadhaar document ${document.originalname} did not contain a detectable Aadhaar number.`,
    });
  }

  if (!document.extractedData.name) {
    issues.push({
      severity: "medium",
      title: `Name not found in ${document.key}`,
      detail: `The uploaded Aadhaar document ${document.originalname} did not contain a detectable name.`,
    });
  }

  if (!document.extractedData.dob) {
    issues.push({
      severity: "medium",
      title: `DOB not found in ${document.key}`,
      detail: `The uploaded Aadhaar document ${document.originalname} did not contain a detectable DOB.`,
    });
  }
}

module.exports = { extractAadhaarData, validateAadhaarDocument };
