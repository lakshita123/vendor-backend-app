// ============================================================
// documents/companyGst.js
// Extraction + per-document validation for Company GST Registration
// ============================================================

const { normalizeText } = require("../validation/normalizers");
const { extractGstin, extractGroup, parseAddress } = require("../validation/extractors");

// ── Helper ───────────────────────────────────────────────────

function collectFieldFromLines(lines, startPattern, endPattern) {
  const startIndex = lines.findIndex((line) => startPattern.test(line));
  if (startIndex === -1) return null;

  const collected = [];
  let current = lines[startIndex].replace(startPattern, "").trim();
  if (current) collected.push(current);

  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (endPattern.test(line)) break;
    if (line) collected.push(line.replace(/^Business\s+/i, "").trim());
  }

  return normalizeText(collected.join(" "));
}

// ── Data extraction ──────────────────────────────────────────

function extractGstRegistrationData(text) {
  const rawLines = (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const firstPageLines = [];
  for (const line of rawLines) {
    if (/^--\s*1 of \d+\s*--$/i.test(line)) break;
    firstPageLines.push(line);
  }

  const cleaned = normalizeText(text);

  const legalNameFromLines = collectFieldFromLines(firstPageLines, /^1\.\s*Legal Name\s*/i, /^2\./i);
  const tradeNameFromLines = collectFieldFromLines(firstPageLines, /^2\.\s*Trade Name, if any\s*/i, /^3\./i);
  const constitutionFromLines = collectFieldFromLines(firstPageLines, /^4\.\s*Constitution of Business\s*/i, /^5\./i);
  const addressFromLines = collectFieldFromLines(firstPageLines, /^5\.\s*Address of Principal Place of\s*Business\s*/i, /^6\./i);

  const annexureLegalName =
    extractGroup(/Total Number of Additional Places of Business in the State\s+\d+\s+Legal Name\s+(.+?)\s+Trade Name, if any/i, cleaned) ||
    extractGroup(/Details of Proprietor\s+Legal Name\s+(.+?)\s+Trade Name, if any/i, cleaned);

  const annexureTradeName =
    extractGroup(/Total Number of Additional Places of Business in the State\s+\d+\s+Legal Name\s+.+?\s+Trade Name, if any\s+(.+?)(?=\s+(?:Goods and Services Tax|Annexure B|Details of Proprietor|$))/i, cleaned) ||
    extractGroup(/Details of Proprietor\s+Legal Name\s+.+?\s+Trade Name, if any\s+(.+?)(?=\s+1 Name|\s+Designation\/Status|\s+Resident of State|$)/i, cleaned);

  const legalName =
    legalNameFromLines ||
    annexureLegalName ||
    extractGroup(/1\.\s*Legal Name\s+(.+?)\s+2\./i, cleaned) ||
    extractGroup(/Legal Name[:\s]+([A-Z][A-Z\s.&'-]{2,})/i, cleaned);

  const tradeName =
    tradeNameFromLines ||
    annexureTradeName ||
    extractGroup(/2\.\s*Trade Name, if any\s+(.+?)\s+3\./i, cleaned) ||
    // Stop at address keywords, digits, or constitution to avoid capturing address text
    extractGroup(/Trade Name, if any[:\s]+([A-Z][A-Z\s.&'-]{2,60})(?=\s+(?:\d|Address|Constitution|Additional|Date|Period|Type|Building|Road|Flat|Plot|$))/i, cleaned);

  const constitution =
    constitutionFromLines ||
    extractGroup(/4\.\s*Constitution of Business\s+(.+?)\s+5\./i, cleaned) ||
    extractGroup(/Constitution of Business[:\s]+([A-Z][A-Z\s.&'-]{2,})/i, cleaned);

  const address =
    addressFromLines ||
    extractGroup(/5\.\s*Address of Principal Place of\s*Business\s+(.+?)\s+6\./i, cleaned) ||
    extractGroup(/Address of Principal Place of Business[:\s]+(.+?)(?=\d+\.\s|Date of Liability|Period of Validity|Type of Registration|$)/i, cleaned);

  return {
    gstin: extractGstin(cleaned),
    legalName: normalizeText(legalName),
    tradeName: normalizeText(tradeName),
    additionalPlacesOfBusiness:
      extractGroup(/Total Number of Additional Places of Business in the State[:\s]+(\d+)/i, cleaned) || "0",
    constitutionOfBusiness: normalizeText(constitution),
    address: normalizeText(address),
    addressParts: parseAddress(address),
  };
}

// ── Per-document validation issues ──────────────────────────

function validateCompanyGstDocument(document, issues) {
  if (!document.identifiers.gstin) {
    issues.push({
      severity: "high",
      title: `GSTIN not found in ${document.key}`,
      detail: `The uploaded GST-related document ${document.originalname} did not contain a detectable GSTIN.`,
    });
  }

  [
    ["legalName",                   "Legal Name"],
    ["tradeName",                   "Trade Name"],
    ["additionalPlacesOfBusiness",  "Additional Places of Business"],
    ["constitutionOfBusiness",      "Constitution of Business"],
    ["address",                     "Address"],
  ].forEach(([fieldKey, label]) => {
    if (!document.extractedData[fieldKey]) {
      issues.push({
        severity: "medium",
        title: `${label} not found in ${document.key}`,
        detail: `The GST Registration document ${document.originalname} did not contain a detectable ${label}.`,
      });
    }
  });
}

module.exports = { extractGstRegistrationData, validateCompanyGstDocument };
