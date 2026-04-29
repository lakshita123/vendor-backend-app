// ============================================================
// documents/geoTag.js
// Metadata extraction for geo-tag / warehouse photo / person photo
// No OCR — just maps submission geo fields onto the document record
// ============================================================

const { normalizeText } = require("../validation/normalizers");

function extractGeoTagData(submission) {
  return {
    geoAddress:    normalizeText(submission.geoAddress),
    geoLatitude:   normalizeText(submission.geoLatitude),
    geoLongitude:  normalizeText(submission.geoLongitude),
    geoCapturedAt: normalizeText(submission.geoCapturedAt),
    geoMapsUrl:    normalizeText(submission.geoMapsUrl),
  };
}

module.exports = { extractGeoTagData };
