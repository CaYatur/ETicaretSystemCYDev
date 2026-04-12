/**
 * Ana Sayfa ve Genel Rotalar
 */

const express = require('express');
const router = express.Router();
const { db, getSettings } = require('../config/database');

// Ana sayfa
router.get('/', (req, res) => {
  const sections = db.prepare(`
    SELECT * FROM homepage_sections WHERE is_active = 1 ORDER BY sort_order
  `).all();

  // Slaytları yükle
  let slides = [];
  try {
    slides = db.prepare('SELECT * FROM homepage_slides WHERE is_active = 1 ORDER BY sort_order').all();
  } catch(e) { /* tablo henüz yoksa */ }

  // Her bölüm için gerekli verileri çek
  const processedSections = sections.map(section => {
    const s = { ...section };
    try { s.content = JSON.parse(s.content || '{}'); } catch { s.content = {}; }
    try { s.style = JSON.parse(s.style || '{}'); } catch { s.style = {}; }

    if (s.type === 'categories') {
      s.categories = db.prepare("SELECT * FROM categories WHERE type = 'shop' AND is_active = 1 ORDER BY sort_order LIMIT 8").all();
    }
    if (s.type === 'featured') {
      const limit = s.content.limit || 8;
      s.products = db.prepare(`
        SELECT p.*, c.name as category_name FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.is_active = 1 AND p.is_featured = 1
        ORDER BY p.created_at DESC LIMIT ?
      `).all(limit);
    }
    if (s.type === 'latest_products') {
      const limit = s.content.limit || 8;
      s.products = db.prepare(`
        SELECT p.*, c.name as category_name FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.is_active = 1
        ORDER BY p.created_at DESC LIMIT ?
      `).all(limit);
    }
    if (s.type === 'latest_posts') {
      const limit = s.content.limit || 4;
      s.posts = db.prepare(`
        SELECT p.*, c.name as category_name, u.display_name as author_name FROM posts p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN users u ON p.author_id = u.id
        WHERE p.is_published = 1
        ORDER BY p.created_at DESC LIMIT ?
      `).all(limit);
    }
    return s;
  });

  res.render('pages/home', {
    title: getSettings().site_name || 'Ana Sayfa',
    sections: processedSections,
    slides
  });
});

// İletişim sayfası
router.get('/contact', (req, res) => {
  const methods = db.prepare('SELECT * FROM contact_methods WHERE is_active = 1 ORDER BY sort_order').all();
  res.render('pages/contact', {
    title: 'İletişim',
    methods
  });
});

// Yasal sayfalar
router.get('/legal/:slug', (req, res) => {
  const page = db.prepare('SELECT * FROM legal_pages WHERE slug = ? AND is_active = 1').get(req.params.slug);
  if (!page) {
    return res.status(404).render('pages/error', { title: 'Bulunamadı', message: 'Sayfa bulunamadı.', code: 404 });
  }
  res.render('pages/legal', { title: page.title, page });
});

// robots.txt
router.get('/robots.txt', (req, res) => {
  const settings = getSettings();
  const siteUrl = settings.site_url || process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`;
  
  // Use custom robots.txt from settings if available
  if (settings.robots_txt) {
    res.type('text/plain');
    return res.send(settings.robots_txt);
  }
  
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /
Disallow: /admin/
Disallow: /api/
Disallow: /account/
Disallow: /auth/

Sitemap: ${siteUrl}/sitemap.xml
Sitemap: ${siteUrl}/sitemap.txt
`);
});

module.exports = router;
