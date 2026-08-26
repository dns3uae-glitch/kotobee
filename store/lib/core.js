'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

const SECURE_COOKIES = process.env.SECURE_COOKIES === '1' ||
  String(process.env.BASE_URL || '').indexOf('https://') === 0;

let cachedSecret = null;

function secret() {
  if (cachedSecret) return cachedSecret;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, 'secret.key');
  if (fs.existsSync(file)) {
    cachedSecret = fs.readFileSync(file, 'utf8').trim();
  } else {
    cachedSecret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, cachedSecret, { mode: 0o600 });
  }
  return cachedSecret;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + mac;
}

function unsign(token) {
  if (typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const idx = token.lastIndexOf('.');
  const body = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

function setCookie(res, name, value, options) {
  const opts = options || {};
  const bits = [name + '=' + encodeURIComponent(value)];
  bits.push('Path=' + (opts.path || '/'));
  bits.push('SameSite=' + (opts.sameSite || 'Lax'));
  if (opts.httpOnly !== false) bits.push('HttpOnly');
  if (opts.maxAge !== undefined) bits.push('Max-Age=' + opts.maxAge);
  if (opts.secure || SECURE_COOKIES) bits.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  const list = prev ? (Array.isArray(prev) ? prev.slice() : [prev]) : [];
  list.push(bits.join('; '));
  res.setHeader('Set-Cookie', list);
}

function clearCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0 });
}

/* ---------- cart ---------- */

function getCart(req) {
  const cookies = parseCookies(req);
  const data = unsign(cookies.cart);
  if (!data || !Array.isArray(data.items)) return { items: [], coupon: '' };
  const items = [];
  for (const item of data.items) {
    const id = parseInt(item.id, 10);
    const qty = parseInt(item.qty, 10);
    if (Number.isInteger(id) && id > 0 && Number.isInteger(qty) && qty > 0) {
      items.push({ id: id, qty: Math.min(qty, 99) });
    }
  }
  return { items: items, coupon: typeof data.coupon === 'string' ? data.coupon : '' };
}

function setCart(res, cart) {
  setCookie(res, 'cart', sign({ items: cart.items, coupon: cart.coupon || '' }), {
    maxAge: 60 * 60 * 24 * 30
  });
}

/* ---------- admin session ---------- */

function getAdmin(req) {
  const cookies = parseCookies(req);
  const data = unsign(cookies.sid);
  if (!data || !data.uid || !data.exp) return null;
  if (Date.now() > data.exp) return null;
  return data;
}

function setAdmin(res, admin) {
  const exp = Date.now() + 1000 * 60 * 60 * 8;
  setCookie(res, 'sid', sign({ uid: admin.id, name: admin.username, exp: exp }), {
    maxAge: 60 * 60 * 8
  });
}

/* ---------- csrf (double submit) ---------- */

function csrfToken(req, res) {
  const cookies = parseCookies(req);
  if (cookies.csrf && cookies.csrf.length === 43) return cookies.csrf;
  const token = crypto.randomBytes(32).toString('base64url');
  setCookie(res, 'csrf', token, { httpOnly: false, maxAge: 60 * 60 * 12 });
  return token;
}

function csrfOk(req, body) {
  const cookies = parseCookies(req);
  const sent = body && body.fields ? body.fields._csrf : null;
  if (!cookies.csrf || !sent) return false;
  const a = Buffer.from(String(cookies.csrf));
  const b = Buffer.from(String(sent));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ---------- flash ---------- */

function setFlash(res, type, text) {
  setCookie(res, 'flash', sign({ type: type, text: text }), { maxAge: 30 });
}

function takeFlash(req, res) {
  const cookies = parseCookies(req);
  const data = unsign(cookies.flash);
  if (!data) return null;
  clearCookie(res, 'flash');
  return data;
}

/* ---------- body parsing ---------- */

const MAX_BODY = 8 * 1024 * 1024;

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('body-too-large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

function parseUrlEncoded(text) {
  const fields = {};
  const params = new URLSearchParams(text);
  for (const [key, value] of params.entries()) fields[key] = value;
  return { fields: fields, files: {} };
}

function indexOfBuf(buf, needle, from) {
  return buf.indexOf(needle, from);
}

function parseMultipart(buf, boundary) {
  const fields = {};
  const files = {};
  const delimiter = Buffer.from('--' + boundary);
  let pos = indexOfBuf(buf, delimiter, 0);
  if (pos < 0) return { fields: fields, files: files };
  pos += delimiter.length;

  while (pos < buf.length) {
    if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break;
    if (buf[pos] === 0x0d && buf[pos + 1] === 0x0a) pos += 2;

    const headerEnd = indexOfBuf(buf, Buffer.from('\r\n\r\n'), pos);
    if (headerEnd < 0) break;
    const headerText = buf.slice(pos, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;

    let next = indexOfBuf(buf, delimiter, bodyStart);
    if (next < 0) next = buf.length;
    let bodyEnd = next - 2;
    if (bodyEnd < bodyStart) bodyEnd = bodyStart;
    const value = buf.slice(bodyStart, bodyEnd);

    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const fileMatch = /filename="([^"]*)"/i.exec(headerText);
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
    const name = nameMatch ? nameMatch[1] : '';

    if (name) {
      if (fileMatch && fileMatch[1]) {
        files[name] = {
          filename: fileMatch[1],
          type: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
          data: value
        };
      } else if (!fileMatch) {
        fields[name] = value.toString('utf8');
      }
    }
    pos = next + delimiter.length;
  }
  return { fields: fields, files: files };
}

async function parseRequestBody(req) {
  const type = String(req.headers['content-type'] || '');
  let raw;
  try {
    raw = await readBody(req);
  } catch (err) {
    return { fields: {}, files: {}, error: 'too-large' };
  }
  if (type.indexOf('multipart/form-data') === 0) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
    const boundary = m ? (m[1] || m[2]).trim() : '';
    if (!boundary) return { fields: {}, files: {} };
    return parseMultipart(raw, boundary);
  }
  if (type.indexOf('application/json') === 0) {
    try {
      return { fields: JSON.parse(raw.toString('utf8')), files: {} };
    } catch (err) {
      return { fields: {}, files: {} };
    }
  }
  return parseUrlEncoded(raw.toString('utf8'));
}

/* ---------- uploads ---------- */

const IMAGE_TYPES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

function saveUpload(file, prefix) {
  if (!file || !file.data || !file.data.length) return '';
  const ext = IMAGE_TYPES[String(file.type).toLowerCase()];
  if (!ext) return '';
  if (file.data.length > 4 * 1024 * 1024) return '';
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = (prefix || 'file') + '-' + Date.now() + '-' +
    crypto.randomBytes(4).toString('hex') + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), file.data);
  return name;
}

/* ---------- responses ---------- */

function html(res, body, status) {
  res.writeHead(status || 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin'
  });
  res.end(body);
}

function json(res, data, status) {
  res.writeHead(status || 200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function redirect(res, to) {
  res.writeHead(302, { Location: to });
  res.end();
}

function serveFile(res, filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    return false;
  }
  if (!stat.isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'public, max-age=86400'
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function safeJoin(root, requested) {
  const clean = path.normalize(decodeURIComponent(requested)).replace(/^([.][.][/\\])+/, '');
  const full = path.join(root, clean);
  if (!full.startsWith(root)) return null;
  return full;
}

/* ---------- text helpers ---------- */

function e(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(amount, label) {
  const n = Number(amount) || 0;
  const fixed = n.toFixed(2).replace(/\.00$/, '');
  return fixed + ' ' + (label || '');
}

function slugify(text, fallback) {
  const base = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0621-\u064a]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || (fallback || 'item-' + Date.now());
}

function orderRef() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return 'G' + stamp + rand;
}

function nl2br(text) {
  return e(text).replace(/\r?\n/g, '<br>');
}

module.exports = {
  DATA_DIR,
  PUBLIC_DIR,
  UPLOAD_DIR,
  sign,
  unsign,
  parseCookies,
  setCookie,
  clearCookie,
  getCart,
  setCart,
  getAdmin,
  setAdmin,
  csrfToken,
  csrfOk,
  setFlash,
  takeFlash,
  parseRequestBody,
  saveUpload,
  html,
  json,
  redirect,
  serveFile,
  safeJoin,
  e,
  money,
  slugify,
  orderRef,
  nl2br
};
