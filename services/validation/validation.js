// ============================================================
// validation/validation.js  (replaces services/validation.js)
// Main entry point — orchestrates all validation logic
// ============================================================

const { normalizeText, normalizeDigits, normalizeEmail, isValidName } = require("./normalizers");
const { compareNameField, isSuspiciousName, isCloseDigitMatch } = require("./comparators");
const { parseAddress } = require("./extractors");
const { buildDocumentMetadata } = require("./documentMetadata");
const { buildValidationChecks, getDocumentByKey, hasDocumentToken, pushIssue } = require("./crossDocumentChecks");
const { buildFaceChecks } = require("./faceChecks");

// Per-document validators
const { validatePanDocument }        = require("../documents/pan");
const { validateAadhaarDocument }    = require("../documents/aadhaar");
const { validateCompanyGstDocument } = require("../documents/companyGst");
const { validateBankDocument }       = require("../documents/bank");
const { validateCinDocument }        = require("../documents/cin");
const { validateMsmeDocument }       = require("../documents/msme");
const { validateGstr3bDocument }     = require("../documents/gstr3b");
const { validateCompanyPanDocument } = require("../documents/companyPan");
const { validateCtoExpiry }          = require("../documents/cto");

function isMissingValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return !value.trim();
  return false;
}

function isWeakAccountNumber(value) {
  const digits = normalizeDigits(value);
  return !digits || digits.length < 14;
}

function validateSubmission(submission, documents, faceResults) {
  const issues = [];
  const extractedDocuments = documents.map((document) => buildDocumentMetadata(document, submission));

  // ── Resolve trusted names and fix-up data ────────────────────
  const gstDocument    = getDocumentByKey(extractedDocuments, "company_gst");
  const aadhaarDocument = extractedDocuments.find((doc) => doc.key.includes("aadhar")) || null;
  const panDocument    = extractedDocuments.find((doc) => hasDocumentToken(doc.key, "pan")) || null;
  const chequeDocument = extractedDocuments.find((doc) => doc.key.includes("cheque")) || null;
  const gstBankDocument = extractedDocuments.find((doc) => doc.key.includes("gst_bank")) || null;

  const aadhaarName     = normalizeText(aadhaarDocument && aadhaarDocument.extractedData.name);
  const gstName         = normalizeText(gstDocument && gstDocument.extractedData.legalName);
  const trustedSharedName =
    aadhaarName && gstName && compareNameField(aadhaarName, gstName)
      ? gstName
      : gstName || aadhaarName;

  if (aadhaarDocument && aadhaarDocument.identifiers.aadhaar && trustedSharedName &&
      (isSuspiciousName(aadhaarDocument.extractedData.name) ||
        !compareNameField(aadhaarDocument.extractedData.name, trustedSharedName))) {
    aadhaarDocument.extractedData.name = trustedSharedName;
  }

  if (panDocument && panDocument.identifiers.pan &&
      (isSuspiciousName(panDocument.extractedData.name) ||
        (trustedSharedName && !compareNameField(panDocument.extractedData.name, trustedSharedName)))) {
    panDocument.extractedData.name =
      (!isSuspiciousName(trustedSharedName) && trustedSharedName) ||
      panDocument.extractedData.name;
  }

  if (chequeDocument && gstBankDocument &&
      isCloseDigitMatch(chequeDocument.extractedData.accountNumber, gstBankDocument.extractedData.accountNumber)) {
    chequeDocument.extractedData.accountNumber = normalizeDigits(gstBankDocument.extractedData.accountNumber);
  }

  // ── MSME data fix-ups ────────────────────────────────────────
  const msmeDocument = extractedDocuments.find((doc) => doc.key === "msme" || doc.key.endsWith("_msme")) || null;
  if (msmeDocument) {
    if (isMissingValue(msmeDocument.extractedData.typeOfOrganization) && gstDocument)
      msmeDocument.extractedData.typeOfOrganization = normalizeText(gstDocument.extractedData.constitutionOfBusiness);
    if (isMissingValue(msmeDocument.extractedData.enterpriseName) && gstDocument)
      msmeDocument.extractedData.enterpriseName = normalizeText(gstDocument.extractedData.tradeName);
    if ((isMissingValue(msmeDocument.extractedData.ownerName) ||
        compareNameField(msmeDocument.extractedData.ownerName, msmeDocument.extractedData.enterpriseName)) && gstDocument)
      msmeDocument.extractedData.ownerName = normalizeText(gstDocument.extractedData.legalName);
    if ((isMissingValue(msmeDocument.extractedData.officialAddress) ||
        !msmeDocument.extractedData.officialAddressParts ||
        !msmeDocument.extractedData.officialAddressParts.pincode) && gstDocument) {
      msmeDocument.extractedData.officialAddress = normalizeText(gstDocument.extractedData.address);
      msmeDocument.extractedData.officialAddressParts = parseAddress(msmeDocument.extractedData.officialAddress);
    }
    if (isWeakAccountNumber(msmeDocument.extractedData.bankAccountNumber)) {
      msmeDocument.extractedData.bankAccountNumber =
        normalizeDigits(chequeDocument && chequeDocument.extractedData.accountNumber) ||
        normalizeDigits(gstBankDocument && gstBankDocument.extractedData.accountNumber) ||
        msmeDocument.extractedData.bankAccountNumber;
    }
    if (isMissingValue(msmeDocument.extractedData.mobileNumber))
      msmeDocument.extractedData.mobileNumber = normalizeDigits(submission && submission.phone);
    if (isMissingValue(msmeDocument.extractedData.email))
      msmeDocument.extractedData.email = normalizeEmail(submission && submission.email);
  }

  // ── Required submission fields ───────────────────────────────
  ["name", "phone", "email", "constitution", "vendorType", "product"].forEach((field) => {
    if (!normalizeText(submission[field])) {
      pushIssue(issues, "high", `Missing form field: ${field}`, `The submission did not include a value for "${field}".`);
    }
  });

  if (!documents.length) {
    pushIssue(issues, "high", "No documents uploaded", "The vendor submission reached the backend without any files attached.");
  }

  // ── Per-document validation ──────────────────────────────────
  extractedDocuments.forEach((document) => {
    // Skip geo-tag docs with no text extraction
    if ((document.key === "geo_tag_photo" || document.key === "authorized_person_with_warehouse_photo") &&
        document.extractionStatus !== "success") return;

    if (document.extractionStatus === "skipped") {
      pushIssue(issues, "medium", `Unsupported file type for ${document.key}`, `${document.originalname} is not a PDF, so automatic reading was skipped.`);
      return;
    }

    if (document.extractionStatus !== "success") {
      pushIssue(issues, "medium", `Unreadable document: ${document.key}`, `${document.originalname} could not be read automatically. ${document.extractionError}`);
      return;
    }

    if (hasDocumentToken(document.key, "pan")) validatePanDocument(document, issues);
    if (document.key.includes("aadhar"))       validateAadhaarDocument(document, issues);
    if (document.key === "company_gst")        validateCompanyGstDocument(document, issues);
    if (document.key.includes("cheque") || document.key.includes("gst_bank")) validateBankDocument(document, issues);
    if (document.key === "cin" || document.key.endsWith("_cin"))  validateCinDocument(document, issues);
    if (document.key === "msme" || document.key.endsWith("_msme")) validateMsmeDocument(document, issues);

    if (document.key.startsWith("gstr3b_")) {
      const index = extractedDocuments.filter((d) => d.key.startsWith("gstr3b_")).indexOf(document);
      validateGstr3bDocument(document, index, issues);
    }

    // GST docs that are NOT company_gst — still need GSTIN check
    if ((document.key.includes("gst") || document.key.includes("gstr3b")) &&
        document.key !== "company_gst" &&
        !document.key.startsWith("gstr3b_") &&
        !document.identifiers.gstin) {
      pushIssue(issues, "high", `GSTIN not found in ${document.key}`, `The uploaded GST-related document ${document.originalname} did not contain a detectable GSTIN.`);
    }
  });

  // ── Cross-document identifier consistency ────────────────────
  const gstins = [...new Set(extractedDocuments.map((doc) => doc.identifiers.gstin).filter(Boolean))];
  if (gstins.length > 1) pushIssue(issues, "high", "GSTIN mismatch across uploaded documents", `Multiple GSTINs were detected: ${gstins.join(", ")}.`);

  const pans = [...new Set(extractedDocuments.map((doc) => doc.identifiers.pan).filter(Boolean))];
  if (pans.length > 1) pushIssue(issues, "high", "PAN mismatch across uploaded documents", `Multiple PAN numbers were detected: ${pans.join(", ")}.`);

  const gstr3bDocuments = documents.filter((doc) => doc.fieldname.startsWith("gstr3b_"));
  if (gstr3bDocuments.length > 0 && gstr3bDocuments.length < 3) {
    pushIssue(issues, "medium", "Incomplete GSTR3B set", `Expected 3 GSTR3B uploads, but only received ${gstr3bDocuments.length}.`);
  }

  // ── Private Limited specific checks ─────────────────────────
  if (submission && submission.constitution === "Private Limited") {
    const companyPanDoc = extractedDocuments.find((doc) => doc.key === "company_pan") || null;
    validateCompanyPanDocument(companyPanDoc, issues);

    const cinDoc = extractedDocuments.find((doc) => doc.key === "cin" || doc.key.endsWith("_cin")) || null;
    if (!cinDoc) {
      pushIssue(issues, "high", "CIN certificate not uploaded", "CIN certificate is required for Private Limited vendors.");
    } else if (cinDoc.extractionStatus !== "success") {
      pushIssue(issues, "medium", "CIN certificate unreadable", `${cinDoc.originalname} could not be read automatically.`);
    } else if (!cinDoc.identifiers.cin) {
      pushIssue(issues, "medium", "CIN not found in CIN document", `${cinDoc.originalname} did not contain a detectable CIN number.`);
    }

    const ctoDoc = extractedDocuments.find((doc) =>
      doc.key === "cto" || doc.key.includes("_cto") ||
      doc.key === "cte" || doc.key.includes("_cte")
    ) || null;

    if (!ctoDoc) {
      pushIssue(issues, "high", "CTO certificate not uploaded", "CTO (Consent to Operate) is required for Private Limited vendors.");
    } else if (ctoDoc.extractionStatus !== "success") {
      pushIssue(issues, "medium", "CTO certificate unreadable", `${ctoDoc.originalname} could not be read automatically.`);
    } else {
      validateCtoExpiry(ctoDoc, issues);
    }
  }

  // ── Build final checks and return ────────────────────────────
  const validationChecks = buildValidationChecks(extractedDocuments, issues, submission);
  const faceChecks       = buildFaceChecks(faceResults || [], issues);
  const allChecks        = [...validationChecks, ...faceChecks];

  return {
    status: issues.length ? "needs_review" : "clear",
    issues,
    extractedDocuments,
    validationChecks: allChecks,
    faceResults: faceResults || [],
    summary: {
      totalDocuments:      documents.length,
      readableDocuments:   extractedDocuments.filter((doc) => doc.extractionStatus === "success").length,
      unreadableDocuments: extractedDocuments.filter((doc) => doc.extractionStatus !== "success").length,
    },
  };
}

module.exports = { validateSubmission };
