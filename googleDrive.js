const { google } = require("googleapis");
const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const os = require("os");

// ===== AUTH SETUP =====
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const drive = google.drive({ version: "v3", auth: oauth2Client });


// 📁 CREATE FOLDER
async function createFolder(name) {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
    },
  });
  return res.data.id;
}


// 📤 UPLOAD FILE
async function uploadFile(file, folderId) {
  const response = await drive.files.create({
    requestBody: {
      name: file.originalname,
      parents: [folderId],
    },
    media: {
      mimeType: file.mimetype,
      body: fs.createReadStream(file.path),
    },
    fields: "id,name,webViewLink,webContentLink,mimeType,size",
  });

  return response.data;
}


// 🔗 MAKE FOLDER PUBLIC + return both link and folderId
async function makePublic(folderId) {
  await drive.permissions.create({
    fileId: folderId,
    requestBody: { role: "reader", type: "anyone" },
  });
  return `https://drive.google.com/drive/folders/${folderId}`;
}

function extractFolderId(input) {
  const value = String(input || "").trim();
  if (!value) {
    return null;
  }

  const directIdMatch = value.match(/^[a-zA-Z0-9_-]{10,}$/);
  if (directIdMatch) {
    return directIdMatch[0];
  }

  const urlMatch =
    value.match(/\/folders\/([a-zA-Z0-9_-]+)/) ||
    value.match(/[?&]id=([a-zA-Z0-9_-]+)/);

  return urlMatch ? urlMatch[1] : null;
}


// 📋 LIST FILES IN A FOLDER
async function listFolderFiles(folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id, name, mimeType, size, webViewLink, webContentLink)",
    pageSize: 100,
  });
  return res.data.files || [];
}


// 📥 DOWNLOAD A SINGLE FILE to destPath
async function downloadFile(fileId, destPath) {
  const dest = fs.createWriteStream(destPath);
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );
  return new Promise((resolve, reject) => {
    res.data
      .on("error", reject)
      .pipe(dest)
      .on("finish", resolve)
      .on("error", reject);
  });
}


// 📥 DOWNLOAD ALL FILES FROM A FOLDER into a temp dir
// Returns array of file objects shaped like multer req.files entries.
// Each file also carries _tempDir so cleanup can remove the whole dir.
async function downloadFolderFiles(folderId) {
  const driveFiles = await listFolderFiles(folderId);
  if (!driveFiles.length) return [];

  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "vendor-"));

  const results = await Promise.all(
    driveFiles.map(async (driveFile) => {
      // strip characters that can upset the filesystem
      const safeName = driveFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const destPath = path.join(tempDir, safeName);

      try {
        await downloadFile(driveFile.id, destPath);

        // Derive the fieldname from the filename.
        // Files were uploaded as e.g. "pan.pdf", "aadhar.pdf", "gstr3b_0.pdf" etc.
        // We strip the extension to recover the original fieldname.
        const fieldname = safeName.replace(/\.[^.]+$/, "");

        return {
          fieldname,
          originalname: driveFile.name,
          filename: safeName,
          mimetype: driveFile.mimeType || "application/octet-stream",
          path: destPath,
          size: Number(driveFile.size || 0),
          driveFileId: driveFile.id || null,
          driveWebViewLink: driveFile.webViewLink || null,
          driveDownloadLink: driveFile.webContentLink || null,
          _tempDir: tempDir,
        };
      } catch (err) {
        console.error(`[Drive] Failed to download "${driveFile.name}": ${err.message}`);
        return null;
      }
    })
  );

  return results.filter(Boolean);
}


// 🗑️ DELETE the temp dir created by downloadFolderFiles
async function cleanupTempDir(files) {
  if (!files || !files.length) return;
  const tempDir = files[0]._tempDir;
  if (tempDir) {
    await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}


module.exports = {
  createFolder,
  uploadFile,
  makePublic,
  extractFolderId,
  listFolderFiles,
  downloadFolderFiles,
  cleanupTempDir,
};
