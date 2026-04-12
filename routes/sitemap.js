/**
 * Sitemap Rotaları
 * Dinamik XML ve TXT sitemap oluşturma
 */

const express = require('express');
const router = express.Router();
const { db, getSettings } = require('../config/database');

function getUrls() {
  const settings = getSettings();
  const siteUrl = settings.site_url || process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`;

  let urls = [];

  // Statik sayfalar
  urls.push({ loc: siteUrl + '/', changefreq: 'daily', priority: '1.0' });
  urls.push({ loc: siteUrl + '/shop', changefreq: 'daily', priority: '0.9' });
  urls.push({ loc: siteUrl + '/blog', changefreq: 'daily', priority: '0.8' });
  urls.push({ loc: siteUrl + '/contact', changefreq: 'monthly', priority: '0.5' });

  // Mağaza kategorileri
  const shopCats = db.prepare("SELECT slug, created_at FROM categories WHERE type = 'shop' AND is_active = 1").all();
  shopCats.forEach(c => {
    urls.push({
      loc: `${siteUrl}/shop?category=${c.slug}`,
      changefreq: 'weekly',
      priority: '0.8',
      lastmod: c.created_at?.split(' ')[0]
    });
  });

  // Ürünler
  const products = db.prepare('SELECT slug, updated_at FROM products WHERE is_active = 1').all();
  products.forEach(p => {
    urls.push({
      loc: `${siteUrl}/shop/${p.slug}`,
      changefreq: 'weekly',
      priority: '0.7',
      lastmod: p.updated_at?.split(' ')[0]
    });
  });

  // Blog kategorileri
  const blogCats = db.prepare("SELECT slug, created_at FROM categories WHERE type = 'blog' AND is_active = 1").all();
  blogCats.forEach(c => {
    urls.push({
      loc: `${siteUrl}/blog?category=${c.slug}`,
      changefreq: 'weekly',
      priority: '0.7',
      lastmod: c.created_at?.split(' ')[0]
    });
  });

  // Blog gönderileri
  const posts = db.prepare('SELECT slug, updated_at FROM posts WHERE is_published = 1').all();
  posts.forEach(p => {
    urls.push({
      loc: `${siteUrl}/blog/${p.slug}`,
      changefreq: 'monthly',
      priority: '0.6',
      lastmod: p.updated_at?.split(' ')[0]
    });
  });

  // Yasal sayfalar
  const legalPages = db.prepare('SELECT slug, updated_at FROM legal_pages WHERE is_active = 1').all();
  legalPages.forEach(p => {
    urls.push({
      loc: `${siteUrl}/legal/${p.slug}`,
      changefreq: 'monthly',
      priority: '0.3',
      lastmod: p.updated_at?.split(' ')[0]
    });
  });

  return urls;
}

router.get('/sitemap.xml', (req, res) => {
  const urls = getUrls();

  // XML oluştur
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  
  for (const url of urls) {
    xml += '  <url>\n';
    xml += `    <loc>${escapeXml(url.loc)}</loc>\n`;
    if (url.lastmod) xml += `    <lastmod>${url.lastmod}</lastmod>\n`;
    xml += `    <changefreq>${url.changefreq}</changefreq>\n`;
    xml += `    <priority>${url.priority}</priority>\n`;
    xml += '  </url>\n';
  }
  
  xml += '</urlset>';

  res.type('application/xml');
  res.send(xml);
});

// /sitemap serves XML as well
router.get('/sitemap', (req, res) => {
  res.redirect(301, '/sitemap.xml');
});

// TXT sitemap
router.get('/sitemap.txt', (req, res) => {
  const urls = getUrls();
  const txt = urls.map(u => u.loc).join('\n');
  res.type('text/plain');
  res.send(txt);
});

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

module.exports = router;
