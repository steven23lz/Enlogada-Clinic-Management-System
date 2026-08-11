const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

// Feature Gap Plan Phase B: diagnostic result files. Storage key is server-generated
// (visitTestId + random hex), never the client-submitted filename — closes off path traversal
// and filename-collision risk. The original name is preserved separately in
// test_results.file_original_name for display/download purposes only.
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'results');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_ROOT),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 10);
    const safeName = `${req.params.visitTestId}-${crypto.randomBytes(16).toString('hex')}${ext}`;
    cb(null, safeName);
  }
});

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(new Error('Unsupported file type. Only PDF, JPEG, and PNG files are allowed.'));
  }
  cb(null, true);
};

const uploadResultFile = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES }
});

// multer's own errors (wrong type, too large) don't carry a statusCode, so errorHandler.js would
// otherwise report them as a generic 500 — this normalizes them to a 400 with the real message.
const uploadResultFileMiddleware = (req, res, next) => {
  uploadResultFile.single('file')(req, res, (err) => {
    if (err) {
      err.statusCode = 400;
      return next(err);
    }
    next();
  });
};

module.exports = { uploadResultFileMiddleware, UPLOAD_ROOT };
