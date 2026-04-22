const vision = require("@google-cloud/vision");
const {
  extractEmbeddedImageBuffers,
  extractRenderedFirstPageBuffer,
} = require("./pdfImageExtractor");

let client;

function getClient() {
  if (!client) {
    const options = {};

    if (process.env.GOOGLE_CLOUD_VISION_KEYFILE) {
      options.keyFilename = process.env.GOOGLE_CLOUD_VISION_KEYFILE;
    }

    client = new vision.ImageAnnotatorClient(options);
  }

  return client;
}

async function detectDocumentTextFromBuffer(buffer) {
  const image = { content: buffer };
  const [result] = await getClient().documentTextDetection({ image });
  return (result.fullTextAnnotation && result.fullTextAnnotation.text) || "";
}

async function extractPdfTextWithGoogleVision(filePath) {
  const imageBuffers = await extractEmbeddedImageBuffers(filePath);

  for (const imageBuffer of imageBuffers) {
    const text = (await detectDocumentTextFromBuffer(imageBuffer)).trim();
    if (text) {
      return text;
    }
  }

  const renderedPage = await extractRenderedFirstPageBuffer(filePath);
  if (!renderedPage) {
    return "";
  }

  return (await detectDocumentTextFromBuffer(renderedPage)).trim();
}

module.exports = {
  extractPdfTextWithGoogleVision,
};
