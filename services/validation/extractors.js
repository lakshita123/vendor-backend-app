// ============================================================
// extractors.js
// Generic field-level regex extractors (PAN, GST, Aadhaar, etc.)
// ============================================================

const { normalizeText, normalizeAlphaNumeric, normalizeDigits } = require("./normalizers");

function extractFirst(regex, text) {
  const match = normalizeText(text).match(regex);
  return match ? normalizeAlphaNumeric(match[0]) : null;
}

function extractGroup(regex, text, groupIndex = 1) {
  const match = normalizeText(text).match(regex);
  return match && match[groupIndex] ? match[groupIndex].trim() : null;
}

function extractPan(text) {
  return extractFirst(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/i, text);
}

function extractGstin(text) {
  return extractFirst(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/i, text);
}

function extractAadhaar(text) {
  const match = normalizeText(text).match(/\b\d{4}\s?\d{4}\s?\d{4}\b/);
  return match ? normalizeDigits(match[0]) : null;
}

function extractCin(text) {
  return extractFirst(/\b[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b/i, text);
}

function extractMsme(text) {
  return extractFirst(/\bUDYAM-[A-Z]{2}-\d{2}-\d{7}\b/i, text);
}

function extractEntityName(text) {
  return (
    extractGroup(/Legal Name[:\s]+([A-Z][A-Z\s.&'-]{2,})/i, text) ||
    extractGroup(/Trade Name[:\s]+([A-Z][A-Z\s.&'-]{2,})/i, text) ||
    null
  );
}

function extractAccountNumber(text) {
  const labeled =
    extractGroup(/account\s*(?:number|no\.?)[:\s-]*([0-9\s-]{9,20})/i, text) ||
    extractGroup(/a\/c\s*(?:no|number)[:\s-]*([0-9\s-]{9,20})/i, text);

  if (labeled) return labeled.replace(/\D/g, "");

  const matches = (text || "").match(/\b\d{12,18}\b/g);
  return matches ? matches[0] : null;
}

function extractBankAccountNearLabel(text) {
  const cleaned = normalizeText(text);
  const labeled =
    extractGroup(/\b[A-Z]{4}0[A-Z0-9]{6}\b\s+([0-9OQSBIl|¢]{9,20})/i, cleaned) ||
    extractGroup(/Bank Account (?:Nu|No|Number)[^0-9A-Z]*([0-9OQSBIl|]{9,20})/i, cleaned) ||
    extractGroup(/A\/C[^0-9A-Z]*([0-9OQSBIl|]{9,20})/i, cleaned);

  if (!labeled) return null;

  return normalizeDigits(
    labeled
      .replace(/O/g, "0")
      .replace(/[Il|]/g, "1")
      .replace(/S/g, "5")
      .replace(/B/g, "8")
      .replace(/Q/g, "0")
      .replace(/¢/g, "")
  );
}

function extractEmail(text) {
  const match = (text || "").match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return match ? match[0] : null;
}

function extractMobileNumber(text) {
  const match = normalizeText(text).match(/(?:mobile|mob\.?|phone|contact)\s*(?:number|no\.?)?[:\s-]*([6-9]\d{9})/i);
  if (match) return match[1];

  const generic = normalizeText(text).match(/\b[6-9]\d{9}\b/);
  return generic ? generic[0] : null;
}

function extractGender(text) {
  return (
    extractGroup(/Gender[:\s-]*(Male|Female|Transgender|Other)/i, text) ||
    extractGroup(/Social Category[:\s-].+?\b(Male|Female)\b/i, text)
  );
}

function extractDateOfBirth(text) {
  const cleaned = normalizeText(text);
  const match =
    cleaned.match(/\b\d{2}\/\d{2}\/\d{4}\b/) ||
    cleaned.match(/\b\d{2}-\d{2}-\d{4}\b/);
  return match ? match[0] : null;
}

function extractPersonName(text) {
  const cleaned = normalizeText(text);
  const { firstMeaningfulNameTokens } = require("./normalizers");

  const labeledPatterns = [
    /Name[:\s-]+([A-Z][A-Za-z\s.'-]{2,})/i,
    /Legal Name[:\s-]+([A-Z][A-Za-z\s.&'-]{2,})/i,
  ];

  for (const pattern of labeledPatterns) {
    const match = cleaned.match(pattern);
    if (match && match[1]) return firstMeaningfulNameTokens(match[1], 3);
  }

  const lines = (text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (
      /^[A-Z][A-Za-z\s.'-]{4,}$/.test(line) &&
      !/government|income tax|permanent account|unique identification/i.test(line)
    ) {
      return firstMeaningfulNameTokens(line, 3);
    }
  }

  return null;
}

function extractAddressBlock(text) {
  const cleaned = normalizeText(text);
  return (
    extractGroup(/Address[:\s]+(.+?)(?=help@|www\.|uidai|$)/i, cleaned) ||
    extractGroup(
      /Address of Principal Place of Business[:\s]+(.+?)(?=\d+\.\s|Date of Liability|Period of Validity|Type of Registration|$)/i,
      cleaned
    )
  );
}

function parseAddress(address) {
  const cleaned = normalizeText(address);
  if (!cleaned) return { raw: null, pincode: null, city: null, state: null, region: null };

  const parts = cleaned.split(",").map((part) => normalizeText(part)).filter(Boolean);
  const pincodeMatch = cleaned.match(/\b\d{6}\b/);
  const pincode = pincodeMatch ? pincodeMatch[0] : null;
  const state  = parts.length >= 2 ? parts[parts.length - 2] : null;
  const city   = parts.length >= 3 ? parts[parts.length - 3] : null;
  const region = parts.length >= 4 ? parts[parts.length - 4] : parts[0] || null;

  return { raw: cleaned, pincode, city, state, region };
}

module.exports = {
  extractFirst, extractGroup,
  extractPan, extractGstin, extractAadhaar, extractCin, extractMsme,
  extractEntityName, extractAccountNumber, extractBankAccountNearLabel,
  extractEmail, extractMobileNumber, extractGender,
  extractDateOfBirth, extractPersonName, extractAddressBlock, parseAddress,
};
