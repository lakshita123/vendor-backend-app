const path = require("path");
const { extractPdfText } = require("./pdfReader");
const { readTextFromImage } = require("./ocrReader");
const { validateSubmission } = require("./validation");
const { downloadFolderFiles, cleanupTempDir } = require("../googleDrive");
const { prepareUploadedFiles } = require("./filePreparation");
const { updateSubmissionRecord } = require("./submissionStore");
require("events").EventEmitter.defaultMaxListeners = 20;

const PROCESSING_TIMEOUTS = {
  documentReadMs: 10000,
};

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

async function updateRecordSafely(submissionId, updater) {
  if (!submissionId) return;
  try {
    await updateSubmissionRecord(submissionId, updater);
  } catch (err) {
    console.warn("[Processing] Failed to update submission record:", err.message);
  }
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

async function readDocumentForDashboard(file) {
  const extension = path.extname(file.originalname || file.filename || "").toLowerCase();
  const isPdf = extension === ".pdf" || file.mimetype === "application/pdf";
  const imageSourcePath = file.ocrSourcePath || file.sourcePath || null;
  const canReadSourceImage = Boolean(file.convertedFromImage && imageSourcePath);

  if (!isPdf && !canReadSourceImage) {
    return {
      ...file,
      extractionStatus: "skipped",
      extractedText: "",
      rawExtractedText: "",
      totalPages: 0,
      extractionError: "No supported text extraction path found.",
    };
  }

  try {
    let pdfText = "";
    let totalPages = 0;

    if (isPdf) {
      const pdfResult = await extractPdfText(file.path);
      pdfText = String(pdfResult.text || "");
      totalPages = Number.isFinite(pdfResult.totalPages) ? pdfResult.totalPages : 0;
    }

    let imageText = "";
    if (canReadSourceImage) {
      imageText = await withTimeout(
        readTextFromImage(imageSourcePath),
        PROCESSING_TIMEOUTS.documentReadMs,
        `${file.originalname} image OCR`
      );
    }

    const normalizedPdfText = String(pdfText || "").replace(/\s+/g, " ").trim();
    const normalizedImageText = String(imageText || "").replace(/\s+/g, " ").trim();
    const normalizedText =
      normalizedImageText.length > normalizedPdfText.length ? normalizedImageText : normalizedPdfText;

    return {
      ...file,
      extractionStatus: normalizedText ? "success" : "empty",
      extractedText: normalizedText,
      rawExtractedText: normalizedText,
      totalPages: Number.isFinite(totalPages) ? totalPages : 0,
      extractionError: normalizedText ? null : "No readable text found in PDF or source image.",
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
  void driveFolderLink;
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
      review: {
        ...record.review,
        reviewStatus: record.review && record.review.reviewStatus ? record.review.reviewStatus : "Pending",
      },
    }));

    if (folderId) {
      try {
        console.log(`[Processing] Downloading files from Drive folder: ${folderId}`);
        driveFiles = await downloadFolderFiles(folderId);
        console.log(`[Processing] Downloaded ${driveFiles.length} file(s).`);
        sourceFiles = driveFiles;
        await updateRecordSafely(submissionId, (record) => ({
          ...record,
          uploadedFiles: driveFiles.length
            ? driveFiles.map((file) => ({
                fieldname: file.fieldname,
                originalname: file.originalname,
                mimetype: file.mimetype,
                size: file.size,
                driveFileId: file.driveFileId || null,
                driveWebViewLink: file.driveWebViewLink || null,
                driveDownloadLink: file.driveDownloadLink || null,
              }))
            : record.uploadedFiles,
        }));
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
        return { processed: false, reason: "Drive download failed" };
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
      return { processed: false, reason: "No files available for processing" };
    }

    let preparedFiles;
    try {
      preparedFiles = await prepareUploadedFiles(sourceFiles);
    } catch (err) {
      console.error("[Processing] filePreparation failed:", err.message);
      preparedFiles = sourceFiles;
    }

    const reviewedDocuments = [];

    for (const file of preparedFiles) {
      try {
        console.log("[Processing] Reading file for dashboard:", file.originalname);
        const result = await withTimeout(
          readDocumentForDashboard(file),
          PROCESSING_TIMEOUTS.documentReadMs,
          `${file.originalname} dashboard read`
        );
        reviewedDocuments.push(result);
      } catch (err) {
        console.error("[Processing] Read failed:", file.originalname, err.message);
        reviewedDocuments.push(buildFailedDocument(file, err.message));
      }
    }

    const faceResults = [];
    const validation = validateSubmission(submission, reviewedDocuments, faceResults);
    const processedAt = new Date().toISOString();

    await updateRecordSafely(submissionId, (record) => ({
      ...record,
      status: "completed",
      processing: {
        ...record.processing,
        completedAt: processedAt,
        reviewEmailSent: false,
        reportPath: null,
        reason: "OCR and validation saved for dashboard review",
        issuesCount: validation.issues.length,
        validationStatus: validation.status,
        error: null,
      },
      review: {
        ...record.review,
        formData: {
          ...(record.review && record.review.formData ? record.review.formData : {}),
          ...submission,
        },
        extractedDocuments: validation.extractedDocuments,
        validation,
        faceResults,
        lastProcessedAt: processedAt,
        lastValidatedAt: processedAt,
        savedAt: record.review && record.review.savedAt ? record.review.savedAt : processedAt,
      },
    }));

    return {
      processed: true,
      validation,
    };
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
    return { processed: false, reason: error.message };
  } finally {
    await cleanupTempDir(driveFiles);
  }
}

module.exports = { processSubmission };
