const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const submissionsDir = path.join(__dirname, "..", "data", "submissions");

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

async function writeSubmission(submissionId, payload) {
  await ensureStore();
  await fs.writeFile(
    getSubmissionPath(submissionId),
    JSON.stringify(payload, null, 2),
    "utf8"
  );
}

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
  };

  await writeSubmission(submissionId, record);
  return record;
}

async function readSubmissionRecord(submissionId) {
  const raw = await fs.readFile(getSubmissionPath(submissionId), "utf8");
  return JSON.parse(raw);
}

async function updateSubmissionRecord(submissionId, updater) {
  const current = await readSubmissionRecord(submissionId);
  const next = typeof updater === "function" ? await updater(current) : { ...current, ...updater };
  next.updatedAt = nowIso();
  await writeSubmission(submissionId, next);
  return next;
}

module.exports = {
  createSubmissionRecord,
  readSubmissionRecord,
  updateSubmissionRecord,
};
