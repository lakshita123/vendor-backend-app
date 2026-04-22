function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

const runtime = {
  isLocalTestMode: parseBoolean(process.env.LOCAL_TEST_MODE, false),
  enableDriveUpload: parseBoolean(process.env.ENABLE_DRIVE_UPLOAD, true),
  enableSubmissionEmail: parseBoolean(process.env.ENABLE_SUBMISSION_EMAIL, true),
  enableReviewEmail: parseBoolean(process.env.ENABLE_REVIEW_EMAIL, true),
  enableOcrFallback: parseBoolean(process.env.ENABLE_OCR_FALLBACK, true),
  enableCloudOcr: parseBoolean(process.env.ENABLE_CLOUD_OCR, true),
  cloudOcrProvider: (process.env.CLOUD_OCR_PROVIDER || "ocrspace").trim().toLowerCase(),
};

module.exports = {
  runtime,
  parseBoolean,
};
