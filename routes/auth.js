/**
 * Kimlik Doğrulama Rotaları
 * Giriş, Kayıt, Google OAuth, CaYaDev OAuth, Şifre Sıfırlama
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const axios = require('axios');
const { db } = require('../config/database');
const { validateCsrf } = require('../middleware/auth');
const { loginLimiter, registerLimiter, passwordResetLimiter } = require('../middleware/rateLimit');
const { sendWelcomeEmail, sendVerificationEmail, sendPasswordResetEmail } = require('../config/mail');

// ==========================================
// GİRİŞ
// ==========================================
router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('pages/login', { title: 'Giriş Yap', error: null });
});

router.post('/login', loginLimiter, validateCsrf, (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.render('pages/login', { title: 'Giriş Yap', error: 'E-posta ve şifre gereklidir.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email.trim().toLowerCase());
  if (!user || !user.password_hash) {
    return res.render('pages/login', { title: 'Giriş Yap', error: 'Geçersiz e-posta veya şifre.' });
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.render('pages/login', { title: 'Giriş Yap', error: 'Geçersiz e-posta veya şifre.' });
  }

  // Oturum başlat
  req.session.userId = user.id;
  db.prepare('UPDATE users SET last_login = datetime("now") WHERE id = ?').run(user.id);

  // Misafir sepetini kullanıcıya aktar
  if (req.session.cartSessionId) {
    db.prepare('UPDATE cart_items SET user_id = ?, session_id = NULL WHERE session_id = ?').run(user.id, req.session.cartSessionId);
    delete req.session.cartSessionId;
  }

  const returnTo = req.session.returnTo || '/';
  delete req.session.returnTo;
  req.session.save(() => res.redirect(returnTo));
});

// ==========================================
// KAYIT
// ==========================================
router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('pages/register', { title: 'Kayıt Ol', error: null });
});

router.post('/register', registerLimiter, validateCsrf, async (req, res) => {
  const { email, password, password_confirm, display_name, phone } = req.body;

  // Doğrulama
  if (!email || !password || !display_name) {
    return res.render('pages/register', { title: 'Kayıt Ol', error: 'Tüm alanlar gereklidir.' });
  }

  if (password.length < 8) {
    return res.render('pages/register', { title: 'Kayıt Ol', error: 'Şifre en az 8 karakter olmalıdır.' });
  }

  if (password !== password_confirm) {
    return res.render('pages/register', { title: 'Kayıt Ol', error: 'Şifreler eşleşmiyor.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.render('pages/register', { title: 'Kayıt Ol', error: 'Geçersiz e-posta adresi.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) {
    return res.render('pages/register', { title: 'Kayıt Ol', error: 'Bu e-posta adresi zaten kayıtlı.' });
  }

  // Kullanıcı oluştur
  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare(`
    INSERT INTO users (email, password_hash, display_name, phone, role, email_verified)
    VALUES (?, ?, ?, ?, 'user', 0)
  `).run(cleanEmail, hash, display_name.trim(), phone?.trim() || null);

  // E-posta doğrulama token oluştur
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO email_verifications (user_id, token, expires_at) VALUES (?, ?, ?)').run(result.lastInsertRowid, token, expiresAt);

  const siteUrl = res.locals.site.url;
  const verifyUrl = `${siteUrl}/auth/verify-email/${token}`;

  // Hoş geldiniz e-postası gönder
  try {
    await sendWelcomeEmail({ email: cleanEmail, display_name: display_name.trim() }, verifyUrl);
  } catch (e) {
    console.error('Hoş geldiniz e-postası gönderilemedi:', e.message);
  }

  // Otomatik giriş
  req.session.userId = result.lastInsertRowid;
  
  // Misafir sepetini aktar
  if (req.session.cartSessionId) {
    db.prepare('UPDATE cart_items SET user_id = ?, session_id = NULL WHERE session_id = ?').run(result.lastInsertRowid, req.session.cartSessionId);
    delete req.session.cartSessionId;
  }

  req.session.flash = { type: 'success', message: 'Hesabınız oluşturuldu! E-posta adresinizi doğrulamayı unutmayın.' };
  req.session.save(() => res.redirect('/'));
});

// ==========================================
// E-POSTA DOĞRULAMA
// ==========================================
router.get('/verify-email/:token', (req, res) => {
  const record = db.prepare(`
    SELECT * FROM email_verifications WHERE token = ? AND expires_at > datetime('now')
  `).get(req.params.token);

  if (!record) {
    return res.render('pages/error', { title: 'Geçersiz Link', message: 'Doğrulama linki geçersiz veya süresi dolmuş.', code: 400 });
  }

  db.prepare('UPDATE users SET email_verified = 1, updated_at = datetime("now") WHERE id = ?').run(record.user_id);
  db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(record.user_id);

  req.session.flash = { type: 'success', message: 'E-posta adresiniz doğrulandı!' };
  res.redirect(req.user ? '/account' : '/auth/login');
});

// ==========================================
// ŞİFRE SIFIRLAMA
// ==========================================
router.get('/forgot-password', (req, res) => {
  res.render('pages/forgot-password', { title: 'Şifremi Unuttum', error: null, success: null });
});

router.post('/forgot-password', passwordResetLimiter, validateCsrf, async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.render('pages/forgot-password', { title: 'Şifremi Unuttum', error: 'E-posta adresi gereklidir.', success: null });
  }

  const user = db.prepare('SELECT id, email, display_name FROM users WHERE email = ? AND is_active = 1').get(email.trim().toLowerCase());
  
  // Kullanıcı bulunamazsa bile aynı mesajı göster (güvenlik)
  if (user) {
    // Eski tokenları temizle
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
    
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 saat
    db.prepare('INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, token, expiresAt);

    const siteUrl = res.locals.site.url;
    const resetUrl = `${siteUrl}/auth/reset-password/${token}`;
    try {
      await sendPasswordResetEmail(user, resetUrl);
    } catch (e) {
      console.error('Şifre sıfırlama e-postası gönderilemedi:', e.message);
    }
  }

  res.render('pages/forgot-password', {
    title: 'Şifremi Unuttum',
    error: null,
    success: 'Eğer bu e-posta adresiyle kayıtlı bir hesap varsa, şifre sıfırlama linki gönderildi.'
  });
});

router.get('/reset-password/:token', (req, res) => {
  const record = db.prepare("SELECT * FROM password_resets WHERE token = ? AND expires_at > datetime('now')").get(req.params.token);
  if (!record) {
    return res.render('pages/error', { title: 'Geçersiz Link', message: 'Şifre sıfırlama linki geçersiz veya süresi dolmuş.', code: 400 });
  }
  res.render('pages/reset-password', { title: 'Şifre Sıfırla', token: req.params.token, error: null });
});

router.post('/reset-password/:token', validateCsrf, (req, res) => {
  const { password, password_confirm } = req.body;
  const record = db.prepare("SELECT * FROM password_resets WHERE token = ? AND expires_at > datetime('now')").get(req.params.token);
  
  if (!record) {
    return res.render('pages/error', { title: 'Geçersiz Link', message: 'Şifre sıfırlama linki geçersiz veya süresi dolmuş.', code: 400 });
  }

  if (!password || password.length < 8) {
    return res.render('pages/reset-password', { title: 'Şifre Sıfırla', token: req.params.token, error: 'Şifre en az 8 karakter olmalıdır.' });
  }

  if (password !== password_confirm) {
    return res.render('pages/reset-password', { title: 'Şifre Sıfırla', token: req.params.token, error: 'Şifreler eşleşmiyor.' });
  }

  const hash = bcrypt.hashSync(password, 12);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?').run(hash, record.user_id);
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(record.user_id);

  req.session.flash = { type: 'success', message: 'Şifreniz başarıyla sıfırlandı. Giriş yapabilirsiniz.' };
  res.redirect('/auth/login');
});

// ==========================================
// GOOGLE OAUTH
// ==========================================
router.get('/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.render('pages/error', { title: 'Hata', message: 'Google OAuth yapılandırılmamış.', code: 500 });
  }

  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${res.locals.site.url}/auth/google/callback`;
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=openid%20email%20profile&` +
    `state=${state}&` +
    `access_type=offline`;

  req.session.save(() => res.redirect(authUrl));
});

router.get('/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!state || state !== req.session.oauthState) {
      return res.render('pages/error', { title: 'Hata', message: 'Geçersiz OAuth durumu.', code: 400 });
    }
    delete req.session.oauthState;

    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${res.locals.site.url}/auth/google/callback`;

    // Token al
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    }));

    // Kullanıcı bilgilerini al
    const userInfo = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
    });

    const { id: googleId, email, name, picture } = userInfo.data;

    // Kullanıcıyı bul veya oluştur
    let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
    if (!user) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (user) {
        // Mevcut hesaba Google ID bağla
        db.prepare('UPDATE users SET google_id = ?, avatar = COALESCE(avatar, ?), updated_at = datetime("now") WHERE id = ?').run(googleId, picture, user.id);
      } else {
        // Yeni kullanıcı
        const result = db.prepare(`
          INSERT INTO users (email, display_name, google_id, avatar, role, email_verified, is_active)
          VALUES (?, ?, ?, ?, 'user', 1, 1)
        `).run(email, name, googleId, picture);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
      }
    }

    if (!user.is_active) {
      return res.render('pages/error', { title: 'Hesap Engelli', message: 'Hesabınız devre dışı bırakılmış.', code: 403 });
    }

    req.session.userId = user.id;
    db.prepare('UPDATE users SET last_login = datetime("now") WHERE id = ?').run(user.id);

    // Misafir sepetini aktar
    if (req.session.cartSessionId) {
      db.prepare('UPDATE cart_items SET user_id = ?, session_id = NULL WHERE session_id = ?').run(user.id, req.session.cartSessionId);
      delete req.session.cartSessionId;
    }

    const returnTo = req.session.returnTo || '/';
    delete req.session.returnTo;
    req.session.save(() => res.redirect(returnTo));
  } catch (error) {
    console.error('Google OAuth hatası:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      stack: error.stack?.split('\n')[1]
    });
    return res.render('pages/error', { title: 'Giriş Hatası', message: 'Google ile giriş başarısız oldu.', code: 500 });
  }
});

// ==========================================
// CAYADEV OAUTH
// ==========================================
router.get('/cayadev', (req, res) => {
  const clientId = process.env.CAYADEV_CLIENT_ID;
  if (!clientId) {
    return res.render('pages/error', { title: 'Hata', message: 'CaYaDev OAuth yapılandırılmamış.', code: 500 });
  }

  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const redirectUri = process.env.CAYADEV_REDIRECT_URI || `${res.locals.site.url}/auth/cayadev/callback`;
  const authUrl = `https://cayadev.com/oauth/authorize?` +
    `client_id=${encodeURIComponent(clientId)}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=profile:read%20email:read&` +
    `state=${state}`;

  req.session.save(() => res.redirect(authUrl));
});

router.get('/cayadev/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!state || state !== req.session.oauthState) {
      return res.render('pages/error', { title: 'Hata', message: 'Geçersiz OAuth durumu.', code: 400 });
    }
    delete req.session.oauthState;

    const redirectUri = process.env.CAYADEV_REDIRECT_URI || `${res.locals.site.url}/auth/cayadev/callback`;

    // Token al
    const tokenRes = await axios.post('https://cayadev.com/oauth/token', new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: process.env.CAYADEV_CLIENT_ID,
      client_secret: process.env.CAYADEV_CLIENT_SECRET
    }));

    const { access_token } = tokenRes.data;

    // Kullanıcı bilgilerini al
    const userInfo = await axios.get('https://cayadev.com/oauth/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const { sub: cayadevId, email, display_name, username, avatar } = userInfo.data;

    // Kullanıcıyı bul veya oluştur
    let user = db.prepare('SELECT * FROM users WHERE cayadev_id = ?').get(cayadevId);
    if (!user && email) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (user) {
        db.prepare('UPDATE users SET cayadev_id = ?, avatar = COALESCE(avatar, ?), updated_at = datetime("now") WHERE id = ?').run(cayadevId, avatar, user.id);
      } else {
        const result = db.prepare(`
          INSERT INTO users (email, display_name, cayadev_id, avatar, role, email_verified, is_active)
          VALUES (?, ?, ?, ?, 'user', 1, 1)
        `).run(email, display_name || username, cayadevId, avatar);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
      }
    }

    if (!user || !user.is_active) {
      return res.render('pages/error', { title: 'Giriş Hatası', message: 'Hesap bulunamadı veya devre dışı.', code: 403 });
    }

    req.session.userId = user.id;
    db.prepare('UPDATE users SET last_login = datetime("now") WHERE id = ?').run(user.id);

    if (req.session.cartSessionId) {
      db.prepare('UPDATE cart_items SET user_id = ?, session_id = NULL WHERE session_id = ?').run(user.id, req.session.cartSessionId);
      delete req.session.cartSessionId;
    }

    const returnTo = req.session.returnTo || '/';
    delete req.session.returnTo;
    req.session.save(() => res.redirect(returnTo));
  } catch (error) {
    console.error('CaYaDev OAuth hatası:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      stack: error.stack?.split('\n')[1]
    });
    return res.render('pages/error', { title: 'Giriş Hatası', message: 'CaYaDev ile giriş başarısız oldu.', code: 500 });
  }
});

// ==========================================
// ÇIKIŞ
// ==========================================
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    res.redirect('/');
  });
});

router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    res.redirect('/');
  });
});

module.exports = router;
