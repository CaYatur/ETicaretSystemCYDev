/**
 * Blog Rotaları
 */

const express = require('express');
const router = express.Router();
const { db, getSetting } = require('../config/database');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

// Blog ana sayfa
router.get('/', (req, res) => {
  const perPage = parseInt(getSetting('blog_per_page', '10'));
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const offset = (page - 1) * perPage;
  const { category, search } = req.query;

  let where = ['p.is_published = 1'];
  let params = [];

  if (category) {
    const cat = db.prepare("SELECT id FROM categories WHERE slug = ? AND type = 'blog'").get(category);
    if (cat) {
      where.push('p.category_id = ?');
      params.push(cat.id);
    }
  }

  if (search) {
    where.push('(p.title LIKE ? OR p.content LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s);
  }

  const whereClause = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) as count FROM posts p WHERE ${whereClause}`).get(...params).count;
  
  const posts = db.prepare(`
    SELECT p.*, c.name as category_name, c.slug as category_slug,
           u.display_name as author_name, u.avatar as author_avatar
    FROM posts p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN users u ON p.author_id = u.id
    WHERE ${whereClause}
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, perPage, offset);

  const categories = db.prepare("SELECT * FROM categories WHERE type = 'blog' AND is_active = 1 ORDER BY sort_order").all();
  const totalPages = Math.ceil(total / perPage);

  res.render('pages/blog', {
    title: getSetting('blog_name', 'Blog'),
    posts,
    categories,
    currentCategory: category || '',
    currentSearch: search || '',
    currentPage: page,
    totalPages,
    total
  });
});

// Blog gönderi detay
router.get('/:slug', (req, res) => {
  const post = db.prepare(`
    SELECT p.*, c.name as category_name, c.slug as category_slug,
           u.display_name as author_name, u.avatar as author_avatar
    FROM posts p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN users u ON p.author_id = u.id
    WHERE p.slug = ? AND p.is_published = 1
  `).get(req.params.slug);

  if (!post) {
    return res.status(404).render('pages/error', { title: 'Bulunamadı', message: 'Gönderi bulunamadı.', code: 404 });
  }

  // Görüntülenme artır (oturum başına 1 kez)
  if (!req.session.viewedPosts) req.session.viewedPosts = [];
  if (!req.session.viewedPosts.includes(post.id)) {
    db.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?').run(post.id);
    req.session.viewedPosts.push(post.id);
  }

  // Markdown render
  const renderedContent = sanitizeHtml(marked.parse(post.content || ''), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'figure', 'figcaption']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      'img': ['src', 'alt', 'title', 'loading', 'width', 'height'],
      'a': ['href', 'name', 'target', 'rel']
    }
  });

  // İlgili gönderiler
  const related = db.prepare(`
    SELECT p.*, u.display_name as author_name FROM posts p
    LEFT JOIN users u ON p.author_id = u.id
    WHERE p.category_id = ? AND p.id != ? AND p.is_published = 1
    ORDER BY p.created_at DESC LIMIT 3
  `).all(post.category_id, post.id);

  res.render('pages/post', {
    title: post.meta_title || post.title,
    description: post.meta_description || post.excerpt,
    post: { ...post, renderedContent },
    related
  });
});

module.exports = router;
