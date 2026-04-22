const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { PDFParse } = require("pdf-parse");
const { readTextFromImage } = require("./ocrReader");
const { extractPdfTextWithGoogleVision } = require("./googleVisionReader");
const { extractPdfTextWithOcrSpace } = require("./ocrSpaceReader");
const { runtime } = require("../config/runtime");

async function extractPdfText(filePath) {
  const buffer = await fs.readFile(filePath);
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return {
      text: (result.text || "").replace(/\u0000/g, "").trim(),
      totalPages: result.total || 0,
    };
  } finally {
    await parser.destroy();
  }
}

function sanitizeExtractedText(text) {
  return (text || "")
    .replace(/\u0000/g, "")
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasDocumentToken(key, token) {
  return (
    key === token ||
    key.startsWith(`${token}_`) ||
    key.endsWith(`_${token}`) ||
    key.includes(`_${token}_`)
  );
}

function hasLikelyPan(text) {
  return /\b[A-Z]{5}[0-9]{4}[A-Z]\b/i.test(text || "");
}

function hasLikelyAadhaar(text) {
  return /\b\d{4}\s?\d{4}\s?\d{4}\b/.test(text || "");
}

function hasLikelyDob(text) {
  return /(?:dob|date of birth)[:\s-]*[0-3]?\d[\/-][0-1]?\d[\/-](?:\d{2}|\d{4})/i.test(text || "");
}

function hasLikelyAccountNumber(text) {
  return /(?:account\s*(?:number|no\.?)|a\/c\s*(?:number|no\.?))[:\s-]*[0-9]{9,18}|\b[0-9]{9,18}\b/i.test(text || "");
}

function hasLikelyMsmeNumber(text) {
  return /\bUDYAM-[A-Z]{2}-\d{2}-\d{7}\b/i.test(text || "");
}

function hasLikelyName(text) {
  return /(?:[A-Z][a-z]+|[A-Z]{2,})(?:\s+(?:[A-Z][a-z]+|[A-Z]{2,})){1,3}/.test(text || "");
}

function extractionQualityScore(file, text) {
  const cleaned = sanitizeExtractedText(text);
  const key = file.fieldname || "";
  let score = cleaned.length ? 1 : 0;

  if (hasDocumentToken(key, "pan")) {
    if (hasLikelyPan(cleaned)) score += 4;
    if (hasLikelyName(cleaned)) score += 2;
  }

  if (key.includes("aadhar")) {
    if (hasLikelyAadhaar(cleaned)) score += 4;
    if (hasLikelyDob(cleaned)) score += 2;
    if (hasLikelyName(cleaned)) score += 2;
  }

  if (key === "msme" || key.endsWith("_msme")) {
    if (hasLikelyMsmeNumber(cleaned)) score += 5;
    if (/type of organization/i.test(cleaned)) score += 2;
    if (/official address/i.test(cleaned)) score += 2;
    if (/mobile/i.test(cleaned)) score += 1;
    if (/bank/i.test(cleaned)) score += 1;
  }

  if (key.includes("cheque") || key.includes("gst_bank")) {
    if (hasLikelyAccountNumber(cleaned)) score += 5;
    if (/ifsc|bank/i.test(cleaned)) score += 2;
  }

  if (key.includes("gstr3b")) {
    if (/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/i.test(cleaned)) score += 3;
    if (/legal name of the registered person/i.test(cleaned)) score += 2;
    if (/period/i.test(cleaned) && /year/i.test(cleaned)) score += 2;
  }

  if (key.includes("gst") && !key.includes("gstr3b")) {
    if (/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/i.test(cleaned)) score += 3;
    if (/legal name/i.test(cleaned)) score += 2;
    if (/address/i.test(cleaned)) score += 2;
  }

  return score;
}

function shouldTryCloudOcr(file, text) {
  const cleaned = sanitizeExtractedText(text);
  const key = file.fieldname || "";


if (key.includes("geo_tag")){ return false;}


  if (!runtime.enableCloudOcr) {
    return false;
  }

  if (!cleaned || cleaned.length < 50) {
    return true;
  }

  if (hasDocumentToken(key, "pan")) {
    return !hasLikelyPan(cleaned) || !hasLikelyName(cleaned);
  }

	if (key.includes("aadhar") || key.includes("cheque")) {
	  return true;
	}

  if (key.includes("aadhar")) {
    return !hasLikelyAadhaar(cleaned) || !hasLikelyDob(cleaned) || !hasLikelyName(cleaned);
  }

  if (key.includes("cheque") || key.includes("gst_bank")) {
    return !hasLikelyAccountNumber(cleaned);
  }

  if (key === "msme" || key.endsWith("_msme")) {
    return !hasLikelyMsmeNumber(cleaned) || !/official address|type of organization|name of enterprise/i.test(cleaned);
  }

  return false;
}

async function extractCloudText(filePath) {
  if (runtime.cloudOcrProvider === "google") {
    return extractPdfTextWithGoogleVision(filePath);
  }
  if (runtime.cloudOcrProvider === "ocrspace") {
    return extractPdfTextWithOcrSpace(filePath);
  }
  throw new Error(`Unsupported CLOUD_OCR_PROVIDER: ${runtime.cloudOcrProvider}`);
}

/**
 * Renders PDF pages to images using PDFParse.getScreenshot() and OCRs them.
 * This is the primary fallback for scanned/image-based PDFs (Aadhaar, PAN, cheque etc).
 * Much more reliable than pdf2pic because getScreenshot() is built into our pdf-parse build.
 */
async function extractPdfImagesAndOcr(filePath) {
  let parser;
  try {
    const buffer = await fs.readFile(filePath);
    parser = new PDFParse({ data: buffer });

    const result = await parser.getScreenshot({
      imageDataUrl: false,
      imageBuffer: true,
      desiredWidth: 1600,
      scale: 2,
    });

    const pages = (result && result.pages) || [];
    if (!pages.length) return "";

    let text = "";
    const tempDir = path.join(os.tmpdir(), `pdfocr_${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    for (let i = 0; i < Math.min(pages.length, 5); i++) {
      const pageData = pages[i] && pages[i].data;
      if (!pageData) continue;

      const imgPath = path.join(tempDir, `page_${i + 1}.png`);
      await fs.writeFile(imgPath, pageData);
      try {
        const pageText = await readTextFromImage(imgPath);
        text += "\n" + pageText;
      } catch (e) {
        // ignore per-page OCR error, continue
      }
    }

    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    return text;
  } catch (err) {
    console.warn(`[extractPdfImagesAndOcr] Failed for ${filePath}: ${err.message}`);
    return "";
  } finally {
    if (parser) await parser.destroy().catch(() => {});
  }
}

async function readDocument(file) {
  const extension = path.extname(file.originalname || file.filename || "").toLowerCase();
  const isPdf = extension === ".pdf" || file.mimetype === "application/pdf";

  if (!isPdf) {
    return {
      ...file,
      extractionStatus: "skipped",
      extractedText: "",
      totalPages: 0,
      extractionError: "Only PDF extraction is supported right now.",
    };
  }

  try {
    let { text, totalPages } = await extractPdfText(file.path);

    // Safety: some scanned PDFs report unrealistically high page counts
    if (totalPages > 10) {
      console.warn("?? Suspicious page count:", totalPages);
      totalPages = 1;
    }

    const cleanedText = sanitizeExtractedText(text);
    let bestText = cleanedText;
    let bestRawText = text || cleanedText;
    let bestScore = extractionQualityScore(file, bestText);

    // If this was originally an image, also OCR the source image directly
    if (file.convertedFromImage && file.sourcePath) {
      try {
        const imageOcrRaw = await readTextFromImage(file.sourcePath);
        const imageOcrText = sanitizeExtractedText(imageOcrRaw);
        const imageScore = extractionQualityScore(file, imageOcrText);

        if (imageScore > bestScore || (imageScore === bestScore && imageOcrText.length > bestText.length)) {
          bestText = imageOcrText;
          bestRawText = imageOcrRaw || imageOcrText;
          bestScore = imageScore;
        }
      } catch (error) {
        console.warn(`Image OCR failed for ${file.originalname}: ${error.message}`);
      }
    }

    // Render PDF pages to images using PDFParse.getScreenshot() and OCR them.
    // This handles scanned PDFs where embedded text extraction returns nothing.
    const ocrTextRaw = await extractPdfImagesAndOcr(file.path);
    const ocrText = sanitizeExtractedText(ocrTextRaw);
    const ocrScore = extractionQualityScore(file, ocrText);

    if (ocrScore > bestScore || (ocrScore === bestScore && ocrText.length > bestText.length)) {
      bestText = ocrText;
      bestRawText = ocrTextRaw;
      bestScore = ocrScore;
    }

    // Cloud OCR as final fallback (e.g. Google Vision or OCR Space with a real API key)
    if (shouldTryCloudOcr(file, bestText)) {
      try {
        const cloudText = sanitizeExtractedText(await extractCloudText(file.path));
        const cloudScore = extractionQualityScore(file, cloudText);
        if (cloudScore > bestScore || (cloudScore === bestScore && cloudText.length > bestText.length)) {
          bestText = cloudText;
          bestRawText = cloudText;
          bestScore = cloudScore;
        }
      } catch (error) {
        console.warn(`Cloud OCR failed for ${file.originalname}: ${error.message}`);
      }
    }

    return {
      ...file,
      extractionStatus: bestText ? "success" : "empty",
      extractedText: bestText,
      rawExtractedText: bestRawText,
      totalPages,
      extractionError: bestText ? null : "No readable text found in the PDF.",
    };
  } catch (error) {
    return {
      ...file,
      extractionStatus: "failed",
      extractedText: "",
      totalPages: 0,
      extractionError: error.message,
    };
  }
}

module.exports = {
  extractPdfText,
  readDocument,
};
