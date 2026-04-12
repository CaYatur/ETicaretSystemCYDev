/**
 * Rate Limiting Middleware
 * Her endpoint için ayrı rate limiting
 */

const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

function hashIP(ip) {
  return crypto.createHash('sha256').update(ip + (process.env.SESSION_SECRET || 'salt')).digest('hex').substring(0, 16);
}

// Genel sayfa rate limit
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 dakika
  max: 300,
  message: { error: 'Çok fazla istek gönderdiniz. Lütfen bekleyin.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => hashIP(req.ip)
});

// Giriş rate limit
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 10,
  message: { error: 'Çok fazla giriş denemesi. 15 dakika sonra tekrar deneyin.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => hashIP(req.ip),
  skipSuccessfulRequests: true
});

// Kayıt rate limit
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 saat
  max: 5,
  message: { error: 'Çok fazla kayıt denemesi. 1 saat sonra tekrar deneyin.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => hashIP(req.ip)
});

// Şifre sıfırlama rate limit
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Çok fazla şifre sıfırlama talebi. 1 saat sonra tekrar deneyin.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => hashIP(req.ip)
});

// API rate limit
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 180,
  message: { error: 'API istek limiti aşıldı.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => hashIP(req.ip)
});

// Ödeme rate limit
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Çok fazla ödeme denemesi. Lütfen bekleyin.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => hashIP(req.ip)
});

// Admin rate limit
const adminLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 300,
  message: { error: 'Çok fazla istek. Lütfen bekleyin.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => hashIP(req.ip)
});

// Upload rate limit
const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: { error: 'Çok fazla dosya yükleme. Lütfen bekleyin.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => hashIP(req.ip)
});

module.exports = {
  generalLimiter,
  loginLimiter,
  registerLimiter,
  passwordResetLimiter,
  apiLimiter,
  paymentLimiter,
  adminLimiter,
  uploadLimiter
};
