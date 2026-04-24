/**
 * validation.js
 *
 * Validates a vendor submission against its extracted documents and
 * optional face-comparison results.
 *
 * ✅ SAFE EXTENSION RULES APPLIED:
 *  - All existing validation logic preserved as-is
 *  - New Private Limited checks added in a clearly isolated block
 *  - No existing fields removed or renamed
 *  - Return shape unchanged: { status, issues }
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function fieldText(docs, fieldname) {
  const doc = docs.find(
    (d) =>
      d.fieldname === fieldname ||
      (d.fieldname && d.fieldname.includes(fieldname))
  );
  return doc ? (doc.extractedText || "") : "";
}

function docPresent(docs, fieldname) {
  return docs.some(
    (d) =>
      (d.fieldname === fieldname ||
        (d.fieldname && d.fieldname.includes(fieldname))) &&
      d.extractionStatus !== "failed" &&
      (d.extractedText || "").trim().length > 0
  );
}

function docUploaded(docs, fieldname) {
  return docs.some(
    (d) =>
      d.fieldname === fieldname ||
      (d.fieldname && d.fieldname.includes(fieldname))
  );
}

// ── Field-specific extraction helpers ────────────────────────────────────────

function extractPanNumber(text) {
  const m = (text || "").match(/\b([A-Z]{5}[0-9]{4}[A-Z])\b/i);
  return m ? m[1].toUpperCase() : null;
}

function extractGstin(text) {
  const m = (text || "").match(/\b(\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9])\b/i);
  return m ? m[1].toUpperCase() : null;
}

function extractAadhaarNumber(text) {
  const m = (text || "").match(/\b(\d{4}\s?\d{4}\s?\d{4})\b/);
  return m ? m[1].replace(/\s/g, "") : null;
}

function extractMsmeNumber(text) {
  const m = (text || "").match(/\b(UDYAM-[A-Z]{2}-\d{2}-\d{7})\b/i);
  return m ? m[1].toUpperCase() : null;
}

function extractCinNumber(text) {
  const m = (text || "").match(/\b([A-Z]{1}[0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6})\b/);
  return m ? m[1] : null;
}

// ── Name normalisation for cross-doc checks ───────────────────────────────────

function normalizeName(name) {
  return (name || "")
    .toUpperCase()
    .replace(/\bPRIVATE\b|\bLIMITED\b|\bPVT\b|\bLTD\b|\./g, "")
    .replace(/[^A-Z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function namesSimilar(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// ── Cross-document PAN consistency ───────────────────────────────────────────

function checkPanGstConsistency(panText, gstText) {
  const pan  = extractPanNumber(panText);
  const gstin = extractGstin(gstText);
  if (!pan || !gstin) return null;
  // GSTIN positions 3–12 embed the PAN
  const panInGstin = gstin.substring(2, 12);
  return panInGstin.toUpperCase() === pan.toUpperCase();
}

// ── Face result helpers ───────────────────────────────────────────────────────

function getFaceResult(faceResults, label) {
  if (!Array.isArray(faceResults)) return null;
  return faceResults.find(
    (r) => r && r.label && r.label.toLowerCase() === label.toLowerCase()
  ) || null;
}

// ── Issue builder ─────────────────────────────────────────────────────────────

function issue(code, severity, message, detail) {
  return { code, severity, message, detail: detail || null };
}

// ── MAIN VALIDATION ───────────────────────────────────────────────────────────

function validateSubmission(submission, documents, faceResults) {
  const issues = [];
  const docs   = Array.isArray(documents) ? documents : [];
  const sub    = submission || {};

  const constitution = (sub.constitution || "").trim();
  const isPrivateLimited = constitution === "Private Limited";
  const isProprietorship  = constitution === "Proprietorship";

  // ══════════════════════════════════════════════════════════════════
  // 1. SUBMISSION METADATA CHECKS
  // ══════════════════════════════════════════════════════════════════

  if (!sub.name || !sub.name.trim()) {
    issues.push(issue("MISSING_NAME", "error", "Vendor name is missing."));
  }
  if (!sub.phone || !sub.phone.trim()) {
    issues.push(issue("MISSING_PHONE", "error", "Phone number is missing."));
  }
  if (!sub.email || !sub.email.trim()) {
    issues.push(issue("MISSING_EMAIL", "warning", "Email address is missing."));
  }
  if (!sub.constitution || !sub.constitution.trim()) {
    issues.push(issue("MISSING_CONSTITUTION", "error", "Constitution type is missing."));
  }
  if (!sub.vendorType || !sub.vendorType.trim()) {
    issues.push(issue("MISSING_VENDOR_TYPE", "error", "Vendor type is missing."));
  }

  // ══════════════════════════════════════════════════════════════════
  // 2. AADHAAR VALIDATION
  // ══════════════════════════════════════════════════════════════════

  const aadharText = fieldText(docs, "aadhar");
  if (!docUploaded(docs, "aadhar")) {
    issues.push(issue("MISSING_AADHAR", "error", "Aadhaar document not uploaded."));
  } else if (!docPresent(docs, "aadhar")) {
    issues.push(issue("AADHAR_UNREADABLE", "warning", "Aadhaar document could not be read."));
  } else {
    const aadhaarNo = extractAadhaarNumber(aadharText);
    if (!aadhaarNo) {
      issues.push(issue("AADHAR_NUMBER_NOT_FOUND", "warning", "Aadhaar number not found in document."));
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 3. INDIVIDUAL PAN VALIDATION
  // ══════════════════════════════════════════════════════════════════

  const panText = fieldText(docs, "pan");
  if (!docUploaded(docs, "pan")) {
    issues.push(issue("MISSING_PAN", "error", "Authorised person PAN not uploaded."));
  } else if (!docPresent(docs, "pan")) {
    issues.push(issue("PAN_UNREADABLE", "warning", "Authorised person PAN could not be read."));
  } else {
    const panNo = extractPanNumber(panText);
    if (!panNo) {
      issues.push(issue("PAN_NUMBER_NOT_FOUND", "warning", "PAN number not found in document."));
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 4. GST VALIDATION
  // ══════════════════════════════════════════════════════════════════

  const gstText = fieldText(docs, "company_gst");
  if (!docUploaded(docs, "company_gst")) {
    issues.push(issue("MISSING_GST", "error", "Company GST certificate not uploaded."));
  } else if (!docPresent(docs, "company_gst")) {
    issues.push(issue("GST_UNREADABLE", "warning", "Company GST certificate could not be read."));
  } else {
    const gstin = extractGstin(gstText);
    if (!gstin) {
      issues.push(issue("GST_NUMBER_NOT_FOUND", "warning", "GSTIN not found in GST certificate."));
    }
  }

  // PAN ↔ GST consistency (only if both readable)
  if (docPresent(docs, "pan") && docPresent(docs, "company_gst")) {
    const consistent = checkPanGstConsistency(panText, gstText);
    if (consistent === false) {
      issues.push(issue(
        "PAN_GST_MISMATCH",
        "error",
        "PAN number does not match the PAN embedded in GSTIN.",
        `PAN: ${extractPanNumber(panText)}, GSTIN: ${extractGstin(gstText)}`
      ));
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 5. MSME VALIDATION
  // ══════════════════════════════════════════════════════════════════

  const msmeText = fieldText(docs, "msme");
  if (!docUploaded(docs, "msme")) {
    issues.push(issue("MISSING_MSME", "warning", "MSME certificate not uploaded."));
  } else if (!docPresent(docs, "msme")) {
    issues.push(issue("MSME_UNREADABLE", "warning", "MSME certificate could not be read."));
  } else {
    const msmeNo = extractMsmeNumber(msmeText);
    if (!msmeNo) {
      issues.push(issue("MSME_NUMBER_NOT_FOUND", "warning", "UDYAM registration number not found in MSME certificate."));
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 6. CHEQUE / BANK VALIDATION
  // ══════════════════════════════════════════════════════════════════

  if (!docUploaded(docs, "cheque")) {
    issues.push(issue("MISSING_CHEQUE", "error", "Cancelled cheque not uploaded."));
  } else if (!docPresent(docs, "cheque")) {
    issues.push(issue("CHEQUE_UNREADABLE", "warning", "Cancelled cheque could not be read."));
  }

  // ══════════════════════════════════════════════════════════════════
  // 7. GSTR3B VALIDATION (last 3 months)
  // ══════════════════════════════════════════════════════════════════

  const gstr3bDocs = docs.filter(
    (d) => d.fieldname && d.fieldname.includes("gstr3b")
  );
  if (gstr3bDocs.length === 0) {
    issues.push(issue("MISSING_GSTR3B", "warning", "GSTR-3B filings not uploaded."));
  } else if (gstr3bDocs.length < 3) {
    issues.push(issue(
      "INSUFFICIENT_GSTR3B",
      "warning",
      `Only ${gstr3bDocs.length} of 3 required GSTR-3B filings uploaded.`
    ));
  }

  // ══════════════════════════════════════════════════════════════════
  // 8. FACE COMPARISON RESULTS
  // ══════════════════════════════════════════════════════════════════

  if (Array.isArray(faceResults) && faceResults.length > 0) {
    for (const result of faceResults) {
      if (!result) continue;

      if (result.error) {
        issues.push(issue(
          `FACE_COMPARE_ERROR_${(result.label || "UNKNOWN").toUpperCase().replace(/\s/g, "_")}`,
          "warning",
          `Face comparison with ${result.label || "document"} could not be completed.`,
          result.error
        ));
      } else if (!result.match) {
        issues.push(issue(
          `FACE_MISMATCH_${(result.label || "UNKNOWN").toUpperCase().replace(/\s/g, "_")}`,
          "error",
          `Face in authorized person photo does not match ${result.label}.`,
          `Confidence: ${result.confidence}, Distance: ${result.distance}`
        ));
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 9. PRIVATE LIMITED — ADDITIONAL VALIDATIONS
  //    ✅ NEW BLOCK — does NOT affect Proprietorship or other types
  // ══════════════════════════════════════════════════════════════════

  if (isPrivateLimited) {

    // ── 9a. Company PAN ────────────────────────────────────────────
    const companyPanText = fieldText(docs, "company_pan");
    if (!docUploaded(docs, "company_pan")) {
      issues.push(issue(
        "MISSING_COMPANY_PAN",
        "error",
        "Company PAN not uploaded (required for Private Limited)."
      ));
    } else if (!docPresent(docs, "company_pan")) {
      issues.push(issue(
        "COMPANY_PAN_UNREADABLE",
        "warning",
        "Company PAN could not be read."
      ));
    } else {
      const companyPanNo = extractPanNumber(companyPanText);
      if (!companyPanNo) {
        issues.push(issue(
          "COMPANY_PAN_NUMBER_NOT_FOUND",
          "warning",
          "PAN number not found in Company PAN document."
        ));
      }

      // Company PAN ↔ GST consistency
      if (docPresent(docs, "company_gst")) {
        const consistent = checkPanGstConsistency(companyPanText, gstText);
        if (consistent === false) {
          issues.push(issue(
            "COMPANY_PAN_GST_MISMATCH",
            "error",
            "Company PAN does not match the PAN embedded in GSTIN.",
            `Company PAN: ${extractPanNumber(companyPanText)}, GSTIN: ${extractGstin(gstText)}`
          ));
        }
      }
    }

    // ── 9b. CIN Certificate ────────────────────────────────────────
    const cinText = fieldText(docs, "cin");
    if (!docUploaded(docs, "cin")) {
      issues.push(issue(
        "MISSING_CIN",
        "error",
        "CIN certificate not uploaded (required for Private Limited)."
      ));
    } else if (!docPresent(docs, "cin")) {
      issues.push(issue(
        "CIN_UNREADABLE",
        "warning",
        "CIN certificate could not be read."
      ));
    } else {
      const cinNo = extractCinNumber(cinText);
      if (!cinNo) {
        issues.push(issue(
          "CIN_NUMBER_NOT_FOUND",
          "warning",
          "CIN number not found in CIN certificate."
        ));
      }

      // CIN company name vs GST legal name cross-check (best-effort)
      if (cinNo && docPresent(docs, "company_gst")) {
        const cinDoc = docs.find((d) => d.fieldname && d.fieldname.includes("cin"));
        const gstDoc = docs.find((d) => d.fieldname && d.fieldname.includes("company_gst"));
        if (cinDoc && gstDoc) {
          const cinNameMatch  = (cinDoc.extractedText || "").match(/company\s+name[:\s]+([A-Z][A-Z\s&().,-]{3,80})/i);
          const gstNameMatch  = (gstDoc.extractedText || "").match(/legal\s+name[:\s]+([A-Z][A-Z\s&().,-]{3,80})/i);
          if (cinNameMatch && gstNameMatch) {
            if (!namesSimilar(cinNameMatch[1], gstNameMatch[1])) {
              issues.push(issue(
                "CIN_GST_NAME_MISMATCH",
                "warning",
                "Company name on CIN certificate does not match GST legal name.",
                `CIN name: "${cinNameMatch[1].trim()}", GST name: "${gstNameMatch[1].trim()}"`
              ));
            }
          }
        }
      }
    }

    // ── 9c. CTO Certificate ────────────────────────────────────────
    const ctoText = fieldText(docs, "cto");
    if (!docUploaded(docs, "cto")) {
      issues.push(issue(
        "MISSING_CTO",
        "error",
        "CTO (Consent to Operate) certificate not uploaded (required for Private Limited)."
      ));
    } else if (!docPresent(docs, "cto")) {
      issues.push(issue(
        "CTO_UNREADABLE",
        "warning",
        "CTO certificate could not be read."
      ));
    } else {
      // Check expiry date — warn if found and appears expired
      const ctoDoc = docs.find((d) => d.fieldname && d.fieldname.includes("cto"));
      if (ctoDoc && ctoDoc.structuredData && ctoDoc.structuredData.expiryDate) {
        const expiryStr = ctoDoc.structuredData.expiryDate;
        try {
          // Parse dd/mm/yyyy or dd-mm-yyyy
          const parts = expiryStr.split(/[\/\-]/);
          let expiryDate;
          if (parts.length === 3) {
            const [d, m, y] = parts;
            const year = y.length === 2 ? `20${y}` : y;
            expiryDate = new Date(`${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
          }
          if (expiryDate && !isNaN(expiryDate.getTime()) && expiryDate < new Date()) {
            issues.push(issue(
              "CTO_EXPIRED",
              "error",
              `CTO certificate appears to be expired (valid till: ${expiryStr}).`
            ));
          }
        } catch (_) { /* ignore date parse errors */ }
      }

      if (!/pollution\s*control|consent\s*to\s*operate/i.test(ctoText)) {
        issues.push(issue(
          "CTO_CONTENT_UNCLEAR",
          "warning",
          "CTO certificate content does not clearly identify it as a Consent to Operate."
        ));
      }
    }

  } // end isPrivateLimited block

  // ══════════════════════════════════════════════════════════════════
  // 10. PROPRIETORSHIP — SPECIFIC CHECKS
  //     (existing logic kept intact)
  // ══════════════════════════════════════════════════════════════════

  // For proprietorship, company_pan is hidden in the UI (hideFor: ["Proprietorship"])
  // so we do NOT require it. No extra check needed.

  // ══════════════════════════════════════════════════════════════════
  // RESULT
  // ══════════════════════════════════════════════════════════════════

  const hasErrors   = issues.some((i) => i.severity === "error");
  const hasWarnings = issues.some((i) => i.severity === "warning");

  const status = hasErrors ? "rejected" : hasWarnings ? "review" : "approved";

  return { status, issues };
}

module.exports = { validateSubmission };
