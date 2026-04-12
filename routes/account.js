/**
 * Hesap Yönetimi Rotaları
 * Profil, siparişler, adresler, faturalandırma
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../config/database');
const { requireAuth, validateCsrf } = require('../middleware/auth');

// Tüm rotalar giriş gerektirir
router.use(requireAuth);

// Hesap dashboard
router.get('/', (req, res) => {
  const recentOrders = db.prepare(`
    SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 5
  `).all(req.user.id);

  const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders WHERE user_id = ?').get(req.user.id).count;
  const addressCount = db.prepare('SELECT COUNT(*) as count FROM addresses WHERE user_id = ?').get(req.user.id).count;
  const billingCount = db.prepare('SELECT COUNT(*) as count FROM billing_profiles WHERE user_id = ?').get(req.user.id).count;

  res.render('pages/account', {
    title: 'Hesabım',
    tab: 'overview',
    recentOrders,
    totalOrders,
    addressCount,
    billingCount
  });
});

// Profil güncelle
router.post('/profile', validateCsrf, (req, res) => {
  const { display_name, phone } = req.body;
  if (!display_name || display_name.trim().length < 2) {
    req.session.flash = { type: 'error', message: 'Geçerli bir ad giriniz.' };
    return res.redirect('/account');
  }

  db.prepare('UPDATE users SET display_name = ?, phone = ?, updated_at = datetime("now") WHERE id = ?')
    .run(display_name.trim(), phone?.trim() || null, req.user.id);

  req.session.flash = { type: 'success', message: 'Profiliniz güncellendi.' };
  res.redirect('/account');
});

// Şifre değiştir
router.post('/password', validateCsrf, (req, res) => {
  const { current_password, new_password, new_password_confirm } = req.body;
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);

  if (user.password_hash && !bcrypt.compareSync(current_password || '', user.password_hash)) {
    req.session.flash = { type: 'error', message: 'Mevcut şifre yanlış.' };
    return res.redirect('/account');
  }

  if (!new_password || new_password.length < 8) {
    req.session.flash = { type: 'error', message: 'Yeni şifre en az 8 karakter olmalıdır.' };
    return res.redirect('/account');
  }

  if (new_password !== new_password_confirm) {
    req.session.flash = { type: 'error', message: 'Şifreler eşleşmiyor.' };
    return res.redirect('/account');
  }

  const hash = bcrypt.hashSync(new_password, 12);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?').run(hash, req.user.id);

  req.session.flash = { type: 'success', message: 'Şifreniz değiştirildi.' };
  res.redirect('/account');
});

// ==========================================
// SİPARİŞLER
// ==========================================
router.get('/orders', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = 10;
  const offset = (page - 1) * perPage;

  const total = db.prepare('SELECT COUNT(*) as count FROM orders WHERE user_id = ?').get(req.user.id).count;
  const orders = db.prepare(`
    SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(req.user.id, perPage, offset);

  res.render('pages/orders', {
    title: 'Siparişlerim',
    orders,
    currentPage: page,
    totalPages: Math.ceil(total / perPage)
  });
});

router.get('/orders/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!order) {
    return res.status(404).render('pages/error', { title: 'Bulunamadı', message: 'Sipariş bulunamadı.', code: 404 });
  }

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const billing = order.billing_profile_id ? db.prepare('SELECT * FROM billing_profiles WHERE id = ?').get(order.billing_profile_id) : null;
  const shippingAddress = order.shipping_address_id ? db.prepare('SELECT * FROM addresses WHERE id = ?').get(order.shipping_address_id) : null;

  // IBAN bilgileri (eğer ödeme yöntemi IBAN ise)
  let ibanInfo = null;
  if (order.payment_method === 'iban') {
    const ps = db.prepare("SELECT config FROM payment_settings WHERE method = 'iban' AND is_active = 1").get();
    if (ps) {
      try { ibanInfo = JSON.parse(ps.config); } catch {}
    }
  }

  res.render('pages/order-detail', {
    title: `Sipariş #${order.order_number}`,
    order,
    items,
    billing,
    shippingAddress,
    ibanInfo
  });
});

// Sipariş iptal
router.post('/orders/:id/cancel', validateCsrf, (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!order) {
    req.session.flash = { type: 'error', message: 'Sipariş bulunamadı.' };
    return res.redirect('/account/orders');
  }
  if (order.status !== 'pending' || order.payment_status === 'confirmed') {
    req.session.flash = { type: 'error', message: 'Bu sipariş iptal edilemez.' };
    return res.redirect(`/account/orders/${order.id}`);
  }

  // Stokları geri ekle
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const restoreStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ? AND stock != -1');
  const cancelOrder = db.transaction(() => {
    for (const item of items) {
      restoreStock.run(item.quantity, item.product_id);
    }
    db.prepare("UPDATE orders SET status = 'cancelled', payment_status = 'failed', updated_at = datetime('now') WHERE id = ?").run(order.id);
  });
  cancelOrder();

  req.session.flash = { type: 'success', message: 'Siparişiniz iptal edildi.' };
  res.redirect(`/account/orders/${order.id}`);
});

// ==========================================
// ADRES YÖNETİMİ
// ==========================================
router.get('/addresses', (req, res) => {
  const addresses = db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC').all(req.user.id);
  res.render('pages/addresses', { title: 'Adreslerim', addresses });
});

router.post('/addresses', validateCsrf, (req, res) => {
  const { title, first_name, last_name, address, city, district, zip_code, country, phone, is_default } = req.body;
  
  if (!title || !first_name || !last_name || !address || !city) {
    req.session.flash = { type: 'error', message: 'Zorunlu alanları doldurunuz.' };
    return res.redirect('/account/addresses');
  }

  if (is_default) {
    db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
  }

  db.prepare(`
    INSERT INTO addresses (user_id, title, first_name, last_name, address, city, district, zip_code, country, phone, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, title.trim(), first_name.trim(), last_name.trim(), address.trim(), city.trim(),
    district?.trim() || null, zip_code?.trim() || null, country?.trim() || 'Türkiye', phone?.trim() || null, is_default ? 1 : 0);

  req.session.flash = { type: 'success', message: 'Adres eklendi.' };
  res.redirect('/account/addresses');
});

router.post('/addresses/:id/update', validateCsrf, (req, res) => {
  const addr = db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!addr) return res.status(404).json({ error: 'Adres bulunamadı.' });

  const { title, first_name, last_name, address, city, district, zip_code, country, phone, is_default } = req.body;

  if (is_default) {
    db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
  }

  db.prepare(`
    UPDATE addresses SET title=?, first_name=?, last_name=?, address=?, city=?, district=?, zip_code=?, country=?, phone=?, is_default=?
    WHERE id = ? AND user_id = ?
  `).run(title?.trim(), first_name?.trim(), last_name?.trim(), address?.trim(), city?.trim(),
    district?.trim() || null, zip_code?.trim() || null, country?.trim() || 'Türkiye', phone?.trim() || null,
    is_default ? 1 : 0, req.params.id, req.user.id);

  req.session.flash = { type: 'success', message: 'Adres güncellendi.' };
  res.redirect('/account/addresses');
});

router.post('/addresses/:id/delete', validateCsrf, (req, res) => {
  db.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  req.session.flash = { type: 'success', message: 'Adres silindi.' };
  res.redirect('/account/addresses');
});

// ==========================================
// FATURALANDIRMA PROFİLLERİ
// ==========================================
router.get('/billing', (req, res) => {
  const profiles = db.prepare('SELECT * FROM billing_profiles WHERE user_id = ? ORDER BY is_default DESC, created_at DESC').all(req.user.id);
  res.render('pages/billing', { title: 'Fatura Bilgilerim', profiles });
});

router.post('/billing', validateCsrf, (req, res) => {
  const { type, first_name, last_name, tc_no, company_name, tax_office, tax_no,
    address, city, district, zip_code, country, phone, email, is_default } = req.body;

  if (!type || !address || !city) {
    req.session.flash = { type: 'error', message: 'Zorunlu alanları doldurunuz.' };
    return res.redirect('/account/billing');
  }

  if (type === 'individual' && (!first_name || !last_name)) {
    req.session.flash = { type: 'error', message: 'Ad ve soyad gereklidir.' };
    return res.redirect('/account/billing');
  }

  if (type === 'corporate' && (!company_name || !tax_office || !tax_no)) {
    req.session.flash = { type: 'error', message: 'Firma bilgileri gereklidir.' };
    return res.redirect('/account/billing');
  }

  if (is_default) {
    db.prepare('UPDATE billing_profiles SET is_default = 0 WHERE user_id = ?').run(req.user.id);
  }

  db.prepare(`
    INSERT INTO billing_profiles (user_id, type, first_name, last_name, tc_no, company_name, tax_office, tax_no,
      address, city, district, zip_code, country, phone, email, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, type, first_name?.trim(), last_name?.trim(), tc_no?.trim() || null,
    company_name?.trim() || null, tax_office?.trim() || null, tax_no?.trim() || null,
    address.trim(), city.trim(), district?.trim() || null, zip_code?.trim() || null,
    country?.trim() || 'Türkiye', phone?.trim() || null, email?.trim() || null, is_default ? 1 : 0);

  req.session.flash = { type: 'success', message: 'Fatura profili eklendi.' };
  res.redirect('/account/billing');
});

router.post('/billing/:id/update', validateCsrf, (req, res) => {
  const profile = db.prepare('SELECT * FROM billing_profiles WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!profile) return res.status(404).json({ error: 'Profil bulunamadı.' });

  const { type, first_name, last_name, tc_no, company_name, tax_office, tax_no,
    address, city, district, zip_code, country, phone, email, is_default } = req.body;

  if (is_default) {
    db.prepare('UPDATE billing_profiles SET is_default = 0 WHERE user_id = ?').run(req.user.id);
  }

  db.prepare(`
    UPDATE billing_profiles SET type=?, first_name=?, last_name=?, tc_no=?, company_name=?, tax_office=?, tax_no=?,
      address=?, city=?, district=?, zip_code=?, country=?, phone=?, email=?, is_default=?
    WHERE id = ? AND user_id = ?
  `).run(type, first_name?.trim(), last_name?.trim(), tc_no?.trim() || null,
    company_name?.trim() || null, tax_office?.trim() || null, tax_no?.trim() || null,
    address?.trim(), city?.trim(), district?.trim() || null, zip_code?.trim() || null,
    country?.trim() || 'Türkiye', phone?.trim() || null, email?.trim() || null,
    is_default ? 1 : 0, req.params.id, req.user.id);

  req.session.flash = { type: 'success', message: 'Fatura profili güncellendi.' };
  res.redirect('/account/billing');
});

router.post('/billing/:id/delete', validateCsrf, (req, res) => {
  db.prepare('DELETE FROM billing_profiles WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  req.session.flash = { type: 'success', message: 'Fatura profili silindi.' };
  res.redirect('/account/billing');
});

module.exports = router;
