const fs = require("fs/promises");
const { runWithOcrThrottle } = require("./ocrThrottle");

async function extractPdfTextWithOcrSpace(filePath, { ocrEngine = "2" } = {}) {
  const apiKey = process.env.OCR_SPACE_API_KEY;

  if (!apiKey) {
    throw new Error("OCR_SPACE_API_KEY is not set.");
  }

  const sharp = require("sharp");

  const fileName = filePath.split(/[/\\]/).pop() || "document.pdf";

  let fileBuffer = await fs.readFile(filePath);

  // Compress ONLY if file is large — reduces 413 errors
  if (fileBuffer.length > 1024 * 1024) {
    try {
      fileBuffer = await sharp(fileBuffer)
        .resize({ width: 1200 })
        .jpeg({ quality: 70 })
        .toBuffer();
      console.log(`[OCR] Compressed file: ${fileName} (${Math.round(fileBuffer.length / 1024)}KB)`);
    } catch (err) {
      console.warn(`[OCR] Compression failed, using original: ${err.message}`);
    }
  }

  const form = new FormData();

  form.append("file", new Blob([fileBuffer]), fileName);
  form.append("language", "eng");
  form.append("isOverlayRequired", "false");
  form.append("detectOrientation", "true");
  form.append("scale", "true");
  form.append("OCREngine", ocrEngine); // Engine 1 = better for coloured scans (Aadhaar); Engine 2 = better for printed docs

  const response = await runWithOcrThrottle(() =>
    fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: {
        apikey: apiKey,
      },
      body: form,
    })
  );

  if (!response.ok) {
    throw new Error(`OCR.space request failed with status ${response.status}`);
  }

  const payload = await response.json();

  if (payload.IsErroredOnProcessing) {
    const message =
      (payload.ErrorMessage && payload.ErrorMessage.join(" ")) ||
      payload.ErrorDetails ||
      "OCR.space could not process the file.";
    throw new Error(message);
  }

  const parsedText = (payload.ParsedResults || [])
    .map((result) => result.ParsedText || "")
    .join("\n")
    .trim();

  return parsedText;
}

module.exports = {
  extractPdfTextWithOcrSpace,
};
