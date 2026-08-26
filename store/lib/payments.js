'use strict';

/*
 * بوابات الدفع — لا تحتاج أي مكتبة خارجية، تستخدم fetch المدمج في Node.js
 * كل بوابة تُرجع: { ok, url } لبدء الدفع، و verify() للتأكيد بعد العودة.
 */

function paypalBase(settings) {
  return settings.paypal_live === '1'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

function formBody(pairs) {
  const params = new URLSearchParams();
  for (const key of Object.keys(pairs)) params.append(key, String(pairs[key]));
  return params.toString();
}

/* ---------------- Stripe ---------------- */

async function stripeCreate(settings, order, items, returnUrl, cancelUrl) {
  const key = settings.stripe_secret;
  if (!key) return { ok: false, error: 'مفتاح Stripe غير مضبوط في لوحة التحكم.' };

  const payload = {
    mode: 'payment',
    success_url: returnUrl,
    cancel_url: cancelUrl,
    client_reference_id: order.ref,
    'metadata[order_ref]': order.ref
  };

  // Stripe لا يقبل خطوط الخصم، لذلك يُطبَّق الخصم على أول عنصر
  let discountLeft = Number(order.discount) || 0;
  let i = 0;
  for (const item of items) {
    let unit = Number(item.price);
    const qty = Number(item.qty);
    if (discountLeft > 0) {
      const share = Math.min(discountLeft, unit * qty);
      unit = Math.max(0, unit - share / qty);
      discountLeft -= share;
    }
    payload['line_items[' + i + '][quantity]'] = qty;
    payload['line_items[' + i + '][price_data][currency]'] = String(order.currency).toLowerCase();
    payload['line_items[' + i + '][price_data][unit_amount]'] = Math.round(unit * 100);
    payload['line_items[' + i + '][price_data][product_data][name]'] = item.name;
    i += 1;
  }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formBody(payload)
  });
  const data = await res.json();
  if (!res.ok) {
    return { ok: false, error: (data.error && data.error.message) || 'تعذر بدء الدفع عبر Stripe.' };
  }
  return { ok: true, url: data.url, ref: data.id };
}

async function stripeVerify(settings, sessionId) {
  const key = settings.stripe_secret;
  if (!key || !sessionId) return { paid: false };
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId), {
    headers: { Authorization: 'Bearer ' + key }
  });
  const data = await res.json();
  if (!res.ok) return { paid: false };
  return {
    paid: data.payment_status === 'paid',
    ref: data.payment_intent || data.id,
    orderRef: data.client_reference_id || ''
  };
}

/* ---------------- PayPal ---------------- */

async function paypalToken(settings) {
  const id = settings.paypal_client_id;
  const sec = settings.paypal_secret;
  if (!id || !sec) return null;
  const res = await fetch(paypalBase(settings) + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(id + ':' + sec).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token || null;
}

async function paypalCreate(settings, order, items, returnUrl, cancelUrl) {
  const token = await paypalToken(settings);
  if (!token) return { ok: false, error: 'بيانات PayPal غير صحيحة أو غير مضبوطة.' };

  const res = await fetch(paypalBase(settings) + '/v2/checkout/orders', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: order.ref,
        custom_id: order.ref,
        amount: {
          currency_code: String(order.currency).toUpperCase(),
          value: Number(order.total).toFixed(2)
        }
      }],
      application_context: {
        return_url: returnUrl,
        cancel_url: cancelUrl,
        user_action: 'PAY_NOW'
      }
    })
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data.message || 'تعذر بدء الدفع عبر PayPal.' };
  const link = (data.links || []).find(function (l) { return l.rel === 'approve'; });
  if (!link) return { ok: false, error: 'لم يُرجع PayPal رابط الدفع.' };
  return { ok: true, url: link.href, ref: data.id };
}

async function paypalCapture(settings, paypalOrderId) {
  const token = await paypalToken(settings);
  if (!token || !paypalOrderId) return { paid: false };
  const res = await fetch(
    paypalBase(settings) + '/v2/checkout/orders/' + encodeURIComponent(paypalOrderId) + '/capture',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    }
  );
  const data = await res.json();
  if (!res.ok) return { paid: false };
  const unit = (data.purchase_units || [])[0] || {};
  return {
    paid: data.status === 'COMPLETED',
    ref: data.id,
    orderRef: unit.custom_id || unit.reference_id || ''
  };
}

/* ---------------- registry ---------------- */

function availableGateways(settings) {
  const list = [];
  if (settings.enable_bank === '1') {
    list.push({ id: 'bank', label: 'تحويل بنكي', note: 'تأكيد يدوي بعد إرسال صورة التحويل' });
  }
  if (settings.enable_stripe === '1' && settings.stripe_secret) {
    list.push({ id: 'stripe', label: 'بطاقة مدى أو فيزا', note: 'تأكيد تلقائي فوري' });
  }
  if (settings.enable_paypal === '1' && settings.paypal_client_id) {
    list.push({ id: 'paypal', label: 'PayPal', note: 'تأكيد تلقائي فوري' });
  }
  return list;
}

module.exports = {
  stripeCreate,
  stripeVerify,
  paypalCreate,
  paypalCapture,
  availableGateways
};
