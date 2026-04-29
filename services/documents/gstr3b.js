// ============================================================
// documents/gstr3b.js
// Extraction + per-document validation for GSTR-3B filings
// ============================================================

const { normalizeText } = require("../validation/normalizers");
const { extractGroup } = require("../validation/extractors");

// ── Data extraction ──────────────────────────────────────────

function extractGstr3bData(text) {
  const raw     = text || "";
  const cleaned = normalizeText(text);

  const year     = extractGroup(/Year\s+([0-9]{4}-[0-9]{2})/i, cleaned);
  const period   = extractGroup(/Period\s+([A-Za-z]+)/i, cleaned);
  const legalName = extractGroup(/2\(a\)\.\s*Legal name of the registered person\s+(.+?)(?=\s+2\(b\)\.)/i, cleaned);
  const tradeName = extractGroup(/2\(b\)\.\s*Trade name, if any\s+(.+?)(?=\s+2\(c\)\.)/i, cleaned);

  const lines = raw.split(/\r?\n/).map((line) => normalizeText(line));
  const rowHeaders = new Set(["Integrated", "Central", "State/UT"]);

  function mergeBrokenDecimals(tokens) {
    const merged = [];
    for (let i = 0; i < tokens.length; i++) {
      const current = tokens[i];
      const next    = tokens[i + 1];
      if (/^\d+\.\d$/.test(current) && /^\d$/.test(next || "")) {
        merged.push(`${current}${next}`);
        i++;
      } else {
        merged.push(current);
      }
    }
    return merged;
  }

  function numericOrDash(token) {
    if (token === "-") return "-";
    const value = Number(token);
    return Number.isNaN(value) ? null : value;
  }

  let taxPaidInCashSum  = 0;
  let inPaymentSection  = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("6.1 Payment of tax")) { inPaymentSection = true; continue; }
    if (!inPaymentSection) continue;
    if (line.includes("Breakup of tax liability declared")) break;

    if (rowHeaders.has(line) && lines[i + 1] === "tax") {
      const collected = [];
      let j = i + 2;
      while (j < lines.length) {
        const next = lines[j];
        if (rowHeaders.has(next) || next.startsWith("Cess") ||
            next.startsWith("(B) Reverse charge") ||
            next.includes("Breakup of tax liability declared")) break;
        collected.push(next);
        j++;
      }

      const tokens = mergeBrokenDecimals(collected.join(" ").split(/\s+/).filter(Boolean));
      const values = tokens.map(numericOrDash).filter((v) => v !== null);

      if (values.length >= 10) {
        const cashValue = values[7];
        if (typeof cashValue === "number") taxPaidInCashSum += cashValue;
      } else if (values.length >= 8) {
        const cashValue = values[values.length - 3];
        if (typeof cashValue === "number") taxPaidInCashSum += cashValue;
      }
    }

    if (line.startsWith("Cess")) {
      const tokens = mergeBrokenDecimals(line.split(/\s+/).slice(1));
      const values = tokens.map(numericOrDash).filter((v) => v !== null);
      if (values.length >= 10) {
        const cashValue = values[7];
        if (typeof cashValue === "number") taxPaidInCashSum += cashValue;
      }
    }
  }

  return {
    year,
    period,
    legalName: normalizeText(legalName),
    tradeName: normalizeText(tradeName),
    taxPaidInCashSum: taxPaidInCashSum || 0,
  };
}

// ── Per-document validation issues ──────────────────────────

function validateGstr3bDocument(document, index, issues) {
  const n = index + 1;

  if (!document.extractedData.legalName) {
    issues.push({
      severity: "medium",
      title: `Legal name not found in ${document.key}`,
      detail: `The uploaded GSTR-3B document ${document.originalname} did not contain a detectable legal name.`,
    });
  }

  if (!document.extractedData.tradeName) {
    issues.push({
      severity: "medium",
      title: `Trade name not found in ${document.key}`,
      detail: `The uploaded GSTR-3B document ${document.originalname} did not contain a detectable trade name.`,
    });
  }

  if (!document.extractedData.year || !document.extractedData.period) {
    issues.push({
      severity: "medium",
      title: `GSTR-3B ${n} period details missing`,
      detail: `The uploaded GSTR-3B document ${document.originalname} did not contain a detectable year and period.`,
    });
  }

  if (!(Number(document.extractedData.taxPaidInCashSum || 0) > 0)) {
    issues.push({
      severity: "high",
      title: `GSTR-3B ${n} tax paid in cash is not greater than 0`,
      detail: `The sum of 'Tax paid in cash' values in table 6.1 for ${document.originalname} was ${document.extractedData.taxPaidInCashSum || 0}.`,
    });
  }
}

module.exports = { extractGstr3bData, validateGstr3bDocument };
