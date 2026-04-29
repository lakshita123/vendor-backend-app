// ============================================================
// validation/documentMetadata.js
// Builds the enriched metadata record for a single extracted document.
// Dispatches to the correct per-document extractor based on key/fieldname.
// ============================================================

const { normalizeText } = require("./normalizers");
const { extractPan, extractGstin, extractAadhaar, extractCin, extractMsme, extractEntityName } = require("./extractors");
const { hasDocumentToken } = require("./crossDocumentChecks");

const { extractPanData }              = require("../documents/pan");
const { extractAadhaarData }          = require("../documents/aadhaar");
const { extractGstRegistrationData }  = require("../documents/companyGst");
const { extractBankData }             = require("../documents/bank");
const { extractMsmeData }             = require("../documents/msme");
const { extractCtoData }              = require("../documents/cto");
const { extractGstr3bData }           = require("../documents/gstr3b");
const { extractGeoTagData }           = require("../documents/geoTag");

function buildDocumentMetadata(document, submission = {}) {
  const text    = document.extractedText || "";
  const rawText = document.rawExtractedText || text;
  const key     = document.fieldname;

  const isPanDocument      = hasDocumentToken(key, "pan");
  const isGstDocument      = key.includes("gst") || key.includes("gstr3b");
  const isAadhaarDocument  = key.includes("aadhar");
  const isCinDocument      = key === "cin" || key.endsWith("_cin");
  const isMsmeDocument     = key === "msme" || key.endsWith("_msme");
  const isChequeDocument   = key.includes("cheque");
  const isGstBankDocument  = key.includes("gst_bank");
  const isCtoDocument      = key === "cto" || key.includes("_cto") || key === "cte" || key.includes("_cte") || key === "pwp" || key.includes("_pwp");
  const isGeoTagDocument   = key === "geo_tag_photo" || key === "authorized_person_with_warehouse_photo";

  const extractedData = {};

  if (key === "company_gst")              Object.assign(extractedData, extractGstRegistrationData(rawText));
  if (isAadhaarDocument)                  Object.assign(extractedData, extractAadhaarData(rawText));
  if (isPanDocument)                      Object.assign(extractedData, extractPanData(rawText));
  if (isChequeDocument || isGstBankDocument) Object.assign(extractedData, extractBankData(rawText));
  if (isMsmeDocument)                     Object.assign(extractedData, extractMsmeData(rawText));
  if (isCtoDocument)                      Object.assign(extractedData, extractCtoData(rawText));
  if (key.startsWith("gstr3b_"))          Object.assign(extractedData, extractGstr3bData(rawText));
  if (isGeoTagDocument)                   Object.assign(extractedData, extractGeoTagData(submission));

  return {
    key,
    originalname:     document.originalname,
    extractionStatus: document.extractionStatus,
    extractionError:  document.extractionError,
    totalPages:       document.totalPages,
    identifiers: {
      pan:    isPanDocument     ? extractPan(text)    : null,
      gstin:  isGstDocument     ? extractGstin(text)  : null,
      aadhaar: isAadhaarDocument ? extractAadhaar(text) : null,
      cin:    isCinDocument     ? extractCin(text)    : null,
      msme:   isMsmeDocument    ? extractMsme(text)   : null,
    },
    extractedData,
    entityName: extractEntityName(text),
    textSample: text.slice(0, 500),
  };
}

module.exports = { buildDocumentMetadata };
