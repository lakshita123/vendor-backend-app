const axios = require("axios");
const fs = require("fs");
const path = require("path");

/*async function readTextFromImage(filePath) {
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

    const response = await axios.post(
      "https://api.ocr.space/parse/image",
      params,
      {
        headers: {
          apikey: process.env.OCR_SPACE_API_KEY || "helloworld",
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const text = response.data?.ParsedResults?.[0]?.ParsedText || "";
    return text;
  } catch (err) {
    console.error("OCR Error:", err.message);
    return "";
  }
}

*/

// NOTE: Ensure your existing OCR execution logic (Tesseract or Cloud) is called inside this function where indicated.
async function readTextFromImage(imagePath) {
  const ext = path.extname(imagePath);
  const optimizedPath = imagePath.replace(ext, `_optimized.jpg`);

  try {
    const image = sharp(imagePath);
    const metadata = await image.metadata();

    // 1. CONDITIONAL RESIZE: Only shrink if it's a massive, high-res photo (> 1500px).
    if (metadata.width > 1500) {
      image.resize({ width: 1500, withoutEnlargement: true });
    }

    // 2. ENHANCE FOR OCR: Clean up the image so the OCR doesn't hang.
    await image
      .grayscale()       // Remove color noise 
      .normalize()       // Maximize contrast 
      .sharpen()         // Crisp up blurry edges
      .jpeg({ quality: 85 }) 
      .toFile(optimizedPath);

    // 3. RUN OCR: Replace this comment with your actual OCR call
    // Example: const text = await runTesseract(optimizedPath);
    // return text;

  } finally {
    // 4. CLEANUP: Delete the temp optimized file
    await fs.unlink(optimizedPath).catch(() => {});
  }
}

async function extractPdfTextWithOcr(filePath) {
  return await readTextFromImage(filePath);
}

module.exports = {
  readTextFromImage,
  extractPdfTextWithOcr,
};
