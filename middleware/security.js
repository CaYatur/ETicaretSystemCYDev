/**
 * Güvenlik Middleware
 * XSS, path traversal, injection koruması
 */

const helmet = require('helmet');
const crypto = require('crypto');

/**
 * Helmet güvenlik başlıkları
 */
function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://accounts.google.com", "https://apis.google.com"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", "https://accounts.google.com"],
        frameSrc: ["https://accounts.google.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  });
}

/**
 * Tehlikeli dosya erişimlerini engelle
 */
function blockSensitiveFiles(req, res, next) {
  const blocked = ['.env', '.git', 'node_modules', '.sqlite', 'package.json', 'package-lock.json',
    'server.js', 'smtp-server.js', 'config/', 'middleware/', 'routes/', 'data/', 'logs/'];
  const urlLower = decodeURIComponent(req.path).toLowerCase();

  for (const pattern of blocked) {
    if (urlLower.includes(pattern) && !urlLower.startsWith('/public/') && !urlLower.startsWith('/uploads/')) {
      return res.status(403).send('Erişim engellendi.');
    }
  }

  // Path traversal kontrolü
  if (urlLower.includes('..') || urlLower.includes('%2e%2e') || urlLower.includes('%252e')) {
    return res.status(403).send('Erişim engellendi.');
  }

  next();
}

/**
 * Ziyaret kayıt middleware (analytics)
 */
function trackVisit(req, res, next) {
  // Sadece GET istekleri ve sayfa isteklerini takip et
  if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/public/') ||
      req.path.startsWith('/uploads/') || req.path.includes('.')) {
    return next();
  }

  try {
    const { db } = require('../config/database');
    const ipHash = crypto.createHash('sha256').update(req.ip + new Date().toISOString().split('T')[0]).digest('hex').substring(0, 16);
    
    // Aynı IP + sayfa + gün kombinasyonunu kontrol et (benzersiz ziyaret)
    const today = new Date().toISOString().split('T')[0];
    const existing = db.prepare(`
      SELECT id FROM visits WHERE ip_hash = ? AND page = ? AND created_at >= ?
    `).get(ipHash, req.path, today);

    if (!existing) {
      db.prepare(`
        INSERT INTO visits (page, ip_hash, user_agent, referrer) VALUES (?, ?, ?, ?)
      `).run(req.path, ipHash, (req.headers['user-agent'] || '').substring(0, 255), (req.headers.referer || '').substring(0, 500));
    }
  } catch (e) {
    // Sessiz hata - ziyaret kaydı ana işlevi etkilememeli
  }

  next();
}

/**
 * Giriş sanitizasyonu
 */
function sanitizeInput(req, res, next) {
  function sanitize(obj) {
    if (typeof obj === 'string') {
      // Null bytes temizle
      return obj.replace(/\0/g, '');
    }
    if (typeof obj === 'object' && obj !== null) {
      for (const key of Object.keys(obj)) {
        obj[key] = sanitize(obj[key]);
      }
    }
    return obj;
  }
  if (req.body) req.body = sanitize(req.body);
  if (req.query) req.query = sanitize(req.query);
  if (req.params) req.params = sanitize(req.params);
  next();
}

module.exports = {
  securityHeaders,
  blockSensitiveFiles,
  trackVisit,
  sanitizeInput
};
