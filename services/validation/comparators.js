// ============================================================
// comparators.js
// Name, address, and digit comparison/matching helpers
// ============================================================

const { normalizeText, normalizeName, normalizeDigits, uniqueWords, firstMeaningfulNameTokens } = require("./normalizers");
const { extractGroup } = require("./extractors");

function compareNameField(left, right) {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return false;
  if (a === b) return true;

  const aWords = a.split(" ").filter(Boolean);
  const bWords = b.split(" ").filter(Boolean);
  const overlap = aWords.filter((w) => bWords.includes(w));
  return overlap.length >= 2;
}

function isSuspiciousName(value) {
  const n = normalizeName(value || "");
  if (!n || n.length < 3) return true;
  if (/^(GOVT|GOVERNMENT|INDIA|INCOME TAX|PERMANENT ACCOUNT|UNIQUE IDENTIFICATION)/.test(n)) return true;
  if ((n.match(/[A-Z]/g) || []).length < 3) return true;
  return false;
}

function isCloseDigitMatch(left, right, maxDifferences = 2) {
  const a = normalizeDigits(left);
  const b = normalizeDigits(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 2) return false;

  const shorter = a.length <= b.length ? a : b;
  const longer  = a.length <= b.length ? b : a;
  let diffs = 0;
  let si = 0;

  for (let li = 0; li < longer.length && si < shorter.length; li++) {
    if (longer[li] !== shorter[si]) diffs++;
    else si++;
    if (diffs > maxDifferences) return false;
  }

  return true;
}

function compareAddressField(left, right) {
  const leftText  = normalizeText(left);
  const rightText = normalizeText(right);
  if (!leftText || !rightText) return false;

  const leftPin  = extractGroup(/(\d{6})/, leftText);
  const rightPin = extractGroup(/(\d{6})/, rightText);
  if (leftPin && rightPin && leftPin === rightPin) return true;

  const leftWords  = uniqueWords(leftText);
  const rightWords = uniqueWords(rightText);
  const overlap = [...leftWords].filter((word) => rightWords.has(word));
  return overlap.length >= 2;
}

module.exports = {
  compareNameField,
  isSuspiciousName,
  isCloseDigitMatch,
  compareAddressField,
};
