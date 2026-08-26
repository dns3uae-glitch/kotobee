'use strict';

const { e, money, nl2br } = require('../lib/core');

const RARITY = {
  common: { label: 'عادي', cls: 'r-common' },
  rare: { label: 'نادر', cls: 'r-rare' },
  epic: { label: 'ملحمي', cls: 'r-epic' },
  mythic: { label: 'أسطوري', cls: 'r-mythic' }
};

const STATUS = {
  pending: 'بانتظار الدفع',
  review: 'بانتظار المراجعة',
  paid: 'مدفوع',
  delivered: 'تم التسليم',
  canceled: 'ملغي'
};

function rarity(key) {
  return RARITY[key] || RARITY.common;
}

function statusLabel(key) {
  return STATUS[key] || key;
}

function layout(ctx, opts) {
  const s = ctx.settings;
  const cartCount = ctx.cartCount || 0;
  const cats = ctx.categories || [];
  const flash = ctx.flash;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(opts.title)} — ${e(s.store_name)}</title>
<meta name="description" content="${e(opts.description || s.store_tagline)}">
<meta property="og:title" content="${e(opts.title)}">
<meta property="og:description" content="${e(opts.description || s.store_tagline)}">
<meta name="theme-color" content="#0B1026">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lalezar&family=Tajawal:wght@400;500;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/app.css">
</head>
<body>
<a class="skip" href="#main">تخطَّ إلى المحتوى</a>
<header class="top">
  <div class="wrap top-in">
    <a class="brand" href="/">
      <span class="brand-mark" aria-hidden="true">غ</span>
      <span class="brand-text">
        <strong>${e(s.store_name)}</strong>
        <small>${e(s.store_tagline)}</small>
      </span>
    </a>
    <nav class="nav" aria-label="التصنيفات">
      <a href="/products">كل الغنائم</a>
      ${cats.map(function (c) {
        return `<a href="/c/${e(c.slug)}">${e(c.name)}</a>`;
      }).join('')}
      <a href="/track">تتبع طلبي</a>
    </nav>
    <a class="cart-btn" href="/cart">
      السلة
      <span class="cart-count" data-cart-count>${cartCount}</span>
    </a>
  </div>
</header>

${flash ? `<div class="wrap"><div class="flash ${e(flash.type)}">${e(flash.text)}</div></div>` : ''}

<main id="main">${opts.body}</main>

<footer class="foot">
  <div class="wrap foot-in">
    <div>
      <strong class="foot-name">${e(s.store_name)}</strong>
      <p>${e(s.store_tagline)}</p>
    </div>
    <div class="foot-links">
      <a href="/products">المتجر</a>
      <a href="/track">تتبع طلبي</a>
      <a href="/page/terms">الشروط والاستبدال</a>
      ${s.whatsapp ? `<a href="https://wa.me/${e(s.whatsapp)}">واتساب</a>` : ''}
      ${s.discord ? `<a href="${e(s.discord)}">Discord</a>` : ''}
      ${s.instagram ? `<a href="${e(s.instagram)}">Instagram</a>` : ''}
    </div>
  </div>
  <div class="wrap foot-bar">
    <span>جميع الحقوق محفوظة ${new Date().getFullYear()}</span>
    <a href="/admin">لوحة التحكم</a>
  </div>
</footer>
<script src="/assets/js/app.js" defer></script>
</body>
</html>`;
}

function ticket(ctx, p) {
  const r = rarity(p.rarity);
  const cur = ctx.settings.currency_label;
  const off = p.compare_at > p.price
    ? Math.round((1 - p.price / p.compare_at) * 100)
    : 0;
  const soldOut = p.kind === 'digital' && p.stock <= 0;

  return `<article class="ticket ${r.cls}${soldOut ? ' is-out' : ''}">
  <a class="ticket-media" href="/p/${e(p.slug)}">
    ${p.image
      ? `<img src="/uploads/${e(p.image)}" alt="${e(p.name)}" loading="lazy">`
      : `<span class="ticket-ph" aria-hidden="true">${e(p.name.slice(0, 2))}</span>`}
    <span class="ticket-rarity">${r.label}</span>
    ${off ? `<span class="ticket-off">-${off}%</span>` : ''}
  </a>
  <div class="ticket-tear" aria-hidden="true"></div>
  <div class="ticket-body">
    <h3><a href="/p/${e(p.slug)}">${e(p.name)}</a></h3>
    <p>${e(p.summary)}</p>
    <div class="ticket-meta">
      <span class="serial">رقم ${String(p.id).padStart(4, '0')}</span>
      <span class="stock">${soldOut ? 'نفدت الكمية' : 'المتاح ' + p.stock}</span>
    </div>
    <div class="ticket-foot">
      <div class="price">
        <span class="price-now">${money(p.price, cur)}</span>
        ${p.compare_at > p.price ? `<span class="price-was">${money(p.compare_at, cur)}</span>` : ''}
      </div>
      ${soldOut
        ? `<button class="btn btn-ghost" disabled>نفدت</button>`
        : `<form method="post" action="/cart/add" class="inline">
             <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
             <input type="hidden" name="id" value="${p.id}">
             <button class="btn btn-gold" type="submit">أضف للسلة</button>
           </form>`}
    </div>
  </div>
</article>`;
}

function home(ctx, data) {
  const s = ctx.settings;
  const body = `
<section class="hero">
  <div class="wrap hero-in">
    <div class="hero-copy">
      <span class="eyebrow">ماب السرقة — Steal a Brainrot</span>
      <h1>${e(s.hero_title)}</h1>
      <p>${e(s.hero_text)}</p>
      <div class="hero-cta">
        <a class="btn btn-gold btn-lg" href="/products">اختر غنيمتك</a>
        <a class="btn btn-ghost btn-lg" href="/track">تتبع طلبك</a>
      </div>
      <dl class="hero-stats">
        <div><dt>طلب مكتمل</dt><dd>${data.stats.orders}</dd></div>
        <div><dt>غنيمة معروضة</dt><dd>${data.stats.products}</dd></div>
        <div><dt>متوسط التسليم</dt><dd>5 دقائق</dd></div>
      </dl>
    </div>
    <div class="hero-vault" aria-hidden="true">
      <div class="vault-ring"></div>
      <div class="vault-core">غ</div>
    </div>
  </div>
</section>

<div class="ticker" aria-label="أحدث المبيعات">
  <div class="ticker-track">
    ${data.ticker.concat(data.ticker).map(function (t) {
      return `<span class="ticker-item"><b>${e(t.name)}</b> بِيعت ${t.sold_count} مرة</span>`;
    }).join('')}
  </div>
</div>

<section class="wrap section">
  <header class="section-head">
    <h2>الأكثر طلبًا</h2>
    <a href="/products">كل الغنائم</a>
  </header>
  <div class="grid">
    ${data.featured.map(function (p) { return ticket(ctx, p); }).join('')}
  </div>
</section>

<section class="wrap section">
  <header class="section-head"><h2>كيف تستلم غنيمتك</h2></header>
  <ol class="steps">
    <li><span>1</span><h3>اختر وادفع</h3><p>حدد الغنيمة، وادفع ببطاقة أو تحويل بنكي.</p></li>
    <li><span>2</span><h3>اكتب اسمك في اللعبة</h3><p>نطلب اسم حسابك فقط، ولا نطلب كلمة المرور إطلاقًا.</p></li>
    <li><span>3</span><h3>استلم في السيرفر</h3><p>ندخل معك سيرفرًا خاصًا ونسلّمك الغنيمة مباشرة.</p></li>
  </ol>
</section>

<section class="wrap section">
  <header class="section-head"><h2>مستويات الندرة</h2></header>
  <div class="tiers">
    ${Object.keys(RARITY).map(function (key) {
      const r = RARITY[key];
      return `<div class="tier ${r.cls}"><span>${r.label}</span></div>`;
    }).join('')}
  </div>
</section>

<section class="wrap section">
  <header class="section-head"><h2>أسئلة متكررة</h2></header>
  <div class="faq">
    <details open><summary>هل تحتاجون كلمة مرور حسابي؟</summary><p>لا. نحتاج اسم حسابك في اللعبة فقط، والتسليم يتم داخل سيرفر خاص.</p></details>
    <details><summary>كم يستغرق التسليم؟</summary><p>من دقيقة إلى خمس دقائق بعد تأكيد الدفع في أوقات العمل.</p></details>
    <details><summary>ماذا لو لم تصل الغنيمة؟</summary><p>افتح صفحة تتبع الطلب وأرسل رقم الطلب، ويُعاد المبلغ كاملًا إن تعذر التسليم.</p></details>
  </div>
</section>`;

  return layout(ctx, { title: 'الرئيسية', body: body });
}

function catalog(ctx, data) {
  const body = `
<section class="wrap section">
  <header class="section-head">
    <h2>${e(data.title)}</h2>
    <form class="search" method="get" action="/products">
      <input type="search" name="q" value="${e(data.q || '')}" placeholder="ابحث عن غنيمة" aria-label="بحث">
      <button class="btn btn-ghost" type="submit">بحث</button>
    </form>
  </header>
  ${data.products.length
    ? `<div class="grid">${data.products.map(function (p) { return ticket(ctx, p); }).join('')}</div>`
    : `<div class="empty"><h3>لا توجد نتائج</h3><p>جرّب اسمًا آخر أو تصفّح كل الغنائم.</p><a class="btn btn-gold" href="/products">كل الغنائم</a></div>`}
</section>`;
  return layout(ctx, { title: data.title, body: body });
}

function product(ctx, data) {
  const p = data.product;
  const r = rarity(p.rarity);
  const cur = ctx.settings.currency_label;
  const soldOut = p.kind === 'digital' && p.stock <= 0;

  const body = `
<section class="wrap product">
  <div class="product-media ${r.cls}">
    ${p.image
      ? `<img src="/uploads/${e(p.image)}" alt="${e(p.name)}">`
      : `<span class="ticket-ph big" aria-hidden="true">${e(p.name.slice(0, 2))}</span>`}
    <span class="ticket-rarity">${r.label}</span>
  </div>
  <div class="product-info">
    <nav class="crumbs"><a href="/">الرئيسية</a> / <a href="/products">الغنائم</a></nav>
    <h1>${e(p.name)}</h1>
    <p class="lead">${e(p.summary)}</p>
    <div class="product-price">
      <span class="price-now">${money(p.price, cur)}</span>
      ${p.compare_at > p.price ? `<span class="price-was">${money(p.compare_at, cur)}</span>` : ''}
      <span class="serial">رقم ${String(p.id).padStart(4, '0')}</span>
    </div>
    ${soldOut
      ? `<div class="notice">نفدت الكمية حاليًا. تابع حسابنا ليصلك التوفر.</div>`
      : `<form method="post" action="/cart/add" class="buy">
           <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
           <input type="hidden" name="id" value="${p.id}">
           <label>الكمية
             <input type="number" name="qty" value="1" min="1" max="${Math.max(1, p.stock)}">
           </label>
           <button class="btn btn-gold btn-lg" type="submit">أضف للسلة</button>
         </form>`}
    <div class="product-body">${nl2br(p.body)}</div>
    <ul class="assure">
      <li>لا نطلب كلمة المرور</li>
      <li>استرجاع كامل إن تعذر التسليم</li>
      <li>المتاح الآن: ${p.stock}</li>
    </ul>
  </div>
</section>

${data.related.length ? `<section class="wrap section">
  <header class="section-head"><h2>غنائم مشابهة</h2></header>
  <div class="grid">${data.related.map(function (x) { return ticket(ctx, x); }).join('')}</div>
</section>` : ''}`;

  return layout(ctx, { title: p.name, description: p.summary, body: body });
}

function cart(ctx, data) {
  const cur = ctx.settings.currency_label;
  const body = `
<section class="wrap section narrow">
  <h2>سلة الغنائم</h2>
  ${data.lines.length ? `
  <form method="post" action="/cart/update" class="cart-table">
    <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
    ${data.lines.map(function (l) {
      return `<div class="cart-row">
        <div class="cart-name">
          <strong>${e(l.name)}</strong>
          <small>${money(l.price, cur)} للحبة</small>
        </div>
        <input class="qty" type="number" name="qty_${l.id}" value="${l.qty}" min="0" max="${Math.max(1, l.stock)}" aria-label="كمية ${e(l.name)}">
        <div class="cart-sum">${money(l.price * l.qty, cur)}</div>
      </div>`;
    }).join('')}
    <div class="cart-actions">
      <button class="btn btn-ghost" type="submit">تحديث الكميات</button>
    </div>
  </form>

  <form method="post" action="/cart/coupon" class="coupon">
    <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
    <input type="text" name="code" value="${e(data.coupon || '')}" placeholder="كود الخصم">
    <button class="btn btn-ghost" type="submit">تطبيق</button>
  </form>

  <div class="totals">
    <div><span>المجموع</span><b>${money(data.subtotal, cur)}</b></div>
    ${data.discount ? `<div class="off"><span>الخصم</span><b>-${money(data.discount, cur)}</b></div>` : ''}
    <div class="grand"><span>الإجمالي</span><b>${money(data.total, cur)}</b></div>
  </div>
  <a class="btn btn-gold btn-lg block" href="/checkout">إتمام الشراء</a>
  ` : `<div class="empty"><h3>سلتك فارغة</h3><p>اختر غنيمة وابدأ.</p><a class="btn btn-gold" href="/products">تصفّح الغنائم</a></div>`}
</section>`;
  return layout(ctx, { title: 'السلة', body: body });
}

function checkout(ctx, data) {
  const cur = ctx.settings.currency_label;
  const s = ctx.settings;
  const body = `
<section class="wrap section narrow">
  <h2>إتمام الشراء</h2>
  <form method="post" action="/checkout" class="form">
    <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
    <label>الاسم
      <input type="text" name="customer_name" required maxlength="80" value="${e(data.old.customer_name || '')}">
    </label>
    <label>اسم حسابك في اللعبة
      <input type="text" name="game_username" required maxlength="60" value="${e(data.old.game_username || '')}"
        placeholder="اكتبه كما يظهر داخل اللعبة">
    </label>
    <div class="row">
      <label>البريد الإلكتروني
        <input type="email" name="customer_email" maxlength="120" value="${e(data.old.customer_email || '')}">
      </label>
      <label>الجوال
        <input type="tel" name="customer_phone" maxlength="30" value="${e(data.old.customer_phone || '')}">
      </label>
    </div>
    <label>ملاحظة للفريق
      <textarea name="note" rows="2" maxlength="400">${e(data.old.note || '')}</textarea>
    </label>

    <fieldset class="pay">
      <legend>طريقة الدفع</legend>
      ${data.gateways.map(function (g, i) {
        return `<label class="pay-opt">
          <input type="radio" name="gateway" value="${e(g.id)}" ${i === 0 ? 'checked' : ''}>
          <span><b>${e(g.label)}</b><small>${e(g.note)}</small></span>
        </label>`;
      }).join('')}
    </fieldset>

    ${s.enable_bank === '1' ? `<div class="bank-box">
      <h4>بيانات التحويل البنكي</h4>
      <p><span>البنك</span> <b>${e(s.bank_name)}</b></p>
      <p><span>الآيبان</span> <b class="mono">${e(s.bank_iban)}</b></p>
      <p><span>الاسم</span> <b>${e(s.bank_holder)}</b></p>
      <small>${e(s.bank_note)}</small>
    </div>` : ''}

    <div class="totals">
      <div><span>المجموع</span><b>${money(data.subtotal, cur)}</b></div>
      ${data.discount ? `<div class="off"><span>الخصم</span><b>-${money(data.discount, cur)}</b></div>` : ''}
      <div class="grand"><span>الإجمالي</span><b>${money(data.total, cur)}</b></div>
    </div>
    <button class="btn btn-gold btn-lg block" type="submit">تأكيد الطلب</button>
  </form>
</section>`;
  return layout(ctx, { title: 'إتمام الشراء', body: body });
}

function orderPage(ctx, data) {
  const cur = ctx.settings.currency_label;
  const o = data.order;
  const s = ctx.settings;
  const body = `
<section class="wrap section narrow">
  <div class="order-head">
    <span class="eyebrow">رقم الطلب</span>
    <h2 class="mono">${e(o.ref)}</h2>
    <span class="badge st-${e(o.status)}">${statusLabel(o.status)}</span>
  </div>

  ${o.status === 'pending' && o.gateway === 'bank' ? `<div class="bank-box">
    <h4>حوّل المبلغ ثم أرسل صورة التحويل</h4>
    <p><span>البنك</span> <b>${e(s.bank_name)}</b></p>
    <p><span>الآيبان</span> <b class="mono">${e(s.bank_iban)}</b></p>
    <p><span>الاسم</span> <b>${e(s.bank_holder)}</b></p>
    <p><span>المبلغ</span> <b>${money(o.total, cur)}</b></p>
    <form method="post" action="/order/${e(o.ref)}/proof" enctype="multipart/form-data" class="proof">
      <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
      <input type="file" name="proof" accept="image/*" required>
      <button class="btn btn-gold" type="submit">أرسل صورة التحويل</button>
    </form>
  </div>` : ''}

  ${o.status === 'review' ? `<div class="notice">وصلتنا صورة التحويل، وسيتم التأكيد ثم التسليم.</div>` : ''}

  ${o.delivery ? `<div class="delivery">
    <h4>تفاصيل التسليم</h4>
    <pre>${e(o.delivery)}</pre>
  </div>` : ''}

  <div class="cart-table">
    ${data.items.map(function (it) {
      return `<div class="cart-row">
        <div class="cart-name"><strong>${e(it.name)}</strong><small>الكمية ${it.qty}</small></div>
        <div class="cart-sum">${money(it.price * it.qty, cur)}</div>
      </div>`;
    }).join('')}
  </div>

  <div class="totals">
    <div><span>المجموع</span><b>${money(o.subtotal, cur)}</b></div>
    ${o.discount ? `<div class="off"><span>الخصم</span><b>-${money(o.discount, cur)}</b></div>` : ''}
    <div class="grand"><span>الإجمالي</span><b>${money(o.total, cur)}</b></div>
  </div>

  <dl class="kv">
    <div><dt>الاسم</dt><dd>${e(o.customer_name)}</dd></div>
    <div><dt>الحساب في اللعبة</dt><dd>${e(o.game_username)}</dd></div>
    <div><dt>طريقة الدفع</dt><dd>${e(o.gateway)}</dd></div>
    <div><dt>تاريخ الطلب</dt><dd class="mono">${e(o.created_at)}</dd></div>
  </dl>
  <a class="btn btn-ghost" href="/products">متابعة التسوق</a>
</section>`;
  return layout(ctx, { title: 'الطلب ' + o.ref, body: body });
}

function track(ctx, data) {
  const body = `
<section class="wrap section narrow">
  <h2>تتبع طلبك</h2>
  <p class="lead">أدخل رقم الطلب الذي وصلك بعد الشراء.</p>
  ${data.error ? `<div class="flash error">${e(data.error)}</div>` : ''}
  <form method="get" action="/track" class="form">
    <label>رقم الطلب
      <input type="text" name="ref" required maxlength="40" placeholder="G..." value="${e(data.ref || '')}">
    </label>
    <button class="btn btn-gold btn-lg" type="submit">ابحث</button>
  </form>
</section>`;
  return layout(ctx, { title: 'تتبع الطلب', body: body });
}

function staticPage(ctx, data) {
  const body = `
<section class="wrap section narrow prose">
  <h2>${e(data.title)}</h2>
  ${nl2br(data.text)}
</section>`;
  return layout(ctx, { title: data.title, body: body });
}

function notFound(ctx) {
  const body = `
<section class="wrap section narrow">
  <div class="empty">
    <h3>الصفحة غير موجودة</h3>
    <p>الرابط الذي طلبته غير متاح.</p>
    <a class="btn btn-gold" href="/">العودة للرئيسية</a>
  </div>
</section>`;
  return layout(ctx, { title: 'غير موجود', body: body });
}

module.exports = {
  layout,
  home,
  catalog,
  product,
  cart,
  checkout,
  orderPage,
  track,
  staticPage,
  notFound,
  statusLabel,
  RARITY,
  STATUS
};
