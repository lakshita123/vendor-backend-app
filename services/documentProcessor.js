const fs = require("fs/promises");
const path = require("path");
const { readDocument } = require("./pdfReader");
const { validateSubmission } = require("./validation");
const { generateIssueReport } = require("./reportGenerator");
const { compareGeoTagToDocuments } = require("./faceComparison");
const { downloadFolderFiles, cleanupTempDir } = require("../googleDrive");
const { prepareUploadedFiles } = require("./filePreparation");
const { runtime } = require("../config/runtime");
const { updateSubmissionRecord } = require("./submissionStore");


async function runFaceComparisons(files) {
  const geoTagFile = files.find((f) => f.fieldname === "geo_tag_photo");
  if (!geoTagFile) return null;

  const identityFiles = [];

  const aadhaarFile = files.find((f) => f.fieldname && f.fieldname.includes("aadhar"));
  if (aadhaarFile) identityFiles.push({ file: aadhaarFile, label: "Aadhaar" });

  const panFile = files.find(
    (f) =>
      f.fieldname &&
      (f.fieldname === "pan" ||
        f.fieldname.startsWith("pan_") ||
        f.fieldname.endsWith("_pan") ||
        f.fieldname.includes("_pan_"))
  );
  if (panFile) identityFiles.push({ file: panFile, label: "PAN" });

  if (!identityFiles.length) return null;

  try {
    return await compareGeoTagToDocuments(geoTagFile, identityFiles);
  } catch (err) {
    console.warn("[FaceComparison] Failed:", err.message);
    return null;
  }
}

async function updateRecordSafely(submissionId, updater) {
  if (!submissionId) return;
  try {
    await updateSubmissionRecord(submissionId, updater);
  } catch (err) {
    console.warn("[Processing] Failed to update submission record:", err.message);
  }
}

async function processSubmission({
  submission,
  folderId,
  files,
  transporter,
  driveFolderLink,
  submissionId,
}) {
  let driveFiles = [];
  let sourceFiles = Array.isArray(files) ? files : [];

  await updateRecordSafely(submissionId, (record) => ({
    ...record,
    status: "processing",
    processing: {
      ...record.processing,
      startedAt: new Date().toISOString(),
      error: null,
    },
  }));

  if (folderId) {
    try {
      console.log(`[Processing] Downloading files from Drive folder: ${folderId}`);
      driveFiles = await downloadFolderFiles(folderId);
      console.log(`[Processing] Downloaded ${driveFiles.length} file(s).`);
      sourceFiles = driveFiles;
    } catch (err) {
      console.error("[Processing] Drive download failed:", err.message);
      await updateRecordSafely(submissionId, (record) => ({
        ...record,
        status: "failed",
        processing: {
          ...record.processing,
          completedAt: new Date().toISOString(),
          reason: "Drive download failed",
          error: err.message,
        },
      }));
      return { sent: false, reason: "Drive download failed" };
    }
  }

  if (!sourceFiles.length) {
    await updateRecordSafely(submissionId, (record) => ({
      ...record,
      status: "failed",
      processing: {
        ...record.processing,
        completedAt: new Date().toISOString(),
        reason: "No files available for processing",
        error: "No files available for processing",
      },
    }));
    return { sent: false, reason: "No files available for processing" };
  }

  let preparedFiles;
  try {
    preparedFiles = await prepareUploadedFiles(sourceFiles);
  } catch (err) {
    console.error("[Processing] filePreparation failed:", err.message);
    preparedFiles = sourceFiles;
  }

  const reviewedDocuments = await Promise.all(preparedFiles.map((file) => readDocument(file)));

  const faceResults = await runFaceComparisons(preparedFiles).catch((err) => {
    console.warn("[Processing] Face comparison error:", err.message);
    return null;
  });

  const validation = validateSubmission(submission, reviewedDocuments, faceResults);

  await cleanupTempDir(driveFiles);

  if (!validation.issues.length) {
    console.log("[Processing] No issues found, review email not sent.");
    await updateRecordSafely(submissionId, (record) => ({
      ...record,
      status: "completed",
      processing: {
        ...record.processing,
        completedAt: new Date().toISOString(),
        reviewEmailSent: false,
        reportPath: null,
        reason: "No issues detected",
        issuesCount: 0,
        validationStatus: validation.status,
      },
    }));
    return { sent: false, reason: "No issues detected", validation };
  }

  const reportsDir = path.join(__dirname, "..", "reports");
  await fs.mkdir(reportsDir, { recursive: true });

  const reportPath = await generateIssueReport({
    submission,
    validation,
    outputDir: reportsDir,
  });

  const reviewRecipient = process.env.REVIEW_EMAIL || process.env.EMAIL_USER;

  if (runtime.enableReviewEmail) {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: reviewRecipient,
      cc: process.env.CC_EMAILS,
      subject: `Vendor Submission Issues - ${submission.name || "Unknown Vendor"}`,
      text: [
        "The vendor submission review engine detected issues.",
        "",
        `Vendor: ${submission.name || "-"}`,
        `Email: ${submission.email || "-"}`,
        `Phone: ${submission.phone || "-"}`,
        `Constitution: ${submission.constitution || "-"}`,
        `Vendor Type: ${submission.vendorType || "-"}`,
        `Product: ${submission.product || "-"}`,
        `Geo Address: ${submission.geoAddress || "-"}`,
        `Geo Coordinates: ${submission.geoLatitude || "-"}, ${submission.geoLongitude || "-"}`,
        `Geo Captured At: ${submission.geoCapturedAt || "-"}`,
        `Google Maps Link: ${submission.geoMapsUrl || "-"}`,
        "",
        `Drive Folder: ${driveFolderLink || "Not available"}`,
        `Detected Issues: ${validation.issues.length}`,
        "",
        "See the attached PDF report for details.",
      ].join("\n"),
      attachments: [{ filename: path.basename(reportPath), path: reportPath }],
    });
    console.log(`[Processing] Review email sent. Report: ${reportPath}`);
  } else {
    console.log(`[LOCAL TEST] Review email skipped. Report: ${reportPath}`);
  }

  await updateRecordSafely(submissionId, (record) => ({
    ...record,
    status: "completed",
    processing: {
      ...record.processing,
      completedAt: new Date().toISOString(),
      reviewEmailSent: Boolean(runtime.enableReviewEmail),
      reportPath,
      reason: runtime.enableReviewEmail ? "Review email sent" : "Review email skipped",
      issuesCount: validation.issues.length,
      validationStatus: validation.status,
    },
  }));

  return { sent: runtime.enableReviewEmail, reportPath, validation };
}

module.exports = { processSubmission };
