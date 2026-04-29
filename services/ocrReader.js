const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { runWithOcrThrottle } = require("./ocrThrottle");

async function readTextFromImage(filePath) {
  try {
    const base64 = fs.readFileSync(filePath, { encoding: "base64" });

    // Detect mime type from extension for correct base64 prefix
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
    };
    const mime = mimeMap[ext] || "image/png";

    // OCR Space requires form-encoded body (not JSON) for the base64Image field
    const params = new URLSearchParams();
    params.append("base64Image", `data:${mime};base64,${base64}`);
    params.append("language", "eng");
    params.append("isOverlayRequired", "false");
    params.append("detectOrientation", "true");
    params.append("scale", "true");
    params.append("OCREngine", "2"); // Engine 2 handles printed/scanned Indian docs better

    const response = await runWithOcrThrottle(() =>
      axios.post(
        "https://api.ocr.space/parse/image",
        params,
        {
          headers: {
            apikey: process.env.OCR_SPACE_API_KEY || "helloworld",
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      )
    );

    const text = response.data?.ParsedResults?.[0]?.ParsedText || "";
    return text;
  } catch (err) {
    console.error("OCR Error:", err.message);
    return "";
  }
}

async function extractPdfTextWithOcr(filePath) {
  return await readTextFromImage(filePath);
}

module.exports = {
  readTextFromImage,
  extractPdfTextWithOcr,
};
