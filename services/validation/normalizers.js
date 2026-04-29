// ============================================================
// normalizers.js
// Pure text/string normalization helpers used across all docs
// ============================================================

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function normalizeAlphaNumeric(value) {
  return normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeName(value) {
  return normalizeText(value).toUpperCase().replace(/[^A-Z\s]/g, " ").replace(/\s+/g, " ").trim();
}

function isValidName(name) {
  return name && name.length > 4 && /[A-Z]{3,}/.test(name);
}

function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function uniqueWords(value) {
  return new Set(
    normalizeText(value)
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token && token.length > 2)
  );
}

function firstMeaningfulNameTokens(value, preferredLength = 2) {
  const stopWords = new Set([
    "GOVT", "GOVERNMENT", "INDIA", "FATHER", "FATHERS", "NAME", "DOB",
    "MALE", "FEMALE", "CARD", "ACCOUNT", "NUMBER", "PERMANENT", "TAX",
    "DEPARTMENT", "YOUR", "AADHAAR", "OF", "INCOME", "CGSVEMMENTOMMDETTTTT", "FOR",
  ]);

  const tokens = normalizeName(value)
    .split(" ")
    .filter((token) => token && !stopWords.has(token) && token.length > 1);

  if (!tokens.length) return null;

  const slice = tokens.slice(0, preferredLength);
  return slice.join(" ");
}

function bestTrailingName(value, maxWords = 3) {
  const tokens = normalizeName(value).split(" ").filter(Boolean);
  if (!tokens.length) return null;

  for (let size = Math.min(maxWords, tokens.length); size >= 2; size -= 1) {
    const candidate = tokens.slice(-size).join(" ");
    if (candidate) return candidate;
  }

  return tokens.join(" ");
}

module.exports = {
  normalizeText,
  normalizeAlphaNumeric,
  normalizeName,
  isValidName,
  normalizeDigits,
  normalizeEmail,
  uniqueWords,
  firstMeaningfulNameTokens,
  bestTrailingName,
};
