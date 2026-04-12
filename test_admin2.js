// Test admin dashboard render to find 500 cause
const { db, loadDatabase, getSettings } = require('./config/database');

loadDatabase().then(() => {
  try {
    const stats = {
      totalProducts: db.prepare('SELECT COUNT(*) as c FROM products').get().c,
      activeProducts: db.prepare("SELECT COUNT(*) as c FROM products WHERE is_active = 1").get().c,
      totalOrders: db.prepare('SELECT COUNT(*) as c FROM orders').get().c,
      pendingOrders: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get().c,
      awaitingPayment: db.prepare("SELECT COUNT(*) as c FROM orders WHERE payment_status = 'awaiting_confirmation'").get().c,
      totalUsers: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
      totalPosts: db.prepare('SELECT COUNT(*) as c FROM posts').get().c,
      totalRevenue: db.prepare("SELECT COALESCE(SUM(total), 0) as t FROM orders WHERE payment_status = 'confirmed'").get().t
    };
    console.log('stats:', JSON.stringify(stats));

    const recentOrders = db.prepare(`
      SELECT o.*, u.display_name as user_name, u.email as user_email FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC LIMIT 10
    `).all();
    console.log('recentOrders count:', recentOrders.length);

    const visitStats = {};
    const periods = [
      { key: 'today', label: 'Bugun', days: 0 },
      { key: 'week', label: '7 Gun', days: 7 }
    ];
    for (const p of periods) {
      const date = new Date();
      date.setDate(date.getDate() - p.days);
      const dateStr = date.toISOString().split('T')[0];
      visitStats[p.key] = db.prepare('SELECT COUNT(*) as c FROM visits WHERE created_at >= ?').get(dateStr).c;
    }
    console.log('visitStats:', JSON.stringify(visitStats));

    // Test EJS rendering
    const ejs = require('ejs');
    const ejsMate = require('ejs-mate');
    const path = require('path');
    const fs = require('fs');
    
    // Read the template
    const templatePath = path.join(__dirname, 'views', 'admin', 'dashboard.ejs');
    const template = fs.readFileSync(templatePath, 'utf8');
    
    const settings = getSettings();
    const locals = {
      title: 'Yonetim Paneli',
      layout: 'admin',
      stats,
      recentOrders,
      visitStats,
      site: { currency_symbol: settings.currency_symbol || '₺', name: settings.site_name || 'Site', favicon: null, logo: null, url: 'http://localhost:3000' },
      theme: { primary: '#2563eb', secondary: '#1e293b', accent: '#f59e0b' },
      currentPath: '/admin',
      user: { display_name: 'Admin', role: 'admin' },
      flash: null,
      csrfToken: 'test',
      shopCategories: [],
      blogCategories: [],
      cartCount: 0
    };
    
    const rendered = ejs.render(template, { ...locals, filename: templatePath });
    console.log('EJS render OK, length:', rendered.length);
    
  } catch(e) {
    console.error('ERROR:', e.message);
    console.error(e.stack);
  }
  process.exit(0);
}).catch(e => { console.error('DB load error:', e.message); process.exit(1); });
