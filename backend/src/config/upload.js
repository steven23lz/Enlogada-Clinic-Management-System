const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

// Feature Gap Plan Phase B: diagnostic result files.
//
// The storage key is built ONLY from server-generated material. It previously interpolated
// `req.params.visitTestId` and an extension taken from the uploader's own filename, both of which
// are attacker-controlled:
//
//   POST /api/results/..%2F..%2Fsrc%2Fscripts%2Fpwn   with filename="payload.js"
//
// Express 5 keeps %2F encoded while matching, so that whole string matches the single :visitTestId
// segment and is then decoded to `../../src/scripts/pwn`. multer's disk storage does a bare
// path.join(destination, filename) with no containment check, so the file lands outside the upload
// directory with an attacker-chosen extension. Worse, multer runs as route middleware, so the
// write happens BEFORE the controller's authorization check ever executes — the 403 that follows
// is too late, the file is already on disk.
//
// Two independent defences, because either alone would be enough and neither is expensive:
//   1. the name is random hex plus an extension mapped from the VALIDATED mime type, so no request
//      value reaches the path at all;
//   2. assertInside() re-checks the resolved path is under the upload root before accepting it.
//
// The uploader's original filename is still preserved in test_results.file_original_name, for
// display on download only — it is never used to build a path.
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'results');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

// Extension is derived from the mime type we accepted, never from the client's filename.
const RESULT_MIME_EXTENSIONS = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
]);
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB

/**
 * Refuses a storage key that would resolve outside its intended directory. The generated names
 * below cannot escape, so this never fires today — it is here so that a future change to the
 * naming scheme fails closed instead of silently reopening the traversal above.
 */
const assertInside = (root, name, cb) => {
  const resolved = path.resolve(root, name);
  if (resolved !== path.join(root, path.basename(name)) || !resolved.startsWith(path.resolve(root) + path.sep)) {
    return cb(new Error('Rejected upload: unsafe storage path.'));
  }
  return cb(null, name);
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_ROOT),
  filename: (req, file, cb) => {
    const ext = RESULT_MIME_EXTENSIONS.get(file.mimetype) || '.bin';
    assertInside(UPLOAD_ROOT, `${crypto.randomBytes(16).toString('hex')}${ext}`, cb);
  }
});

const fileFilter = (req, file, cb) => {
  if (!RESULT_MIME_EXTENSIONS.has(file.mimetype)) {
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

// UI/UX Modernization Phase 8: profile avatars. This path was already safe — `req.user.userId` is
// a server-side integer read from the database by verifyToken, not a request value — but the
// extension still came from the uploader's filename, so it gets the same mime-mapped treatment
// and the same containment assertion as results above.
const AVATAR_UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'avatars');
fs.mkdirSync(AVATAR_UPLOAD_ROOT, { recursive: true });

const AVATAR_MIME_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);
const MAX_AVATAR_SIZE_BYTES = 3 * 1024 * 1024; // 3MB

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_UPLOAD_ROOT),
  filename: (req, file, cb) => {
    const ext = AVATAR_MIME_EXTENSIONS.get(file.mimetype) || '.bin';
    assertInside(AVATAR_UPLOAD_ROOT, `${req.user.userId}-${crypto.randomBytes(16).toString('hex')}${ext}`, cb);
  }
});

const avatarFileFilter = (req, file, cb) => {
  if (!AVATAR_MIME_EXTENSIONS.has(file.mimetype)) {
    return cb(new Error('Unsupported file type. Only JPEG, PNG, and WebP images are allowed.'));
  }
  cb(null, true);
};

const uploadAvatar = multer({
  storage: avatarStorage,
  fileFilter: avatarFileFilter,
  limits: { fileSize: MAX_AVATAR_SIZE_BYTES }
});

const uploadAvatarMiddleware = (req, res, next) => {
  uploadAvatar.single('avatar')(req, res, (err) => {
    if (err) {
      err.statusCode = 400;
      return next(err);
    }
    next();
  });
};

module.exports = { uploadResultFileMiddleware, UPLOAD_ROOT, uploadAvatarMiddleware, AVATAR_UPLOAD_ROOT };
