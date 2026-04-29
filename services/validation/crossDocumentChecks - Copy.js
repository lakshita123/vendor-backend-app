// ============================================================
// validation/crossDocumentChecks.js
// Checks that compare data ACROSS multiple documents
// (GST vs Aadhaar, GST vs PAN, Cheque vs MSME, etc.)
// ============================================================

const { normalizeText, normalizeDigits, isValidName } = require("./normalizers");
const { extractGroup } = require("./extractors");
const { compareNameField, compareAddressField, isCloseDigitMatch } = require("./comparators");

function pushIssue(issues, severity, title, detail) {
  issues.push({ severity, title, detail });
}

function getDocumentByKey(documents, key) {
  return documents.find((doc) => doc.key === key) || null;
}

function hasDocumentToken(key, token) {
  return (
    key === token ||
    key.startsWith(`${token}_`) ||
    key.endsWith(`_${token}`) ||
    key.includes(`_${token}_`)
  );
}

function buildValidationChecks(extractedDocuments, issues, submission) {
  const checks = [];

  const gst    = getDocumentByKey(extractedDocuments, "company_gst");
  const aadhaar = extractedDocuments.find((doc) => doc.key.includes("aadhar")) || null;
  const pan    = extractedDocuments.find((doc) => hasDocumentToken(doc.key, "pan")) || null;
  const msme   = extractedDocuments.find((doc) => doc.key === "msme" || doc.key.endsWith("_msme")) || null;
  const cheque  = extractedDocuments.find((doc) => doc.key.includes("cheque")) || null;
  const gstBank = extractedDocuments.find((doc) => doc.key.includes("gst_bank")) || null;

  // ── GST legal name vs Aadhaar name ──────────────────────────
  if (gst && aadhaar && gst.extractedData.legalName && aadhaar.extractedData.name) {
    const passed = compareNameField(gst.extractedData.legalName, aadhaar.extractedData.name);
    checks.push({ title: "GST legal name vs Aadhaar name", passed, expected: gst.extractedData.legalName, actual: aadhaar.extractedData.name });
    if (!passed) pushIssue(issues, "high", "GST legal name does not match Aadhaar name", `GST legal name "${gst.extractedData.legalName}" did not match Aadhaar name "${aadhaar.extractedData.name}".`);
  }

  // ── GST legal name vs PAN name ──────────────────────────────
  if (gst && pan) {
    let panName  = pan.extractedData.name;
    const gstName = gst.extractedData.legalName;
    if (!isValidName(panName)) panName = gstName;

    if (gstName && panName) {
      const passed = compareNameField(gstName, panName);
      checks.push({ title: "GST legal name vs PAN name", passed, expected: gstName, actual: panName });
      if (!passed) pushIssue(issues, "high", "GST legal name does not match PAN name", `GST legal name "${gstName}" did not match PAN name "${panName}".`);
    }
  }

  // ── Cheque account vs GST bank account ──────────────────────
  if (cheque && gstBank) {
    const chequeAccount  = normalizeDigits(cheque.extractedData.accountNumber);
    const gstBankAccount = normalizeDigits(gstBank.extractedData.accountNumber);
    if (chequeAccount && gstBankAccount) {
      const passed = chequeAccount === gstBankAccount;
      checks.push({ title: "Cancelled cheque account number vs GST bank account number", passed, expected: chequeAccount, actual: gstBankAccount });
      if (!passed) pushIssue(issues, "high", "Cheque account number does not match GST bank account number", `Cancelled cheque account number "${chequeAccount}" did not match GST bank account number "${gstBankAccount}".`);
    }
  }

  // ── Cheque account vs MSME bank account ─────────────────────
  if (cheque && msme) {
    const chequeAccount   = normalizeDigits(cheque.extractedData.accountNumber);
    const msmeBankAccount = normalizeDigits(msme.extractedData.bankAccountNumber);
    if (chequeAccount && msmeBankAccount) {
      const passed = chequeAccount === msmeBankAccount || isCloseDigitMatch(chequeAccount, msmeBankAccount);
      checks.push({ title: "Cancelled cheque account number vs MSME bank account number", passed, expected: chequeAccount, actual: msmeBankAccount });
      if (!passed) pushIssue(issues, "high", "Cheque account number does not match MSME bank account number", `Cancelled cheque account number "${chequeAccount}" did not match MSME bank account number "${msmeBankAccount}".`);
    }
  }

  // ── MSME address vs GST address ──────────────────────────────
  if (gst && msme && gst.extractedData.address && msme.extractedData.officialAddress) {
    const passed = compareAddressField(gst.extractedData.address, msme.extractedData.officialAddress);
    checks.push({ title: "MSME official address vs GST address", passed, expected: gst.extractedData.address, actual: msme.extractedData.officialAddress });
    if (!passed) pushIssue(issues, "medium", "MSME official address does not match GST address", `MSME official address "${msme.extractedData.officialAddress}" did not match GST address "${gst.extractedData.address}".`);
  }

  // ── Geo address vs GST address ───────────────────────────────
  const geoAddress = normalizeText(submission && submission.geoAddress);
  if (gst && gst.extractedData.address && geoAddress) {
    const passed = compareAddressField(gst.extractedData.address, geoAddress);
    checks.push({ title: "Geo location address vs GST address", passed, expected: gst.extractedData.address, actual: geoAddress });
    if (!passed) pushIssue(issues, "high", "Geo location address does not match GST address", `Geo location address "${geoAddress}" did not match GST address "${gst.extractedData.address}".`);
  }

  // ── GSTR-3B name vs GST name ─────────────────────────────────
  extractedDocuments.filter((doc) => doc.key.startsWith("gstr3b_")).forEach((doc, index) => {
    const n = index + 1;

    if (gst && doc.extractedData.legalName) {
      const passed = compareNameField(gst.extractedData.legalName, doc.extractedData.legalName);
      checks.push({ title: `GSTR-3B ${n} legal name vs GST legal name`, passed, expected: gst.extractedData.legalName || "-", actual: doc.extractedData.legalName || "-" });
      if (!passed) pushIssue(issues, "high", `GSTR-3B ${n} legal name mismatch`, `GSTR-3B legal name "${doc.extractedData.legalName || "-"}" did not match GST legal name "${gst.extractedData.legalName || "-"}".`);
    }

    if (gst && doc.extractedData.tradeName) {
      const passed = compareNameField(gst.extractedData.tradeName, doc.extractedData.tradeName);
      checks.push({ title: `GSTR-3B ${n} trade name vs GST trade name`, passed, expected: gst.extractedData.tradeName || "-", actual: doc.extractedData.tradeName || "-" });
      if (!passed) pushIssue(issues, "high", `GSTR-3B ${n} trade name mismatch`, `GSTR-3B trade name "${doc.extractedData.tradeName || "-"}" did not match GST trade name "${gst.extractedData.tradeName || "-"}".`);
    }
  });

  // ── GSTR-3B periods unique ────────────────────────────────────
  const gstr3bPeriods = extractedDocuments
    .filter((doc) => doc.key.startsWith("gstr3b_"))
    .map((doc) => normalizeText(`${doc.extractedData.period || ""} ${doc.extractedData.year || ""}`))
    .filter(Boolean);

  if (gstr3bPeriods.length) {
    const uniquePeriods = new Set(gstr3bPeriods);
    const passed = uniquePeriods.size === gstr3bPeriods.length;
    checks.push({ title: "GSTR-3B uploaded periods are unique", passed, expected: String(gstr3bPeriods.length), actual: String(uniquePeriods.size) });
    if (!passed) pushIssue(issues, "high", "Duplicate GSTR-3B periods detected", `Expected different GSTR-3B months, but found duplicates: ${gstr3bPeriods.join(", ")}.`);
  }

  return checks;
}

module.exports = { buildValidationChecks, getDocumentByKey, hasDocumentToken, pushIssue };
