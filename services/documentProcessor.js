const fs = require("fs/promises");
const path = require("path");
const { extractPdfText } = require("./pdfReader");
const { validateSubmission } = require("./validation");
const { generateIssueReport } = require("./reportGenerator");
const { downloadFolderFiles, cleanupTempDir } = require("../googleDrive");
const { prepareUploadedFiles } = require("./filePreparation");
const { runtime } = require("../config/runtime");
const { updateSubmissionRecord } = require("./submissionStore");
require("events").EventEmitter.defaultMaxListeners = 20;

const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

const PROCESSING_TIMEOUTS = {
  documentReadMs: 10000,
  reportGenerationMs: 30000,
  emailSendMs: 20000,
};

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

async function buildAttachment(reportPath) {
  const content = await fs.readFile(reportPath, { encoding: "base64" });
  return {
    filename: path.basename(reportPath),
    content,
  };
}

async function sendReviewEmail({ to, cc, subject, text, html, reportPath }) {
  const attachments = reportPath ? [await buildAttachment(reportPath)] : undefined;

  return withTimeout(
    resend.emails.send({
      from: "onboarding@resend.dev",
      to,
      cc,
      subject,
      text,
      html,
      attachments,
    }),
    PROCESSING_TIMEOUTS.emailSendMs,
    "Review email send"
  );
}

async function updateRecordSafely(submissionId, updater) {
  if (!submissionId) return;
  try {
    await updateSubmissionRecord(submissionId, updater);
  } catch (err) {
    console.warn("[Processing] Failed to update submission record:", err.message);
  }
}

function buildReviewText(submission, validation, driveFolderLink) {
  return [
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
  ].join("\n");
}

function buildReviewHtml(submission, validation, driveFolderLink, submissionId) {
  return `
    <h2>Vendor Submission Needs Review</h2>
    <p><b>Submission ID:</b> ${submissionId || "-"}</p>
    <p><b>Vendor:</b> ${submission.name || "-"}</p>
    <p><b>Email:</b> ${submission.email || "-"}</p>
    <p><b>Phone:</b> ${submission.phone || "-"}</p>
    <p><b>Detected Issues:</b> ${validation.issues.length}</p>
    <p><b>Drive Folder:</b> <a href="${driveFolderLink || "#"}">${driveFolderLink || "Not available"}</a></p>
    <p>The PDF report is attached.</p>
  `;
}

function buildApprovalText(submission, driveFolderLink, submissionId) {
  return [
    "Vendor submission approved.",
    "",
    `Submission ID: ${submissionId || "-"}`,
    `Vendor: ${submission.name || "-"}`,
    `Drive Folder: ${driveFolderLink || "Not available"}`,
    "",
    "The verification report is attached.",
  ].join("\n");
}

function buildApprovalHtml(driveFolderLink, submissionId) {
  return `
    <h2>Vendor Submission Approved</h2>
    <p><b>Submission ID:</b> ${submissionId || "-"}</p>
    <p>No issues were found in the submitted documents.</p>
    <p><b>Drive Folder:</b></p>
    <a href="${driveFolderLink}" target="_blank">${driveFolderLink}</a>
    <br/><br/>
    <p>Attached is the verification report.</p>
  `;
}

function buildFailedDocument(file, reason) {
  return {
    ...file,
    extractionStatus: "failed",
    extractedText: "",
    rawExtractedText: "",
    totalPages: 0,
    extractionError: reason,
  };
}

async function readDocumentLight(file) {
  const extension = path.extname(file.originalname || file.filename || "").toLowerCase();
  const isPdf = extension === ".pdf" || file.mimetype === "application/pdf";

  if (!isPdf) {
    return {
      ...file,
      extractionStatus: "skipped",
      extractedText: "",
      rawExtractedText: "",
      totalPages: 0,
      extractionError: "Light review mode skips non-PDF OCR.",
    };
  }

  try {
    const { text, totalPages } = await extractPdfText(file.path);
    const normalizedText = String(text || "").replace(/\s+/g, " ").trim();

    return {
      ...file,
      extractionStatus: normalizedText ? "success" : "empty",
      extractedText: normalizedText,
      rawExtractedText: text || normalizedText,
      totalPages: Number.isFinite(totalPages) ? totalPages : 0,
      extractionError: normalizedText ? null : "No readable embedded PDF text found.",
    };
  } catch (error) {
    return buildFailedDocument(file, error.message);
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
  void transporter;
  console.log("processSubmission started");

  let driveFiles = [];

  try {
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

    const limitedFiles = preparedFiles.slice(0, 6);
    const reviewedDocuments = [];

    for (const file of limitedFiles) {
      try {
        console.log("[Processing] Light-reading file:", file.originalname);
        const result = await withTimeout(
          readDocumentLight(file),
          PROCESSING_TIMEOUTS.documentReadMs,
          `${file.originalname} light read`
        );
        console.log("[Processing] Light-read complete:", file.originalname);
        reviewedDocuments.push(result);
      } catch (err) {
        console.error("[Processing] Light-read failed:", file.originalname, err.message);
        reviewedDocuments.push(buildFailedDocument(file, err.message));
      }
    }

    console.log("[Processing] All files processed. Running validation...");
    console.warn("[Processing] Face comparison disabled in light review mode.");
    const faceResults = null;

    const validation = validateSubmission(submission, reviewedDocuments, faceResults);

    const reportsDir = path.join(__dirname, "..", "reports");
    await fs.mkdir(reportsDir, { recursive: true });

    const reportPath = await withTimeout(
      generateIssueReport({
        submission,
        validation,
        outputDir: reportsDir,
      }),
      PROCESSING_TIMEOUTS.reportGenerationMs,
      "Report generation"
    );

    if (!runtime.enableReviewEmail) {
      console.log(`[LOCAL TEST] Review email skipped. Report: ${reportPath}`);
      await updateRecordSafely(submissionId, (record) => ({
        ...record,
        status: "completed",
        processing: {
          ...record.processing,
          completedAt: new Date().toISOString(),
          reviewEmailSent: false,
          reportPath,
          reason: "Review email skipped",
          issuesCount: validation.issues.length,
          validationStatus: validation.status,
        },
      }));
      return { sent: false, reportPath, validation };
    }

    const reviewRecipient = process.env.REVIEW_EMAIL || process.env.EMAIL_USER;
    console.log("[Processing] Preparing review email...");

    if (!validation.issues.length) {
      await sendReviewEmail({
        to: reviewRecipient,
        cc: process.env.CC_EMAILS,
        subject: `Vendor Approved - ${submission.name || "Unknown Vendor"}`,
        text: buildApprovalText(submission, driveFolderLink, submissionId),
        html: buildApprovalHtml(driveFolderLink, submissionId),
        reportPath,
      });
    } else {
      await sendReviewEmail({
        to: reviewRecipient,
        cc: process.env.CC_EMAILS,
        subject: `Vendor Submission Issues - ${submission.name || "Unknown Vendor"}`,
        text: buildReviewText(submission, validation, driveFolderLink),
        html: buildReviewHtml(submission, validation, driveFolderLink, submissionId),
        reportPath,
      });
    }

    console.log("[Processing] Review email sent. Report:", reportPath);

    await updateRecordSafely(submissionId, (record) => ({
      ...record,
      status: "completed",
      processing: {
        ...record.processing,
        completedAt: new Date().toISOString(),
        reviewEmailSent: true,
        reportPath,
        reason: validation.issues.length ? "Review email sent" : "No issues detected (report sent)",
        issuesCount: validation.issues.length,
        validationStatus: validation.status,
        error: null,
      },
    }));

    return { sent: true, reportPath, validation };
  } catch (error) {
    console.error("[Processing] Fatal processing error:", error);
    await updateRecordSafely(submissionId, (record) => ({
      ...record,
      status: "failed",
      processing: {
        ...record.processing,
        completedAt: new Date().toISOString(),
        reviewEmailSent: false,
        reason: "Processing pipeline failed",
        error: error.message,
      },
    }));
    return { sent: false, reason: error.message };
  } finally {
    await cleanupTempDir(driveFiles);
  }
}

module.exports = { processSubmission };
