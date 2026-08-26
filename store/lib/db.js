'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  console.error('\n[!] هذه النسخة من Node.js لا تدعم node:sqlite.');
  console.error('[!] المطلوب: Node.js 22.5 أو أحدث. النسخة الحالية: ' + process.version + '\n');
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

function ensureDirs() {
  for (const dir of [DATA_DIR, UPLOAD_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  slug     TEXT NOT NULL UNIQUE,
  sort     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  summary      TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',
  price        REAL NOT NULL DEFAULT 0,
  compare_at   REAL NOT NULL DEFAULT 0,
  rarity       TEXT NOT NULL DEFAULT 'common',
  image        TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL DEFAULT 'digital',
  stock        INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1,
  is_featured  INTEGER NOT NULL DEFAULT 0,
  sold_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  order_id   INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  used_at    TEXT
);

CREATE TABLE IF NOT EXISTS coupons (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  percent    INTEGER NOT NULL DEFAULT 0,
  amount     REAL NOT NULL DEFAULT 0,
  max_uses   INTEGER NOT NULL DEFAULT 0,
  used       INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ref            TEXT NOT NULL UNIQUE,
  customer_name  TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  game_username  TEXT NOT NULL DEFAULT '',
  note           TEXT NOT NULL DEFAULT '',
  subtotal       REAL NOT NULL DEFAULT 0,
  discount       REAL NOT NULL DEFAULT 0,
  total          REAL NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL DEFAULT 'SAR',
  coupon_code    TEXT NOT NULL DEFAULT '',
  gateway        TEXT NOT NULL DEFAULT 'bank',
  gateway_ref    TEXT NOT NULL DEFAULT '',
  proof_file     TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending',
  delivery       TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at        TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  name       TEXT NOT NULL,
  price      REAL NOT NULL DEFAULT 0,
  qty        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS logins (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ip      TEXT NOT NULL,
  at      TEXT NOT NULL DEFAULT (datetime('now')),
  ok      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_codes_free ON codes(product_id, used_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
`;

const DEFAULT_SETTINGS = {
  store_name: 'متجر الغنيمة',
  store_tagline: 'منتجات ماب السرقة — تسليم فوري',
  currency: 'SAR',
  currency_label: 'ر.س',
  whatsapp: '',
  instagram: '',
  discord: '',
  hero_title: 'اسرق الغنيمة قبل أن يسرقها غيرك',
  hero_text: 'حيوانات وأدوات نادرة بأسعار واضحة، والتسليم يوصلك على الطلب مباشرة.',
  bank_name: 'الراجحي',
  bank_iban: 'SA0000000000000000000000',
  bank_holder: 'اسم صاحب الحساب',
  bank_note: 'أرسل صورة التحويل عند إتمام الطلب ليتم تسليم الغنيمة.',
  enable_bank: '1',
  enable_stripe: '0',
  enable_paypal: '0',
  stripe_secret: '',
  stripe_public: '',
  paypal_client_id: '',
  paypal_secret: '',
  paypal_live: '0',
  base_url: ''
};

const SEED_CATEGORIES = [
  { name: 'حيوانات نادرة', slug: 'rare-pets', sort: 1 },
  { name: 'حيوانات أسطورية', slug: 'mythic-pets', sort: 2 },
  { name: 'أدوات وتعزيزات', slug: 'boosts', sort: 3 },
  { name: 'حزم موفرة', slug: 'bundles', sort: 4 }
];

const SEED_PRODUCTS = [
  {
    category: 'mythic-pets', name: 'La Vacca Saturno', price: 249, compare_at: 320,
    rarity: 'mythic', summary: 'من أقوى الحيوانات في الماب، دخل فوري بعد التسليم.',
    body: 'يُسلَّم عبر إضافتك كصديق داخل اللعبة ثم التسليم المباشر في السيرفر الخاص.\nمدة التسليم: من دقيقة إلى خمس دقائق بعد تأكيد الدفع.',
    stock: 6, featured: 1, sold: 148
  },
  {
    category: 'mythic-pets', name: 'Graipuss Medussi', price: 199, compare_at: 260,
    rarity: 'mythic', summary: 'دخل عالٍ في الثانية، الأكثر طلبًا هذا الأسبوع.',
    body: 'التسليم داخل سيرفر خاص. تأكد من كتابة اسمك في اللعبة بشكل صحيح عند الطلب.',
    stock: 4, featured: 1, sold: 121
  },
  {
    category: 'rare-pets', name: 'Tralalero Tralala', price: 39, compare_at: 55,
    rarity: 'rare', summary: 'بداية ممتازة لبناء دخلك في الماب.',
    body: 'مناسب للاعبين الجدد. التسليم فوري من المخزون.',
    stock: 25, featured: 1, sold: 402
  },
  {
    category: 'rare-pets', name: 'Bombardiro Crocodilo', price: 59, compare_at: 0,
    rarity: 'rare', summary: 'قوة جيدة مقابل سعر منخفض.',
    body: 'التسليم فوري من المخزون بعد تأكيد الدفع.',
    stock: 18, featured: 0, sold: 267
  },
  {
    category: 'boosts', name: 'تعزيز الدخل ×2 لمدة يوم', price: 25, compare_at: 0,
    rarity: 'common', summary: 'يضاعف دخلك لمدة 24 ساعة كاملة.',
    body: 'يُفعَّل على حسابك مباشرة، ولا يحتاج مشاركة كلمة المرور.',
    stock: 60, featured: 0, sold: 611
  },
  {
    category: 'bundles', name: 'حزمة البداية القوية', price: 129, compare_at: 180,
    rarity: 'epic', summary: 'ثلاثة حيوانات نادرة مع تعزيز دخل ليوم.',
    body: 'الحزمة تشمل: حيوانين نادرين، حيوان ملحمي واحد، وتعزيز دخل ×2 لمدة يوم.',
    stock: 9, featured: 1, sold: 88
  }
];

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), useSalt, 64).toString('hex');
  return 'scrypt$' + useSalt + '$' + derived;
}

function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const expected = Buffer.from(parts[2], 'hex');
  const actual = crypto.scryptSync(String(password), parts[1], 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function open(file) {
  ensureDirs();
  const target = file || path.join(DATA_DIR, 'store.db');
  const db = new DatabaseSync(target);
  db.exec(SCHEMA);
  return db;
}

function seed(db, adminUser, adminPass) {
  const setSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    setSetting.run(key, DEFAULT_SETTINGS[key]);
  }

  const adminCount = db.prepare('SELECT COUNT(*) AS c FROM admins').get().c;
  let created = null;
  if (adminCount === 0) {
    const user = adminUser || 'admin';
    const pass = adminPass || crypto.randomBytes(6).toString('base64url');
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)')
      .run(user, hashPassword(pass));
    created = { username: user, password: pass };
  }

  const catCount = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  if (catCount === 0) {
    const insCat = db.prepare('INSERT INTO categories (name, slug, sort) VALUES (?, ?, ?)');
    for (const cat of SEED_CATEGORIES) insCat.run(cat.name, cat.slug, cat.sort);

    const insProd = db.prepare(
      'INSERT INTO products (category_id, name, slug, summary, body, price, compare_at, rarity, kind, stock, is_active, is_featured, sold_count) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)'
    );
    let n = 1;
    for (const p of SEED_PRODUCTS) {
      const cat = db.prepare('SELECT id FROM categories WHERE slug = ?').get(p.category);
      insProd.run(
        cat ? cat.id : null, p.name, 'item-' + n, p.summary, p.body,
        p.price, p.compare_at, p.rarity, 'digital', p.stock, p.featured, p.sold
      );
      n += 1;
    }
  }
  return created;
}

module.exports = {
  open,
  seed,
  hashPassword,
  verifyPassword,
  DATA_DIR,
  UPLOAD_DIR,
  DEFAULT_SETTINGS
};
