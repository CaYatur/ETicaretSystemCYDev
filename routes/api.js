/**
 * API Rotaları
 * Sepet, ödeme, AJAX işlemleri
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db, getSettings } = require('../config/database');
const { requireAuth, validateCsrf } = require('../middleware/auth');
const { apiLimiter, paymentLimiter } = require('../middleware/rateLimit');
const { sendOrderConfirmation, sendPaymentConfirmation } = require('../config/mail');

router.use(apiLimiter);

// ==========================================
// SEPET İŞLEMLERİ
// ==========================================

// Sepete ekleme
router.post('/cart/add', validateCsrf, (req, res) => {
  const { product_id, quantity = 1 } = req.body;
  const qty = Math.max(1, parseInt(quantity) || 1);

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(product_id);
  if (!product) return res.status(404).json({ error: 'Ürün bulunamadı.' });

  // Stok kontrolü
  if (product.stock !== -1 && product.stock < qty) {
    return res.status(400).json({ error: 'Yeterli stok yok.' });
  }

  const userId = req.user?.id || null;
  let sessionId = null;
  if (!userId) {
    if (!req.session.cartSessionId) {
      req.session.cartSessionId = crypto.randomBytes(16).toString('hex');
    }
    sessionId = req.session.cartSessionId;
  }

  // Mevcut sepet öğesi kontrol
  const where = userId ? 'user_id = ? AND product_id = ?' : 'session_id = ? AND product_id = ?';
  const key = userId || sessionId;
  const existing = db.prepare(`SELECT * FROM cart_items WHERE ${where}`).get(key, product_id);

  if (existing) {
    const newQty = existing.quantity + qty;
    if (product.stock !== -1 && product.stock < newQty) {
      return res.status(400).json({ error: 'Yeterli stok yok.' });
    }
    db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(newQty, existing.id);
  } else {
    if (userId) {
      db.prepare('INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)').run(userId, product_id, qty);
    } else {
      db.prepare('INSERT INTO cart_items (session_id, product_id, quantity) VALUES (?, ?, ?)').run(sessionId, product_id, qty);
    }
  }

  // Güncel sepet sayısı
  const countWhere = userId ? 'user_id = ?' : 'session_id = ?';
  const cart = db.prepare(`SELECT SUM(quantity) as count FROM cart_items WHERE ${countWhere}`).get(key);

  res.json({ success: true, cartCount: cart?.count || 0 });
});

// Sepeti getir
router.get('/cart', (req, res) => {
  const userId = req.user?.id || null;
  const sessionId = !userId ? req.session.cartSessionId : null;

  if (!userId && !sessionId) {
    return res.json({ items: [], total: 0 });
  }

  const where = userId ? 'ci.user_id = ?' : 'ci.session_id = ?';
  const key = userId || sessionId;

  const items = db.prepare(`
    SELECT ci.*, p.title, p.slug, p.price, p.sale_price, p.cover_image, p.stock
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
    WHERE ${where} AND p.is_active = 1
    ORDER BY ci.created_at DESC
  `).all(key);

  const total = items.reduce((sum, item) => {
    const price = item.sale_price || item.price;
    return sum + (price * item.quantity);
  }, 0);

  res.json({ items, total });
});

// Sepet güncelle
router.put('/cart/:id', validateCsrf, (req, res) => {
  const { quantity } = req.body;
  const qty = Math.max(1, parseInt(quantity) || 1);

  const userId = req.user?.id || null;
  const sessionId = !userId ? req.session.cartSessionId : null;
  const where = userId ? 'ci.id = ? AND ci.user_id = ?' : 'ci.id = ? AND ci.session_id = ?';
  const key = userId || sessionId;

  const item = db.prepare(`SELECT ci.*, p.stock FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ${where}`).get(req.params.id, key);
  if (!item) return res.status(404).json({ error: 'Sepet öğesi bulunamadı.' });

  if (item.stock !== -1 && item.stock < qty) {
    return res.status(400).json({ error: 'Yeterli stok yok.' });
  }

  db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(qty, req.params.id);

  const countWhere = userId ? 'user_id = ?' : 'session_id = ?';
  const cart = db.prepare(`SELECT SUM(quantity) as count FROM cart_items WHERE ${countWhere}`).get(key);
  res.json({ success: true, cartCount: cart?.count || 0 });
});

// Sepetten sil
router.delete('/cart/:id', (req, res) => {
  const userId = req.user?.id || null;
  const sessionId = !userId ? req.session.cartSessionId : null;
  const where = userId ? 'id = ? AND user_id = ?' : 'id = ? AND session_id = ?';
  const key = userId || sessionId;

  db.prepare(`DELETE FROM cart_items WHERE ${where}`).run(req.params.id, key);

  const countWhere = userId ? 'user_id = ?' : 'session_id = ?';
  const cart = key ? db.prepare(`SELECT SUM(quantity) as count FROM cart_items WHERE ${countWhere}`).get(key) : null;
  res.json({ success: true, cartCount: cart?.count || 0 });
});

// ==========================================
// SEPET SAYFASI
// ==========================================
router.get('/cart/page', (req, res) => {
  res.render('pages/cart', { title: 'Sepetim' });
});

// ==========================================
// ÖDEME & SİPARİŞ
// ==========================================

// Checkout sayfası
router.get('/checkout', requireAuth, (req, res) => {
  const items = db.prepare(`
    SELECT ci.*, p.title, p.slug, p.price, p.sale_price, p.cover_image, p.stock
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
    WHERE ci.user_id = ? AND p.is_active = 1
  `).all(req.user.id);

  if (items.length === 0) {
    return res.redirect('/shop');
  }

  const addresses = db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC').all(req.user.id);
  const billingProfiles = db.prepare('SELECT * FROM billing_profiles WHERE user_id = ? ORDER BY is_default DESC').all(req.user.id);

  // Aktif ödeme yöntemleri
  const paymentMethods = db.prepare('SELECT method, config, is_active FROM payment_settings WHERE is_active = 1').all();
  const methods = paymentMethods.map(m => {
    try { m.config = JSON.parse(m.config); } catch { m.config = {}; }
    return m;
  });

  const total = items.reduce((sum, item) => sum + ((item.sale_price || item.price) * item.quantity), 0);

  res.render('pages/checkout', {
    title: 'Ödeme',
    items,
    total,
    addresses,
    billingProfiles,
    paymentMethods: methods
  });
});

// Sipariş oluştur
router.post('/checkout', requireAuth, paymentLimiter, validateCsrf, async (req, res) => {
  const { payment_method, billing_profile_id, shipping_address_id, phone, notes } = req.body;

  // Sepet kontrolü
  const items = db.prepare(`
    SELECT ci.*, p.title, p.price, p.sale_price, p.stock, p.cover_image
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
    WHERE ci.user_id = ? AND p.is_active = 1
  `).all(req.user.id);

  if (items.length === 0) {
    return res.status(400).json({ error: 'Sepetiniz boş.' });
  }

  if (!payment_method) {
    return res.status(400).json({ error: 'Ödeme yöntemi seçiniz.' });
  }

  if (!billing_profile_id) {
    return res.status(400).json({ error: 'Fatura profili seçiniz.' });
  }

  if (!phone) {
    return res.status(400).json({ error: 'Telefon numarası gereklidir.' });
  }

  // Stok kontrolleri
  for (const item of items) {
    if (item.stock !== -1 && item.stock < item.quantity) {
      return res.status(400).json({ error: `"${item.title}" için yeterli stok yok.` });
    }
  }

  const baseTotal = items.reduce((sum, item) => sum + ((item.sale_price || item.price) * item.quantity), 0);

  // KDV hesapla
  const settings = getSettings();
  const kdvEnabled = settings.kdv_enabled === '1' || settings.kdv_enabled === 'true';
  const kdvRate = parseFloat(settings.kdv_rate) || 0;
  const kdvMult = kdvEnabled ? (1 + kdvRate / 100) : 1;
  const total = Math.round(baseTotal * kdvMult * 100) / 100;

  // Minimum sipariş kontrolü
  const minOrder = parseFloat(settings.shop_min_order || '0');
  if (minOrder > 0 && total < minOrder) {
    return res.status(400).json({ error: `Minimum sipariş tutarı ${settings.currency_symbol}${minOrder}` });
  }

  // Sipariş numarası ve ödeme kodu oluştur
  const orderNumber = 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const paymentCode = payment_method === 'iban' ? 'PAY-' + crypto.randomBytes(4).toString('hex').toUpperCase() : null;

  // Sipariş oluştur
  let orderId;
  try {
    const orderResult = db.prepare(`
    INSERT INTO orders (user_id, order_number, status, total, payment_method, payment_status, payment_code, billing_profile_id, shipping_address_id, phone, notes)
    VALUES (?, ?, 'pending', ?, ?, 'pending', ?, ?, ?, ?, ?)
  `).run(req.user.id, orderNumber, total, payment_method, paymentCode, billing_profile_id, shipping_address_id || null, phone.trim(), notes?.trim() || null);

  orderId = orderResult.lastInsertRowid;

  // Sipariş öğeleri
  const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, title, quantity, price, cover_image) VALUES (?, ?, ?, ?, ?, ?)');
  const updateStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock != -1');
  
  const createOrderItems = db.transaction(() => {
    for (const item of items) {
      const unitPrice = (item.sale_price || item.price) * kdvMult;
      const roundedPrice = Math.round(unitPrice * 100) / 100;
      insertItem.run(orderId, item.product_id, item.title, item.quantity, roundedPrice, item.cover_image);
      updateStock.run(item.quantity, item.product_id);
    }
  });
  createOrderItems();

  // Sepeti temizle
  db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
  } catch (err) {
    console.error('Sipariş oluşturma hatası:', err);
    return res.status(500).json({ error: 'Sipariş oluşturulamadı. Lütfen tekrar deneyin.' });
  }

  // E-posta gönder
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);

  // IBAN ödeme ise bilgileri al
  let ibanInfo = null;
  if (payment_method === 'iban') {
    const ps = db.prepare("SELECT config FROM payment_settings WHERE method = 'iban'").get();
    if (ps) {
      try { ibanInfo = JSON.parse(ps.config); } catch {}
    }
  }

  try {
    await sendOrderConfirmation(req.user, order, orderItems, ibanInfo);
  } catch (e) {
    console.error('Sipariş onay e-postası gönderilemedi:', e.message);
  }

  res.json({
    success: true,
    order: {
      id: orderId,
      order_number: orderNumber,
      total,
      payment_method,
      payment_code: paymentCode
    },
    ibanInfo
  });
});

// Ödeme onayla (IBAN)
router.post('/checkout/confirm-payment', requireAuth, paymentLimiter, validateCsrf, (req, res) => {
  const { order_id } = req.body;
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ? AND payment_method = 'iban' AND payment_status = 'pending'").get(order_id, req.user.id);
  
  if (!order) {
    return res.status(404).json({ error: 'Sipariş bulunamadı.' });
  }

  db.prepare("UPDATE orders SET payment_status = 'awaiting_confirmation', updated_at = datetime('now') WHERE id = ?").run(order.id);
  res.json({ success: true, message: 'Ödemeniz onay için sisteme düştü. En kısa sürede kontrol edilecektir.' });
});

module.exports = router;
