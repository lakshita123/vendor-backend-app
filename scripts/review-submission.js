require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const { processSubmission } = require("../services/documentProcessor");

function usage() {
  console.log(
    'Usage: node scripts/review-submission.js "<manifest.json>"'
  );
}

async function loadManifest(manifestPath) {
  const raw = await fs.readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw);

  const submission = parsed.submission || {};
  const baseDir = parsed.baseDir
    ? path.resolve(path.dirname(manifestPath), parsed.baseDir)
    : path.dirname(manifestPath);

  const files = (parsed.files || []).map((file) => ({
    fieldname: file.fieldname,
    originalname: path.basename(file.path),
    filename: path.basename(file.path),
    mimetype: file.mimetype || "application/pdf",
    path: path.resolve(baseDir, file.path),
  }));

  return { submission, files, driveFolderLink: parsed.driveFolderLink || null };
}

async function main() {
  const [, , manifestArg] = process.argv;

  if (!manifestArg) {
    usage();
    process.exit(1);
  }

  const manifestPath = path.resolve(process.cwd(), manifestArg);
  const payload = await loadManifest(manifestPath);

  const transporter = {
    async sendMail(mail) {
      console.log("Mock mail send");
      console.log(`To: ${mail.to || "missing"}`);
      console.log(`Subject: ${mail.subject}`);
      if (mail.attachments?.[0]?.path) {
        console.log(`Attachment: ${mail.attachments[0].path}`);
      }
    },
  };

  const result = await processSubmission({
    ...payload,
    transporter,
  });

  console.log(
    JSON.stringify(
      {
        sent: result.sent,
        reason: result.reason || null,
        reportPath: result.reportPath || null,
        validation: result.validation,
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
