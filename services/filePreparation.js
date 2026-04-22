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
      const pipeline = sharp(imagePath).rotate();
      const metadata = await pipeline.metadata();
      const imageBuffer = await pipeline.jpeg({ quality: 92 }).toBuffer();
      const width = Math.max(1, metadata.width || 1200);
      const height = Math.max(1, metadata.height || 1600);

      const document = new PDFDocument({
        autoFirstPage: false,
        compress: true,
      });
      const stream = fs.createWriteStream(pdfPath);

      document.pipe(stream);
      document.addPage({
        size: [width, height],
        margin: 0,
      });
      document.image(imageBuffer, 0, 0, {
        fit: [width, height],
        align: "center",
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




async function preprocessImage(inputPath, outputPath) {
  await sharp(inputPath)
    .rotate()
    .grayscale()
    .normalize()
    .toFile(outputPath);
}

async function prepareUploadedFiles(files) {
  return Promise.all(
    (files || []).map(async (file) => {
      if (!isImageFile(file)) {
		
        return file;
      }

      const baseName = path.basename(file.originalname || file.filename || "upload", path.extname(file.originalname || file.filename || ""));
      const pdfPath = path.join(path.dirname(file.path), `${path.basename(file.path, path.extname(file.path))}.pdf`);

      const processedPath = file.path.replace(/(\.\w+)$/, "_processed$1");

	  await preprocessImage(file.path, processedPath);
	  await createPdfFromImage(processedPath, pdfPath);

      return {
        ...file,
        originalname: `${baseName}.pdf`,
        filename: path.basename(pdfPath),
        mimetype: "application/pdf",
        path: pdfPath,
        convertedFromImage: true,
        sourcePath: file.path,
        sourceOriginalname: file.originalname,
        sourceMimetype: file.mimetype,
      };
    })
  );
}

module.exports = {
  prepareUploadedFiles,
};
