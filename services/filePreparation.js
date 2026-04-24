const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const PDFDocument = require("pdfkit");

function isImageFile(file) {
  const extension = path.extname(file.originalname || file.filename || "").toLowerCase();
  return (
    (file.mimetype || "").toLowerCase().startsWith("image/") ||
    [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff", ".heic", ".heif"].includes(extension)
  );
}

function createPdfFromImage(imagePath, pdfPath) {
  return new Promise(async (resolve, reject) => {
    try {
      // ✅ FIX: Use original color buffer — do NOT convert to grayscale
      const pipeline = sharp(imagePath).rotate();
      const metadata = await pipeline.metadata();
      // Keep original format; jpeg at high quality for lossless-ish colour
      const imageBuffer = await pipeline.jpeg({ quality: 95 }).toBuffer();
      const width  = Math.max(1, metadata.width  || 1200);
      const height = Math.max(1, metadata.height || 1600);

      const document = new PDFDocument({ autoFirstPage: false, compress: true });
      const stream = fs.createWriteStream(pdfPath);

      document.pipe(stream);
      document.addPage({ size: [width, height], margin: 0 });
      document.image(imageBuffer, 0, 0, {
        fit:    [width, height],
        align:  "center",
        valign: "center",
      });
      document.end();

      stream.on("finish", resolve);
      stream.on("error", reject);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Preprocesses an image for OCR use ONLY (grayscale + normalize).
 * The resulting file is a SEPARATE path — it is NEVER uploaded to Drive.
 * Drive upload always uses the original colour path (file.path or file.sourcePath).
 */
async function preprocessImageForOcr(inputPath, outputPath) {
  await sharp(inputPath)
    .rotate()
    .grayscale()   // ← grayscale is fine here — this file is OCR-only
    .normalize()
    .toFile(outputPath);
}

async function prepareUploadedFiles(files) {
  return Promise.all(
    (files || []).map(async (file) => {
      if (!isImageFile(file)) {
        return file;
      }

      const baseName = path.basename(
        file.originalname || file.filename || "upload",
        path.extname(file.originalname || file.filename || "")
      );

      const pdfPath = path.join(
        path.dirname(file.path),
        `${path.basename(file.path, path.extname(file.path))}.pdf`
      );

      // OCR-preprocessed copy (grayscale) — separate file, never uploaded
      const processedPath = file.path.replace(/(\.\w+)$/, "_ocr_processed.jpg");

      await preprocessImageForOcr(file.path, processedPath);

      // ✅ createPdfFromImage reads from the ORIGINAL colour image (file.path),
      //    NOT from processedPath — so Drive receives a colour PDF.
      await createPdfFromImage(file.path, pdfPath);

      return {
        ...file,
        originalname: `${baseName}.pdf`,
        filename:     path.basename(pdfPath),
        mimetype:     "application/pdf",
        path:         pdfPath,
        convertedFromImage: true,
        sourcePath:         file.path,           // original colour image
        ocrSourcePath:      processedPath,        // grayscale OCR-only image
        sourceOriginalname: file.originalname,
        sourceMimetype:     file.mimetype,
      };
    })
  );
}

module.exports = { prepareUploadedFiles };
