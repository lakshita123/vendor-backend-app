// ============================================================
// services/documentMetadata.js
// Builds the per-document metadata object (identifiers + extractedData)
// for every uploaded document key.
// ============================================================

const { normalizeText }        = require("../validation/normalizers");
const {
  extractGstin, extractPan, extractAadhaar,
  extractMsme,  extractCin,
} = require("../validation/extractors");

const { extractGstRegistrationData }  = require("../documents/companyGst");
const { extractPanData }              = require("../documents/pan");
const { extractAadhaarData }          = require("../documents/aadhaar");
const { extractMsmeData }             = require("../documents/msme");
const { extractBankData }             = require("../documents/bank");
const { extractGstr3bData }           = require("../documents/gstr3b");
const { extractCinData }              = require("../documents/cin");

// ── Helper: pick the best photo file from a document group ──

function findPhotoDoc(documents, key) {
  return documents.find(
    (d) => d.key === key && /\.(jpe?g|png|webp|heic|bmp|gif)$/i.test(d.originalname || "")
  ) || documents.find((d) => d.key === key);
}

// ── Main builder ─────────────────────────────────────────────

/**
 * buildDocumentMetadata
 *
 * @param {object} doc  - raw document object from documentProcessor
 *   { key, originalname, mimetype, extractionStatus, rawText, filePath }
 * @param {object[]} allDocs - all documents in this submission (for cross-doc lookups)
 * @returns enriched document object with .identifiers and .extractedData
 */
function buildDocumentMetadata(doc, allDocs = []) {
  const text   = doc.rawText || "";
  const key    = doc.key    || "";

  // ── Universal identifiers (extracted from any doc's text) ─
  const identifiers = {
    gstin:  extractGstin(text)  || null,
    pan:    extractPan(text)    || null,
    aadhaar: extractAadhaar(text) || null,
    msme:   extractMsme(text)   || null,
    cin:    extractCin(text)    || null,
  };

  // ── Per-document-type rich extraction ─────────────────────
  let extractedData = {};

  if (key === "company_gst") {
    extractedData = extractGstRegistrationData(text);

  } else if (key === "pan" || key === "company_pan") {
    extractedData = extractPanData(text);

  } else if (key === "aadhar" || key === "aadhaar") {
    extractedData = extractAadhaarData(text);

  } else if (key === "msme") {
    extractedData = extractMsmeData(text);

  } else if (key === "cheque" || key === "gst_bank") {
    extractedData = extractBankData(text);

  } else if (key.startsWith("gstr3b")) {
    extractedData = extractGstr3bData(text);

  } else if (key === "cin") {
    extractedData = extractCinData(text);
    // Backfill CIN identifier from extractedData if direct regex missed it
    if (!identifiers.cin && extractedData.cin) {
      identifiers.cin = extractedData.cin;
    }
  }

  // ── Face-check photo resolution ───────────────────────────
  // The authorized_person_photo document is the source face to compare
  // against the Aadhaar / PAN photo.  We tag it here so documentProcessor
  // can pass both images to compareFaces().
  let facePhotoMeta = null;
  if (key === "authorized_person_photo") {
    facePhotoMeta = {
      role:     "source",       // This is the live photo of the authorized person
      filePath: doc.filePath,
    };
  } else if (key === "aadhar" || key === "aadhaar") {
    facePhotoMeta = {
      role:     "reference",    // This is the Aadhaar ID photo
      filePath: doc.filePath,
    };
  }

  return {
    ...doc,
    identifiers,
    extractedData,
    facePhotoMeta,  // null unless this doc is used for face comparison
  };
}

/**
 * resolveFaceComparisonPair
 *
 * Given enriched documents, returns { sourcePath, referencePath } for
 * face comparison, or null if either is unavailable.
 *
 * - source    = authorized_person_photo (live photo taken at geo-tag step)
 * - reference = aadhar (Aadhaar card scan)
 */
function resolveFaceComparisonPair(enrichedDocs) {
  const sourceDoc = enrichedDocs.find(
    (d) => d.key === "authorized_person_photo" && d.filePath
  );
  const referenceDoc = enrichedDocs.find(
    (d) => (d.key === "aadhar" || d.key === "aadhaar") && d.filePath
  );

  if (!sourceDoc || !referenceDoc) return null;

  return {
    sourcePath:    sourceDoc.filePath,    // authorized person live photo
    referencePath: referenceDoc.filePath, // Aadhaar card photo
  };
}

module.exports = { buildDocumentMetadata, resolveFaceComparisonPair };
