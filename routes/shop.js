/**
 * Mağaza Rotaları
 * Ürün listeleme, detay, filtreleme
 */

const express = require('express');
const router = express.Router();
const { db, getSetting } = require('../config/database');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

// Mağaza ana sayfa - ürün listesi
router.get('/', (req, res) => {
  const perPage = parseInt(getSetting('shop_per_page', '12'));
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const offset = (page - 1) * perPage;
  const { category, search, sort, min_price, max_price } = req.query;

  let where = ['p.is_active = 1'];
  let params = [];

  if (category) {
    const cat = db.prepare("SELECT id FROM categories WHERE slug = ? AND type = 'shop'").get(category);
    if (cat) {
      where.push('p.category_id = ?');
      params.push(cat.id);
    }
  }

  if (search) {
    where.push('(p.title LIKE ? OR p.description LIKE ?)');
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm);
  }

  if (min_price) {
    where.push('COALESCE(p.sale_price, p.price) >= ?');
    params.push(parseFloat(min_price));
  }
  if (max_price) {
    where.push('COALESCE(p.sale_price, p.price) <= ?');
    params.push(parseFloat(max_price));
  }

  // Filtre değerleri
  if (req.query.filters) {
    try {
      const filters = JSON.parse(req.query.filters);
      for (const [filterId, value] of Object.entries(filters)) {
        if (value) {
          where.push('EXISTS (SELECT 1 FROM product_filter_values pfv WHERE pfv.product_id = p.id AND pfv.filter_id = ? AND pfv.value = ?)');
          params.push(parseInt(filterId), value);
        }
      }
    } catch {}
  }

  let orderBy = 'p.created_at DESC';
  if (sort === 'price_asc') orderBy = 'COALESCE(p.sale_price, p.price) ASC';
  else if (sort === 'price_desc') orderBy = 'COALESCE(p.sale_price, p.price) DESC';
  else if (sort === 'name_asc') orderBy = 'p.title ASC';
  else if (sort === 'name_desc') orderBy = 'p.title DESC';
  else if (sort === 'popular') orderBy = 'p.view_count DESC';

  const whereClause = where.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) as count FROM products p WHERE ${whereClause}`).get(...params).count;
  const products = db.prepare(`
    SELECT p.*, c.name as category_name, c.slug as category_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, perPage, offset);

  const categories = db.prepare("SELECT * FROM categories WHERE type = 'shop' AND is_active = 1 ORDER BY sort_order").all();

  // Filtreler (seçilen kategoriye göre)
  let filters = [];
  if (category) {
    const cat = db.prepare("SELECT id FROM categories WHERE slug = ? AND type = 'shop'").get(category);
    if (cat) {
      filters = db.prepare('SELECT * FROM product_filters WHERE category_id = ? ORDER BY sort_order').all(cat.id);
      filters = filters.map(f => {
        try { f.options = JSON.parse(f.options || '[]'); } catch { f.options = []; }
        return f;
      });
    }
  }

  const totalPages = Math.ceil(total / perPage);

  res.render('pages/shop', {
    title: getSetting('shop_name', 'Mağaza'),
    products,
    categories,
    filters,
    currentCategory: category || '',
    currentSearch: search || '',
    currentSort: sort || '',
    currentPage: page,
    totalPages,
    total,
    query: req.query
  });
});

// Ürün detay
router.get('/:slug', (req, res) => {
  const product = db.prepare(`
    SELECT p.*, c.name as category_name, c.slug as category_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.slug = ? AND p.is_active = 1
  `).get(req.params.slug);

  if (!product) {
    return res.status(404).render('pages/error', { title: 'Bulunamadı', message: 'Ürün bulunamadı.', code: 404 });
  }

  // Görüntülenme artır (oturum başına 1 kez)
  if (!req.session.viewedProducts) req.session.viewedProducts = [];
  if (!req.session.viewedProducts.includes(product.id)) {
    db.prepare('UPDATE products SET view_count = view_count + 1 WHERE id = ?').run(product.id);
    req.session.viewedProducts.push(product.id);
  }

  // Ürün görselleri
  const images = db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order').all(product.id);

  // Filtre değerleri
  const filterValues = db.prepare(`
    SELECT pf.name, pfv.value FROM product_filter_values pfv
    JOIN product_filters pf ON pfv.filter_id = pf.id
    WHERE pfv.product_id = ?
  `).all(product.id);

  // Benzer ürünler
  const related = db.prepare(`
    SELECT p.*, c.name as category_name FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.category_id = ? AND p.id != ? AND p.is_active = 1
    ORDER BY RANDOM() LIMIT 4
  `).all(product.category_id, product.id);

  // Markdown render
  const renderedContent = product.content ? sanitizeHtml(marked.parse(product.content), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      'img': ['src', 'alt', 'title', 'loading', 'width', 'height'],
      'a': ['href', 'name', 'target', 'rel'],
      'td': ['align'],
      'th': ['align']
    }
  }) : '';

  res.render('pages/product', {
    title: product.meta_title || product.title,
    description: product.meta_description || product.description,
    product,
    images,
    filterValues,
    related,
    renderedContent
  });
});

module.exports = router;
