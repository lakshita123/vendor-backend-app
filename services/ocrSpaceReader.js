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

  async function buildForm() {
    const f = new FormData();
    f.append("file", new Blob([fileBuffer]), fileName);
    f.append("language", "eng");
    f.append("isOverlayRequired", "false");
    f.append("detectOrientation", "true");
    f.append("scale", "true");
    f.append("OCREngine", ocrEngine);
    return f;
  }

  async function doFetch() {
    return fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { apikey: apiKey },
      body: await buildForm(),
    });
  }

  let response = await doFetch();

  // Retry up to 3 times on 429 rate-limit with exponential backoff
  if (!response.ok && response.status === 429) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const delay = attempt * 3000; // 3s, 6s, 9s
      console.warn(`[OCR.space] 429 rate limit — retrying in ${delay / 1000}s (attempt ${attempt}/3)`);
      await new Promise(r => setTimeout(r, delay));
      response = await doFetch();
      if (response.ok) break;
      if (response.status !== 429) break; // Non-429 error — stop retrying
    }
  }

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
