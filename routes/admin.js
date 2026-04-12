/**
 * Yönetim Paneli Rotaları
 * Kapsamlı admin yönetimi
 */

const express = require('express');
const router = express.Router();
const slugify = require('slugify');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');
const { db, getSettings, setSetting } = require('../config/database');
const { requireAdmin, requirePermission, validateCsrf } = require('../middleware/auth');
const { adminLimiter, uploadLimiter } = require('../middleware/rateLimit');
const { productUpload, postUpload, categoryUpload, siteUpload, invoiceUpload, handleUploadError, deleteFile } = require('../middleware/upload');
const { sendOrderStatusUpdate, sendPaymentConfirmation, sendCargoTrackingEmail, sendInvoiceEmail } = require('../config/mail');

router.use(requireAdmin);
router.use(adminLimiter);

// SLUG Yardımcısı
function createSlug(text) {
  return slugify(text, { lower: true, strict: true, locale: 'tr' });
}

// ==========================================
// DASHBOARD
// ==========================================
router.get('/', requirePermission('admin.dashboard'), (req, res, next) => {
  try {
  const stats = {
    totalProducts: db.prepare('SELECT COUNT(*) as c FROM products').get().c,
    activeProducts: db.prepare("SELECT COUNT(*) as c FROM products WHERE is_active = 1").get().c,
    totalOrders: db.prepare('SELECT COUNT(*) as c FROM orders').get().c,
    pendingOrders: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get().c,
    awaitingPayment: db.prepare("SELECT COUNT(*) as c FROM orders WHERE payment_status = 'awaiting_confirmation'").get().c,
    totalUsers: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    totalPosts: db.prepare('SELECT COUNT(*) as c FROM posts').get().c,
    totalRevenue: (db.prepare("SELECT COALESCE(SUM(total), 0) as t FROM orders WHERE payment_status = 'confirmed'").get() || {}).t || 0
  };

  // Son siparişler
  const recentOrders = db.prepare(`
    SELECT o.*, u.display_name as user_name, u.email as user_email FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    ORDER BY o.created_at DESC LIMIT 10
  `).all();

  // Ziyaret istatistikleri
  const visitStats = {};
  const periods = [
    { key: 'today', label: 'Bugün', days: 0 },
    { key: 'week', label: '7 Gün', days: 7 },
    { key: 'month', label: '30 Gün', days: 30 },
    { key: 'quarter', label: '90 Gün', days: 90 }
  ];
  for (const p of periods) {
    const date = new Date();
    date.setDate(date.getDate() - p.days);
    const dateStr = date.toISOString().split('T')[0];
    visitStats[p.key] = db.prepare('SELECT COUNT(*) as c FROM visits WHERE created_at >= ?').get(dateStr).c;
  }

  stats.todayVisits = visitStats.today;

  // Son 7 günün günlük ziyaret verisi (grafik için)
  const visitData = db.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM visits
    WHERE created_at >= DATE('now', '-6 days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all();

  res.render('admin/dashboard', {
    title: 'Yönetim Paneli',
    layout: 'admin',
    stats,
    recentOrders,
    visitStats,
    visitData
  });
  } catch(e) { console.error('Admin dashboard error:', e.message, e.stack); next(e); }
});

// ==========================================
// ÜRÜN YÖNETİMİ
// ==========================================
router.get('/products', requirePermission('products.view'), (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = 20;
  const offset = (page - 1) * perPage;
  const search = req.query.search || '';

  let where = '1=1';
  let params = [];
  if (search) {
    where = 'p.title LIKE ?';
    params.push(`%${search}%`);
  }
  const category = req.query.category || '';
  if (category) {
    where += ' AND p.category_id = ?';
    params.push(category);
  }
  const status = req.query.status || '';
  if (status !== '') {
    where += ' AND p.is_active = ?';
    params.push(status);
  }

  const total = db.prepare(`SELECT COUNT(*) as c FROM products p WHERE ${where}`).get(...params).c;
  const products = db.prepare(`
    SELECT p.*, c.name as category_name FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, perPage, offset);

  const categories = db.prepare("SELECT * FROM categories WHERE type = 'shop' AND is_active = 1 ORDER BY sort_order").all();

  res.render('admin/products', {
    title: 'Ürünler', layout: 'admin', products, total, categories,
    currentPage: page, totalPages: Math.ceil(total / perPage), search,
    selectedCategory: category, selectedStatus: status
  });
});

router.get('/products/new', requirePermission('products.create'), (req, res) => {
  const categories = db.prepare("SELECT * FROM categories WHERE type = 'shop' AND is_active = 1 ORDER BY sort_order").all();
  res.render('admin/product-form', { title: 'Yeni Ürün', layout: 'admin', product: null, categories, images: [], filters: [], filterValues: {} });
});

router.post('/products', requirePermission('products.create'), handleUploadError(productUpload.fields([
  { name: 'cover_image', maxCount: 1 }, { name: 'images', maxCount: 10 }
])), validateCsrf, (req, res) => {
  const { title, description, content, price, sale_price, stock, stock_visible,
    category_id, is_active, is_featured, meta_title, meta_description } = req.body;

  if (!title || !price) {
    req.session.flash = { type: 'error', message: 'Başlık ve fiyat gereklidir.' };
    return res.redirect('/admin/products/new');
  }

  let slug = createSlug(title);
  const existingSlug = db.prepare('SELECT id FROM products WHERE slug = ?').get(slug);
  if (existingSlug) slug += '-' + Date.now().toString(36);

  const coverImage = req.files?.cover_image?.[0] ? '/uploads/products/' + req.files.cover_image[0].filename : null;

  const result = db.prepare(`
    INSERT INTO products (title, slug, description, content, price, sale_price, stock, stock_visible,
      cover_image, category_id, is_active, is_featured, meta_title, meta_description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title.trim(), slug, description?.trim() || null, content?.trim() || null,
    parseFloat(price), sale_price ? parseFloat(sale_price) : null,
    stock !== undefined && stock !== '' ? parseInt(stock) : -1, stock_visible ? 1 : 0,
    coverImage, category_id || null, is_active ? 1 : 0, is_featured ? 1 : 0,
    meta_title?.trim() || null, meta_description?.trim() || null);

  // Ek görseller
  if (req.files?.images) {
    const insertImg = db.prepare('INSERT INTO product_images (product_id, image_path, sort_order) VALUES (?, ?, ?)');
    req.files.images.forEach((f, i) => {
      insertImg.run(result.lastInsertRowid, '/uploads/products/' + f.filename, i);
    });
  }

  req.session.flash = { type: 'success', message: 'Ürün oluşturuldu.' };
  res.redirect('/admin/products');
});

router.get('/products/:id/edit', requirePermission('products.edit'), (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.redirect('/admin/products');

  const categories = db.prepare("SELECT * FROM categories WHERE type = 'shop' AND is_active = 1 ORDER BY sort_order").all();
  const images = db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order').all(product.id);

  // Filtreler (kategoriye göre)
  let filters = [];
  let filterValues = {};
  if (product.category_id) {
    filters = db.prepare('SELECT * FROM product_filters WHERE category_id = ? ORDER BY sort_order').all(product.category_id);
    filters.forEach(f => {
      try { f.options = JSON.parse(f.options || '[]'); } catch { f.options = []; }
    });
    const fvRows = db.prepare('SELECT filter_id, value FROM product_filter_values WHERE product_id = ?').all(product.id);
    fvRows.forEach(fv => { filterValues[fv.filter_id] = fv.value; });
  }

  res.render('admin/product-form', { title: 'Ürün Düzenle', layout: 'admin', product, categories, images, filters, filterValues });
});

router.post('/products/:id', requirePermission('products.edit'), handleUploadError(productUpload.fields([
  { name: 'cover_image', maxCount: 1 }, { name: 'images', maxCount: 10 }
])), validateCsrf, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.redirect('/admin/products');

  const { title, description, content, price, sale_price, stock, stock_visible,
    category_id, is_active, is_featured, meta_title, meta_description } = req.body;

  let coverImage = product.cover_image;
  if (req.files?.cover_image?.[0]) {
    if (product.cover_image) deleteFile(product.cover_image.replace('/uploads/', ''));
    coverImage = '/uploads/products/' + req.files.cover_image[0].filename;
  }

  db.prepare(`
    UPDATE products SET title=?, description=?, content=?, price=?, sale_price=?, stock=?, stock_visible=?,
      cover_image=?, category_id=?, is_active=?, is_featured=?, meta_title=?, meta_description=?,
      updated_at=datetime('now') WHERE id=?
  `).run(title?.trim(), description?.trim() || null, content?.trim() || null,
    parseFloat(price), sale_price ? parseFloat(sale_price) : null,
    stock !== undefined && stock !== '' ? parseInt(stock) : -1, stock_visible ? 1 : 0,
    coverImage, category_id || null, is_active ? 1 : 0, is_featured ? 1 : 0,
    meta_title?.trim() || null, meta_description?.trim() || null, req.params.id);

  if (req.files?.images) {
    const maxSort = db.prepare('SELECT MAX(sort_order) as m FROM product_images WHERE product_id = ?').get(req.params.id)?.m || 0;
    const insertImg = db.prepare('INSERT INTO product_images (product_id, image_path, sort_order) VALUES (?, ?, ?)');
    req.files.images.forEach((f, i) => {
      insertImg.run(req.params.id, '/uploads/products/' + f.filename, maxSort + i + 1);
    });
  }

  req.session.flash = { type: 'success', message: 'Ürün güncellendi.' };
  res.redirect('/admin/products');
});

router.post('/products/:id/delete', requirePermission('products.delete'), validateCsrf, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (product) {
    if (product.cover_image) deleteFile(product.cover_image.replace('/uploads/', ''));
    const images = db.prepare('SELECT image_path FROM product_images WHERE product_id = ?').all(product.id);
    images.forEach(img => deleteFile(img.image_path.replace('/uploads/', '')));
    db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  }
  req.session.flash = { type: 'success', message: 'Ürün silindi.' };
  res.redirect('/admin/products');
});

// Ürün görseli sil
router.post('/products/images/:id/delete', requirePermission('products.edit'), validateCsrf, (req, res) => {
  const img = db.prepare('SELECT * FROM product_images WHERE id = ?').get(req.params.id);
  if (img) {
    deleteFile(img.image_path.replace('/uploads/', ''));
    db.prepare('DELETE FROM product_images WHERE id = ?').run(req.params.id);
  }
  res.json({ success: true });
});

// ==========================================
// KATEGORİ YÖNETİMİ
// ==========================================
router.get('/categories', requirePermission('categories.view'), (req, res) => {
  const categories = db.prepare(`
    SELECT c.*, p.name as parent_name FROM categories c
    LEFT JOIN categories p ON c.parent_id = p.id
    ORDER BY c.type, c.sort_order
  `).all();
  res.render('admin/categories', { title: 'Kategoriler', layout: 'admin', categories });
});

router.post('/categories', requirePermission('categories.create'), handleUploadError(categoryUpload.fields([
  { name: 'image', maxCount: 1 }, { name: 'bg_image', maxCount: 1 }
])), validateCsrf, (req, res) => {
  const { name, type, description, parent_id, icon, color, sort_order } = req.body;
  if (!name || !type) {
    req.session.flash = { type: 'error', message: 'Kategori adı ve türü gereklidir.' };
    return res.redirect('/admin/categories');
  }

  let slug = createSlug(name);
  const existing = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
  if (existing) slug += '-' + Date.now().toString(36);

  const image = req.files?.image?.[0] ? '/uploads/categories/' + req.files.image[0].filename : null;
  const bg_image = req.files?.bg_image?.[0] ? '/uploads/categories/' + req.files.bg_image[0].filename : null;

  db.prepare(`
    INSERT INTO categories (name, slug, type, description, parent_id, icon, image, bg_image, color, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name.trim(), slug, type, description?.trim() || null, parent_id || null,
    icon?.trim() || null, image, bg_image, color || '#333333', parseInt(sort_order) || 0);

  req.session.flash = { type: 'success', message: 'Kategori oluşturuldu.' };
  res.redirect('/admin/categories');
});

router.post('/categories/:id', requirePermission('categories.edit'), handleUploadError(categoryUpload.fields([
  { name: 'image', maxCount: 1 }, { name: 'bg_image', maxCount: 1 }
])), validateCsrf, (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.redirect('/admin/categories');

  const { name, description, parent_id, icon, color, sort_order, is_active } = req.body;
  let image = cat.image;
  if (req.files?.image?.[0]) {
    if (cat.image) deleteFile(cat.image.replace('/uploads/', ''));
    image = '/uploads/categories/' + req.files.image[0].filename;
  }
  let bg_image = cat.bg_image || null;
  if (req.files?.bg_image?.[0]) {
    if (cat.bg_image) deleteFile(cat.bg_image.replace('/uploads/', ''));
    bg_image = '/uploads/categories/' + req.files.bg_image[0].filename;
  }
  if (req.body.remove_bg_image === '1') {
    if (bg_image) deleteFile(bg_image.replace('/uploads/', ''));
    bg_image = null;
  }

  db.prepare(`
    UPDATE categories SET name=?, description=?, parent_id=?, icon=?, image=?, bg_image=?, color=?, sort_order=?, is_active=?
    WHERE id=?
  `).run(name?.trim(), description?.trim() || null, parent_id || null,
    icon?.trim() || null, image, bg_image, color || '#333333', parseInt(sort_order) || 0, is_active ? 1 : 0, req.params.id);

  req.session.flash = { type: 'success', message: 'Kategori güncellendi.' };
  res.redirect('/admin/categories');
});

router.post('/categories/:id/delete', requirePermission('categories.delete'), validateCsrf, (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (cat) {
    if (cat.image) deleteFile(cat.image.replace('/uploads/', ''));
    db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  }
  req.session.flash = { type: 'success', message: 'Kategori silindi.' };
  res.redirect('/admin/categories');
});

// ==========================================
// SİPARİŞ YÖNETİMİ
// ==========================================
router.get('/orders', requirePermission('orders.view'), (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = 20;
  const offset = (page - 1) * perPage;
  const status = req.query.status || '';
  const search = req.query.search || '';
  const paymentStatus = req.query.payment || '';

  let where = '1=1';
  let params = [];
  if (status) { where += ' AND o.status = ?'; params.push(status); }
  if (paymentStatus) { where += ' AND o.payment_status = ?'; params.push(paymentStatus); }
  if (search) { where += ' AND (o.order_number LIKE ? OR u.display_name LIKE ? OR u.email LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

  const total = db.prepare(`SELECT COUNT(*) as c FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE ${where}`).get(...params).c;
  const orders = db.prepare(`
    SELECT o.*, u.display_name as user_name, u.email as user_email FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    WHERE ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, perPage, offset);

  res.render('admin/orders', {
    title: 'Siparişler', layout: 'admin', orders, total,
    currentPage: page, totalPages: Math.ceil(total / perPage),
    selectedStatus: status, search, selectedPayment: paymentStatus
  });
});

router.get('/orders/:id', requirePermission('orders.view'), (req, res) => {
  const order = db.prepare(`
    SELECT o.*, u.display_name as user_name, u.email as user_email, u.phone as user_phone FROM orders o
    LEFT JOIN users u ON o.user_id = u.id WHERE o.id = ?
  `).get(req.params.id);
  if (!order) return res.redirect('/admin/orders');

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const billing = order.billing_profile_id ? db.prepare('SELECT * FROM billing_profiles WHERE id = ?').get(order.billing_profile_id) : null;
  const shipping = order.shipping_address_id ? db.prepare('SELECT * FROM addresses WHERE id = ?').get(order.shipping_address_id) : null;

  res.render('admin/order-detail', { title: `Sipariş #${order.order_number}`, layout: 'admin', order, items, billing, shipping });
});

router.post('/orders/:id/status', requirePermission('orders.edit'), validateCsrf, async (req, res) => {
  const { status, payment_status, tracking_url, tracking_code, cargo_provider } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) {
    req.session.flash = { type: 'error', message: 'Sipariş bulunamadı.' };
    return res.redirect('/admin/orders');
  }

  if (status) {
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, order.id);
  }
  if (payment_status) {
    db.prepare("UPDATE orders SET payment_status = ?, updated_at = datetime('now') WHERE id = ?").run(payment_status, order.id);
    
    if (payment_status === 'confirmed') {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id);
      if (user) {
        try { await sendPaymentConfirmation(user, order); } catch (e) { console.error(e.message); }
      }
    }
  }

  // Kargo takip bilgileri güncelle
  const hasTracking = tracking_url !== undefined || tracking_code !== undefined || cargo_provider !== undefined;
  if (hasTracking) {
    db.prepare("UPDATE orders SET tracking_url = ?, tracking_code = ?, cargo_provider = ?, updated_at = datetime('now') WHERE id = ?")
      .run(tracking_url || order.tracking_url || null, tracking_code || order.tracking_code || null, cargo_provider || order.cargo_provider || null, order.id);
    
    // Kargo bilgisi eklendiğinde veya değiştiğinde e-posta gönder
    const trackingChanged = (tracking_url && tracking_url !== order.tracking_url) || (tracking_code && tracking_code !== order.tracking_code);
    if (trackingChanged) {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id);
      if (user) {
        const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
        try { await sendCargoTrackingEmail(user, updatedOrder); } catch (e) { console.error(e.message); }
      }
    }
  }

  const statusTexts = { pending: 'Beklemede', paid: 'Ödendi', processing: 'Hazırlanıyor', shipped: 'Kargoda', delivered: 'Teslim Edildi', cancelled: 'İptal Edildi' };
  if (status && status !== order.status) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id);
    if (user) {
      try { await sendOrderStatusUpdate(user, order, statusTexts[status] || status); } catch (e) { console.error(e.message); }
    }
  }

  req.session.flash = { type: 'success', message: 'Sipariş güncellendi.' };
  res.redirect(`/admin/orders/${order.id}`);
});

// Fatura Yükle ve Gönder
router.post('/orders/:id/invoice', requirePermission('orders.edit'), uploadLimiter, handleUploadError(invoiceUpload.single('invoice')), validateCsrf, async (req, res) => {
    if (!req.file) {
      req.session.flash = { type: 'error', message: 'Lütfen bir PDF dosyası seçin.' };
      return res.redirect(`/admin/orders/${req.params.id}`);
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
      req.session.flash = { type: 'error', message: 'Sipariş bulunamadı.' };
      return res.redirect('/admin/orders');
    }

    const invoiceUrl = '/uploads/invoices/' + req.file.filename;
    db.prepare("UPDATE orders SET invoice_url = ?, updated_at = datetime('now') WHERE id = ?").run(invoiceUrl, order.id);

    // Fatura e-postası gönder
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id);
    if (user) {
      try {
        const absolutePath = req.file.path;
        await sendInvoiceEmail(user, order, absolutePath);
        req.session.flash = { type: 'success', message: 'Fatura yüklendi ve müşteriye e-posta ile gönderildi.' };
      } catch (e) {
        console.error('Fatura e-posta hatası:', e.message);
        req.session.flash = { type: 'warning', message: 'Fatura yüklendi ancak e-posta gönderilemedi.' };
      }
    } else {
      req.session.flash = { type: 'success', message: 'Fatura yüklendi.' };
    }

    res.redirect(`/admin/orders/${order.id}`);
});

// ==========================================
// KULLANICI YÖNETİMİ
// ==========================================
router.get('/users', requirePermission('users.view'), (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = 20;
  const offset = (page - 1) * perPage;
  const search = req.query.search || '';

  let where = '1=1';
  let params = [];
  if (search) { where = '(email LIKE ? OR display_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  const total = db.prepare(`SELECT COUNT(*) as c FROM users WHERE ${where}`).get(...params).c;
  const users = db.prepare(`SELECT id, email, display_name, phone, role, avatar, email_verified, is_active, last_login, created_at FROM users WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, perPage, offset);

  const roles = db.prepare('SELECT DISTINCT role FROM role_permissions ORDER BY role').all().map(r => r.role);
  roles.unshift('user');
  const selectedRole = req.query.role || '';

  res.render('admin/users', {
    title: 'Kullanıcılar', layout: 'admin', users, total,
    currentPage: page, totalPages: Math.ceil(total / perPage), search, roles, selectedRole
  });
});

router.post('/users/:id', requirePermission('users.edit'), validateCsrf, (req, res) => {
  const { role, is_active } = req.body;
  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!targetUser) return res.redirect('/admin/users');

  // Admin kendini düşüremesin
  if (targetUser.id === req.user.id && role && role !== targetUser.role) {
    req.session.flash = { type: 'error', message: 'Kendi rolünüzü değiştiremezsiniz.' };
    return res.redirect('/admin/users');
  }

  const newRole = role || targetUser.role;
  const newActive = is_active !== undefined ? (parseInt(is_active) ? 1 : 0) : targetUser.is_active;

  db.prepare("UPDATE users SET role = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?")
    .run(newRole, newActive, req.params.id);

  req.session.flash = { type: 'success', message: 'Kullanıcı güncellendi.' };
  res.redirect('/admin/users');
});

// ==========================================
// GÖNDERİ / BLOG YÖNETİMİ
// ==========================================
router.get('/posts', requirePermission('posts.view'), (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = 20;
  const offset = (page - 1) * perPage;
  const search = req.query.search || '';
  const selectedCategory = req.query.category || '';

  let where = '1=1';
  let params = [];
  if (search) { where += ' AND p.title LIKE ?'; params.push(`%${search}%`); }
  if (selectedCategory) { where += ' AND p.category_id = ?'; params.push(selectedCategory); }

  const total = db.prepare(`SELECT COUNT(*) as c FROM posts p WHERE ${where}`).get(...params).c;
  const posts = db.prepare(`
    SELECT p.*, c.name as category_name, u.display_name as author_name FROM posts p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN users u ON p.author_id = u.id
    WHERE ${where}
    ORDER BY p.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, perPage, offset);

  const categories = db.prepare("SELECT * FROM categories WHERE type = 'blog' AND is_active = 1 ORDER BY sort_order").all();

  res.render('admin/posts', {
    title: 'Gönderiler', layout: 'admin', posts, categories,
    search, selectedCategory, total,
    currentPage: page, totalPages: Math.ceil(total / perPage)
  });
});

router.get('/posts/new', requirePermission('posts.create'), (req, res) => {
  const categories = db.prepare("SELECT * FROM categories WHERE type = 'blog' AND is_active = 1 ORDER BY sort_order").all();
  res.render('admin/post-form', { title: 'Yeni Gönderi', layout: 'admin', post: null, categories });
});

router.post('/posts', requirePermission('posts.create'), handleUploadError(postUpload.single('cover_image')), validateCsrf, (req, res) => {
  const { title, content, excerpt, category_id, is_published, meta_title, meta_description } = req.body;
  if (!title || !content) {
    req.session.flash = { type: 'error', message: 'Başlık ve içerik gereklidir.' };
    return res.redirect('/admin/posts/new');
  }

  let slug = createSlug(title);
  const existing = db.prepare('SELECT id FROM posts WHERE slug = ?').get(slug);
  if (existing) slug += '-' + Date.now().toString(36);

  const coverImage = req.file ? '/uploads/posts/' + req.file.filename : null;

  db.prepare(`
    INSERT INTO posts (title, slug, content, excerpt, cover_image, category_id, author_id, is_published, meta_title, meta_description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title.trim(), slug, content, excerpt?.trim() || null, coverImage,
    category_id || null, req.user.id, is_published ? 1 : 0, meta_title?.trim() || null, meta_description?.trim() || null);

  req.session.flash = { type: 'success', message: 'Gönderi oluşturuldu.' };
  res.redirect('/admin/posts');
});

router.get('/posts/:id/edit', requirePermission('posts.edit'), (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.redirect('/admin/posts');
  const categories = db.prepare("SELECT * FROM categories WHERE type = 'blog' AND is_active = 1 ORDER BY sort_order").all();
  res.render('admin/post-form', { title: 'Gönderi Düzenle', layout: 'admin', post, categories });
});

router.post('/posts/:id', requirePermission('posts.edit'), handleUploadError(postUpload.single('cover_image')), validateCsrf, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.redirect('/admin/posts');

  const { title, content, excerpt, category_id, is_published, meta_title, meta_description } = req.body;
  let coverImage = post.cover_image;
  if (req.file) {
    if (post.cover_image) deleteFile(post.cover_image.replace('/uploads/', ''));
    coverImage = '/uploads/posts/' + req.file.filename;
  }

  db.prepare(`
    UPDATE posts SET title=?, content=?, excerpt=?, cover_image=?, category_id=?, is_published=?,
      meta_title=?, meta_description=?, updated_at=datetime('now') WHERE id=?
  `).run(title?.trim(), content, excerpt?.trim() || null, coverImage,
    category_id || null, is_published ? 1 : 0, meta_title?.trim() || null, meta_description?.trim() || null, req.params.id);

  req.session.flash = { type: 'success', message: 'Gönderi güncellendi.' };
  res.redirect('/admin/posts');
});

router.post('/posts/:id/delete', requirePermission('posts.delete'), validateCsrf, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (post) {
    if (post.cover_image) deleteFile(post.cover_image.replace('/uploads/', ''));
    db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  }
  req.session.flash = { type: 'success', message: 'Gönderi silindi.' };
  res.redirect('/admin/posts');
});

// ==========================================
// SİTE AYARLARI
// ==========================================
router.get('/settings', requirePermission('settings.view'), (req, res) => {
  const siteSettings = {};
  db.prepare('SELECT key, value FROM site_settings').all().forEach(s => {
    siteSettings[s.key] = s.value;
  });

  const paymentSettings = db.prepare('SELECT * FROM payment_settings').all().map(p => {
    try { p.config = JSON.parse(p.config); } catch { p.config = {}; }
    return p;
  });

  res.render('admin/settings', { title: 'Site Ayarları', layout: 'admin', siteSettings, paymentSettings });
});

router.post('/settings', requirePermission('settings.edit'), handleUploadError(siteUpload.fields([
  { name: 'site_logo_file', maxCount: 1 }, { name: 'site_favicon_file', maxCount: 1 }
])), validateCsrf, (req, res) => {
  // Dosya yüklemeleri
  if (req.files?.site_logo_file?.[0]) {
    setSetting('site_logo', '/uploads/site/' + req.files.site_logo_file[0].filename);
  }
  if (req.files?.site_favicon_file?.[0]) {
    setSetting('site_favicon', '/uploads/site/' + req.files.site_favicon_file[0].filename);
  }

  // Tüm form alanlarını kaydet (dosya alanları ve csrf hariç)
  const skipFields = ['_csrf', 'site_logo_file', 'site_favicon_file'];
  for (const [key, val] of Object.entries(req.body)) {
    if (!skipFields.includes(key)) {
      // checkbox hidden+checkbox pattern sends array — take last value
      const value = Array.isArray(val) ? val[val.length - 1] : val;
      setSetting(key, value);
    }
  }

  req.session.flash = { type: 'success', message: 'Ayarlar kaydedildi.' };
  res.redirect('/admin/settings');
});

// Ödeme ayarları
router.post('/settings/payment', requirePermission('payments.edit'), validateCsrf, (req, res) => {
  const { iban_bank_name, iban_account_holder, iban_iban, iban_active,
    card_provider, card_api_key, card_secret_key, card_base_url, card_active } = req.body;

  db.prepare("UPDATE payment_settings SET config = ?, is_active = ? WHERE method = 'iban'").run(
    JSON.stringify({ bank_name: iban_bank_name, account_holder: iban_account_holder, iban: iban_iban }),
    iban_active ? 1 : 0
  );

  db.prepare("UPDATE payment_settings SET config = ?, is_active = ? WHERE method = 'card'").run(
    JSON.stringify({ provider: card_provider, api_key: card_api_key, secret_key: card_secret_key, base_url: card_base_url }),
    card_active ? 1 : 0
  );

  req.session.flash = { type: 'success', message: 'Ödeme ayarları kaydedildi.' };
  res.redirect('/admin/settings');
});

// ==========================================
// ANALİTİK
// ==========================================
router.get('/analytics', requirePermission('analytics.view'), (req, res) => {
  const period = req.query.period || '30';
  const days = parseInt(period) || 30;
  const date = new Date();
  date.setDate(date.getDate() - days);
  const dateStr = date.toISOString().split('T')[0];

  const totalVisits = db.prepare('SELECT COUNT(*) as c FROM visits WHERE created_at >= ?').get(dateStr).c;
  const uniqueVisitors = db.prepare('SELECT COUNT(DISTINCT ip_hash) as c FROM visits WHERE created_at >= ?').get(dateStr).c;
  const totalOrders = db.prepare('SELECT COUNT(*) as c FROM orders WHERE created_at >= ?').get(dateStr).c;
  const totalRevenue = (db.prepare("SELECT COALESCE(SUM(total), 0) as t FROM orders WHERE payment_status = 'confirmed' AND created_at >= ?").get(dateStr) || {}).t || 0;

  const topPages = db.prepare(`
    SELECT page, COUNT(*) as count FROM visits WHERE created_at >= ?
    GROUP BY page ORDER BY count DESC LIMIT 20
  `).all(dateStr);
  const visitData = db.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as count FROM visits
    WHERE created_at >= ? GROUP BY DATE(created_at) ORDER BY date
  `).all(dateStr);
  const referrers = db.prepare(`
    SELECT COALESCE(referrer, '') as referrer, COUNT(*) as count FROM visits
    WHERE created_at >= ? AND referrer IS NOT NULL AND referrer != ''
    GROUP BY referrer ORDER BY count DESC LIMIT 20
  `).all(dateStr);

  const stats = { totalVisits, uniqueVisitors, totalOrders, totalRevenue };

  res.render('admin/analytics', {
    title: 'İstatistikler', layout: 'admin',
    stats, topPages, visitData, referrers, period: days
  });
});

// ==========================================
// YASAL SAYFALAR
// ==========================================
router.get('/legal', requirePermission('legal.view'), (req, res) => {
  const pages = db.prepare('SELECT * FROM legal_pages ORDER BY id').all();
  res.render('admin/legal', { title: 'Yasal Sayfalar', layout: 'admin', pages });
});

router.post('/legal/:id', requirePermission('legal.edit'), validateCsrf, (req, res) => {
  const { title, content, is_active } = req.body;
  db.prepare("UPDATE legal_pages SET title = ?, content = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?")
    .run(title?.trim(), content, is_active ? 1 : 0, req.params.id);
  req.session.flash = { type: 'success', message: 'Yasal sayfa güncellendi.' };
  res.redirect('/admin/legal');
});

// ==========================================
// BACKLINK YÖNETİMİ
// ==========================================
router.get('/backlinks', requirePermission('backlinks.view'), (req, res) => {
  const backlinks = db.prepare(`
    SELECT b.*, c.name as category_name FROM backlinks b
    LEFT JOIN categories c ON b.category_id = c.id ORDER BY b.sort_order
  `).all();
  const categories = db.prepare("SELECT * FROM categories WHERE is_active = 1 ORDER BY type, sort_order").all();
  res.render('admin/backlinks', { title: 'Backlinkler', layout: 'admin', backlinks, categories });
});

router.post('/backlinks', requirePermission('backlinks.edit'), validateCsrf, (req, res) => {
  const { title, url, description, category_id, icon, sort_order, is_active, nofollow } = req.body;
  if (!title || !url) {
    req.session.flash = { type: 'error', message: 'Başlık ve URL gereklidir.' };
    return res.redirect('/admin/backlinks');
  }
  db.prepare(`INSERT INTO backlinks (title, url, description, category_id, icon, sort_order, is_active, nofollow) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(title.trim(), url.trim(), description?.trim() || null, category_id || null,
      icon?.trim() || null, parseInt(sort_order) || 0, is_active ? 1 : 0, nofollow ? 1 : 0);
  req.session.flash = { type: 'success', message: 'Backlink eklendi.' };
  res.redirect('/admin/backlinks');
});

router.post('/backlinks/:id', requirePermission('backlinks.edit'), validateCsrf, (req, res) => {
  const { title, url, description, category_id, icon, sort_order, is_active, nofollow } = req.body;
  db.prepare(`UPDATE backlinks SET title=?, url=?, description=?, category_id=?, icon=?, sort_order=?, is_active=?, nofollow=? WHERE id=?`)
    .run(title?.trim(), url?.trim(), description?.trim() || null, category_id || null,
      icon?.trim() || null, parseInt(sort_order) || 0, is_active ? 1 : 0, nofollow ? 1 : 0, req.params.id);
  req.session.flash = { type: 'success', message: 'Backlink güncellendi.' };
  res.redirect('/admin/backlinks');
});

router.post('/backlinks/:id/delete', requirePermission('backlinks.edit'), validateCsrf, (req, res) => {
  db.prepare('DELETE FROM backlinks WHERE id = ?').run(req.params.id);
  req.session.flash = { type: 'success', message: 'Backlink silindi.' };
  res.redirect('/admin/backlinks');
});

// ==========================================
// İLETİŞİM YÖNTEMLERİ
// ==========================================
router.get('/contact', requirePermission('contact.view'), (req, res) => {
  const methods = db.prepare('SELECT * FROM contact_methods ORDER BY sort_order').all();
  res.render('admin/contact', { title: 'İletişim Yöntemleri', layout: 'admin', methods });
});

router.post('/contact', requirePermission('contact.edit'), validateCsrf, (req, res) => {
  const { type, value, label, icon, sort_order } = req.body;
  if (!type || !value) {
    req.session.flash = { type: 'error', message: 'Tür ve değer gereklidir.' };
    return res.redirect('/admin/contact');
  }
  const is_active = req.body.is_active ? 1 : 0;
  db.prepare('INSERT INTO contact_methods (type, value, label, icon, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?)')
    .run(type, value.trim(), label?.trim() || null, icon?.trim() || null, parseInt(sort_order) || 0, is_active);
  req.session.flash = { type: 'success', message: 'İletişim yöntemi eklendi.' };
  res.redirect('/admin/contact');
});

router.post('/contact/:id', requirePermission('contact.edit'), validateCsrf, (req, res) => {
  const { type, value, label, icon, sort_order, is_active } = req.body;
  db.prepare('UPDATE contact_methods SET type=?, value=?, label=?, icon=?, sort_order=?, is_active=? WHERE id=?')
    .run(type, value?.trim(), label?.trim() || null, icon?.trim() || null, parseInt(sort_order) || 0, is_active ? 1 : 0, req.params.id);
  req.session.flash = { type: 'success', message: 'İletişim yöntemi güncellendi.' };
  res.redirect('/admin/contact');
});

router.post('/contact/:id/delete', requirePermission('contact.edit'), validateCsrf, (req, res) => {
  db.prepare('DELETE FROM contact_methods WHERE id = ?').run(req.params.id);
  req.session.flash = { type: 'success', message: 'İletişim yöntemi silindi.' };
  res.redirect('/admin/contact');
});

// ==========================================
// ANASAYFA YÖNETİMİ
// ==========================================
router.get('/homepage', requirePermission('homepage.view'), (req, res) => {
  const sections = db.prepare('SELECT * FROM homepage_sections ORDER BY sort_order').all().map(s => {
    try { s.content = JSON.parse(s.content || '{}'); } catch { s.content = {}; }
    try { s.style = JSON.parse(s.style || '{}'); } catch { s.style = {}; }
    return s;
  });
  res.render('admin/homepage', { title: 'Anasayfa Yönetimi', layout: 'admin', sections });
});

router.post('/homepage', requirePermission('homepage.edit'), validateCsrf, (req, res) => {
  const { type, title, subtitle, content, style, sort_order, is_active } = req.body;
  db.prepare(`INSERT INTO homepage_sections (type, title, subtitle, content, style, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(type, title?.trim() || null, subtitle?.trim() || null,
      typeof content === 'string' ? content : JSON.stringify(content || {}),
      typeof style === 'string' ? style : JSON.stringify(style || {}),
      parseInt(sort_order) || 0, is_active ? 1 : 0);
  req.session.flash = { type: 'success', message: 'Bölüm eklendi.' };
  res.redirect('/admin/homepage');
});

router.post('/homepage/:id', requirePermission('homepage.edit'), validateCsrf, (req, res) => {
  const { type, title, subtitle, content, style, sort_order, is_active } = req.body;
  db.prepare(`UPDATE homepage_sections SET type=?, title=?, subtitle=?, content=?, style=?, sort_order=?, is_active=? WHERE id=?`)
    .run(type, title?.trim() || null, subtitle?.trim() || null,
      typeof content === 'string' ? content : JSON.stringify(content || {}),
      typeof style === 'string' ? style : JSON.stringify(style || {}),
      parseInt(sort_order) || 0, is_active ? 1 : 0, req.params.id);
  req.session.flash = { type: 'success', message: 'Bölüm güncellendi.' };
  res.redirect('/admin/homepage');
});

router.post('/homepage/:id/delete', requirePermission('homepage.edit'), validateCsrf, (req, res) => {
  db.prepare('DELETE FROM homepage_sections WHERE id = ?').run(req.params.id);
  req.session.flash = { type: 'success', message: 'Bölüm silindi.' };
  res.redirect('/admin/homepage');
});

// ==========================================
// YETKİ YÖNETİMİ
// ==========================================
router.get('/permissions', requirePermission('permissions.view'), (req, res) => {
  const allPerms = db.prepare('SELECT * FROM role_permissions ORDER BY role, permission').all();
  const currentPermissions = {};
  allPerms.forEach(p => {
    if (!currentPermissions[p.role]) currentPermissions[p.role] = [];
    currentPermissions[p.role].push(p.permission);
  });

  const availablePermissions = [
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
  ];

  res.render('admin/permissions', {
    title: 'Yetki Yönetimi', layout: 'admin', currentPermissions, availablePermissions
  });
});

router.post('/permissions', requirePermission('permissions.edit'), validateCsrf, (req, res) => {
  // View sends checkboxes named like perm_editor_products.view
  const roles = ['editor', 'moderator'];
  
  const updatePerms = db.transaction(() => {
    for (const role of roles) {
      db.prepare('DELETE FROM role_permissions WHERE role = ?').run(role);
      const insert = db.prepare('INSERT INTO role_permissions (role, permission) VALUES (?, ?)');
      for (const key of Object.keys(req.body)) {
        const prefix = `perm_${role}_`;
        if (key.startsWith(prefix) && req.body[key]) {
          const permission = key.substring(prefix.length);
          insert.run(role, permission);
        }
      }
    }
  });
  updatePerms();

  req.session.flash = { type: 'success', message: 'Yetkiler güncellendi.' };
  res.redirect('/admin/permissions');
});

// ==========================================
// FİLTRE YÖNETİMİ (Ürün Filtreleri)
// ==========================================
router.get('/filters', requirePermission('categories.edit'), (req, res) => {
  const categoryId = req.query.category;
  if (!categoryId) return res.redirect('/admin/categories');
  
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
  if (!category) return res.redirect('/admin/categories');
  
  const filters = db.prepare('SELECT * FROM product_filters WHERE category_id = ? ORDER BY sort_order').all(categoryId);
  filters.forEach(f => {
    try { f.options = JSON.parse(f.options || '[]'); } catch { f.options = []; }
  });

  res.render('admin/filters', { title: `Filtreler - ${category.name}`, layout: 'admin', category, filters });
});

router.post('/filters', requirePermission('categories.edit'), validateCsrf, (req, res) => {
  const { category_id, name, type, options, sort_order } = req.body;
  const optionsJson = Array.isArray(options) ? JSON.stringify(options) : JSON.stringify((options || '').split(',').map(o => o.trim()).filter(Boolean));
  
  db.prepare('INSERT INTO product_filters (category_id, name, type, options, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(category_id, name?.trim(), type || 'select', optionsJson, parseInt(sort_order) || 0);
  
  req.session.flash = { type: 'success', message: 'Filtre eklendi.' };
  res.redirect(`/admin/filters?category=${category_id}`);
});

router.post('/filters/:id/delete', requirePermission('categories.edit'), validateCsrf, (req, res) => {
  const filter = db.prepare('SELECT * FROM product_filters WHERE id = ?').get(req.params.id);
  if (filter) {
    db.prepare('DELETE FROM product_filters WHERE id = ?').run(req.params.id);
  }
  res.redirect(`/admin/filters?category=${filter?.category_id || ''}`);
});

// ==========================================
// ANASAYFA SLAYT YÖNETİMİ
// ==========================================
router.get('/slides', requirePermission('homepage.view'), (req, res) => {
  const slides = db.prepare('SELECT * FROM homepage_slides ORDER BY sort_order').all();
  res.render('admin/slides', { title: 'Slayt Yönetimi', layout: 'admin', slides });
});

router.post('/slides', requirePermission('homepage.edit'), handleUploadError(siteUpload.single('image')), validateCsrf, (req, res) => {
  const { title, subtitle, button_text, button_url, sort_order } = req.body;
  if (!req.file) {
    req.session.flash = { type: 'error', message: 'Slayt görseli gereklidir.' };
    return res.redirect('/admin/slides');
  }
  const image = '/uploads/site/' + req.file.filename;
  db.prepare('INSERT INTO homepage_slides (image, title, subtitle, button_text, button_url, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)')
    .run(image, title?.trim() || null, subtitle?.trim() || null, button_text?.trim() || null, button_url?.trim() || '/shop', parseInt(sort_order) || 0);
  req.session.flash = { type: 'success', message: 'Slayt eklendi.' };
  res.redirect('/admin/slides');
});

router.post('/slides/:id', requirePermission('homepage.edit'), handleUploadError(siteUpload.single('image')), validateCsrf, (req, res) => {
  const slide = db.prepare('SELECT * FROM homepage_slides WHERE id = ?').get(req.params.id);
  if (!slide) return res.redirect('/admin/slides');
  const { title, subtitle, button_text, button_url, sort_order, is_active } = req.body;
  let image = slide.image;
  if (req.file) {
    if (slide.image) deleteFile(slide.image.replace('/uploads/', ''));
    image = '/uploads/site/' + req.file.filename;
  }
  db.prepare('UPDATE homepage_slides SET image=?, title=?, subtitle=?, button_text=?, button_url=?, sort_order=?, is_active=? WHERE id=?')
    .run(image, title?.trim() || null, subtitle?.trim() || null, button_text?.trim() || null, button_url?.trim() || '/shop', parseInt(sort_order) || 0, is_active ? 1 : 0, req.params.id);
  req.session.flash = { type: 'success', message: 'Slayt güncellendi.' };
  res.redirect('/admin/slides');
});

router.post('/slides/:id/delete', requirePermission('homepage.edit'), validateCsrf, (req, res) => {
  const slide = db.prepare('SELECT * FROM homepage_slides WHERE id = ?').get(req.params.id);
  if (slide && slide.image) deleteFile(slide.image.replace('/uploads/', ''));
  db.prepare('DELETE FROM homepage_slides WHERE id = ?').run(req.params.id);
  req.session.flash = { type: 'success', message: 'Slayt silindi.' };
  res.redirect('/admin/slides');
});

router.post('/slides/reorder', requirePermission('homepage.edit'), validateCsrf, (req, res) => {
  const { order } = req.body;
  if (Array.isArray(order)) {
    const update = db.prepare('UPDATE homepage_slides SET sort_order = ? WHERE id = ?');
    order.forEach((id, index) => { update.run(index, id); });
  }
  res.json({ success: true });
});

module.exports = router;
