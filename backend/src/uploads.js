// File uploads (ID cards, property papers). Saved on disk under UPLOAD_DIR.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const config = require("./config");
const { HttpError } = require("./errors");

const ALLOWED = { "image/jpeg": ".jpg", "image/png": ".png", "application/pdf": ".pdf" };

function uploader(folder) {
  const dir = path.resolve(config.uploadDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (_req, file, cb) => cb(null, crypto.randomUUID() + ALLOWED[file.mimetype]),
    }),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter: (_req, file, cb) =>
      ALLOWED[file.mimetype] ? cb(null, true) : cb(new HttpError(400, "Only JPG, PNG or PDF files are allowed")),
  });
}

/** SHA-256 fingerprint of a file. Anyone can re-check it to prove the file wasn't changed. */
const fileHash = (filePath) =>
  "sha256:" + crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

module.exports = { uploader, fileHash };
