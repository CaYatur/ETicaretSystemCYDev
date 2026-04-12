/**
 * Dosya Yükleme Middleware
 * Güvenli dosya yükleme ve boyut kontrolü
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const ALLOWED_IMAGES = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
const ALLOWED_DOCS = ['.pdf'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Yükleme dizinlerini oluştur
const dirs = ['products', 'posts', 'categories', 'site', 'avatars', 'invoices'];
for (const dir of dirs) {
  const fullPath = path.join(UPLOAD_DIR, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
}

/**
 * Dosya depolama yapılandırması
 */
function createStorage(subDir) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const dest = path.join(UPLOAD_DIR, subDir);
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      }
      cb(null, dest);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const uniqueName = crypto.randomBytes(16).toString('hex') + ext;
      cb(null, uniqueName);
    }
  });
}

/**
 * Dosya filtresi - sadece izin verilen türler
 */
function imageFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_IMAGES.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Desteklenmeyen dosya türü. İzin verilen: ' + ALLOWED_IMAGES.join(', ')), false);
  }
}

// Ürün görselleri yükleme
const productUpload = multer({
  storage: createStorage('products'),
  limits: { fileSize: MAX_FILE_SIZE, files: 10 },
  fileFilter: imageFilter
});

// Blog görselleri yükleme
const postUpload = multer({
  storage: createStorage('posts'),
  limits: { fileSize: MAX_FILE_SIZE, files: 5 },
  fileFilter: imageFilter
});

// Kategori görselleri yükleme
const categoryUpload = multer({
  storage: createStorage('categories'),
  limits: { fileSize: MAX_FILE_SIZE, files: 2 },
  fileFilter: imageFilter
});

// Site görselleri (logo, favicon, slider vs.)
const siteUpload = multer({
  storage: createStorage('site'),
  limits: { fileSize: MAX_FILE_SIZE, files: 10 },
  fileFilter: imageFilter
});

// Avatar yükleme
const avatarUpload = multer({
  storage: createStorage('avatars'),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: imageFilter
});

// Fatura PDF yükleme
function pdfFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_DOCS.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Sadece PDF dosyası yüklenebilir.'), false);
  }
}
const invoiceUpload = multer({
  storage: createStorage('invoices'),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: pdfFilter
});

/**
 * Multer hata yakalama wrapper
 */
function handleUploadError(uploadMiddleware) {
  return (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        const messages = {
          LIMIT_FILE_SIZE: 'Dosya boyutu çok büyük (max 5MB).',
          LIMIT_FILE_COUNT: 'Çok fazla dosya yüklendi.',
          LIMIT_UNEXPECTED_FILE: 'Beklenmeyen dosya alanı.'
        };
        const msg = messages[err.code] || `Yükleme hatası: ${err.message}`;
        if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
          return res.status(400).json({ error: msg });
        }
        req.session.flash = { type: 'error', message: msg };
        return res.redirect('back');
      }
      if (err) {
        const msg = err.message || 'Dosya yükleme hatası.';
        if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
          return res.status(400).json({ error: msg });
        }
        req.session.flash = { type: 'error', message: msg };
        return res.redirect('back');
      }
      next();
    });
  };
}

/**
 * Dosya silme
 */
function deleteFile(filePath) {
  try {
    const fullPath = path.join(UPLOAD_DIR, filePath);
    // Path traversal koruması
    if (!fullPath.startsWith(UPLOAD_DIR)) return;
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (e) {
    console.error('Dosya silme hatası:', e.message);
  }
}

module.exports = {
  productUpload,
  postUpload,
  categoryUpload,
  siteUpload,
  avatarUpload,
  invoiceUpload,
  handleUploadError,
  deleteFile,
  UPLOAD_DIR
};
