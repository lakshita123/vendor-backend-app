const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const submissionsDir = path.join(__dirname, "..", "data", "submissions");
const phoneIndexPath = path.join(__dirname, "..", "data", "phone-index.json");
const REVIEW_STATUSES = ["Pending", "In Review", "Approved", "Rejected", "Needs Clarification"];

async function ensureStore() {
  await fs.mkdir(submissionsDir, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function buildSubmissionId() {
  const random = crypto.randomBytes(3).toString("hex");
  return `sub_${Date.now()}_${random}`;
}

function getSubmissionPath(submissionId) {
  return path.join(submissionsDir, `${submissionId}.json`);
}

function buildDefaultReview(submission = {}) {
  return {
    reviewStatus: "Pending",
    reviewerNotes: "",
    formData: { ...submission },
    extractedDocuments: [],
    validation: null,
    faceResults: [],
    lastProcessedAt: null,
    lastValidatedAt: null,
    savedAt: null,
  };
}

function sanitizeReviewStatus(status) {
  return REVIEW_STATUSES.includes(status) ? status : "Pending";
}

function normalizeRecord(record) {
  const submission = record && record.submission ? record.submission : {};
  return {
    ...record,
    submission,
    uploadedFiles: Array.isArray(record.uploadedFiles) ? record.uploadedFiles : [],
    processing: {
      startedAt: null,
      completedAt: null,
      reviewEmailSent: false,
      reportPath: null,
      reason: null,
      issuesCount: null,
      validationStatus: null,
      error: null,
      ...(record.processing || {}),
    },
    review: {
      ...buildDefaultReview(submission),
      ...(record.review || {}),
      formData: {
        ...submission,
        ...((record.review && record.review.formData) || {}),
      },
      extractedDocuments: Array.isArray(record.review && record.review.extractedDocuments)
        ? record.review.extractedDocuments
        : [],
      faceResults: Array.isArray(record.review && record.review.faceResults)
        ? record.review.faceResults
        : [],
      reviewStatus: sanitizeReviewStatus(record.review && record.review.reviewStatus),
    },
  };
}

async function writeSubmission(submissionId, payload) {
  await ensureStore();
  await fs.writeFile(
    getSubmissionPath(submissionId),
    JSON.stringify(normalizeRecord(payload), null, 2),
    "utf8"
  );
}

// ── Phone Index Helpers ──────────────────────────────────────────

async function readPhoneIndex() {
  try {
    const raw = await fs.readFile(phoneIndexPath, "utf8");
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

async function writePhoneIndex(index) {
  await ensureStore();
  await fs.writeFile(phoneIndexPath, JSON.stringify(index, null, 2), "utf8");
}

async function indexPhoneEntry(phone, entry) {
  if (!phone) return;
  const index = await readPhoneIndex();
  const normalised = String(phone).trim();
  if (!index[normalised]) index[normalised] = [];
  index[normalised] = index[normalised].filter(
    (e) => e.submissionId !== entry.submissionId
  );
  index[normalised].unshift(entry);
  await writePhoneIndex(index);
}

async function lookupByPhone(phone) {
  if (!phone) return [];
  const index = await readPhoneIndex();
  return index[String(phone).trim()] || [];
}

// ── Submission CRUD ──────────────────────────────────────────────

async function createSubmissionRecord({
  submission,
  source,
  driveFolderId = null,
  driveFolderLink = null,
  uploadedFiles = [],
}) {
  const submissionId = buildSubmissionId();
  const createdAt = nowIso();
  const record = {
    submissionId,
    createdAt,
    updatedAt: createdAt,
    status: "received",
    source,
    driveFolderId,
    driveFolderLink,
    uploadedFiles,
    submission,
    processing: {
      startedAt: null,
      completedAt: null,
      reviewEmailSent: false,
      reportPath: null,
      reason: null,
      issuesCount: null,
      validationStatus: null,
      error: null,
    },
    review: buildDefaultReview(submission),
  };

  await writeSubmission(submissionId, record);

  if (submission && submission.phone) {
    await indexPhoneEntry(submission.phone, {
      submissionId,
      createdAt,
      driveFolderId,
      driveFolderLink,
      name:         submission.name         || "",
      email:        submission.email        || "",
      constitution: submission.constitution || "",
      vendorType:   submission.vendorType   || "",
      product:      submission.product      || "",
      hsn:          submission.hsn          || "",
    });
  }

  return record;
}

async function readSubmissionRecord(submissionId) {
  const raw = await fs.readFile(getSubmissionPath(submissionId), "utf8");
  return normalizeRecord(JSON.parse(raw));
}

async function updateSubmissionRecord(submissionId, updater) {
  const current = await readSubmissionRecord(submissionId);
  const next = normalizeRecord(
    typeof updater === "function" ? await updater(current) : { ...current, ...updater }
  );
  next.updatedAt = nowIso();
  await writeSubmission(submissionId, next);

  if (next.submission && next.submission.phone) {
    await indexPhoneEntry(next.submission.phone, {
      submissionId:    next.submissionId,
      createdAt:       next.createdAt,
      driveFolderId:   next.driveFolderId   || null,
      driveFolderLink: next.driveFolderLink || null,
      name:            next.submission.name         || "",
      email:           next.submission.email        || "",
      constitution:    next.submission.constitution || "",
      vendorType:      next.submission.vendorType   || "",
      product:         next.submission.product      || "",
      hsn:             next.submission.hsn          || "",
    });
  }

  return next;
}

async function listSubmissionIds() {
  await ensureStore();
  const names = await fs.readdir(submissionsDir);
  return names
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/i, ""));
}

async function listSubmissionRecords() {
  const ids = await listSubmissionIds();
  const records = await Promise.all(
    ids.map(async (submissionId) => {
      try {
        return await readSubmissionRecord(submissionId);
      } catch (_) {
        return null;
      }
    })
  );

  return records
    .filter(Boolean)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

module.exports = {
  REVIEW_STATUSES,
  createSubmissionRecord,
  listSubmissionRecords,
  readSubmissionRecord,
  sanitizeReviewStatus,
  updateSubmissionRecord,
  lookupByPhone,
};
