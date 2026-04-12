/**
 * Kimlik Doğrulama ve Yetkilendirme Middleware
 */

const jwt = require('jsonwebtoken');
const { db } = require('../config/database');

/**
 * Oturum kontrolü - giriş yapmış kullanıcı gerekli
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    const user = db.prepare('SELECT id, email, display_name, phone, role, avatar, email_verified, password_hash, is_active FROM users WHERE id = ? AND is_active = 1').get(req.session.userId);
    if (user) {
      req.user = user;
      return next();
    }
  }
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Oturum açmanız gerekiyor.' });
  }
  req.session.returnTo = req.originalUrl;
  return res.redirect('/auth/login');
}

/**
 * Admin paneli erişim kontrolü
 */
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Oturum açmanız gerekiyor.' });
    }
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/login');
  }

  const user = db.prepare('SELECT id, email, display_name, role, avatar FROM users WHERE id = ? AND is_active = 1').get(req.session.userId);
  if (!user) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Geçersiz oturum.' });
    }
    return res.redirect('/auth/login');
  }

  // admin.access yetkisi kontrol et
  const hasAccess = db.prepare('SELECT id FROM role_permissions WHERE role = ? AND permission = ?').get(user.role, 'admin.access');
  if (!hasAccess) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(403).json({ error: 'Yetkiniz yok.' });
    }
    return res.status(403).render('pages/error', {
      title: 'Erişim Engellendi',
      message: 'Bu sayfaya erişim yetkiniz bulunmamaktadır.'
    });
  }

  req.user = user;
  next();
}

/**
 * Belirli bir yetki kontrolü
 */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Oturum açmanız gerekiyor.' });
    }

    // admin rolü her şeye erişebilir (en üst yetki)
    if (req.user.role === 'admin') {
      return next();
    }

    const hasPerm = db.prepare('SELECT id FROM role_permissions WHERE role = ? AND permission = ?').get(req.user.role, permission);
    if (!hasPerm) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(403).json({ error: 'Bu işlem için yetkiniz yok.' });
      }
      return res.status(403).render('pages/error', {
        title: 'Erişim Engellendi',
        message: 'Bu işlem için yetkiniz bulunmamaktadır.'
      });
    }
    next();
  };
}

/**
 * Opsiyonel kimlik doğrulama - varsa kullanıcı bilgisini ekle
 */
function optionalAuth(req, res, next) {
  if (req.session && req.session.userId) {
    const user = db.prepare('SELECT id, email, display_name, phone, role, avatar, email_verified, password_hash, google_id, cayadev_id FROM users WHERE id = ? AND is_active = 1').get(req.session.userId);
    if (user) {
      req.user = user;
    }
  }
  next();
}

/**
 * CSRF token oluştur ve doğrula
 * Session yazma hatalarına karşı dayanıklı: token, session ID'den
 * deterministik olarak türetilir (HMAC). Session kaydetme başarısız
 * olsa bile aynı session ID ile aynı token tekrar üretilir.
 */
const crypto = require('crypto');
const CSRF_SECRET = process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex');

function generateCsrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.createHmac('sha256', CSRF_SECRET)
      .update(req.sessionID || '')
      .digest('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

function validateCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  const token = req.body._csrf || req.headers['x-csrf-token'];
  // Deterministik token: session ID'den tekrar türet ve karşılaştır
  const expectedToken = req.session.csrfToken ||
    crypto.createHmac('sha256', CSRF_SECRET).update(req.sessionID || '').digest('hex');
  if (!token || token !== expectedToken) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(403).json({ error: 'Geçersiz CSRF token.' });
    }
    return res.status(403).render('pages/error', {
      title: 'Güvenlik Hatası',
      message: 'Form güvenlik doğrulaması başarısız oldu. Lütfen sayfayı yenileyip tekrar deneyin.'
    });
  }
  next();
}

module.exports = {
  requireAuth,
  requireAdmin,
  requirePermission,
  optionalAuth,
  generateCsrfToken,
  validateCsrf
};
