//require('@tensorflow/tfjs-node');
require("dotenv").config();

const express = require("express");
const multer = require("multer");
const nodemailer = require("nodemailer");
const cors = require("cors");
const path = require("path");
const fs = require("fs/promises");

const {
  createFolder,
  uploadFile,
  makePublic,
  extractFolderId,
} = require("./googleDrive");
const { runtime } = require("./config/runtime");
const { processSubmission } = require("./services/documentProcessor");
const { prepareUploadedFiles } = require("./services/filePreparation");
const {
  createSubmissionRecord,
  readSubmissionRecord,
} = require("./services/submissionStore");

const app = express();

const allowedOrigins = process.env.FRONTEND_ORIGIN
  ? process.env.FRONTEND_ORIGIN.split(",").map((o) => o.trim())
  : ["*"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (allowedOrigins.includes("*") || !origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const frontendDir = path.join(__dirname, "..", "frontend");
const uploadsDir = path.join(__dirname, "uploads");

fs.mkdir(uploadsDir, { recursive: true }).catch((err) => {
  console.error("Failed to ensure uploads directory exists:", err);
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const upload = multer({ storage });
const uploadFields = upload.any();

function hasValue(value) {
  return Boolean(String(value || "").trim());
}

function getServiceHealth() {
  const driveConfigured =
    hasValue(process.env.GOOGLE_CLIENT_ID) &&
    hasValue(process.env.GOOGLE_CLIENT_SECRET) &&
    hasValue(process.env.GOOGLE_REDIRECT_URI) &&
    hasValue(process.env.GOOGLE_REFRESH_TOKEN);

  const emailConfigured = hasValue(process.env.EMAIL_USER) && hasValue(process.env.EMAIL_PASS);

  const reviewConfigured =
    emailConfigured && hasValue(process.env.REVIEW_EMAIL || process.env.EMAIL_USER);

  const cloudOcrConfigured =
    !runtime.enableCloudOcr ||
    (runtime.cloudOcrProvider === "google" && hasValue(process.env.GOOGLE_CLOUD_VISION_KEYFILE)) ||
    (runtime.cloudOcrProvider === "ocrspace" && hasValue(process.env.OCR_SPACE_API_KEY));

  return {
    mode: runtime.isLocalTestMode ? "LOCAL_TEST" : "LIVE",
    features: {
      driveUpload: {
        enabled: runtime.enableDriveUpload,
        configured: driveConfigured,
        ready: !runtime.enableDriveUpload || driveConfigured,
      },
      submissionEmail: {
        enabled: runtime.enableSubmissionEmail,
        configured: emailConfigured,
        ready: !runtime.enableSubmissionEmail || emailConfigured,
      },
      reviewEmail: {
        enabled: runtime.enableReviewEmail,
        configured: reviewConfigured,
        ready: !runtime.enableReviewEmail || reviewConfigured,
      },
      ocrFallback: { enabled: runtime.enableOcrFallback, configured: true, ready: true },
      cloudOcr: {
        enabled: runtime.enableCloudOcr,
        configured: cloudOcrConfigured,
        provider: runtime.cloudOcrProvider,
        ready: !runtime.enableCloudOcr || cloudOcrConfigured,
      },
    },
  };
}

function logStartupWarnings() {
  const health = getServiceHealth();
  Object.entries(health.features).forEach(([name, details]) => {
    if (details.enabled && !details.ready) {
      console.warn(`[WARN] ${name} is enabled but not fully configured.`);
    }
  });
}

app.use(express.static(frontendDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

const transporter = runtime.isLocalTestMode
  ? {
      async sendMail(payload) {
        console.log(`[LOCAL TEST] Email skipped: ${payload.subject}`);
        return { accepted: [payload.to] };
      },
    }
  : nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

app.post("/submit", uploadFields, async (req, res) => {
  try {
    const body = req.body || {};
    const {
      name,
      phone,
      email,
      constitution,
      vendorType,
      product,
      hsn,
      geoAddress,
      geoLatitude,
      geoLongitude,
      geoMapsUrl,
      geoCapturedAt,
      driveFolderLink: inputDriveFolderLink,
      driveFolderId: inputDriveFolderId,
    } = body;

    const submission = {
      name,
      phone,
      email,
      constitution,
      vendorType,
      product,
      hsn,
      geoAddress,
      geoLatitude,
      geoLongitude,
      geoMapsUrl,
      geoCapturedAt,
    };

    const existingFolderId = extractFolderId(inputDriveFolderId) || extractFolderId(inputDriveFolderLink);
    const hasUploadedFiles = Array.isArray(req.files) && req.files.length > 0;

    let folderId = existingFolderId || null;
    let folderLink = existingFolderId
      ? String(inputDriveFolderLink || `https://drive.google.com/drive/folders/${existingFolderId}`)
      : "Not uploaded to Google Drive";

    if (!folderId && runtime.enableDriveUpload && hasUploadedFiles) {
      try {
        const preparedFiles = await prepareUploadedFiles(req.files || []);
        folderId = await createFolder(`${name}_${constitution}_${vendorType}_${Date.now()}`);

        for (const file of preparedFiles) {
          const ext = path.extname(file.originalname || "") || "";
          await uploadFile({ ...file, originalname: `${file.fieldname}${ext}` }, folderId);
        }

        folderLink = await makePublic(folderId);
      } catch (driveErr) {
        console.error("[Drive] Upload failed:", driveErr);
        folderLink = "Google Drive upload failed";
      }
    } else if (!folderId && !hasUploadedFiles) {
      console.warn("[Submit] Submission received without files or a Drive folder.");
    } else if (!runtime.enableDriveUpload && hasUploadedFiles) {
      console.log("[LOCAL TEST] Drive upload skipped.");
    }

    const source = existingFolderId ? "drive-folder" : hasUploadedFiles ? "frontend-upload" : "metadata-only";
    const uploadedFiles = (req.files || []).map((file) => ({
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    }));

    const submissionRecord = await createSubmissionRecord({
      submission,
      source,
      driveFolderId: folderId,
      driveFolderLink: folderId ? folderLink : null,
      uploadedFiles,
    });

    if (runtime.enableSubmissionEmail) {
      try {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: process.env.EMAIL_USER,
          subject: "New Vendor Submission",
          text: [
            `Submission ID: ${submissionRecord.submissionId}`,
            `Name: ${name}`,
            `Phone: ${phone}`,
            `Email: ${email}`,
            `Constitution: ${constitution}`,
            `Vendor Type: ${vendorType}`,
            `Product: ${product}`,
            `HSN: ${hsn}`,
            `Geo Address: ${geoAddress || "-"}`,
            `Geo Latitude: ${geoLatitude || "-"}`,
            `Geo Longitude: ${geoLongitude || "-"}`,
            `Geo Captured At: ${geoCapturedAt || "-"}`,
            `Google Maps Link: ${geoMapsUrl || "-"}`,
            "",
            `Source: ${source}`,
            `Drive Folder: ${folderLink}`,
          ].join("\n"),
        });
      } catch (emailErr) {
        console.error("[Email] Submission email failed:", emailErr);
      }
    } else {
      console.log("[LOCAL TEST] Submission email skipped.");
    }

    res.json({
      success: true,
      submissionId: submissionRecord.submissionId,
      folderLink,
      processingSource: source,
    });

    if (folderId || hasUploadedFiles) {
      processSubmission({
        submission,
        folderId,
        files: folderId ? undefined : req.files || [],
        transporter,
        driveFolderLink: folderLink,
        submissionId: submissionRecord.submissionId,
      }).catch((err) => {
        console.error("[Background] Document processing failed:", err);
      });
    } else {
      console.log("[Submit] Background processing skipped (no files and no Drive folder).");
    }

    if (folderId) {
      for (const file of req.files || []) {
        fs.unlink(file.path).catch(() => {});
      }
    }
  } catch (err) {
    console.error("[Submit] Unexpected error:", err);
    res.status(500).json({
  success: false,
  error: err.message,
});
  }
});

app.get("/submissions/:submissionId", async (req, res) => {
  try {
    const record = await readSubmissionRecord(req.params.submissionId);
    res.json({
      success: true,
      submission: {
        submissionId: record.submissionId,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        status: record.status,
        source: record.source,
        driveFolderId: record.driveFolderId,
        driveFolderLink: record.driveFolderLink,
        processing: record.processing,
      },
    });
  } catch (err) {
    res.status(404).json({ success: false, error: "Submission not found" });
  }
});

const { compareFaces } = require("./services/faceComparison");
const faceUpload = multer({ storage }).fields([
  { name: "face1", maxCount: 1 },
  { name: "face2", maxCount: 1 },
]);

app.post("/compare-faces", faceUpload, async (req, res) => {
  try {
    const f1 = req.files?.face1?.[0];
    const f2 = req.files?.face2?.[0];

    if (!f1 || !f2) {
      return res.status(400).json({ success: false, error: "Two images are required." });
    }

    const result = await compareFaces(f1.path, f2.path);

    fs.unlink(f1.path).catch(() => {});
    fs.unlink(f2.path).catch(() => {});

    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[FaceCompare] Error:", err);
    res.status(500).json({ success: false, error: "Internal server error during face comparison." });
  }
});

/*
if (process.env.DRIVE_TEST_ID) {
  console.log("Running DRIVE TEST MODE...");

  processSubmission({
    submission: {
      name: "CMD Test",
      email: "test@test.com",
      phone: "9999999999",
    },
    folderId: process.env.DRIVE_TEST_ID,
    transporter: {
      sendMail: async () => console.log("Email skipped"),
    },
    driveFolderLink: `https://drive.google.com/drive/folders/${process.env.DRIVE_TEST_ID}`,
  }).catch(console.error);
}
*/



app.get("/test-drive", async (req, res) => {
  try {
    const folderId = "1r4OvGuUSEzbHkttbiqT-hBqZVO1yCYLO";

    const result = await processSubmission({
      submission: {
        name: "Test User",
        phone: "9999999999",
        email: "test@test.com",
        constitution: "Proprietorship",
        vendorType: "Trader",
        product: "Test",
      },
      folderId,
      transporter: null,
      driveFolderLink: `https://drive.google.com/drive/folders/${folderId}`,
      submissionId: "TEST123",
    });

    res.json({
      success: true,
      result,
    });

  } catch (err) {
    console.error("TEST ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(5000, () => {
  console.log(
    `Mode: ${runtime.isLocalTestMode ? "LOCAL_TEST" : "LIVE"} | ` +
      `Drive: ${runtime.enableDriveUpload ? "on" : "off"} | ` +
      `Submission email: ${runtime.enableSubmissionEmail ? "on" : "off"} | ` +
      `Review email: ${runtime.enableReviewEmail ? "on" : "off"}`
  );
  console.log("Server running at http://localhost:5000");
  logStartupWarnings();
});
