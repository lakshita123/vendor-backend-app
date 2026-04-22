const fs = require("fs/promises");
const { PDFParse } = require("pdf-parse");

async function withParser(filePath, handler) {
  const buffer = await fs.readFile(filePath);
  const parser = new PDFParse({ data: buffer });

  try {
    return await handler(parser);
  } finally {
    await parser.destroy();
  }
}

async function extractEmbeddedImageBuffers(filePath) {
  try {
    return await withParser(filePath, async (parser) => {
      const result = await parser.getImage({
        imageDataUrl: false,
        imageBuffer: true,
        imageThreshold: 0,
      });

      return result.pages.flatMap((page) =>
        (page.images || []).map((image) => image.data).filter(Boolean)
      );
    });
  } catch (err) {
    console.warn("[pdfImageExtractor] extractEmbeddedImageBuffers failed:", err.message);
    return [];
  }
}

async function extractRenderedFirstPageBuffer(filePath) {
  try {
    return await withParser(filePath, async (parser) => {
      const result = await parser.getScreenshot({
        first: 1,
        imageDataUrl: false,
        imageBuffer: true,
        desiredWidth: 2200,
        scale: 2,
      });

      const firstPage = result.pages && result.pages[0];
      return firstPage && firstPage.data ? firstPage.data : null;
    });
  } catch (err) {
    console.warn("[pdfImageExtractor] extractRenderedFirstPageBuffer failed:", err.message);
    return null;
  }
}

async function extractRenderedPageBuffers(filePath) {
  try {
    return await withParser(filePath, async (parser) => {
      const result = await parser.getScreenshot({
        imageDataUrl: false,
        imageBuffer: true,
        desiredWidth: 2200,
        scale: 2,
      });

      return (result.pages || []).map((page) => page.data).filter(Boolean);
    });
  } catch (err) {
    console.warn("[pdfImageExtractor] extractRenderedPageBuffers failed:", err.message);
    return [];
  }
}

module.exports = {
  extractEmbeddedImageBuffers,
  extractRenderedFirstPageBuffer,
  extractRenderedPageBuffers,
};
