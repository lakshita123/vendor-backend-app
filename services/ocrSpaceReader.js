const fs = require("fs/promises");

async function extractPdfTextWithOcrSpace(filePath) {
  const apiKey = process.env.OCR_SPACE_API_KEY;

  if (!apiKey) {
    throw new Error("OCR_SPACE_API_KEY is not set.");
  }

  const sharp = require("sharp");

	let fileBuffer = await fs.readFile(filePath);

	// Compress ONLY if file is large (optional but recommended)
	if (fileBuffer.length > 1024 * 1024) {
	  try {
		fileBuffer = await sharp(fileBuffer)
		  .resize({ width: 1200 })
		  .jpeg({ quality: 70 })
		  .toBuffer();

		console.log(`[OCR] Compressed file: ${fileName}`);
	  } catch (err) {
		console.warn(`[OCR] Compression failed, using original: ${err.message}`);
	  }
	}
  const form = new FormData();
  const fileName = filePath.split(/[/\\]/).pop() || "document.pdf";

  form.append("file", new Blob([fileBuffer]), fileName);
  form.append("language", "eng");
  form.append("isOverlayRequired", "false");
  form.append("detectOrientation", "true");
  form.append("scale", "true");
  form.append("OCREngine", "2");

  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: {
      apikey: apiKey,
    },
    body: form,
  });

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
