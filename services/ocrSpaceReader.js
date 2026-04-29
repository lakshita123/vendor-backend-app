const fs = require("fs/promises");

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

  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: {
      apikey: apiKey,
    },
    body: form,
  });

  // Retry up to 3 times on 429 rate-limit with exponential backoff
  if (!response.ok) {
    if (response.status === 429) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const delay = attempt * 3000; // 3s, 6s, 9s
        console.warn(`[OCR.space] 429 rate limit — retrying in ${delay / 1000}s (attempt ${attempt}/3)`);
        await new Promise(r => setTimeout(r, delay));
        const retry = await fetch("https://api.ocr.space/parse/image", {
          method: "POST",
          headers: { apikey: apiKey },
          body: form,
        });
        if (retry.ok) {
          const retryPayload = await retry.json();
          if (!retryPayload.IsErroredOnProcessing) {
            return (retryPayload.ParsedResults || []).map(r => r.ParsedText || "").join("\n").trim();
          }
        }
        if (retry.status !== 429) break; // Non-429 error — stop retrying
      }
    }
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
