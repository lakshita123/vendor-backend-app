/**
 * faceComparison.js
 * Uses face-api.js (browser build) + canvas — NO tfjs-node needed
 *
 * NEW: extractFaceFromDocument(file) — handles both image uploads and
 * PDF identity documents (Aadhaar, PAN). For PDFs it renders the first
 * page and runs face detection on the rendered bitmap; for images it
 * uses the original source path directly. This keeps the existing
 * compareFaces() API unchanged.
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const canvas = require("canvas");
const { Canvas, Image, ImageData } = canvas;

// Use the browser/canvas-compatible build explicitly
const faceapi = require("face-api.js");

// Patch faceapi to use node-canvas
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

// ── Model loading ──────────────────────────────────────────────
function resolveModelsDir() {
  const candidates = [
    process.env.FACE_MODELS_DIR,
    path.join(__dirname, "../face-models"),
    path.join(__dirname, "../../face-models"),
  ].filter(Boolean);

  for (const dir of candidates) {
    const manifestPath = path.join(dir, "ssd_mobilenetv1_model-weights_manifest.json");
    if (fs.existsSync(manifestPath)) {
      return dir;
    }
  }

  return candidates[0] || path.join(__dirname, "../face-models");
}

const MODELS_DIR = resolveModelsDir();
let modelsLoaded = false;

async function loadModels() {
  if (modelsLoaded) return;

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);

  modelsLoaded = true;
  console.log("[FaceAPI] Models loaded successfully.");
}

// ── Image preprocessing ────────────────────────────────────────
async function preprocessBuffer(buffer) {
  return sharp(buffer)
    .rotate()
    .resize({ width: 640, withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function preprocessImagePath(filePath) {
  return sharp(filePath)
    .rotate()
    .resize({ width: 640, withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
}

// ── Face detection ─────────────────────────────────────────────
async function getBestDescriptor(imageBuffer, label) {
  const img = await canvas.loadImage(imageBuffer);

  const detections = await faceapi
    .detectAllFaces(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
    .withFaceLandmarks()
    .withFaceDescriptors();

  if (!detections || detections.length === 0) {
    throw new Error(`No face detected in ${label}.`);
  }

  // Pick largest face by bounding box area
  const best = detections.reduce((prev, curr) => {
    const prevArea = prev.detection.box.width * prev.detection.box.height;
    const currArea = curr.detection.box.width * curr.detection.box.height;
    return currArea > prevArea ? curr : prev;
  });

  return {
    descriptor: best.descriptor,
    faceCount: detections.length,
    confidence: best.detection.score,
  };
}

// ── PDF → image buffer ─────────────────────────────────────────
// Renders the first page of a PDF to a high-res bitmap so face-api
// can detect the photo printed on an Aadhaar or PAN card.
async function renderPdfFirstPage(filePath) {
  try {
    const { extractRenderedFirstPageBuffer } = require("./pdfImageExtractor");
    const buf = await extractRenderedFirstPageBuffer(filePath);
    if (!buf) throw new Error("No page rendered");
    return buf;
  } catch (err) {
    throw new Error(`Could not render PDF page for face extraction: ${err.message}`);
  }
}

// ── Extract face from a submission file ───────────────────────
/**
 * Given a file object from prepareUploadedFiles / req.files, returns
 * the face descriptor (same shape as getBestDescriptor) or throws.
 *
 * Strategy:
 *  - If the file was originally an image (convertedFromImage === true),
 *    use sourcePath (the raw uploaded image) for best quality.
 *  - If the file is still an image extension (jpg/png/etc), use file.path.
 *  - If the file is a PDF (Aadhaar, PAN card as PDF), render first page.
 *
 * This never modifies the file object and does not affect the main
 * OCR/extraction pipeline.
 */
async function extractFaceFromDocument(file, label) {
  const ext = path.extname(file.originalname || file.filename || "").toLowerCase();
  const isPdf = ext === ".pdf" || (file.mimetype || "").includes("pdf");

  let buffer;

  if (file.convertedFromImage && file.sourcePath) {
    // Best case: original uploaded image before PDF conversion
    buffer = await preprocessImagePath(file.sourcePath);
  } else if (!isPdf) {
    // Direct image upload
    buffer = await preprocessImagePath(file.path);
  } else {
    // PDF identity document — render first page to bitmap
    const rawBuf = await renderPdfFirstPage(file.path);
    buffer = await preprocessBuffer(rawBuf);
  }

  return getBestDescriptor(buffer, label || file.fieldname || "document");
}

// ── Distance → confidence ──────────────────────────────────────
const MATCH_THRESHOLD = 0.6;

function distanceToConfidence(distance) {
  return parseFloat(Math.max(0, 1 - distance / 1.2).toFixed(4));
}

// ── Public API: compare two image paths ───────────────────────
async function compareFaces(imagePath1, imagePath2) {
  await loadModels();

  const [buf1, buf2] = await Promise.all([
    preprocessImagePath(imagePath1),
    preprocessImagePath(imagePath2),
  ]);

  const [face1, face2] = await Promise.all([
    getBestDescriptor(buf1, "image 1"),
    getBestDescriptor(buf2, "image 2"),
  ]);

  const distance = faceapi.euclideanDistance(
    Array.from(face1.descriptor),
    Array.from(face2.descriptor)
  );

  const confidence = distanceToConfidence(distance);
  const match = distance < MATCH_THRESHOLD;

  return {
    match,
    confidence,
    distance: parseFloat(distance.toFixed(4)),
    details: {
      image1FaceCount: face1.faceCount,
      image1DetectionScore: parseFloat(face1.confidence.toFixed(3)),
      image2FaceCount: face2.faceCount,
      image2DetectionScore: parseFloat(face2.confidence.toFixed(3)),
    },
  };
}

// ── Public API: compare a geo-tag photo against identity docs ─
/**
 * compareGeoTagToDocuments(geoTagFile, identityFiles)
 *
 * geoTagFile    — the geo_tag_photo file object
 * identityFiles — array of { file, label } for aadhar and pan
 *
 * Returns an array of comparison results, one per identity doc:
 * [
 *   {
 *     label: "Aadhaar",
 *     fieldname: "aadhar",
 *     match: true/false,
 *     confidence: 0.82,
 *     distance: 0.21,
 *     error: null,          // or error message if face not found
 *     details: { ... }
 *   },
 *   ...
 * ]
 */
async function compareGeoTagToDocuments(geoTagFile, identityFiles) {
  await loadModels();

  // Extract geo tag face once — reuse for all comparisons
  let geoFace;
  let geoError = null;

  try {
    geoFace = await extractFaceFromDocument(geoTagFile, "geo tag photo");
  } catch (err) {
    geoError = err.message;
  }

  const results = await Promise.all(
    identityFiles.map(async ({ file, label }) => {
      if (geoError) {
        return {
          label,
          fieldname: file.fieldname,
          match: false,
          confidence: 0,
          distance: null,
          error: `Geo tag face extraction failed: ${geoError}`,
          details: null,
        };
      }

      try {
        const idFace = await extractFaceFromDocument(file, label);

        const distance = faceapi.euclideanDistance(
          Array.from(geoFace.descriptor),
          Array.from(idFace.descriptor)
        );

        const confidence = distanceToConfidence(distance);
        const match = distance < MATCH_THRESHOLD;

        return {
          label,
          fieldname: file.fieldname,
          match,
          confidence,
          distance: parseFloat(distance.toFixed(4)),
          error: null,
          details: {
            geoTagFaceCount: geoFace.faceCount,
            geoTagDetectionScore: parseFloat(geoFace.confidence.toFixed(3)),
            documentFaceCount: idFace.faceCount,
            documentDetectionScore: parseFloat(idFace.confidence.toFixed(3)),
          },
        };
      } catch (err) {
        return {
          label,
          fieldname: file.fieldname,
          match: false,
          confidence: 0,
          distance: null,
          error: err.message,
          details: null,
        };
      }
    })
  );

  return results;
}

module.exports = {
  compareFaces,
  compareGeoTagToDocuments,
};
