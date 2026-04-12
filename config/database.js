/**
 * Veritabanı Yapılandırması ve Şema Yönetimi
 * sql.js ile kapsamlı e-ticaret veritabanı (pure JS - native derleme gerektirmez)
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'database.sqlite');

/**
 * sql.js için better-sqlite3 uyumlu wrapper
 */
class DatabaseWrapper {
  constructor(sqlDb, dbPath) {
    this._db = sqlDb;
    this._path = dbPath;
    this._saveTimer = null;
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._saveToDisk();
    }, 100);
  }

  _saveToDisk() {
    try {
      const data = this._db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this._path, buffer);
    } catch (e) {
      console.error('DB save error:', e.message);
    }
  }

  saveNow() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._saveToDisk();
  }

  exec(sql) {
    this._db.run(sql);
    this._scheduleSave();
  }

  pragma(sql) {
    try { this._db.run('PRAGMA ' + sql); } catch (e) { /* ignore unsupported pragmas */ }
  }

  prepare(sql) {
    const self = this;
    return {
      get(...params) {
        let stmt;
        try {
          stmt = self._db.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          if (stmt.step()) {
            return stmt.getAsObject();
          }
          return undefined;
        } finally {
          if (stmt) stmt.free();
        }
      },
      all(...params) {
        const results = [];
        let stmt;
        try {
          stmt = self._db.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          while (stmt.step()) {
            results.push(stmt.getAsObject());
          }
        } finally {
          if (stmt) stmt.free();
        }
        return results;
      },
      run(...params) {
        let stmt;
        try {
          stmt = self._db.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          stmt.step();
        } finally {
          if (stmt) stmt.free();
        }
        self._scheduleSave();
        const changes = self._db.getRowsModified();
        // sql.js doesn't directly expose lastInsertRowid on statement, handle via exec
        let lastInsertRowid;
        try {
          const ridStmt = self._db.prepare('SELECT last_insert_rowid() as rid');
          ridStmt.step();
          lastInsertRowid = ridStmt.getAsObject().rid;
          ridStmt.free();
        } catch (e) {
          lastInsertRowid = 0;
        }
        return { changes, lastInsertRowid };
      },
      pluck() {
        const self2 = this;
        return {
          get(...params) {
            const row = self2.get(...params);
            if (!row) return undefined;
            return Object.values(row)[0];
          },
          all(...params) {
            const rows = self2.all(...params);
            return rows.map(r => Object.values(r)[0]);
          }
        };
      }
    };
  }

  transaction(fn) {
    const self = this;
    return function (...args) {
      self._db.run('BEGIN TRANSACTION');
      try {
        const result = fn(...args);
        self._db.run('COMMIT');
        self._scheduleSave();
        return result;
      } catch (e) {
        self._db.run('ROLLBACK');
        throw e;
      }
    };
  }

  close() {
    this.saveNow();
    this._db.close();
  }
}

// Senkron başlatma - sql.js WASM'ı yüklenmeli
let db = null;
let dbReady = null;

function loadDatabase() {
  if (db) return Promise.resolve(db);
  if (dbReady) return dbReady;

  dbReady = initSqlJs().then((SQL) => {
    let sqlDb;
    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      sqlDb = new SQL.Database(fileBuffer);
    } else {
      sqlDb = new SQL.Database();
    }
    db = new DatabaseWrapper(sqlDb, DB_PATH);
    // Performans pragmaları
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    return db;
  });
  return dbReady;
}

/**
 * Veritabanı tablolarını oluştur
 */
function initializeDatabase() {
  db.exec(`
    -- ==========================================
    -- KULLANICI SİSTEMİ
    -- ==========================================
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      display_name TEXT NOT NULL,
      phone TEXT,
      role TEXT DEFAULT 'user',
      google_id TEXT UNIQUE,
      cayadev_id TEXT UNIQUE,
      avatar TEXT,
      email_verified INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      last_login TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Rol bazlı yetkilendirme
    CREATE TABLE IF NOT EXISTS role_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      permission TEXT NOT NULL,
      UNIQUE(role, permission)
    );

    -- ==========================================
    -- KATEGORİ SİSTEMİ
    -- ==========================================
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL DEFAULT 'shop',
      description TEXT,
      parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      icon TEXT,
      image TEXT,
      color TEXT DEFAULT '#333333',
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ==========================================
    -- MAĞAZA SİSTEMİ
    -- ==========================================
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      content TEXT,
      price REAL NOT NULL,
      sale_price REAL,
      stock INTEGER DEFAULT -1,
      stock_visible INTEGER DEFAULT 0,
      cover_image TEXT,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      is_active INTEGER DEFAULT 1,
      is_featured INTEGER DEFAULT 0,
      meta_title TEXT,
      meta_description TEXT,
      view_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      image_path TEXT NOT NULL,
      alt_text TEXT,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS product_filters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'select',
      options TEXT,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS product_filter_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      filter_id INTEGER NOT NULL REFERENCES product_filters(id) ON DELETE CASCADE,
      value TEXT NOT NULL
    );

    -- ==========================================
    -- SEPET SİSTEMİ
    -- ==========================================
    CREATE TABLE IF NOT EXISTS cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ==========================================
    -- SİPARİŞ SİSTEMİ
    -- ==========================================
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      order_number TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'pending',
      total REAL NOT NULL,
      payment_method TEXT NOT NULL,
      payment_status TEXT DEFAULT 'pending',
      payment_ref TEXT,
      payment_code TEXT UNIQUE,
      billing_profile_id INTEGER REFERENCES billing_profiles(id),
      shipping_address_id INTEGER REFERENCES addresses(id),
      phone TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id),
      title TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      cover_image TEXT
    );

    -- ==========================================
    -- FATURALANDIRMA SİSTEMİ
    -- ==========================================
    CREATE TABLE IF NOT EXISTS billing_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'individual',
      first_name TEXT,
      last_name TEXT,
      tc_no TEXT,
      company_name TEXT,
      tax_office TEXT,
      tax_no TEXT,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      district TEXT,
      zip_code TEXT,
      country TEXT DEFAULT 'Türkiye',
      phone TEXT,
      email TEXT,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ==========================================
    -- ADRES SİSTEMİ
    -- ==========================================
    CREATE TABLE IF NOT EXISTS addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      district TEXT,
      zip_code TEXT,
      country TEXT DEFAULT 'Türkiye',
      phone TEXT,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ==========================================
    -- BLOG / GÖNDERİ SİSTEMİ
    -- ==========================================
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      content TEXT NOT NULL,
      excerpt TEXT,
      cover_image TEXT,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      author_id INTEGER NOT NULL REFERENCES users(id),
      is_published INTEGER DEFAULT 0,
      meta_title TEXT,
      meta_description TEXT,
      view_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ==========================================
    -- SİTE AYARLARI
    -- ==========================================
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      group_name TEXT DEFAULT 'general',
      type TEXT DEFAULT 'text',
      label TEXT,
      sort_order INTEGER DEFAULT 0
    );

    -- ==========================================
    -- YASAL SAYFALAR
    -- ==========================================
    CREATE TABLE IF NOT EXISTS legal_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ==========================================
    -- BACKLINK SİSTEMİ
    -- ==========================================
    CREATE TABLE IF NOT EXISTS backlinks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      description TEXT,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      icon TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      nofollow INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ==========================================
    -- İLETİŞİM YÖNTEMLERİ
    -- ==========================================
    CREATE TABLE IF NOT EXISTS contact_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      label TEXT,
      icon TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );

    -- ==========================================
    -- ZİYARET İSTATİSTİKLERİ
    -- ==========================================
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page TEXT NOT NULL,
      ip_hash TEXT NOT NULL,
      user_agent TEXT,
      referrer TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ==========================================
    -- ÖDEME AYARLARI
    -- ==========================================
    CREATE TABLE IF NOT EXISTS payment_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      method TEXT NOT NULL UNIQUE,
      config TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER DEFAULT 0
    );

    -- ==========================================
    -- E-POSTA DOĞRULAMA
    -- ==========================================
    CREATE TABLE IF NOT EXISTS email_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ==========================================
    -- ŞİFRE SIFIRLAMA
    -- ==========================================
    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ==========================================
    -- ANASAYFA BÖLÜMLERİ
    -- ==========================================
    CREATE TABLE IF NOT EXISTS homepage_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT,
      subtitle TEXT,
      content TEXT DEFAULT '{}',
      style TEXT DEFAULT '{}',
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );

    -- ==========================================
    -- ANASAYFA SLAYT SİSTEMİ
    -- ==========================================
    CREATE TABLE IF NOT EXISTS homepage_slides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image TEXT NOT NULL,
      title TEXT,
      subtitle TEXT,
      button_text TEXT,
      button_url TEXT DEFAULT '/shop',
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ==========================================
    -- İNDEXLER
    -- ==========================================
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
    CREATE INDEX IF NOT EXISTS idx_users_cayadev_id ON users(cayadev_id);
    CREATE INDEX IF NOT EXISTS idx_categories_type ON categories(type);
    CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
    CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
    CREATE INDEX IF NOT EXISTS idx_cart_user ON cart_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_cart_session ON cart_items(session_id);
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_number ON orders(order_number);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
    CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(is_published);
    CREATE INDEX IF NOT EXISTS idx_visits_created ON visits(created_at);
    CREATE INDEX IF NOT EXISTS idx_visits_page ON visits(page);
    CREATE INDEX IF NOT EXISTS idx_billing_user ON billing_profiles(user_id);
    CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id);
  `);

  // Migrate: Add bg_image column to categories if not exists
  try {
    const cols = db.prepare("PRAGMA table_info(categories)").all();
    if (!cols.find(c => c.name === 'bg_image')) {
      db.exec("ALTER TABLE categories ADD COLUMN bg_image TEXT");
    }
  } catch (e) { /* column might already exist */ }

  // Migrate: Add tracking columns to orders if not exists
  try {
    const orderCols = db.prepare("PRAGMA table_info(orders)").all();
    if (!orderCols.find(c => c.name === 'tracking_url')) {
      db.exec("ALTER TABLE orders ADD COLUMN tracking_url TEXT");
    }
    if (!orderCols.find(c => c.name === 'tracking_code')) {
      db.exec("ALTER TABLE orders ADD COLUMN tracking_code TEXT");
    }
    if (!orderCols.find(c => c.name === 'cargo_provider')) {
      db.exec("ALTER TABLE orders ADD COLUMN cargo_provider TEXT");
    }
    if (!orderCols.find(c => c.name === 'invoice_url')) {
      db.exec("ALTER TABLE orders ADD COLUMN invoice_url TEXT");
    }
  } catch (e) { /* columns might already exist */ }
}

/**
 * Varsayılan verileri ekle
 */
function seedDefaultData() {
  const existingAdmin = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (!existingAdmin) {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@cayadev.com';
    const adminPassword = process.env.ADMIN_PASSWORD || require('crypto').randomBytes(12).toString('base64url');
    if (!process.env.ADMIN_PASSWORD) console.warn('⚠️ ADMIN_PASSWORD tanımlı değil; rastgele admin şifresi üretildi: ' + adminPassword);
    const adminName = process.env.ADMIN_NAME || 'Site Yöneticisi';
    const hash = bcrypt.hashSync(adminPassword, 12);

    db.prepare(`
      INSERT INTO users (email, password_hash, display_name, role, email_verified, is_active)
      VALUES (?, ?, ?, 'admin', 1, 1)
    `).run(adminEmail, hash, adminName);

    console.log(`✅ Varsayılan admin hesabı oluşturuldu: ${adminEmail}`);
  }

  // Varsayılan roller ve yetkiler
  const defaultPermissions = {
    admin: [
      'admin.access', 'admin.dashboard',
      'products.view', 'products.create', 'products.edit', 'products.delete',
      'categories.view', 'categories.create', 'categories.edit', 'categories.delete',
      'orders.view', 'orders.edit', 'orders.manage',
      'users.view', 'users.edit', 'users.manage',
      'posts.view', 'posts.create', 'posts.edit', 'posts.delete',
      'settings.view', 'settings.edit',
      'analytics.view',
      'legal.view', 'legal.edit',
      'backlinks.view', 'backlinks.edit',
      'contact.view', 'contact.edit',
      'homepage.view', 'homepage.edit',
      'payments.view', 'payments.edit',
      'permissions.view', 'permissions.edit'
    ],
    editor: [
      'admin.access', 'admin.dashboard',
      'posts.view', 'posts.create', 'posts.edit', 'posts.delete',
      'products.view',
      'categories.view',
      'analytics.view'
    ],
    moderator: [
      'admin.access', 'admin.dashboard',
      'orders.view', 'orders.edit',
      'users.view',
      'products.view',
      'categories.view',
      'analytics.view'
    ]
  };

  const insertPerm = db.prepare('INSERT OR IGNORE INTO role_permissions (role, permission) VALUES (?, ?)');
  const insertMany = db.transaction((perms) => {
    for (const [role, permissions] of Object.entries(perms)) {
      for (const perm of permissions) {
        insertPerm.run(role, perm);
      }
    }
  });
  insertMany(defaultPermissions);

  // Varsayılan site ayarları
  const defaultSettings = [
    // Genel
    ['site_name', 'CaYaDev Ticaret', 'general', 'text', 'Site Adı', 1],
    ['site_description', 'Profesyonel E-Ticaret Sistemi', 'general', 'text', 'Site Açıklaması', 2],
    ['site_url', process.env.SITE_URL || 'http://localhost:3000', 'general', 'text', 'Site URL', 3],
    ['site_logo', '', 'general', 'image', 'Site Logo', 4],
    ['site_favicon', '', 'general', 'image', 'Favicon', 5],
    ['site_keywords', 'e-ticaret, online mağaza', 'general', 'text', 'Anahtar Kelimeler', 6],
    ['developer_name', 'CaYaDev', 'general', 'text', 'Geliştirici Adı', 7],
    ['developer_url', 'https://cayadev.com', 'general', 'text', 'Geliştirici URL', 8],
    ['currency', 'TRY', 'general', 'text', 'Para Birimi', 9],
    ['currency_symbol', '₺', 'general', 'text', 'Para Birimi Simgesi', 10],

    // Tema
    ['primary_color', '#2563eb', 'theme', 'color', 'Ana Renk', 1],
    ['secondary_color', '#1e40af', 'theme', 'color', 'İkincil Renk', 2],
    ['accent_color', '#f59e0b', 'theme', 'color', 'Vurgu Rengi', 3],
    ['background_color', '#ffffff', 'theme', 'color', 'Arka Plan Rengi', 4],
    ['text_color', '#1f2937', 'theme', 'color', 'Metin Rengi', 5],
    ['header_bg', '#1f2937', 'theme', 'color', 'Header Arka Plan', 6],
    ['footer_bg', '#111827', 'theme', 'color', 'Footer Arka Plan', 7],
    ['font_family', 'Inter, system-ui, sans-serif', 'theme', 'text', 'Yazı Tipi', 8],
    ['border_radius', '8', 'theme', 'number', 'Köşe Yuvarlaklığı (px)', 9],

    // Mağaza ayarları  
    ['shop_enabled', '1', 'shop', 'boolean', 'Mağaza Aktif', 1],
    ['shop_name', 'Mağaza', 'shop', 'text', 'Mağaza Adı', 2],
    ['shop_per_page', '12', 'shop', 'number', 'Sayfa Başı Ürün', 3],
    ['shop_allow_guest_checkout', '0', 'shop', 'boolean', 'Misafir Alışveriş', 4],
    ['shop_min_order', '0', 'shop', 'number', 'Minimum Sipariş Tutarı', 5],
    ['kdv_enabled', '0', 'shop', 'boolean', 'KDV Aktif', 6],
    ['kdv_rate', '20', 'shop', 'number', 'KDV Oranı (%)', 7],

    // Blog ayarları
    ['blog_enabled', '1', 'blog', 'boolean', 'Blog Aktif', 1],
    ['blog_name', 'Blog', 'blog', 'text', 'Blog Adı', 2],
    ['blog_per_page', '10', 'blog', 'number', 'Sayfa Başı Gönderi', 3],

    // Kategori isimleri
    ['shop_category_label', 'Mağaza Kategorileri', 'labels', 'text', 'Mağaza Kategori Etiketi', 1],
    ['blog_category_label', 'Blog Kategorileri', 'labels', 'text', 'Blog Kategori Etiketi', 2],

    // Sosyal medya
    ['social_facebook', '', 'social', 'text', 'Facebook', 1],
    ['social_twitter', '', 'social', 'text', 'Twitter/X', 2],
    ['social_instagram', '', 'social', 'text', 'Instagram', 3],
    ['social_youtube', '', 'social', 'text', 'YouTube', 4],
    ['social_linkedin', '', 'social', 'text', 'LinkedIn', 5],
    ['social_github', '', 'social', 'text', 'GitHub', 6],

    // Özelleştirilebilir etiketler
    ['label_add_to_cart', 'Sepete Ekle', 'labels', 'text', 'Sepete Ekle Butonu', 10],
    ['label_buy_now', 'Satın Al', 'labels', 'text', 'Satın Al Butonu', 11],
    ['label_out_of_stock', 'Stokta Yok', 'labels', 'text', 'Stokta Yok Etiketi', 12],
    ['label_sale', 'İndirim', 'labels', 'text', 'İndirim Etiketi', 13],

    // Duyuru bandı
    ['announcement_text', '', 'announcement', 'text', 'Duyuru Metni', 1],
    ['announcement_cta', '', 'announcement', 'text', 'Duyuru Buton Metni', 2],
    ['announcement_url', '/shop', 'announcement', 'text', 'Duyuru Buton URL', 3],

    // Google Font
    ['google_font', 'Inter', 'theme', 'text', 'Google Font', 10],

    // Anasayfa
    ['show_hero_section', '1', 'homepage', 'boolean', 'Hero Bölümü Göster', 1],
  ];

  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO site_settings (key, value, group_name, type, label, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertSettings = db.transaction((settings) => {
    for (const s of settings) {
      insertSetting.run(...s);
    }
  });
  insertSettings(defaultSettings);

  // Varsayılan ödeme ayarları
  db.prepare(`INSERT OR IGNORE INTO payment_settings (method, config, is_active) VALUES (?, ?, ?)`).run(
    'iban', JSON.stringify({
      bank_name: process.env.IBAN_BANK_NAME || '',
      account_holder: process.env.IBAN_ACCOUNT_HOLDER || '',
      iban: process.env.IBAN_NUMBER || ''
    }), 0
  );
  db.prepare(`INSERT OR IGNORE INTO payment_settings (method, config, is_active) VALUES (?, ?, ?)`).run(
    'card', JSON.stringify({
      provider: process.env.PAYMENT_PROVIDER || 'none',
      api_key: '',
      secret_key: '',
      base_url: ''
    }), 0
  );

  // Varsayılan yasal sayfalar
  const legalPages = [
    ['privacy-policy', 'Gizlilik Politikası', '<h2>Gizlilik Politikası</h2><p>Bu sayfa düzenlenmelidir.</p>'],
    ['terms-of-service', 'Kullanım Koşulları', '<h2>Kullanım Koşulları</h2><p>Bu sayfa düzenlenmelidir.</p>'],
    ['return-policy', 'İade Politikası', '<h2>İade Politikası</h2><p>Bu sayfa düzenlenmelidir.</p>'],
    ['cookie-policy', 'Çerez Politikası', '<h2>Çerez Politikası</h2><p>Bu sayfa düzenlenmelidir.</p>'],
    ['kvkk', 'KVKK Aydınlatma Metni', '<h2>KVKK Aydınlatma Metni</h2><p>Bu sayfa düzenlenmelidir.</p>'],
    ['distance-sales', 'Mesafeli Satış Sözleşmesi', '<h2>Mesafeli Satış Sözleşmesi</h2><p>Bu sayfa düzenlenmelidir.</p>'],
  ];

  const insertLegal = db.prepare('INSERT OR IGNORE INTO legal_pages (slug, title, content) VALUES (?, ?, ?)');
  const insertLegals = db.transaction((pages) => {
    for (const p of pages) {
      insertLegal.run(...p);
    }
  });
  insertLegals(legalPages);

  // Varsayılan anasayfa bölümleri
  const existingSection = db.prepare('SELECT id FROM homepage_sections LIMIT 1').get();
  if (!existingSection) {
    const sections = [
      ['hero', 'Hoş Geldiniz', 'En iyi ürünleri keşfedin', JSON.stringify({
        button_text: 'Mağazaya Git', button_url: '/shop', image: '', animation: 'fade'
      }), JSON.stringify({ bg_color: '#1f2937', text_color: '#ffffff', height: '500px' }), 1, 1],
      ['categories', 'Kategoriler', 'Popüler kategorilerimiz', JSON.stringify({ layout: 'grid', columns: 4 }), JSON.stringify({}), 2, 1],
      ['featured', 'Öne Çıkan Ürünler', 'En çok tercih edilen ürünler', JSON.stringify({ limit: 8, layout: 'grid' }), JSON.stringify({}), 3, 1],
      ['banner', 'Fırsatları Kaçırmayın', '', JSON.stringify({
        button_text: 'İncele', button_url: '/shop', image: '', animation: 'slide'
      }), JSON.stringify({ bg_color: '#2563eb', text_color: '#ffffff' }), 4, 1],
    ];

    const insertSection = db.prepare(`
      INSERT INTO homepage_sections (type, title, subtitle, content, style, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertSections = db.transaction((secs) => {
      for (const s of secs) {
        insertSection.run(...s);
      }
    });
    insertSections(sections);
  }
}

/**
 * Tüm site ayarlarını al
 */
function getSettings() {
  const rows = db.prepare('SELECT key, value FROM site_settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

/**
 * Tek bir ayar değerini al
 */
function getSetting(key, defaultValue = '') {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

/**
 * Ayar güncelle
 */
function setSetting(key, value) {
  const existing = db.prepare('SELECT key FROM site_settings WHERE key = ?').get(key);
  if (existing) {
    db.prepare('UPDATE site_settings SET value = ? WHERE key = ?').run(value, key);
  } else {
    db.prepare('INSERT INTO site_settings (key, value, group_name, type, label, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run(key, value, 'general', 'text', key, 99);
  }
}

// Proxy: destructuring yapılsa bile her çağrıda gerçek db instance'ını kullanır
const dbProxy = new Proxy({}, {
  get(_, prop) {
    if (!db) throw new Error(`Veritabanı henüz hazır değil (erişilen: ${String(prop)})`);
    const val = db[prop];
    return typeof val === 'function' ? val.bind(db) : val;
  },
  set(_, prop, value) {
    if (!db) throw new Error('Veritabanı henüz hazır değil');
    db[prop] = value;
    return true;
  }
});

module.exports = {
  db: dbProxy,
  loadDatabase,
  initializeDatabase,
  seedDefaultData,
  getSettings,
  getSetting,
  setSetting,
  DB_PATH
};
