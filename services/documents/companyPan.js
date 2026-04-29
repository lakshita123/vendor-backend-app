// ============================================================
// documents/companyPan.js
// Per-document validation for Company PAN (used by Private Limited constitution)
// Shares extractor logic with pan.js
// ============================================================

// No additional extraction needed — reuses pan.js extractPanData via buildDocumentMetadata

function validateCompanyPanDocument(document, issues) {
  if (!document) {
    issues.push({
      severity: "high",
      title: "Company PAN not uploaded",
      detail: "Company PAN is required for Private Limited vendors.",
    });
    return;
  }

  if (document.extractionStatus !== "success") {
    issues.push({
      severity: "medium",
      title: "Company PAN unreadable",
      detail: `${document.originalname} could not be read automatically.`,
    });
    return;
  }

  if (!document.identifiers.pan) {
    issues.push({
      severity: "medium",
      title: "PAN number not found in company_pan",
      detail: `${document.originalname} did not contain a detectable PAN number.`,
    });
  }
}

module.exports = { validateCompanyPanDocument };
