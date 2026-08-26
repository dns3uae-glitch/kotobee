'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');

const DB = require('./lib/db');
const C = require('./lib/core');
const PAY = require('./lib/payments');
const V = require('./views/store');
const A = require('./views/admin');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

const db = DB.open();
const created = DB.seed(db, process.env.ADMIN_USER, process.env.ADMIN_PASS);

const TERMS = `الشروط والاستبدال

- التسليم يتم داخل سيرفر خاص باللعبة، ولا نطلب كلمة مرور حسابك في أي حال.
- مدة التسليم المعتادة من دقيقة إلى خمس دقائق بعد تأكيد الدفع.
- إن تعذر التسليم لأي سبب من جهتنا، يُعاد المبلغ كاملًا.
- الطلب المدفوع والمُسلَّم لا يُستبدل، لأن المنتج رقمي ويُستلم فورًا.
- لأي مشكلة، افتح صفحة تتبع الطلب وأرسل رقم الطلب.`;

/* ----------------------------- helpers ----------------------------- */

function loadSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = Object.assign({}, DB.DEFAULT_SETTINGS);
  for (const row of rows) out[row.key] = row.value;
  return out;
}

function saveSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

function categories() {
  return db.prepare(
    'SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count ' +
    'FROM categories c ORDER BY sort, id'
  ).all();
}

function makeCtx(req, res) {
  const settings = loadSettings();
  const cart = C.getCart(req);
  let count = 0;
  for (const item of cart.items) count += item.qty;
  return {
    settings: settings,
    categories: categories(),
    cart: cart,
    cartCount: count,
    csrf: C.csrfToken(req, res),
    flash: C.takeFlash(req, res)
  };
}

function priceCart(cart) {
  const lines = [];
  let subtotal = 0;
  for (const item of cart.items) {
    const p = db.prepare('SELECT id, name, slug, price, stock, kind FROM products WHERE id = ? AND is_active = 1').get(item.id);
    if (!p) continue;
    let qty = item.qty;
    if (p.kind === 'digital' && p.stock >= 0) qty = Math.min(qty, Math.max(0, p.stock));
    if (qty <= 0) continue;
    lines.push({ id: p.id, name: p.name, slug: p.slug, price: p.price, qty: qty, stock: p.stock });
    subtotal += p.price * qty;
  }

  let discount = 0;
  let couponCode = '';
  if (cart.coupon) {
    const c = db.prepare('SELECT * FROM coupons WHERE code = ? AND is_active = 1').get(cart.coupon);
    if (c && (c.max_uses === 0 || c.used < c.max_uses)) {
      couponCode = c.code;
      discount = c.percent > 0 ? subtotal * (c.percent / 100) : 0;
      discount += Number(c.amount) || 0;
      if (discount > subtotal) discount = subtotal;
    }
  }
  const total = Math.max(0, subtotal - discount);
  return {
    lines: lines,
    subtotal: Math.round(subtotal * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    total: Math.round(total * 100) / 100,
    coupon: couponCode
  };
}

function baseUrl(req, settings) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, '');
  if (settings.base_url) return settings.base_url.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return proto + '://' + (req.headers.host || 'localhost:' + PORT);
}

/* Mark an order paid: assign codes, cut stock, count coupon use. */
function markPaid(order, gatewayRef) {
  if (order.status === 'paid' || order.status === 'delivered') return order;

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const deliveredCodes = [];

  for (const item of items) {
    if (!item.product_id) continue;
    db.prepare('UPDATE products SET stock = MAX(0, stock - ?), sold_count = sold_count + ? WHERE id = ?')
      .run(item.qty, item.qty, item.product_id);

    const free = db.prepare(
      'SELECT id, code FROM codes WHERE product_id = ? AND used_at IS NULL LIMIT ?'
    ).all(item.product_id, item.qty);
    for (const row of free) {
      db.prepare('UPDATE codes SET used_at = datetime(\'now\'), order_id = ? WHERE id = ?')
        .run(order.id, row.id);
      deliveredCodes.push(item.name + ': ' + row.code);
    }
  }

  if (order.coupon_code) {
    db.prepare('UPDATE coupons SET used = used + 1 WHERE code = ?').run(order.coupon_code);
  }

  const delivery = deliveredCodes.length
    ? deliveredCodes.join('\n')
    : order.delivery;

  db.prepare(
    'UPDATE orders SET status = ?, paid_at = datetime(\'now\'), gateway_ref = ?, delivery = ? WHERE id = ?'
  ).run(deliveredCodes.length ? 'delivered' : 'paid', gatewayRef || order.gateway_ref, delivery || '', order.id);

  return db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
}

function requireAdmin(req, res) {
  const admin = C.getAdmin(req);
  if (!admin) {
    C.redirect(res, '/admin/login');
    return null;
  }
  return admin;
}

function tooManyLogins(ip) {
  const row = db.prepare(
    "SELECT COUNT(*) AS c FROM logins WHERE ip = ? AND ok = 0 AND at > datetime('now', '-10 minutes')"
  ).get(ip);
  return row.c >= 8;
}

/* ----------------------------- routes ----------------------------- */

async function handle(req, res, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();

  /* static */
  if (p.startsWith('/assets/')) {
    const file = C.safeJoin(C.PUBLIC_DIR, p.slice('/assets/'.length));
    if (file && C.serveFile(res, file)) return;
    return C.html(res, 'not found', 404);
  }
  if (p.startsWith('/uploads/')) {
    const file = C.safeJoin(C.UPLOAD_DIR, p.slice('/uploads/'.length));
    if (file && C.serveFile(res, file)) return;
    return C.html(res, 'not found', 404);
  }

  /* admin login (no session needed) */
  if (p === '/admin/login') {
    const ctx = makeCtx(req, res);
    if (method === 'GET') {
      if (C.getAdmin(req)) return C.redirect(res, '/admin');
      return C.html(res, A.login(ctx, {}));
    }
    const body = await C.parseRequestBody(req);
    if (!C.csrfOk(req, body)) return C.html(res, A.login(ctx, { error: 'انتهت الجلسة، أعد المحاولة.' }), 403);
    const ip = req.socket.remoteAddress || '0.0.0.0';
    if (tooManyLogins(ip)) {
      return C.html(res, A.login(ctx, { error: 'محاولات كثيرة. انتظر عشر دقائق.' }), 429);
    }
    const user = db.prepare('SELECT * FROM admins WHERE username = ?').get(String(body.fields.username || ''));
    const ok = user && DB.verifyPassword(String(body.fields.password || ''), user.password_hash);
    db.prepare('INSERT INTO logins (ip, ok) VALUES (?, ?)').run(ip, ok ? 1 : 0);
    if (!ok) return C.html(res, A.login(ctx, { error: 'بيانات الدخول غير صحيحة.' }), 401);
    C.setAdmin(res, user);
    return C.redirect(res, '/admin');
  }

  if (p === '/admin/logout' && method === 'POST') {
    C.clearCookie(res, 'sid');
    return C.redirect(res, '/');
  }

  /* admin area */
  if (p === '/admin' || p.startsWith('/admin/')) {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    return adminRoutes(req, res, p, method, url);
  }

  const ctx = makeCtx(req, res);

  /* home */
  if (p === '/' && method === 'GET') {
    const featured = db.prepare(
      'SELECT * FROM products WHERE is_active = 1 ORDER BY is_featured DESC, sold_count DESC LIMIT 6'
    ).all();
    const ticker = db.prepare(
      'SELECT name, sold_count FROM products WHERE is_active = 1 ORDER BY sold_count DESC LIMIT 6'
    ).all();
    const stats = {
      orders: db.prepare("SELECT COUNT(*) AS c FROM orders WHERE status IN ('paid','delivered')").get().c,
      products: db.prepare('SELECT COUNT(*) AS c FROM products WHERE is_active = 1').get().c
    };
    return C.html(res, V.home(ctx, { featured: featured, ticker: ticker, stats: stats }));
  }

  /* catalog */
  if (p === '/products' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    let products;
    if (q) {
      products = db.prepare(
        'SELECT * FROM products WHERE is_active = 1 AND (name LIKE ? OR summary LIKE ?) ORDER BY sold_count DESC'
      ).all('%' + q + '%', '%' + q + '%');
    } else {
      products = db.prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY is_featured DESC, id DESC').all();
    }
    return C.html(res, V.catalog(ctx, { title: q ? 'نتائج البحث' : 'كل الغنائم', products: products, q: q }));
  }

  /* category */
  const catMatch = /^\/c\/([A-Za-z0-9\-_%\u0600-\u06FF]+)$/.exec(p);
  if (catMatch && method === 'GET') {
    const slug = decodeURIComponent(catMatch[1]);
    const cat = db.prepare('SELECT * FROM categories WHERE slug = ?').get(slug);
    if (!cat) return C.html(res, V.notFound(ctx), 404);
    const products = db.prepare(
      'SELECT * FROM products WHERE is_active = 1 AND category_id = ? ORDER BY sold_count DESC'
    ).all(cat.id);
    return C.html(res, V.catalog(ctx, { title: cat.name, products: products }));
  }

  /* product */
  const prodMatch = /^\/p\/([A-Za-z0-9\-_%\u0600-\u06FF]+)$/.exec(p);
  if (prodMatch && method === 'GET') {
    const slug = decodeURIComponent(prodMatch[1]);
    const product = db.prepare('SELECT * FROM products WHERE slug = ? AND is_active = 1').get(slug);
    if (!product) return C.html(res, V.notFound(ctx), 404);
    const related = db.prepare(
      'SELECT * FROM products WHERE is_active = 1 AND id != ? AND (category_id = ? OR ? IS NULL) ORDER BY sold_count DESC LIMIT 3'
    ).all(product.id, product.category_id, product.category_id);
    return C.html(res, V.product(ctx, { product: product, related: related }));
  }

  /* cart */
  if (p === '/cart' && method === 'GET') {
    const priced = priceCart(ctx.cart);
    return C.html(res, V.cart(ctx, priced));
  }

  if (p === '/cart/add' && method === 'POST') {
    const body = await C.parseRequestBody(req);
    if (!C.csrfOk(req, body)) return C.html(res, 'csrf', 403);
    const id = parseInt(body.fields.id, 10);
    const qty = Math.max(1, Math.min(99, parseInt(body.fields.qty || '1', 10) || 1));
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(id);
    if (!product) {
      C.setFlash(res, 'error', 'المنتج غير متاح.');
      return C.redirect(res, '/products');
    }
    const cart = ctx.cart;
    const found = cart.items.find(function (x) { return x.id === id; });
    if (found) found.qty = Math.min(99, found.qty + qty);
    else cart.items.push({ id: id, qty: qty });
    C.setCart(res, cart);
    C.setFlash(res, 'ok', 'أُضيفت ' + product.name + ' إلى السلة.');
    return C.redirect(res, '/cart');
  }

  if (p === '/cart/update' && method === 'POST') {
    const body = await C.parseRequestBody(req);
    if (!C.csrfOk(req, body)) return C.html(res, 'csrf', 403);
    const items = [];
    for (const key of Object.keys(body.fields)) {
      const m = /^qty_(\d+)$/.exec(key);
      if (!m) continue;
      const qty = parseInt(body.fields[key], 10);
      if (Number.isInteger(qty) && qty > 0) items.push({ id: parseInt(m[1], 10), qty: Math.min(99, qty) });
    }
    C.setCart(res, { items: items, coupon: ctx.cart.coupon });
    C.setFlash(res, 'ok', 'حُدّثت السلة.');
    return C.redirect(res, '/cart');
  }

  if (p === '/cart/coupon' && method === 'POST') {
    const body = await C.parseRequestBody(req);
    if (!C.csrfOk(req, body)) return C.html(res, 'csrf', 403);
    const code = String(body.fields.code || '').trim();
    const coupon = code
      ? db.prepare('SELECT * FROM coupons WHERE code = ? AND is_active = 1').get(code)
      : null;
    C.setCart(res, { items: ctx.cart.items, coupon: coupon ? coupon.code : '' });
    C.setFlash(res, coupon ? 'ok' : 'error', coupon ? 'طُبِّق كود الخصم.' : 'كود الخصم غير صالح.');
    return C.redirect(res, '/cart');
  }

  /* checkout */
  if (p === '/checkout' && method === 'GET') {
    const priced = priceCart(ctx.cart);
    if (!priced.lines.length) return C.redirect(res, '/cart');
    return C.html(res, V.checkout(ctx, {
      subtotal: priced.subtotal,
      discount: priced.discount,
      total: priced.total,
      gateways: PAY.availableGateways(ctx.settings),
      old: {}
    }));
  }

  if (p === '/checkout' && method === 'POST') {
    const body = await C.parseRequestBody(req);
    if (!C.csrfOk(req, body)) return C.html(res, 'csrf', 403);
    const priced = priceCart(ctx.cart);
    if (!priced.lines.length) return C.redirect(res, '/cart');

    const gateways = PAY.availableGateways(ctx.settings);
    const chosen = gateways.find(function (g) { return g.id === body.fields.gateway; }) || gateways[0];
    if (!chosen) {
      C.setFlash(res, 'error', 'لا توجد طريقة دفع مفعّلة. راجع لوحة التحكم.');
      return C.redirect(res, '/cart');
    }

    const name = String(body.fields.customer_name || '').trim();
    const game = String(body.fields.game_username || '').trim();
    if (!name || !game) {
      C.setFlash(res, 'error', 'الاسم واسم الحساب في اللعبة مطلوبان.');
      return C.redirect(res, '/checkout');
    }

    const ref = C.orderRef();
    const info = db.prepare(
      'INSERT INTO orders (ref, customer_name, customer_email, customer_phone, game_username, note, ' +
      'subtotal, discount, total, currency, coupon_code, gateway, status) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      ref, name,
      String(body.fields.customer_email || '').trim(),
      String(body.fields.customer_phone || '').trim(),
      game,
      String(body.fields.note || '').trim(),
      priced.subtotal, priced.discount, priced.total,
      ctx.settings.currency, priced.coupon, chosen.id, 'pending'
    );
    const orderId = Number(info.lastInsertRowid);

    const insItem = db.prepare(
      'INSERT INTO order_items (order_id, product_id, name, price, qty) VALUES (?, ?, ?, ?, ?)'
    );
    for (const line of priced.lines) {
      insItem.run(orderId, line.id, line.name, line.price, line.qty);
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    C.setCart(res, { items: [], coupon: '' });

    const root = baseUrl(req, ctx.settings);
    if (chosen.id === 'stripe') {
      const out = await PAY.stripeCreate(
        ctx.settings, order, priced.lines,
        root + '/pay/return?ref=' + ref + '&session_id={CHECKOUT_SESSION_ID}',
        root + '/order/' + ref
      );
      if (!out.ok) {
        C.setFlash(res, 'error', out.error);
        return C.redirect(res, '/order/' + ref);
      }
      db.prepare('UPDATE orders SET gateway_ref = ? WHERE id = ?').run(out.ref || '', orderId);
      return C.redirect(res, out.url);
    }

    if (chosen.id === 'paypal') {
      const out = await PAY.paypalCreate(
        ctx.settings, order, priced.lines,
        root + '/pay/return?ref=' + ref,
        root + '/order/' + ref
      );
      if (!out.ok) {
        C.setFlash(res, 'error', out.error);
        return C.redirect(res, '/order/' + ref);
      }
      db.prepare('UPDATE orders SET gateway_ref = ? WHERE id = ?').run(out.ref || '', orderId);
      return C.redirect(res, out.url);
    }

    C.setFlash(res, 'ok', 'تم إنشاء الطلب. حوّل المبلغ وأرسل صورة التحويل.');
    return C.redirect(res, '/order/' + ref);
  }

  /* payment return */
  if (p === '/pay/return' && method === 'GET') {
    const ref = url.searchParams.get('ref') || '';
    const order = db.prepare('SELECT * FROM orders WHERE ref = ?').get(ref);
    if (!order) return C.html(res, V.notFound(ctx), 404);

    let result = { paid: false };
    if (order.gateway === 'stripe') {
      result = await PAY.stripeVerify(ctx.settings, url.searchParams.get('session_id') || order.gateway_ref);
    } else if (order.gateway === 'paypal') {
      result = await PAY.paypalCapture(ctx.settings, url.searchParams.get('token') || order.gateway_ref);
    }

    if (result.paid) {
      markPaid(order, result.ref);
      C.setFlash(res, 'ok', 'تم تأكيد الدفع.');
    } else {
      C.setFlash(res, 'error', 'لم يتم تأكيد الدفع بعد.');
    }
    return C.redirect(res, '/order/' + ref);
  }

  /* order page */
  const orderMatch = /^\/order\/([A-Za-z0-9]+)$/.exec(p);
  if (orderMatch && method === 'GET') {
    const order = db.prepare('SELECT * FROM orders WHERE ref = ?').get(orderMatch[1]);
    if (!order) return C.html(res, V.notFound(ctx), 404);
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    return C.html(res, V.orderPage(ctx, { order: order, items: items }));
  }

  const proofMatch = /^\/order\/([A-Za-z0-9]+)\/proof$/.exec(p);
  if (proofMatch && method === 'POST') {
    const body = await C.parseRequestBody(req);
    if (!C.csrfOk(req, body)) return C.html(res, 'csrf', 403);
    const order = db.prepare('SELECT * FROM orders WHERE ref = ?').get(proofMatch[1]);
    if (!order) return C.html(res, V.notFound(ctx), 404);
    const saved = C.saveUpload(body.files.proof, 'proof');
    if (!saved) {
      C.setFlash(res, 'error', 'الملف غير مقبول. أرسل صورة بصيغة PNG أو JPG.');
      return C.redirect(res, '/order/' + order.ref);
    }
    db.prepare('UPDATE orders SET proof_file = ?, status = ? WHERE id = ?')
      .run(saved, order.status === 'pending' ? 'review' : order.status, order.id);
    C.setFlash(res, 'ok', 'وصلتنا صورة التحويل، سيتم التأكيد قريبًا.');
    return C.redirect(res, '/order/' + order.ref);
  }

  /* track */
  if (p === '/track' && method === 'GET') {
    const ref = (url.searchParams.get('ref') || '').trim();
    if (!ref) return C.html(res, V.track(ctx, {}));
    const order = db.prepare('SELECT * FROM orders WHERE ref = ?').get(ref);
    if (!order) return C.html(res, V.track(ctx, { ref: ref, error: 'لا يوجد طلب بهذا الرقم.' }), 404);
    return C.redirect(res, '/order/' + order.ref);
  }

  /* static page */
  if (p === '/page/terms' && method === 'GET') {
    return C.html(res, V.staticPage(ctx, { title: 'الشروط والاستبدال', text: TERMS }));
  }

  return C.html(res, V.notFound(ctx), 404);
}

/* ----------------------------- admin ----------------------------- */

async function adminRoutes(req, res, p, method, url) {
  const ctx = makeCtx(req, res);
  const cur = ctx.settings.currency_label;

  if (p === '/admin' && method === 'GET') {
    const revenue = db.prepare(
      "SELECT COALESCE(SUM(total), 0) AS s FROM orders WHERE status IN ('paid','delivered')"
    ).get().s;
    const today = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE date(created_at) = date('now')").get().c;
    const review = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'review'").get().c;
    const activeProducts = db.prepare('SELECT COUNT(*) AS c FROM products WHERE is_active = 1').get().c;
    const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 8').all();
    const lowStock = db.prepare('SELECT * FROM products WHERE is_active = 1 AND stock <= 3 ORDER BY stock').all();
    return C.html(res, A.dashboard(ctx, {
      revenue: revenue, today: today, review: review,
      activeProducts: activeProducts, orders: orders, lowStock: lowStock
    }));
  }

  /* products */
  if (p === '/admin/products' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    const sql = 'SELECT p.*, c.name AS category_name FROM products p ' +
      'LEFT JOIN categories c ON c.id = p.category_id ' +
      (q ? 'WHERE p.name LIKE ? ' : '') + 'ORDER BY p.id DESC';
    const products = q ? db.prepare(sql).all('%' + q + '%') : db.prepare(sql).all();
    return C.html(res, A.productList(ctx, { products: products, q: q }));
  }

  if (p === '/admin/products/new') {
    if (method === 'GET') {
      return C.html(res, A.productForm(ctx, { product: null, categories: ctx.categories }));
    }
    const body = await C.parseRequestBody(req);
    if (!C.csrfOk(req, body)) return C.html(res, 'csrf', 403);
    const f = body.fields;
    const name = String(f.name || '').trim();
    if (!name) {
      C.setFlash(res, 'error', 'اسم المنتج مطلوب.');
      return C.redirect(res, '/admin/products/new');
    }
    const image = C.saveUpload(body.files.image, 'prod');
    const info = db.prepare(
      'INSERT INTO products (category_id, name, slug, summary, body, price, compare_at, rarity, image, kind, stock, is_active, is_featured) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      f.category_id ? parseInt(f.category_id, 10) : null,
      name,
      C.slugify(name, 'item') + '-' + Date.now().toString(36),
      String(f.summary || ''), String(f.body || ''),
      Number(f.price) || 0, Number(f.compare_at) || 0,
      String(f.rarity || 'common'), image, 'digital',
      parseInt(f.stock, 10) || 0,
      f.is_active ? 1 : 0, f.is_featured ? 1 : 0
    );
    C.setFlash(res, 'ok', 'أُضيف المنتج.');
    return C.redirect(res, '/admin/products/' + Number(info.lastInsertRowid));
  }

  const prodEdit = /^\/admin\/products\/(\d+)$/.exec(p);
  if (prodEdit) {
    const id = parseInt(prodEdit[1], 10);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!product) return C.html(res, A.shell(ctx, { title: 'غير موجود', body: '<p class="muted">المنتج غير موجود.</p>' }), 404);
    if (method === 'GET') {
      const stats = db.prepare(
        'SELECT SUM(CASE WHEN used_at IS NULL THEN 1 ELSE 0 END) AS free, ' +
        'SUM(CASE WHEN used_at IS NOT NULL THEN 1 ELSE 0 END) AS used FROM codes WHERE product_id = ?'
      ).get(id);
      return C.html(res, A.productForm(ctx, {
        product: product,
        categories: ctx.categories,
        codeStats: { free: stats.free || 0, used: stats.used || 0 }
      }));
    }
    const body = await C.parseRequestBody(req);
    if (!C.csrfOk(req, body)) return C.html(res, 'csrf', 403);
    const f = body.fields;
    const image = C.saveUpload(body.files.image, 'prod') || product.image;
    db.prepare(
      'UPDATE products SET category_id = ?, name = ?, summary = ?, body = ?, price = ?, compare_at = ?, ' +
      'rarity = ?, image = ?, stock = ?, is_active = ?, is_featured = ? WHERE id = ?'
    ).run(
      f.category_id ? parseInt(f.category_id, 10) : null,
      String(f.name || product.name).trim(),
      String(f.summary || ''), String(f.body || ''),
      Number(f.price) || 0, Number(f.compare_at) || 0,
      String(f.rarity || 'common'), image,
      parseInt(f.stock, 10) || 0,
      f.is_active ? 1 : 0, f.is_featured ? 1 : 0, id
    );
    C.setFlash(res, 'ok', 'حُفظت التعديلات.');
    return C.redirect(res, '/admin/products/' + id);
  }

  const prodCodes = /^\/admin\/products\/(\d+)\/codes$/.exec(p);
  if (prodCodes && method === 'POST') {
    const body = await C.parseRequestBody(req);
    if (!C.csrfOk(req, body)) return C.html(res, 'csrf', 403);
    const id = parseInt(prodCodes[1], 10);
    const lines = String(body.fields.codes || '')
      .split(/\r?\n/)
      .map(function (line) { return line.trim(); })
      .filter(function (line) { return line.length > 0 && line.length <= 200; });
    const ins = db.prepare('INSERT INTO codes (product_id, code) VALUES (?, ?)');
    for (const line of lines) ins.run(id, line);
    C.setFlash(res, 'ok', 'أُضيف ' + lines.length + ' كودًا.');
    return C.redirect(res, '/admin/products/' + id);
  }

  const prodDel = /^\/admin\/products\/(\d+)\/delete$/.exec(p);
  if (prodDel && method === 'POST') {
    const body = await C.parseRequestBody(req);
    if (!C.csrfOk(req, body)) return C.html(res, 'csrf', 403);
    db.prepare('DELETE FROM products WHERE id = ?').run(parseInt(prodDel[1], 10));
    C.setFlash(res, 'ok', 'حُذف المنتج.');
    return C.redirect(res, '/admin/products');
  }

  /* categories */
  if (p === '/admin/categories') {
    if (method === 'GET') {
      return C.html(res, A.categoryList(ctx, { categories: ctx.categories }));
    }
    const body = await C.parseRequestBody(req);
    if (!C.csrfOk(req, body)) return C.html(res, 'csrf', 403);
    const name = String(body.fields.name || '').trim();
    if (name) {
      db.prepare('INSERT OR IGNORE INTO categories (name, slug, sort) VALUES (?, ?, ?)')
        .run(name, C.slugify(name, 'cat') + '-' + Date.now().toString(36), parseInt(body.fields.sort, 10) || 0);
      C.setFlash(res, 'ok', 'أُضيف التصنيف.');
    }
    return C.redirect(res, '/admin/categories');
  }

  const catDel = /^\/admin\/categories\/(\d+)\/delete$/.exec(p);
  if (catDel && method === 'POST') {
    const body = await C.parseRequestBody(req);
    if (!C.csrfOk(req, body)) return C.html(res, 'csrf', 403);
    db.prepare('DELETE FROM categories WHERE id = ?').run(parseInt(catDel[1], 10));
    C.setFlash(res, 'ok', 'حُذف التصنيف.');
    return C.redirect(res, '/admin/categories');
  }

  /* orders */
  if (p === '/admin/orders' && method === 'GET') {
    const status = url.searchParams.get('status') || '';
    const orders = status
      ? db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY id DESC').all(status)
      : db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
    return C.html(res, A.orderList(ctx, { orders: orders, status: status }));
  }

  const orderEdit = /^\/admin\/orders\/(\d+)$/.exec(p);
  if (orderEdit) {
    const id = parseInt(orderEdit[1], 10);
    let order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) return C.html(res, A.shell(ctx, { title: 'غير موجود', body: '<p class="muted">الطلب غير موجود.</p>' }), 404);
    if (method === 'GET') {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
      return C.html(res, A.orderView(ctx, { order: order, items: items }));
    }
    const body = await C.parseRequestBody(req);
    if (!C.csrfOk(req, body)) return C.html(res, 'csrf', 403);
    const status = String(body.fields.status || order.status);
    const delivery = String(body.fields.delivery || '');
    db.prepare('UPDATE orders SET delivery = ? WHERE id = ?').run(delivery, id);
    order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);

    if ((status === 'paid' || status === 'delivered') && order.status !== 'paid' && order.status !== 'delivered') {
      markPaid(order, order.gateway_ref);
      if (status === 'delivered') {
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('delivered', id);
      }
    } else {
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
    }
    C.setFlash(res, 'ok', 'حُدّث الطلب.');
    return C.redirect(res, '/admin/orders/' + id);
  }

  /* coupons */
  if (p === '/admin/coupons') {
    if (method === 'GET') {
      const coupons = db.prepare('SELECT * FROM coupons ORDER BY id DESC').all();
      return C.html(res, A.couponList(ctx, { coupons: coupons }));
    }
    const body = await C.parseRequestBody(req);
    if (!C.csrfOk(req, body)) return C.html(res, 'csrf', 403);
    const code = String(body.fields.code || '').trim();
    if (code) {
      db.prepare('INSERT OR IGNORE INTO coupons (code, percent, amount, max_uses) VALUES (?, ?, ?, ?)')
        .run(code, parseInt(body.fields.percent, 10) || 0, Number(body.fields.amount) || 0,
          parseInt(body.fields.max_uses, 10) || 0);
      C.setFlash(res, 'ok', 'أُضيف كود الخصم.');
    }
    return C.redirect(res, '/admin/coupons');
  }

  const coupDel = /^\/admin\/coupons\/(\d+)\/delete$/.exec(p);
  if (coupDel && method === 'POST') {
    const body = await C.parseRequestBody(req);
    if (!C.csrfOk(req, body)) return C.html(res, 'csrf', 403);
    db.prepare('DELETE FROM coupons WHERE id = ?').run(parseInt(coupDel[1], 10));
    C.setFlash(res, 'ok', 'حُذف الكود.');
    return C.redirect(res, '/admin/coupons');
  }

  /* settings */
  if (p === '/admin/settings') {
    if (method === 'GET') {
      return C.html(res, A.settings(ctx, { settings: ctx.settings }));
    }
    const body = await C.parseRequestBody(req);
    if (!C.csrfOk(req, body)) return C.html(res, 'csrf', 403);
    const toggles = ['enable_bank', 'enable_stripe', 'enable_paypal', 'paypal_live'];
    for (const key of Object.keys(DB.DEFAULT_SETTINGS)) {
      if (toggles.indexOf(key) >= 0) {
        saveSetting(key, body.fields[key] ? '1' : '0');
      } else if (body.fields[key] !== undefined) {
        saveSetting(key, String(body.fields[key]));
      }
    }
    C.setFlash(res, 'ok', 'حُفظت الإعدادات.');
    return C.redirect(res, '/admin/settings');
  }

  if (p === '/admin/password' && method === 'POST') {
    const body = await C.parseRequestBody(req);
    if (!C.csrfOk(req, body)) return C.html(res, 'csrf', 403);
    const admin = C.getAdmin(req);
    const row = db.prepare('SELECT * FROM admins WHERE id = ?').get(admin.uid);
    if (!row || !DB.verifyPassword(String(body.fields.current || ''), row.password_hash)) {
      C.setFlash(res, 'error', 'كلمة المرور الحالية غير صحيحة.');
      return C.redirect(res, '/admin/settings');
    }
    const next = String(body.fields.next || '');
    if (next.length < 8) {
      C.setFlash(res, 'error', 'كلمة المرور الجديدة قصيرة جدًا.');
      return C.redirect(res, '/admin/settings');
    }
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(DB.hashPassword(next), row.id);
    C.setFlash(res, 'ok', 'حُدّثت كلمة المرور.');
    return C.redirect(res, '/admin/settings');
  }

  return C.html(res, A.shell(ctx, { title: 'غير موجود', body: '<p class="muted">الصفحة غير موجودة.</p>' }), 404);
}

/* ----------------------------- boot ----------------------------- */

const server = http.createServer(function (req, res) {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  handle(req, res, url).catch(function (err) {
    console.error('[error]', err);
    if (!res.headersSent) C.html(res, '<h1>خطأ داخلي</h1>', 500);
    else res.end();
  });
});

server.listen(PORT, HOST, function () {
  console.log('');
  console.log('  المتجر يعمل على: http://localhost:' + PORT);
  console.log('  لوحة التحكم:     http://localhost:' + PORT + '/admin');
  if (created) {
    console.log('');
    console.log('  ===== بيانات الدخول (تظهر مرة واحدة) =====');
    console.log('  المستخدم: ' + created.username);
    console.log('  كلمة المرور: ' + created.password);
    console.log('  ==========================================');
  }
  console.log('');
});

module.exports = { server: server, db: db };
