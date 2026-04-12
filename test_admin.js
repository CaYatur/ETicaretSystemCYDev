const { db, loadDatabase } = require('./config/database');
loadDatabase().then(() => {
  try {
    const t1 = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
    console.log('products OK:', t1);
    const t2 = db.prepare("SELECT COUNT(*) as c FROM orders WHERE payment_status = 'awaiting_confirmation'").get().c;
    console.log('awaitingPayment OK:', t2);
    const t3 = db.prepare("SELECT COUNT(*) as c FROM orders WHERE payment_status = 'confirmed'").get().t;
    console.log('revenue query:', t3);
    const t4 = db.prepare('SELECT COUNT(*) as c FROM visits WHERE created_at >= ?').get('2026-04-12').c;
    console.log('visits OK:', t4);
    const t5 = db.prepare('SELECT COUNT(*) as c FROM role_permissions WHERE role = ? AND permission = ?').get('admin', 'admin.access');
    console.log('role_permissions OK:', JSON.stringify(t5));
    const t6 = db.prepare('SELECT id FROM role_permissions WHERE role = ? AND permission = ?').get('admin', 'admin.access');
    console.log('admin.access:', JSON.stringify(t6));
  } catch(e) {
    console.error('ERROR:', e.message);
    console.error(e.stack);
  }
  process.exit(0);
}).catch(e => { console.error('Load DB error:', e.message); process.exit(1); });
