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
require("events").EventEmitter.defaultMaxListeners = 20;

const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

// 🔥 ADD THIS (around line after resend init)
function withTimeout(promise, ms = 20000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), ms)
    ),
  ]);
}

async function runFaceComparisons(files) {
  // Support both old fieldname and new split fieldnames
  const authorizedPersonFile = files.find(
    (f) => f.fieldname === "authorized_person_with_warehouse_photo" ||
           f.fieldname === "authorized_person_photo"
  );

  const warehouseFile = files.find(
    (f) => f.fieldname === "warehouse_photo"
  );

  // Use authorized person photo for face ID, fallback to warehouse photo
  const geoTagFile = authorizedPersonFile || warehouseFile;
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
	console.log("🚀 processSubmission started");
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


const limitedFiles = preparedFiles.slice(0, 6);
const reviewedDocuments = [];

for (const file of limitedFiles) {
  try {
    console.log("📄 Processing file:", file.originalname);

    const result = await withTimeout(readDocument(file),20000);

    console.log("✅ Done:", file.originalname);

    reviewedDocuments.push(result);

  } catch (err) {
    console.error("❌ Failed:", file.originalname, err.message);

    // still push empty so flow continues
    reviewedDocuments.push({
	  file: file.originalname,
	  text: "",
	  error: err.message,
	});
  }
}
console.log("📊 All files processed. Running validation...");

  const faceResults = await runFaceComparisons(preparedFiles).catch((err) => {
    console.warn("[Processing] Face comparison error:", err.message);
    return null;
  });

  const validation = validateSubmission(submission, reviewedDocuments, faceResults);

  /*console.log("📧 Preparing Email 2 early...");

await resend.emails.send({
  from: "onboarding@resend.dev",
  to: process.env.REVIEW_EMAIL || process.env.EMAIL_USER,
  subject: "📊 Vendor Processing Started",

  html: `
    <h2>📊 Processing Started</h2>
    <p>Submission ID: ${submissionId}</p>
    <p>Your documents are being processed.</p>

    <p><b>Drive Folder:</b></p>
    <a href="${driveFolderLink}">${driveFolderLink}</a>
  `,
});

console.log("✅ Email 2 (early) sent");
*/

  await cleanupTempDir(driveFiles);

 if (!validation.issues.length) {
  console.log("[Processing] No issues found — sending clean report.");

  const reportsDir = path.join(__dirname, "..", "reports");
  await fs.mkdir(reportsDir, { recursive: true });

  const reportPath = await generateIssueReport({
    submission,
    validation,
    outputDir: reportsDir,
  });

  const reviewRecipient = process.env.REVIEW_EMAIL || process.env.EMAIL_USER;

  try {
    await resend.emails.send({
      from: "onboarding@resend.dev",
      to: reviewRecipient,
      cc: process.env.CC_EMAILS,

      subject: `✅ Vendor Approved - ${submission.name || "Unknown Vendor"}`,

      html: `
        <h2>✅ Vendor Submission Approved</h2>

        <p><b>Submission ID:</b> ${submissionId}</p>

        <p>No issues were found in the submitted documents.</p>

        <p><b>Drive Folder:</b></p>
        <a href="${driveFolderLink}" target="_blank">${driveFolderLink}</a>

        <br/><br/>
        <p>Attached is the verification report.</p>
      `,

      attachments: [
        {
          filename: path.basename(reportPath),
          path: reportPath,
        },
      ],
    });

    console.log("✅ Clean report email sent");

    await updateRecordSafely(submissionId, (record) => ({
      ...record,
      status: "completed",
      processing: {
        ...record.processing,
        completedAt: new Date().toISOString(),
        reviewEmailSent: true,
        reportPath,
        reason: "No issues detected (report sent)",
        issuesCount: 0,
        validationStatus: validation.status,
      },
    }));

    return { sent: true, reportPath, validation };

  } catch (error) {
    console.error("[Processing] Clean report email failed:", error);

    return { sent: false, reason: error.message };
  }
}

  const reportsDir = path.join(__dirname, "..", "reports");
  await fs.mkdir(reportsDir, { recursive: true });

  const reportPath = await generateIssueReport({
    submission,
    validation,
    outputDir: reportsDir,
  });

  const reviewRecipient = process.env.REVIEW_EMAIL || process.env.EMAIL_USER;
  let reviewEmailSent = false;
  let completionReason = runtime.enableReviewEmail ? "Review email sent" : "Review email skipped";
console.log("📧 Preparing Email 2...");
  if (runtime.enableReviewEmail) {
    try {
      await resend.emails.send({
        from: "onboarding@resend.dev",
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
      reviewEmailSent = true;
	  console.log("✅ Email 2 sent");
      console.log(`[Processing] Review email sent. Report: ${reportPath}`);
    } catch (error) {
      completionReason = `Review email failed: ${error.message}`;
      console.error("[Processing] Review email failed:", error);
    }
  } else {
    console.log(`[LOCAL TEST] Review email skipped. Report: ${reportPath}`);
  }

  await updateRecordSafely(submissionId, (record) => ({
    ...record,
    status: "completed",
    processing: {
      ...record.processing,
      completedAt: new Date().toISOString(),
      reviewEmailSent,
      reportPath,
      reason: completionReason,
      issuesCount: validation.issues.length,
      validationStatus: validation.status,
    },
  }));

  return { sent: reviewEmailSent, reportPath, validation };
}

module.exports = { processSubmission };
