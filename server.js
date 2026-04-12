/**
 * CaYaDev E-Ticaret Altyapı Sistemi
 * Ana Sunucu Dosyası
 */

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const fs = require('fs');

const { loadDatabase, initializeDatabase, seedDefaultData, getSettings } = require('./config/database');
const { securityHeaders, blockSensitiveFiles, trackVisit, sanitizeInput } = require('./middleware/security');
const { generalLimiter } = require('./middleware/rateLimit');
const { optionalAuth, generateCsrfToken } = require('./middleware/auth');

const app = express();
const PORT = parseInt(process.env.PORT) || 3000;

// ==========================================
// VERITABANI BAŞLAT (async - sql.js WASM yüklemesi)
// ==========================================
async function startServer() {
const db = await loadDatabase();
initializeDatabase();
seedDefaultData();

// ==========================================
// GÜVENLİK
// ==========================================
app.use(securityHeaders());
app.use(blockSensitiveFiles);
app.disable('x-powered-by');
app.set('trust proxy', 1);

// ==========================================
// GENEL MIDDLEWARE
// ==========================================
app.use(compression());

// Loglama
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logStream = fs.createWriteStream(path.join(logDir, 'access.log'), { flags: 'a' });
app.use(morgan('combined', { stream: logStream }));
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(sanitizeInput);

// Rate limiting
app.use(generalLimiter);

// ==========================================
// SESSION
// ==========================================
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const sessionDir = path.join(dataDir, 'sessions');
if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

app.use(session({
  store: new FileStore({
    path: sessionDir,
    ttl: 7 * 24 * 60 * 60,
    retries: 5,
    reapInterval: 3600,
    reapAsync: true,
    logFn: function() {}
  }),
  secret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: (process.env.SITE_URL || '').startsWith('https://'),
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 gün
    sameSite: 'lax'
  },
  name: 'sid'
}));

// ==========================================
// TEMPLATE ENGINE
// ==========================================
const ejsMate = require('ejs-mate');
app.engine('ejs', ejsMate);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ==========================================
// STATİK DOSYALAR
// ==========================================
// Root'tan serve et (/images, /css, /js direkt erişilebilir)
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: false,
  lastModified: false
}));
// /public prefix ile de erişilebilir (eski template referansları için)
app.use('/public', express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: false,
  lastModified: false
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: 0,
  etag: false,
  lastModified: false
}));

// ==========================================
// CACHE DEVRE DIŞI
// ==========================================
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// ==========================================
// GLOBAL TEMPLATE DEĞİŞKENLERİ
// ==========================================
app.use(optionalAuth);
app.use(generateCsrfToken);
app.use(trackVisit);

app.use((req, res, next) => {
  let settings;
  try { settings = getSettings(); } catch (e) { settings = {}; }
  
  res.locals.site = {
    name: settings.site_name || 'E-Ticaret',
    description: settings.site_description || '',
    url: settings.site_url || process.env.SITE_URL || `http://localhost:${PORT}`,
    logo: settings.site_logo || '',
    favicon: settings.site_favicon || '',
    announcement: settings.announcement_text || '',
    announcement_cta: settings.announcement_cta || '',
    announcement_url: settings.announcement_url || '/shop',
    keywords: settings.site_keywords || '',
    developer_name: settings.developer_name || 'CaYaDev',
    developer_url: settings.developer_url || 'https://cayadev.com',
    currency: settings.currency || 'TRY',
    currency_symbol: settings.currency_symbol || '₺',
    shop_name: settings.shop_name || 'Mağaza',
    blog_name: settings.blog_name || 'Blog',
    shop_enabled: settings.shop_enabled === '1',
    blog_enabled: settings.blog_enabled === '1',
    shipping_cost: parseFloat(settings.shipping_cost) || 0,
    free_shipping_threshold: parseFloat(settings.free_shipping_threshold) || 0,
    shipping_provider: settings.shipping_provider || '',
    shipping_delivery_time: settings.shipping_delivery_time || '',
    shipping_note: settings.shipping_note || '',
    kdv_enabled: settings.kdv_enabled === '1',
    kdv_rate: parseFloat(settings.kdv_rate) || 0,
    label_add_to_cart: settings.label_add_to_cart || 'Sepete Ekle',
    label_buy_now: settings.label_buy_now || 'Hemen Al',
    label_out_of_stock: settings.label_out_of_stock || 'Stokta Yok',
    show_hero_section: settings.show_hero_section !== '0'
  };

  res.locals.theme = {
    primary: settings.primary_color || '#2563eb',
    secondary: settings.secondary_color || '#1e40af',
    accent: settings.accent_color || '#f59e0b',
    background: settings.background_color || '#ffffff',
    text: settings.text_color || '#1e1b4b',
    headerBg: settings.header_bg || '#ffffff',
    footerBg: settings.footer_bg || '#1f2937',
    fontFamily: settings.font_family || 'Inter, system-ui, sans-serif',
    borderRadius: settings.border_radius || '12'
  };

  res.locals.user = req.user || null;
  res.locals.currentPath = req.path;
  res.locals.csrfToken = req.session.csrfToken || '';
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;

  // Aktif kategorileri header/footer için
  try {
    res.locals.shopCategories = db.prepare("SELECT id, name, slug, icon, color FROM categories WHERE type = 'shop' AND is_active = 1 ORDER BY sort_order").all();
    res.locals.blogCategories = db.prepare("SELECT id, name, slug, icon, color FROM categories WHERE type = 'blog' AND is_active = 1 ORDER BY sort_order").all();
    res.locals.legalPages = db.prepare("SELECT slug, title FROM legal_pages WHERE is_active = 1").all();
    res.locals.contactMethods = db.prepare("SELECT type, value, label, icon FROM contact_methods WHERE is_active = 1 ORDER BY sort_order").all();
    res.locals.activeBacklinks = db.prepare("SELECT title, url, description, icon, nofollow FROM backlinks WHERE is_active = 1 ORDER BY sort_order").all();
  } catch (e) {
    res.locals.shopCategories = [];
    res.locals.blogCategories = [];
    res.locals.legalPages = [];
    res.locals.contactMethods = [];
    res.locals.activeBacklinks = [];
  }

  // Sepet sayısı
  if (req.user) {
    const cart = db.prepare('SELECT SUM(quantity) as count FROM cart_items WHERE user_id = ?').get(req.user.id);
    res.locals.cartCount = cart?.count || 0;
  } else if (req.session.cartSessionId) {
    const cart = db.prepare('SELECT SUM(quantity) as count FROM cart_items WHERE session_id = ?').get(req.session.cartSessionId);
    res.locals.cartCount = cart?.count || 0;
  } else {
    res.locals.cartCount = 0;
  }

  next();
});

// ==========================================
// ROUTE'LAR
// ==========================================
app.use('/', require('./routes/index'));
app.use('/auth', require('./routes/auth'));
app.use('/shop', require('./routes/shop'));
app.use('/blog', require('./routes/blog'));
app.use('/account', require('./routes/account'));
app.use('/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));
app.use('/', require('./routes/sitemap'));

// ==========================================
// 404 SAYFASI
// ==========================================
app.use((req, res) => {
  res.status(404).render('pages/error', {
    title: 'Sayfa Bulunamadı',
    message: 'Aradığınız sayfa bulunamadı.',
    code: 404
  });
});

// ==========================================
// HATA YÖNETİMİ
// ==========================================
app.use((err, req, res, next) => {
  // Session file EPERM errors on Windows — ignore silently
  if (err.code === 'EPERM' || err.code === 'ENOENT') {
    console.warn('Session dosya hatası (sessiz): ' + err.code);
    if (res.headersSent) return next(err);
    return next();
  }

  console.error('Sunucu Hatası:', err);
  
  if (res.headersSent) {
    return next(err);
  }
  
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(500).json({ error: 'Sunucu hatası oluştu.' });
  }
  
  res.status(500).render('pages/error', {
    title: 'Sunucu Hatası',
    message: process.env.NODE_ENV === 'production' ? 'Bir hata oluştu.' : err.message,
    code: 500
  });
});

// ==========================================
// SUNUCUYU BAŞLAT
// ==========================================
app.listen(PORT, () => {
  const settings = getSettings();
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🚀 ${(settings.site_name || 'E-Ticaret Sistemi').padEnd(52)} ║
║                                                               ║
║   Port: ${PORT.toString().padEnd(52)} ║
║   URL:  http://localhost:${PORT.toString().padEnd(38)} ║
║   Mod:  ${(process.env.NODE_ENV || 'development').padEnd(52)} ║
║                                                               ║
║   Durum: ✅ ÇALIŞIYOR                                        ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('⚠️ Sunucu kapatılıyor...');
  db.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('⚠️ Sunucu kapatılıyor...');
  db.close();
  process.exit(0);
});

} // end startServer

startServer().catch(err => {
  console.error('❌ Sunucu başlatılamadı:', err);
  process.exit(1);
});

module.exports = app;
