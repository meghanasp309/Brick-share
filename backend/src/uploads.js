// File uploads. ID cards are private, so they are saved on disk under
// UPLOAD_DIR. Property papers are kept in memory and then sent to IPFS.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const config = require("./config");
const { HttpError } = require("./errors");

const ALLOWED = { "image/jpeg": ".jpg", "image/png": ".png", "application/pdf": ".pdf" };
const LIMITS = { fileSize: 5 * 1024 * 1024 }; // 5 MB
const fileFilter = (_req, file, cb) =>
  ALLOWED[file.mimetype] ? cb(null, true) : cb(new HttpError(400, "Only JPG, PNG or PDF files are allowed"));

function uploader(folder) {
  const dir = path.resolve(config.uploadDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (_req, file, cb) => cb(null, crypto.randomUUID() + ALLOWED[file.mimetype]),
    }),
    limits: LIMITS,
    fileFilter,
  });
}

/** Keeps the uploaded file in memory (req.file.buffer), e.g. to send it to IPFS. */
const memoryUploader = () => multer({ storage: multer.memoryStorage(), limits: LIMITS, fileFilter });

module.exports = { uploader, memoryUploader };
