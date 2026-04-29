require("dotenv").config();

const express = require("express");
const multer  = require("multer");
const nodemailer = require("nodemailer");
const cors    = require("cors");
const path    = require("path");
const fs      = require("fs/promises");

const {
  createFolder,
  uploadFile,
  makePublic,
  extractFolderId,
} = require("./googleDrive");
const { runtime }           = require("./config/runtime");
const { processSubmission } = require("./services/documentProcessor");
const { prepareUploadedFiles } = require("./services/filePreparation");
const {
  createSubmissionRecord,
  readSubmissionRecord,
  lookupByPhone,
} = require("./services/submissionStore");

const app = express();

const allowedOrigins = process.env.FRONTEND_ORIGIN
  ? process.env.FRONTEND_ORIGIN.split(",").map(o => o.trim())
  : ["*"];

app.use(cors({
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
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadsDir = path.join(__dirname, "uploads");
fs.mkdir(uploadsDir, { recursive: true }).catch(err => {
  console.error("Failed to ensure uploads directory exists:", err);
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

// ✅ Always use upload.any() so multer handles any field name safely
const upload = multer({ storage });
const uploadFields = upload.any();

function hasValue(value) {
  return Boolean(String(value || "").trim());
}

function getServiceHealth() {
  const driveConfigured =
    hasValue(process.env.GOOGLE_CLIENT_ID)      &&
    hasValue(process.env.GOOGLE_CLIENT_SECRET)  &&
    hasValue(process.env.GOOGLE_REDIRECT_URI)   &&
    hasValue(process.env.GOOGLE_REFRESH_TOKEN);

  const emailConfigured =
    hasValue(process.env.EMAIL_USER) && hasValue(process.env.EMAIL_PASS);

  const reviewConfigured =
    emailConfigured && hasValue(process.env.REVIEW_EMAIL || process.env.EMAIL_USER);

  const cloudOcrConfigured =
    !runtime.enableCloudOcr ||
    (runtime.cloudOcrProvider === "google"   && hasValue(process.env.GOOGLE_CLOUD_VISION_KEYFILE)) ||
    (runtime.cloudOcrProvider === "ocrspace" && hasValue(process.env.OCR_SPACE_API_KEY));

  return {
    mode: runtime.isLocalTestMode ? "LOCAL_TEST" : "LIVE",
    features: {
      driveUpload:      { enabled: runtime.enableDriveUpload,      configured: driveConfigured,      ready: !runtime.enableDriveUpload      || driveConfigured },
      submissionEmail:  { enabled: runtime.enableSubmissionEmail,  configured: emailConfigured,       ready: !runtime.enableSubmissionEmail  || emailConfigured },
      reviewEmail:      { enabled: runtime.enableReviewEmail,      configured: reviewConfigured,      ready: !runtime.enableReviewEmail      || reviewConfigured },
      ocrFallback:      { enabled: runtime.enableOcrFallback,      configured: true,                  ready: true },
      cloudOcr:         { enabled: runtime.enableCloudOcr,         configured: cloudOcrConfigured,    provider: runtime.cloudOcrProvider, ready: !runtime.enableCloudOcr || cloudOcrConfigured },
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

function parsePort(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalBoolean(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function createMailTransporter() {
  if (runtime.isLocalTestMode) {
    return {
      async sendMail(payload) {
        console.log(`[LOCAL TEST] Email skipped: ${payload.subject}`);
        return { accepted: [payload.to] };
      },
    };
  }

  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = parsePort(process.env.SMTP_PORT, 587);
  const secure = parseOptionalBoolean(process.env.SMTP_SECURE) ?? (port === 465);
  
  console.log(`[Mail] Transport config -> host=${host}, port=${port}, secure=${secure}, family=4`);


  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    family: 4,
    requireTLS: !secure,
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
  });
}

const transporter = createMailTransporter();


/* ══════════════════════════════════════════════════════════════
   POST /submit
══════════════════════════════════════════════════════════════ */
app.post("/submit", uploadFields, async (req, res) => {
  try {
    const body = req.body || {};

    const {
      name,
      phone,
      email,
      constitution,
      vendorType,
      // product is now a comma-separated string of selected products
      product,
      hsn,
      // legacy geo keys (sent from warehouse_photo field for backward compat)
      geoAddress,
      geoLatitude,
      geoLongitude,
      geoMapsUrl,
      geoCapturedAt,
      // new per-field geo keys
      warehouse_photo_address,
      warehouse_photo_latitude,
      warehouse_photo_longitude,
      warehouse_photo_mapsUrl,
      warehouse_photo_capturedAt,
      authorized_person_photo_address,
      authorized_person_photo_latitude,
      authorized_person_photo_longitude,
      authorized_person_photo_mapsUrl,
      authorized_person_photo_capturedAt,
      // drive folder (optional)
      driveFolderLink: inputDriveFolderLink,
      driveFolderId:   inputDriveFolderId,
    } = body;

    const submission = {
      name,
      phone,
      email,
      constitution,
      vendorType,
      product,
      hsn,
      // Prefer per-field geo; fall back to legacy keys
      geoAddress:    warehouse_photo_address    || geoAddress,
      geoLatitude:   warehouse_photo_latitude   || geoLatitude,
      geoLongitude:  warehouse_photo_longitude  || geoLongitude,
      geoMapsUrl:    warehouse_photo_mapsUrl    || geoMapsUrl,
      geoCapturedAt: warehouse_photo_capturedAt || geoCapturedAt,
      // Authorized person geo (new)
      authorizedPersonGeoAddress:   authorized_person_photo_address,
      authorizedPersonGeoLatitude:  authorized_person_photo_latitude,
      authorizedPersonGeoLongitude: authorized_person_photo_longitude,
      authorizedPersonGeoMapsUrl:   authorized_person_photo_mapsUrl,
      authorizedPersonGeoCapturedAt: authorized_person_photo_capturedAt,
    };

    // ✅ Always handle req.files as an array
    const uploadedFilesArr = Array.isArray(req.files) ? req.files : [];

    const existingFolderId = extractFolderId(inputDriveFolderId) || extractFolderId(inputDriveFolderLink);
    const hasUploadedFiles = uploadedFilesArr.length > 0;

    const source = existingFolderId ? "drive-folder"
      : hasUploadedFiles ? "frontend-upload"
      : "metadata-only";

    if (!existingFolderId && !hasUploadedFiles) {
      console.warn("[Submit] No files and no Drive folder received.");
    }

    const uploadedFileMeta = uploadedFilesArr.map(file => ({
      fieldname:    file.fieldname,
      originalname: file.originalname,
      mimetype:     file.mimetype,
      size:         file.size,
    }));

    // ✅ FIX: Create record immediately — Drive upload runs in background
    const submissionRecord = await createSubmissionRecord({
      submission,
      source,
      driveFolderId:   existingFolderId || null,
      driveFolderLink: existingFolderId
        ? String(inputDriveFolderLink || `https://drive.google.com/drive/folders/${existingFolderId}`)
        : null,
      uploadedFiles: uploadedFileMeta,
    });

    // ✅ FIX: Respond to client BEFORE Drive upload — prevents Request aborted
    res.json({
      success: true,
      submissionId:     submissionRecord.submissionId,
      folderLink:       existingFolderId
        ? String(inputDriveFolderLink || `https://drive.google.com/drive/folders/${existingFolderId}`)
        : "Uploading in background...",
      processingSource: source,
    });

    // ── Everything below runs after response is sent ──
    setImmediate(async () => {
      const { updateSubmissionRecord } = require("./services/submissionStore");

      let folderId   = existingFolderId || null;
      let folderLink = existingFolderId
        ? String(inputDriveFolderLink || `https://drive.google.com/drive/folders/${existingFolderId}`)
        : "Not uploaded to Google Drive";

      // ── STEP 1: Drive upload ──────────────────────────────────
      if (!folderId && runtime.enableDriveUpload && hasUploadedFiles) {
        try {
          const preparedFiles = await prepareUploadedFiles(uploadedFilesArr);
          folderId = await createFolder(`${name}_${constitution}_${vendorType}_${Date.now()}`);

          for (const file of preparedFiles) {
            const ext = path.extname(file.originalname || "") || "";
            await uploadFile({ ...file, originalname: `${file.fieldname}${ext}` }, folderId);
          }

          folderLink = await makePublic(folderId);
          console.log(`[Drive] Upload complete: ${folderLink}`);

          await updateSubmissionRecord(submissionRecord.submissionId, (record) => ({
            ...record,
            driveFolderId:   folderId,
            driveFolderLink: folderLink,
          })).catch(() => {});

        } catch (driveErr) {
          console.error("[Drive] Upload failed:", driveErr);
          folderLink = "Google Drive upload failed";
        }
      } else if (!runtime.enableDriveUpload && hasUploadedFiles) {
        console.log("[LOCAL TEST] Drive upload skipped.");
      }

      // ── STEP 2: Email 1 — fires immediately after Drive upload ──
      // Contains submission details + Drive folder link.
      // Does NOT wait for OCR or report.
      if (runtime.enableSubmissionEmail) {
        try {
          await transporter.sendMail({
            from:    process.env.EMAIL_USER,
            to:      process.env.EMAIL_USER,
            cc:      process.env.CC_EMAILS,
            subject: `New Vendor Submission — ${name || "Unknown"}`,
            text: [
              "📋 NEW VENDOR SUBMISSION",
              "─────────────────────────────",
              `Submission ID : ${submissionRecord.submissionId}`,
              `Name          : ${name || "-"}`,
              `Phone         : ${phone || "-"}`,
              `Email         : ${email || "-"}`,
              `Constitution  : ${constitution || "-"}`,
              `Vendor Type   : ${vendorType || "-"}`,
              `Product       : ${product || "-"}`,
              `HSN           : ${hsn || "-"}`,
              "",
              "📍 Warehouse Location",
              `Address       : ${submission.geoAddress || "-"}`,
              `Coordinates   : ${submission.geoLatitude || "-"}, ${submission.geoLongitude || "-"}`,
              `Captured At   : ${submission.geoCapturedAt || "-"}`,
              `Maps Link     : ${submission.geoMapsUrl || "-"}`,
              "",
              "👤 Authorized Person",
              `Address       : ${submission.authorizedPersonGeoAddress || "-"}`,
              "",
              "📁 Drive Folder",
              folderLink,
              "",
              "─────────────────────────────",
              "Analysis report will follow in a separate email once processing is complete.",
            ].join("\n"),
          });
          console.log("[Email] Submission email (email 1) sent.");
        } catch (emailErr) {
          console.error("[Email] Submission email failed:", emailErr);
        }
      } else {
        console.log("[LOCAL TEST] Submission email (email 1) skipped.");
      }

      // ── STEP 3: OCR + analysis + Email 2 (slow, runs in background) ──
      // processSubmission internally sends the review email with report attached.
      if (folderId || hasUploadedFiles) {
        processSubmission({
          submission,
          folderId,
          files:           folderId ? undefined : uploadedFilesArr,
          transporter,
          driveFolderLink: folderLink,
          submissionId:    submissionRecord.submissionId,
        }).catch(err => {
          console.error("[Background] Document processing failed:", err);
        });
      }

      // Cleanup temp files after Drive upload
      if (folderId) {
        for (const file of uploadedFilesArr) {
          fs.unlink(file.path).catch(() => {});
        }
      }
    });

  } catch (err) {
    console.error("[Submit] Unexpected error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /submissions/:submissionId
══════════════════════════════════════════════════════════════ */
app.get("/submissions/:submissionId", async (req, res) => {
  try {
    const record = await readSubmissionRecord(req.params.submissionId);
    res.json({
      success: true,
      submission: {
        submissionId:    record.submissionId,
        createdAt:       record.createdAt,
        updatedAt:       record.updatedAt,
        status:          record.status,
        source:          record.source,
        driveFolderId:   record.driveFolderId,
        driveFolderLink: record.driveFolderLink,
        processing:      record.processing,
      },
    });
  } catch (_) {
    res.status(404).json({ success: false, error: "Submission not found" });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /lookup-phone/:phone
   Returns the most-recent submission for a given mobile number.
   Used by the frontend to pre-fill the form on return visits.
══════════════════════════════════════════════════════════════ */
app.get("/lookup-phone/:phone", async (req, res) => {
  try {
    const phone = String(req.params.phone || "").trim();
    if (!/^\d{10}$/.test(phone)) {
      return res.status(400).json({ success: false, error: "Invalid phone number" });
    }

    const entries = await lookupByPhone(phone);

    if (!entries.length) {
      return res.json({ success: true, found: false });
    }

    // Return the most-recent entry (index 0 — newest first)
    const latest = entries[0];

    return res.json({
      success:  true,
      found:    true,
      previous: {
        submissionId:    latest.submissionId,
        createdAt:       latest.createdAt,
        driveFolderId:   latest.driveFolderId   || null,
        driveFolderLink: latest.driveFolderLink || null,
        name:            latest.name,
        email:           latest.email,
        constitution:    latest.constitution,
        vendorType:      latest.vendorType,
        product:         latest.product,
        hsn:             latest.hsn,
      },
    });
  } catch (err) {
    console.error("[LookupPhone] Error:", err);
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /compare-faces
══════════════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════════════
   GET /test-drive  (dev helper)
══════════════════════════════════════════════════════════════ */
app.get("/test-drive", async (req, res) => {
  try {
    const folderId = "1r4OvGuUSEzbHkttbiqT-hBqZVO1yCYLO";
    const result = await processSubmission({
      submission: {
        name: "Test User", phone: "9999999999", email: "test@test.com",
        constitution: "Proprietorship", vendorType: "Trader", product: "Test",
      },
      folderId,
      transporter: null,
      driveFolderLink: `https://drive.google.com/drive/folders/${folderId}`,
      submissionId: "TEST123",
    });
    res.json({ success: true, result });
  } catch (err) {
    console.error("TEST ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(
    `Mode: ${runtime.isLocalTestMode ? "LOCAL_TEST" : "LIVE"} | ` +
    `Drive: ${runtime.enableDriveUpload ? "on" : "off"} | ` +
    `Submission email: ${runtime.enableSubmissionEmail ? "on" : "off"} | ` +
    `Review email: ${runtime.enableReviewEmail ? "on" : "off"}`
  );
  console.log(`Server running on port ${PORT}`);
  logStartupWarnings();
});
