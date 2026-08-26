'use strict';

const { e, money } = require('../lib/core');
const { statusLabel, STATUS, RARITY } = require('./store');

function shell(ctx, opts) {
  const flash = ctx.flash;
  const active = opts.active || '';
  const nav = [
    { href: '/admin', key: 'home', label: 'نظرة عامة' },
    { href: '/admin/orders', key: 'orders', label: 'الطلبات' },
    { href: '/admin/products', key: 'products', label: 'المنتجات' },
    { href: '/admin/categories', key: 'categories', label: 'التصنيفات' },
    { href: '/admin/coupons', key: 'coupons', label: 'أكواد الخصم' },
    { href: '/admin/settings', key: 'settings', label: 'الإعدادات' }
  ];

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(opts.title)} — لوحة التحكم</title>
<meta name="robots" content="noindex, nofollow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/app.css">
</head>
<body class="admin">
<header class="adm-top">
  <div class="adm-wrap adm-top-in">
    <a class="adm-brand" href="/admin">لوحة ${e(ctx.settings.store_name)}</a>
    <nav class="adm-nav">
      ${nav.map(function (n) {
        return `<a href="${n.href}"${active === n.key ? ' class="on"' : ''}>${n.label}</a>`;
      }).join('')}
    </nav>
    <div class="adm-side">
      <a href="/" target="_blank" rel="noopener">المتجر</a>
      <form method="post" action="/admin/logout" class="inline">
        <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
        <button class="btn btn-ghost sm" type="submit">خروج</button>
      </form>
    </div>
  </div>
</header>
<main class="adm-wrap adm-main">
  ${flash ? `<div class="flash ${e(flash.type)}">${e(flash.text)}</div>` : ''}
  <h1 class="adm-h1">${e(opts.title)}</h1>
  ${opts.body}
</main>
</body>
</html>`;
}

function login(ctx, data) {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>دخول لوحة التحكم</title>
<meta name="robots" content="noindex, nofollow">
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/app.css">
</head>
<body class="admin login-page">
<form class="login-card" method="post" action="/admin/login">
  <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
  <h1>لوحة التحكم</h1>
  ${data.error ? `<div class="flash error">${e(data.error)}</div>` : ''}
  <label>اسم المستخدم
    <input type="text" name="username" required autocomplete="username">
  </label>
  <label>كلمة المرور
    <input type="password" name="password" required autocomplete="current-password">
  </label>
  <button class="btn btn-gold btn-lg block" type="submit">دخول</button>
  <a class="back" href="/">رجوع للمتجر</a>
</form>
</body>
</html>`;
}

function dashboard(ctx, data) {
  const cur = ctx.settings.currency_label;
  const body = `
<div class="cards">
  <div class="card"><span>إجمالي المبيعات المؤكدة</span><b>${money(data.revenue, cur)}</b></div>
  <div class="card"><span>طلبات اليوم</span><b>${data.today}</b></div>
  <div class="card"><span>بانتظار المراجعة</span><b class="warn">${data.review}</b></div>
  <div class="card"><span>منتجات نشطة</span><b>${data.activeProducts}</b></div>
</div>

<section class="panel">
  <header><h2>أحدث الطلبات</h2><a href="/admin/orders">الكل</a></header>
  ${data.orders.length ? `<table class="tbl">
    <thead><tr><th>الرقم</th><th>العميل</th><th>الإجمالي</th><th>الدفع</th><th>الحالة</th><th></th></tr></thead>
    <tbody>
      ${data.orders.map(function (o) {
        return `<tr>
          <td class="mono">${e(o.ref)}</td>
          <td>${e(o.customer_name)}</td>
          <td class="mono">${money(o.total, cur)}</td>
          <td>${e(o.gateway)}</td>
          <td><span class="badge st-${e(o.status)}">${statusLabel(o.status)}</span></td>
          <td><a class="btn btn-ghost sm" href="/admin/orders/${o.id}">فتح</a></td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>` : `<p class="muted">لا توجد طلبات بعد.</p>`}
</section>

<section class="panel">
  <header><h2>مخزون منخفض</h2><a href="/admin/products">المنتجات</a></header>
  ${data.lowStock.length ? `<table class="tbl">
    <thead><tr><th>المنتج</th><th>المتاح</th><th></th></tr></thead>
    <tbody>
      ${data.lowStock.map(function (p) {
        return `<tr><td>${e(p.name)}</td><td class="mono warn">${p.stock}</td>
          <td><a class="btn btn-ghost sm" href="/admin/products/${p.id}">تعديل</a></td></tr>`;
      }).join('')}
    </tbody>
  </table>` : `<p class="muted">المخزون بحالة جيدة.</p>`}
</section>`;
  return shell(ctx, { title: 'نظرة عامة', active: 'home', body: body });
}

function productList(ctx, data) {
  const cur = ctx.settings.currency_label;
  const body = `
<div class="bar">
  <a class="btn btn-gold" href="/admin/products/new">منتج جديد</a>
  <form method="get" action="/admin/products" class="inline">
    <input type="search" name="q" value="${e(data.q || '')}" placeholder="بحث">
    <button class="btn btn-ghost" type="submit">بحث</button>
  </form>
</div>
<table class="tbl">
  <thead><tr><th>الاسم</th><th>التصنيف</th><th>السعر</th><th>المتاح</th><th>الندرة</th><th>الحالة</th><th></th></tr></thead>
  <tbody>
    ${data.products.map(function (p) {
      return `<tr>
        <td>${e(p.name)}</td>
        <td>${e(p.category_name || '—')}</td>
        <td class="mono">${money(p.price, cur)}</td>
        <td class="mono${p.stock <= 3 ? ' warn' : ''}">${p.stock}</td>
        <td>${e((RARITY[p.rarity] || RARITY.common).label)}</td>
        <td>${p.is_active ? 'نشط' : 'مخفي'}</td>
        <td><a class="btn btn-ghost sm" href="/admin/products/${p.id}">تعديل</a></td>
      </tr>`;
    }).join('')}
  </tbody>
</table>`;
  return shell(ctx, { title: 'المنتجات', active: 'products', body: body });
}

function productForm(ctx, data) {
  const p = data.product || {};
  const isNew = !p.id;
  const body = `
<form class="form panel" method="post" action="/admin/products/${isNew ? 'new' : p.id}" enctype="multipart/form-data">
  <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
  <div class="row">
    <label>الاسم
      <input type="text" name="name" required maxlength="120" value="${e(p.name || '')}">
    </label>
    <label>التصنيف
      <select name="category_id">
        <option value="">بدون</option>
        ${data.categories.map(function (c) {
          return `<option value="${c.id}"${p.category_id === c.id ? ' selected' : ''}>${e(c.name)}</option>`;
        }).join('')}
      </select>
    </label>
  </div>
  <label>وصف قصير
    <input type="text" name="summary" maxlength="200" value="${e(p.summary || '')}">
  </label>
  <label>الوصف الكامل
    <textarea name="body" rows="5">${e(p.body || '')}</textarea>
  </label>
  <div class="row">
    <label>السعر
      <input type="number" name="price" step="0.01" min="0" required value="${e(p.price !== undefined ? p.price : 0)}">
    </label>
    <label>السعر قبل الخصم
      <input type="number" name="compare_at" step="0.01" min="0" value="${e(p.compare_at !== undefined ? p.compare_at : 0)}">
    </label>
    <label>الكمية المتاحة
      <input type="number" name="stock" min="0" required value="${e(p.stock !== undefined ? p.stock : 0)}">
    </label>
  </div>
  <div class="row">
    <label>الندرة
      <select name="rarity">
        ${Object.keys(RARITY).map(function (key) {
          return `<option value="${key}"${p.rarity === key ? ' selected' : ''}>${RARITY[key].label}</option>`;
        }).join('')}
      </select>
    </label>
    <label>الصورة
      <input type="file" name="image" accept="image/*">
      ${p.image ? `<small>الحالية: ${e(p.image)}</small>` : ''}
    </label>
  </div>
  <div class="row checks">
    <label class="check"><input type="checkbox" name="is_active" value="1"${p.id === undefined || p.is_active ? ' checked' : ''}> نشط</label>
    <label class="check"><input type="checkbox" name="is_featured" value="1"${p.is_featured ? ' checked' : ''}> مميز في الرئيسية</label>
  </div>
  <button class="btn btn-gold btn-lg" type="submit">${isNew ? 'إضافة المنتج' : 'حفظ التعديلات'}</button>
</form>

${!isNew ? `<section class="panel">
  <header>
    <h2>أكواد التسليم التلقائي</h2>
    <span class="mono">المتاح ${data.codeStats ? data.codeStats.free : 0} / المستخدم ${data.codeStats ? data.codeStats.used : 0}</span>
  </header>
  <p class="muted">ضع كل كود في سطر مستقل. عند تأكيد الدفع يُسلَّم الكود للعميل تلقائيًا في صفحة طلبه.</p>
  <form class="form" method="post" action="/admin/products/${p.id}/codes">
    <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
    <label>أكواد جديدة<textarea name="codes" rows="4" placeholder="CODE-0001&#10;CODE-0002"></textarea></label>
    <button class="btn btn-gold" type="submit">إضافة الأكواد</button>
  </form>
</section>` : ''}

${!isNew ? `<form class="panel danger" method="post" action="/admin/products/${p.id}/delete"
  onsubmit="return confirm('حذف المنتج نهائيًا؟');">
  <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
  <button class="btn btn-danger" type="submit">حذف المنتج</button>
</form>` : ''}`;
  return shell(ctx, {
    title: isNew ? 'منتج جديد' : 'تعديل: ' + (p.name || ''),
    active: 'products',
    body: body
  });
}

function categoryList(ctx, data) {
  const body = `
<form class="form panel" method="post" action="/admin/categories">
  <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
  <div class="row">
    <label>اسم التصنيف<input type="text" name="name" required maxlength="80"></label>
    <label>الترتيب<input type="number" name="sort" value="0"></label>
  </div>
  <button class="btn btn-gold" type="submit">إضافة</button>
</form>
<table class="tbl">
  <thead><tr><th>الاسم</th><th>الرابط</th><th>المنتجات</th><th></th></tr></thead>
  <tbody>
    ${data.categories.map(function (c) {
      return `<tr>
        <td>${e(c.name)}</td>
        <td class="mono">${e(c.slug)}</td>
        <td class="mono">${c.product_count}</td>
        <td><form method="post" action="/admin/categories/${c.id}/delete" class="inline"
          onsubmit="return confirm('حذف التصنيف؟');">
          <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
          <button class="btn btn-ghost sm" type="submit">حذف</button>
        </form></td>
      </tr>`;
    }).join('')}
  </tbody>
</table>`;
  return shell(ctx, { title: 'التصنيفات', active: 'categories', body: body });
}

function orderList(ctx, data) {
  const cur = ctx.settings.currency_label;
  const body = `
<div class="bar">
  <nav class="tabs">
    <a href="/admin/orders"${!data.status ? ' class="on"' : ''}>الكل</a>
    ${Object.keys(STATUS).map(function (key) {
      return `<a href="/admin/orders?status=${key}"${data.status === key ? ' class="on"' : ''}>${STATUS[key]}</a>`;
    }).join('')}
  </nav>
</div>
${data.orders.length ? `<table class="tbl">
  <thead><tr><th>الرقم</th><th>العميل</th><th>الحساب باللعبة</th><th>الإجمالي</th><th>الدفع</th><th>الحالة</th><th></th></tr></thead>
  <tbody>
    ${data.orders.map(function (o) {
      return `<tr>
        <td class="mono">${e(o.ref)}</td>
        <td>${e(o.customer_name)}</td>
        <td>${e(o.game_username)}</td>
        <td class="mono">${money(o.total, cur)}</td>
        <td>${e(o.gateway)}</td>
        <td><span class="badge st-${e(o.status)}">${statusLabel(o.status)}</span></td>
        <td><a class="btn btn-ghost sm" href="/admin/orders/${o.id}">فتح</a></td>
      </tr>`;
    }).join('')}
  </tbody>
</table>` : `<p class="muted">لا توجد طلبات في هذه الحالة.</p>`}`;
  return shell(ctx, { title: 'الطلبات', active: 'orders', body: body });
}

function orderView(ctx, data) {
  const cur = ctx.settings.currency_label;
  const o = data.order;
  const body = `
<section class="panel">
  <header>
    <h2 class="mono">${e(o.ref)}</h2>
    <span class="badge st-${e(o.status)}">${statusLabel(o.status)}</span>
  </header>
  <dl class="kv">
    <div><dt>العميل</dt><dd>${e(o.customer_name)}</dd></div>
    <div><dt>الحساب في اللعبة</dt><dd><b>${e(o.game_username)}</b></dd></div>
    <div><dt>البريد</dt><dd class="mono">${e(o.customer_email || '—')}</dd></div>
    <div><dt>الجوال</dt><dd class="mono">${e(o.customer_phone || '—')}</dd></div>
    <div><dt>طريقة الدفع</dt><dd>${e(o.gateway)}</dd></div>
    <div><dt>مرجع البوابة</dt><dd class="mono">${e(o.gateway_ref || '—')}</dd></div>
    <div><dt>كود الخصم</dt><dd class="mono">${e(o.coupon_code || '—')}</dd></div>
    <div><dt>تاريخ الطلب</dt><dd class="mono">${e(o.created_at)}</dd></div>
    <div><dt>تاريخ الدفع</dt><dd class="mono">${e(o.paid_at || '—')}</dd></div>
  </dl>
  ${o.note ? `<p class="note-box">${e(o.note)}</p>` : ''}
  ${o.proof_file ? `<p><a class="btn btn-ghost sm" href="/uploads/${e(o.proof_file)}" target="_blank" rel="noopener">عرض صورة التحويل</a></p>` : ''}
</section>

<section class="panel">
  <header><h2>العناصر</h2></header>
  <table class="tbl">
    <thead><tr><th>المنتج</th><th>السعر</th><th>الكمية</th><th>المجموع</th></tr></thead>
    <tbody>
      ${data.items.map(function (it) {
        return `<tr><td>${e(it.name)}</td><td class="mono">${money(it.price, cur)}</td>
          <td class="mono">${it.qty}</td><td class="mono">${money(it.price * it.qty, cur)}</td></tr>`;
      }).join('')}
    </tbody>
  </table>
  <div class="totals">
    <div><span>المجموع</span><b>${money(o.subtotal, cur)}</b></div>
    ${o.discount ? `<div class="off"><span>الخصم</span><b>-${money(o.discount, cur)}</b></div>` : ''}
    <div class="grand"><span>الإجمالي</span><b>${money(o.total, cur)}</b></div>
  </div>
</section>

<section class="panel">
  <header><h2>تحديث الطلب</h2></header>
  <form class="form" method="post" action="/admin/orders/${o.id}">
    <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
    <div class="row">
      <label>الحالة
        <select name="status">
          ${Object.keys(STATUS).map(function (key) {
            return `<option value="${key}"${o.status === key ? ' selected' : ''}>${STATUS[key]}</option>`;
          }).join('')}
        </select>
      </label>
    </div>
    <label>تفاصيل التسليم (تظهر للعميل في صفحة الطلب)
      <textarea name="delivery" rows="4" placeholder="مثال: تم التسليم في السيرفر الخاص الساعة 9:40">${e(o.delivery || '')}</textarea>
    </label>
    <button class="btn btn-gold btn-lg" type="submit">حفظ</button>
  </form>
</section>`;
  return shell(ctx, { title: 'طلب ' + o.ref, active: 'orders', body: body });
}

function couponList(ctx, data) {
  const cur = ctx.settings.currency_label;
  const body = `
<form class="form panel" method="post" action="/admin/coupons">
  <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
  <div class="row">
    <label>الكود<input type="text" name="code" required maxlength="40"></label>
    <label>نسبة الخصم %<input type="number" name="percent" min="0" max="100" value="0"></label>
    <label>خصم مبلغ<input type="number" name="amount" step="0.01" min="0" value="0"></label>
    <label>أقصى استخدام<input type="number" name="max_uses" min="0" value="0"></label>
  </div>
  <button class="btn btn-gold" type="submit">إضافة كود</button>
</form>
<table class="tbl">
  <thead><tr><th>الكود</th><th>النسبة</th><th>المبلغ</th><th>الاستخدام</th><th>الحالة</th><th></th></tr></thead>
  <tbody>
    ${data.coupons.map(function (c) {
      return `<tr>
        <td class="mono">${e(c.code)}</td>
        <td class="mono">${c.percent}%</td>
        <td class="mono">${money(c.amount, cur)}</td>
        <td class="mono">${c.used}${c.max_uses ? ' / ' + c.max_uses : ''}</td>
        <td>${c.is_active ? 'نشط' : 'موقوف'}</td>
        <td><form method="post" action="/admin/coupons/${c.id}/delete" class="inline">
          <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
          <button class="btn btn-ghost sm" type="submit">حذف</button>
        </form></td>
      </tr>`;
    }).join('')}
  </tbody>
</table>`;
  return shell(ctx, { title: 'أكواد الخصم', active: 'coupons', body: body });
}

function settings(ctx, data) {
  const s = data.settings;
  function field(key, label, type) {
    return `<label>${e(label)}
      <input type="${type || 'text'}" name="${key}" value="${e(s[key] || '')}">
    </label>`;
  }
  function toggle(key, label) {
    return `<label class="check"><input type="checkbox" name="${key}" value="1"${s[key] === '1' ? ' checked' : ''}> ${e(label)}</label>`;
  }

  const body = `
<form class="form panel" method="post" action="/admin/settings">
  <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">

  <h2>هوية المتجر</h2>
  <div class="row">${field('store_name', 'اسم المتجر')}${field('store_tagline', 'الوصف المختصر')}</div>
  <div class="row">${field('currency', 'رمز العملة')}${field('currency_label', 'اسم العملة المعروض')}${field('base_url', 'رابط الموقع')}</div>
  ${field('hero_title', 'عنوان الواجهة')}
  <label>نص الواجهة<textarea name="hero_text" rows="2">${e(s.hero_text || '')}</textarea></label>
  <div class="row">${field('whatsapp', 'رقم واتساب')}${field('instagram', 'رابط Instagram')}${field('discord', 'رابط Discord')}</div>

  <h2>التحويل البنكي</h2>
  <div class="checks">${toggle('enable_bank', 'تشغيل التحويل البنكي')}</div>
  <div class="row">${field('bank_name', 'اسم البنك')}${field('bank_holder', 'صاحب الحساب')}</div>
  ${field('bank_iban', 'الآيبان')}
  <label>ملاحظة التحويل<textarea name="bank_note" rows="2">${e(s.bank_note || '')}</textarea></label>

  <h2>الدفع بالبطاقة عبر Stripe</h2>
  <div class="checks">${toggle('enable_stripe', 'تشغيل Stripe')}</div>
  <div class="row">${field('stripe_public', 'المفتاح العام')}${field('stripe_secret', 'المفتاح السري', 'password')}</div>

  <h2>الدفع عبر PayPal</h2>
  <div class="checks">${toggle('enable_paypal', 'تشغيل PayPal')}${toggle('paypal_live', 'وضع الإنتاج (وليس التجربة)')}</div>
  <div class="row">${field('paypal_client_id', 'Client ID')}${field('paypal_secret', 'Secret', 'password')}</div>

  <button class="btn btn-gold btn-lg" type="submit">حفظ الإعدادات</button>
</form>

<section class="panel">
  <header><h2>تغيير كلمة مرور الدخول</h2></header>
  <form class="form" method="post" action="/admin/password">
    <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
    <div class="row">
      <label>كلمة المرور الحالية<input type="password" name="current" required></label>
      <label>كلمة المرور الجديدة<input type="password" name="next" required minlength="8"></label>
    </div>
    <button class="btn btn-gold" type="submit">تحديث</button>
  </form>
</section>`;
  return shell(ctx, { title: 'الإعدادات', active: 'settings', body: body });
}

module.exports = {
  shell,
  login,
  dashboard,
  productList,
  productForm,
  categoryList,
  orderList,
  orderView,
  couponList,
  settings
};
