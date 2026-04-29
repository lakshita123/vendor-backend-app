// ============================================================
// documents/msme.js
// Extraction + per-document validation for MSME/Udyam certificate
// ============================================================

const { normalizeText, normalizeDigits, normalizeEmail } = require("../validation/normalizers");
const {
  extractMsme, extractGroup, extractEmail, extractMobileNumber,
  extractGender, extractBankAccountNearLabel, extractAccountNumber, parseAddress,
} = require("../validation/extractors");

// ── Sub-extractors ───────────────────────────────────────────

function extractMsmeClassificationYear(text) {
  return (
    extractGroup(/TYPE OF ENTERPRISE[\s\[\]\d|,-]*([\d]{4}-\d{2,4})/i, text) ||
    extractGroup(/TYPE OF ENTERPRISE\s+\[?\d+\s+\[?([0-9]{4,6})/i, text) ||
    extractGroup(/Classification Year[^0-9]*([0-9]{4}-[0-9]{2,4})/i, text) ||
    extractGroup(/Classification Year[^0-9]*([0-9]{4,6})/i, text) ||
    extractGroup(/Classification Year\(s\)[:\s-]*([0-9,\s-]+)/i, text) ||
    extractGroup(/(\d{4}-\d{2})\s+(?:Micro|Small|Medium)/i, text) ||
    extractGroup(/Date of Commencement[^0-9]*\d{2}\/\d{2}\/(\d{4})/i, text) ||
    extractGroup(/Date of Incorporation[^0-9]*\d{2}\/\d{2}\/(\d{4})/i, text)
  );
}

function extractMsmeEnterpriseType(text) {
  return (
    extractGroup(/TYPE OF ENTERPRISE[\s\[\]\d|]*(Micro|Small|Medium)/i, text) ||
    extractGroup(/TYPE OF ENTERPRISE\s+\d+\s+[0-9-]+\s+([A-Za-z]+)/i, text) ||
    extractGroup(/Type of Enterprise[:\s-]*([A-Za-z\s/&-]+)/i, text) ||
    extractGroup(/Enterprise Type[:\s-]*([A-Za-z\s/&-]+)/i, text)
  );
}

function extractTypeOfOrganisation(text) {
  return (
    extractGroup(/Type of Organisation\s+([A-Za-z\s/&().-]+?)\s+Name of Enterprise/i, text) ||
    extractGroup(/Type of Organization[:\s-]*([A-Za-z\s/&().-]+)/i, text) ||
    extractGroup(/Organisation Type[:\s-]*([A-Za-z\s/&().-]+)/i, text)
  );
}

function extractEnterpriseName(text) {
  return (
    extractGroup(/NAME OF ENTERPRISE\s+(.+?)(?=\s+TYPE OF ENTERPRISE|\s+\.?\s*SNo\.|\s+Type of Organisation|$)/i, text) ||
    extractGroup(/NAME OF ENTERPRISE\s+([A-Z0-9][A-Za-z0-9\s,&().'-]+)/i, text) ||
    extractGroup(/Name of Enterprise\s+([A-Z0-9][A-Za-z0-9\s,&().'-]+?)\s+Do you have GSTIN/i, text) ||
    extractGroup(/Name of Enterprise[:\s-]*([A-Z0-9][A-Za-z0-9\s,&().'-]+)/i, text) ||
    extractGroup(/Enterprise Name[:\s-]*([A-Z0-9][A-Za-z0-9\s,&().'-]+)/i, text)
  );
}

function extractOwnerName(text) {
  return (
    extractGroup(/NAME OF ENTREPRENEUR\s+([A-Z][A-Za-z\s.'-]+)/i, text) ||
    extractGroup(/Name of Entrepreneur[:\s-]*([A-Z][A-Za-z\s.'-]+)/i, text) ||
    extractGroup(/Name of Proprietor[:\s-]*([A-Z][A-Za-z\s.'-]+)/i, text) ||
    extractGroup(/Owner Name[:\s-]*([A-Z][A-Za-z\s.'-]+)/i, text)
  );
}

function extractOfficialAddress(text) {
  return (
    extractGroup(/Official address of Enterprise\s+(.+?)(?=\s+National Industry Classification Code|$)/i, text) ||
    extractGroup(/OFFICAL ADDRESS OF ENTERPRISE\s+(.+?)(?=\s+DATE OF INCORPORATION|\s+NATIONAL INDUSTRY|$)/i, text) ||
    extractGroup(/Official Address of Enterprise[:\s-]*([A-Za-z0-9,./()'\\-\s]+?)(?=\s+(?:Date of Incorporation|Mobile|Email|Social Category|Bank|Type of Organization|Major Activity|NIC Code|$))/i, text) ||
    extractGroup(/Address of Enterprise[:\s-]*([A-Za-z0-9,./()'\\-\s]+?)(?=\s+(?:Date of Incorporation|Mobile|Email|Social Category|Bank|Type of Organization|Major Activity|NIC Code|$))/i, text)
  );
}

// ── Data extraction ──────────────────────────────────────────

function extractMsmeData(text) {
  const officialAddress = extractOfficialAddress(text);
  const enterpriseName  = extractEnterpriseName(text);

  return {
    udyamNumber:         extractMsme(text),
    classificationYear:  normalizeText(extractMsmeClassificationYear(text)),
    enterpriseType:      normalizeText(extractMsmeEnterpriseType(text)),
    typeOfOrganization:  normalizeText(extractTypeOfOrganisation(text)),
    majorActivity:       normalizeText(
      extractGroup(/MAJOR ACTIVITY\s+([A-Za-z]+)/i, text) ||
      extractGroup(/Major Activity\s+([A-Za-z]+)/i, text)
    ),
    enterpriseName:      normalizeText(enterpriseName),
    ownerName:           normalizeText(extractOwnerName(text) || enterpriseName),
    mobileNumber:        normalizeDigits(extractMobileNumber(text)),
    email:               normalizeEmail(extractEmail(text)),
    gender:              normalizeText(extractGender(text)),
    officialAddress:     normalizeText(officialAddress),
    officialAddressParts: parseAddress(officialAddress),
    bankIfsc:            normalizeText(
      extractGroup(/IFS Code\s+([A-Z0-9]{8,15})/i, text) ||
      extractGroup(/\b([A-Z]{4}0[A-Z0-9]{6})\b/i, text)
    ),
    bankAccountNumber:   extractBankAccountNearLabel(text) || extractAccountNumber(text),
  };
}

// ── Per-document validation issues ──────────────────────────

function validateMsmeDocument(document, issues) {
  if (!document.identifiers.msme) {
    issues.push({
      severity: "medium",
      title: `MSME number not found in ${document.key}`,
      detail: `The uploaded MSME document ${document.originalname} did not contain a detectable UDYAM number.`,
    });
  }

  [
    ["udyamNumber",      "MSME Number"],
    ["classificationYear","Classification Year"],
    ["enterpriseType",   "Enterprise Type"],
    ["typeOfOrganization","Type of Organization"],
    ["majorActivity",    "Major Activity"],
    ["enterpriseName",   "Enterprise Name"],
    ["ownerName",        "Owner Name"],
    ["mobileNumber",     "Mobile Number"],
    ["email",            "Email"],
    ["gender",           "Gender"],
    ["officialAddress",  "Official Address of Enterprise"],
    ["bankIfsc",         "Bank IFSC"],
    ["bankAccountNumber","Bank Account Number"],
  ].forEach(([fieldKey, label]) => {
    if (!document.extractedData[fieldKey]) {
      issues.push({
        severity: "medium",
        title: `${label} not found in ${document.key}`,
        detail: `The uploaded MSME/Udyam document ${document.originalname} did not contain a detectable ${label}.`,
      });
    }
  });
}

module.exports = {
  extractMsmeData, validateMsmeDocument,
  // exported for use in other modules
  extractOfficialAddress,
};
