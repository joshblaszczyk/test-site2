// ThomKat DEMO backend. Runs entirely in the visitor's browser: it answers the shop's /shop/api/* requests
// from localStorage so cart -> checkout -> order -> admin all work on a static host.
// There are NO real keys, accounts or servers behind it. Cards are fake (see demo-square.js) and no money moves.
(function () {
  'use strict';
  if (window.ThomKatDemo) return;
  const SCRIPT = document.currentScript.src;
  const SHOP_DIR = new URL('./', SCRIPT).href;            // .../shop/
  const SITE = new URL('../', SCRIPT).href;               // site root
  const KEY = 'thomkat.demo.v2';          // v2: the real-admin demo (consignors, sales, checks) lives in state.adm
  const realFetch = window.fetch.bind(window);
  const PICKUP = { address: '1 N. Main St., Lombard, IL 60148', phone: '630.615.0640' };
  const RATES = [
    { id: 'demo_ground', provider: 'USPS', service: 'Ground Advantage', amount_cents: 650, days: 4 },
    { id: 'demo_priority', provider: 'USPS', service: 'Priority Mail', amount_cents: 985, days: 2 },
  ];

  const exts = [];      // extra route handlers (demo-admin-api.js)
  const hooks = {};     // orderPaid(order), ...

  // ---- state -------------------------------------------------------------------------------------
  const blank = () => ({ custom: [], hidden: [], orders: [], seq: 1000, tokens: {}, idem: {}, seeded: false, adm: {} });
  let state;
  function load() {
    try { state = Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { state = blank(); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; }
  }
  load();
  window.addEventListener('storage', e => { if (e.key === KEY) load(); });

  const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
  const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const rand62 = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => B62[b % 62]).join('');
  const nowIso = () => new Date().toISOString();

  // ---- catalog -----------------------------------------------------------------------------------
  let baseProducts = null;
  async function products() {
    if (!baseProducts) {
      const r = await realFetch(SITE + 'products/products.json');
      baseProducts = (await r.json()).products;
    }
    return ovApply(state.custom.concat(baseProducts));
  }
  // Edits made in the demo admin (Find & edit) to the shop's own sample pieces: stored as per-SKU overrides.
  function ovApply(list) {
    const ov = state.adm && state.adm.ov;
    if (!ov || !Object.keys(ov).length) return list;
    return list.map(p => (ov[String(p.sku)] ? Object.assign({}, p, ov[String(p.sku)]) : p));
  }
  const priceOf = p => Math.round((p.sale_price ?? p.price ?? p.regular_price ?? 0) * 100);
  const thumbOf = p => p.images?.[0]?.thumb || p.images?.[0]?.card || '';
  const pstateOf = sku => ((state.adm && state.adm.pstate) || {})[String(sku)];
  function soldSkus() {
    const s = new Set();
    state.orders.forEach(o => { if (o.status !== 'failed') o.items.forEach(i => { if (!i.refunded) s.add(String(i.sku)); }); });
    Object.entries((state.adm && state.adm.pstate) || {}).forEach(([k, v]) => { if (v.status === 'sold') s.add(k); });
    return s;
  }
  // A piece's state: what the admin set by hand wins over what the orders say (like the real shop's product_state).
  function statusOf(sku, sold) {
    sku = String(sku);
    const p = pstateOf(sku);
    if (p && p.status === 'sold') return 'sold';
    if (p && p.status === 'hidden') return 'hidden';
    if (p && p.status === 'available') return 'available';
    if (sold.has(sku)) return 'sold';
    if (state.hidden.includes(sku)) return 'hidden';
    return 'available';
  }

  // Sample data (orders, consignors, ...) comes from demo-admin-api.js, which registers a seeder here.
  const seeders = [];
  let seeding = null;
  async function ensureSeed() {
    if (state.seeded) return;
    if (!seeding) {   // several requests can arrive together: seed once
      seeding = (async () => { for (const fn of seeders) await fn(state); state.seeded = true; save(); })().finally(() => { seeding = null; });
    }
    await seeding;
  }

  // ---- orders ------------------------------------------------------------------------------------
  function orderPublic(o) {
    return {
      number: o.number, token: o.token, status: o.status, fulfillment: o.fulfillment, fulfillment_status: o.fulfillment_status, email: o.email, email_sent: false,
      ship_to: o.ship_to ? { name: o.ship_to.name, city: o.ship_to.city, state: o.ship_to.state, zip: o.ship_to.zip } : null, pickup: o.fulfillment === 'pickup' ? PICKUP : null,
      shipping: o.fulfillment === 'ship' ? { carrier: o.carrier || (o.tracking && o.tracking.carrier) || 'USPS', service: o.service || '', tracking_number: (o.tracking && o.tracking.number) || '', tracking_url: (o.tracking && o.tracking.url) || '' } : null,
      items: o.items, items_cents: o.items_cents, shipping_cents: o.shipping_cents, tax_cents: o.tax_cents,
      refunded_cents: o.refunded_cents, total_cents: o.total_cents, test_payment: true, receipt_url: '', payment_error: '',
    };
  }
  function fail(message, status, code, extra) { return { status: status || 400, body: Object.assign({ ok: false, error: message, code: code || 'bad_request' }, extra || {}) }; }
  const ok = body => ({ status: 200, body: Object.assign({ ok: true }, body) });

  // ---- routes (the same shapes the real PHP API returns) -----------------------------------------
  async function handle(route, method, body, ctx) {
    await ensureSeed();
    for (const ext of exts) { const r = await ext(route, method, body, ctx || { query: new URLSearchParams(), headers: {} }); if (r) return r; }
    const all = await products();
    const byKey = new Map(all.map(p => [String(p.sku), p]));
    if (route === 'config') {
      return ok({
        test_mode: true,
        square: { available: true, mode: 'sandbox', applicationId: 'demo-no-real-key', locationId: 'DEMO', sdkUrl: SHOP_DIR + 'demo-square.js' },
        shipping: { provider: 'demo', pickup: PICKUP }, tax: { rate_bps: 0, states: 'IL' }, phone: PICKUP.phone,
      });
    }
    if (route === 'catalog') {
      const sold = soldSkus();
      return ok({ products: all.map(p => ({ sku: String(p.sku), status: statusOf(p.sku, sold) })) });
    }
    if (route === 'checkout/quote' && method === 'POST') {
      const sold = soldSkus();
      const skus = (body.items || []).map(String);
      const gone = skus.filter(s => !byKey.has(s) || statusOf(s, sold) !== 'available');
      if (gone.length) return fail('Some pieces are no longer available.', 409, 'unavailable', { unavailable: gone });
      const items_cents = skus.reduce((s, k) => s + priceOf(byKey.get(k)), 0);
      const ship = body.fulfillment === 'ship';
      if (ship && !(body.address && body.address.zip && body.address.state)) return fail('Please enter a full address.', 400, 'bad_address');
      const quote = { quote_id: 'q_' + hex(8), fulfillment: ship ? 'ship' : 'pickup', items_cents, tax_cents: 0, rates: ship ? RATES : [], skus, address: ship ? body.address : null };
      sessionStorage.setItem('thomkat.demo.quote.' + quote.quote_id, JSON.stringify(quote));
      return ok({ quote });
    }
    if (route === 'checkout/pay' && method === 'POST') {
      const prior = state.idem[body.idempotency_key];
      if (prior) { const o = state.orders.find(x => x.id === prior); if (o) return ok({ order: orderPublic(o) }); }
      let quote = null;
      try { quote = JSON.parse(sessionStorage.getItem('thomkat.demo.quote.' + body.quote_id)); } catch { /* none */ }
      if (!quote) return fail('Your quote expired. Please check your order again.', 409, 'quote_expired');
      // The card token is the only thing that reaches "the server"; it must be one the fake SDK issued, unused and fresh.
      const tok = state.tokens[body.source_id];
      if (!tok || tok.used || Date.now() - tok.at > 5 * 60 * 1000) return fail('That card token is not valid. Please re-enter your card.', 400, 'invalid_token');
      tok.used = true;
      if (tok.decline) { save(); return fail('Your card was declined. No charge was made.', 402, 'card_declined'); }
      const sold = soldSkus();
      const gone = quote.skus.filter(s => statusOf(s, sold) !== 'available');
      if (gone.length) { save(); return fail('Some pieces just sold.', 409, 'unavailable', { unavailable: gone }); }
      const rate = quote.fulfillment === 'ship' ? RATES.find(r => r.id === body.rate_id) : null;
      if (quote.fulfillment === 'ship' && !rate) return fail('Please choose a shipping option.', 400, 'bad_rate');
      const its = quote.skus.map(s => { const p = byKey.get(s); return { sku: s, name: p.name, price_cents: priceOf(p), image: thumbOf(p), refunded: false }; });
      const items_cents = its.reduce((s, x) => s + x.price_cents, 0);
      const shipping_cents = rate ? rate.amount_cents : 0;
      const c = body.contact || {};
      const order = {
        id: ++state.seq, token: hex(16), number: 'TK-' + state.seq, status: 'paid', created_at: nowIso(),
        name: c.name, email: c.email, phone: c.phone || '', fulfillment: quote.fulfillment, ship_to: null,
        items: its, items_cents, shipping_cents, tax_cents: 0, refunded_cents: 0, total_cents: items_cents + shipping_cents,
        fulfillment_status: 'unfulfilled', tracking: null, card: tok.card, test_payment: true, notes: '', phone: c.phone || '', paid_at: nowIso(), label: { status: 'none' }, refunds: [], commission_refunded_cents: 0,
        payment_ref: 'demo_pay_' + rand62(12), shipping_rate: rate ? rate.service : '',
      };
      if (quote.fulfillment === 'ship') { const a = quote.address || {}; order.ship_to = { name: c.name, street1: a.street1 || '', street2: a.street2 || '', city: a.city || '', state: a.state || '', zip: a.zip || '' }; }
      state.orders.unshift(order);
      state.idem[body.idempotency_key] = order.id;
      try { if (hooks.orderPaid) hooks.orderPaid(order); } catch (e) { console.warn('demo hook', e); }
      save();
      return ok({ order: orderPublic(order) });
    }
    const m = route.match(/^orders\/([a-f0-9]{32})$/);
    if (m) {
      const o = state.orders.find(x => x.token === m[1]);
      return o ? ok({ order: orderPublic(o) }) : fail('Order not found.', 404, 'not_found');
    }
    return fail('Not found.', 404, 'not_found');
  }

  // ---- fetch interception ------------------------------------------------------------------------
  window.fetch = async function (input, init) {
    let url = typeof input === 'string' ? input : input.url;
    try { url = new URL(url, location.href).href; } catch { /* keep as is */ }   // 'shop/api/…' (relative, as consignor.js calls it) must match too
    const at = url.indexOf('/shop/api/');
    if (at !== -1) {
      const [path, qs] = url.slice(at + 10).split('?');
      const route = path.replace(/\/$/, '');
      const method = (init && init.method) || (typeof input !== 'string' && input.method) || 'GET';
      let body = {};
      try { body = init && init.body ? JSON.parse(init.body) : {}; } catch { /* ignore */ }
      const hdr = {};
      const rawH = (init && init.headers) || (typeof input !== 'string' && input.headers) || {};
      if (typeof rawH.forEach === 'function' && !Array.isArray(rawH)) rawH.forEach((v, k) => { hdr[String(k).toLowerCase()] = v; });
      else Object.entries(rawH).forEach(([k, v]) => { hdr[k.toLowerCase()] = v; });
      const { status, body: out } = await handle(route, method.toUpperCase(), body, { query: new URLSearchParams(qs || ''), headers: hdr });
      return new Response(JSON.stringify(out), { status, headers: { 'Content-Type': 'application/json' } });
    }
    if (/products\/products\.json(\?|$)/.test(url) && (state.custom.length || (state.adm && state.adm.ov))) {
      const r = await realFetch(input, init);
      const data = await r.json();
      data.products = ovApply(state.custom.concat(data.products));
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input, init);
  };

  // Pieces added in the admin appear on the storefront: patch the embedded product list before shop.html reads it.
  const embedded = document.getElementById('productData');
  if (embedded && (state.custom.length || (state.adm && state.adm.ov))) {
    try { embedded.textContent = JSON.stringify(ovApply(state.custom.concat(JSON.parse(embedded.textContent)))); } catch { /* leave as is */ }
  }

  // ---- API for the admin page and the fake card form ---------------------------------------------
  window.ThomKatDemo = {
    PICKUP, RATES,
    state: () => state, exts, hooks, seeders, ovApply, pstateOf, handle, SITE, SHOP_DIR,
    extend(fn) { exts.push(fn); }, onSeed(fn) { seeders.push(fn); },
    save, products, soldSkus, statusOf, priceOf, thumbOf, ensureSeed, orderPublic,
    issueToken(card, decline) {
      const token = 'cnon:' + rand62(28);
      state.tokens[token] = { at: Date.now(), used: false, card, decline: Boolean(decline) };
      // keep the token cache small
      Object.keys(state.tokens).filter(t => Date.now() - state.tokens[t].at > 3600000).forEach(t => delete state.tokens[t]);
      save();
      return token;
    },
    addPiece(p) { state.custom.unshift(p); return save(); },
    removePiece(sku) { state.custom = state.custom.filter(p => String(p.sku) !== String(sku)); state.hidden = state.hidden.filter(s => s !== String(sku)); save(); },
    toggleHidden(sku) { sku = String(sku); state.hidden = state.hidden.includes(sku) ? state.hidden.filter(s => s !== sku) : state.hidden.concat(sku); save(); },
    reset() { localStorage.removeItem(KEY); load(); baseProducts = null; },
    tokenHex: hex,
  };
})();
