require("dotenv").config();

const path = require("path");
const { readDocument } = require("../services/pdfReader");
const { validateSubmission } = require("../services/validation");

function usage() {
  console.log(
    'Usage: node scripts/review-single-document.js <fieldname> "<absolute-or-relative-file-path>"'
  );
}

async function main() {
  const [, , fieldname, inputPath] = process.argv;

  if (!fieldname || !inputPath) {
    usage();
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), inputPath);
  const document = await readDocument({
    fieldname,
    originalname: path.basename(resolvedPath),
    filename: path.basename(resolvedPath),
    mimetype: "application/pdf",
    path: resolvedPath,
  });

  const validation = validateSubmission(
    {
      name: "Test Vendor",
      phone: "9999999999",
      email: "test@example.com",
      constitution: "Proprietorship",
      vendorType: "Recycler",
      product: "PET Bottles",
      hsn: "1234",
    },
    [document]
  );

  console.log(
    JSON.stringify(
      {
        document: {
          fieldname: document.fieldname,
          originalname: document.originalname,
          extractionStatus: document.extractionStatus,
          extractionError: document.extractionError,
          totalPages: document.totalPages,
          textPreview: document.extractedText.slice(0, 1000),
        },
        validation,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
