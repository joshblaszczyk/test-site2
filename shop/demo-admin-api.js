// ThomKat DEMO admin backend. Answers every /shop/api/admin/* and /shop/api/consignor* request the REAL admin pages
// (shop/admin/*.html) and the consignor page (consignor.html) make, from the visitor's own browser (localStorage).
// Response shapes follow shop/api.php + shop/lib/*.php of the real shop, so the real pages run unchanged.
// EVERYTHING here is made up: fake customers (example.com, 555-01xx), fake consignors, fake keys. Nothing real is read or stored.
(function () {
  'use strict';
  const D = window.ThomKatDemo;
  if (!D || D.adminLoaded) return;
  D.adminLoaded = true;
  const SITE = D.SITE, SHOP_DIR = D.SHOP_DIR;
  const SESSION_KEY = 'thomkat.demo.session';
  const PORTAL_KEY = 'thomkat.demo.consignor';
  const PHOTO_CACHE = 'thomkat-demo-photos';
  const DAY = 86400000;

  // ---- tiny helpers ---------------------------------------------------------------------------------
  class Err extends Error { constructor(m, status, code, extra) { super(m); this.status = status || 400; this.code = code || 'bad_request'; this.extra = extra; } }
  const ok = b => ({ status: 200, body: Object.assign({ ok: true }, b) });
  const nowIso = () => new Date().toISOString();
  const isoDate = ms => new Date(ms).toISOString().slice(0, 10);
  const todayLocal = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
  const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
  const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max || 200);
  const dollarsToCents = v => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  };
  const consignCut = (cents, pct) => Math.floor((cents * pct + 50) / 100);          // = consign_cut() in shop/lib/consign.php
  const money = c => '$' + (c / 100).toFixed(2);
  const bpsOf = (cents, bps) => Math.round(cents * bps / 10000);
  const norm = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const dateOnly = (v, what) => {
    const s = clean(v, 20);
    if (s === '') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Err(`“${s}” is not a date (use YYYY-MM-DD).`, 400, 'bad_date');
    return s;
  };
  function pct(v, def) {
    if (v === null || v === undefined || v === '') return def;
    if (isNaN(Number(v))) throw new Err('The split must be a number of percent (for example 40).', 400, 'bad_split');
    let p = Number(v);
    if (p > 0 && p <= 1) p *= 100;
    if (p < 0 || p > 100) throw new Err('The split must be between 0 and 100 percent.', 400, 'bad_split');
    return Math.round(p);
  }
  const PICKUP = D.PICKUP;

  // The shop's own category lists (her categories -> the storefront groups), copied from shop/content/categories.json.
  const LISTS = {"categories":{"Women Tops":["Long Sleeves","Short Sleeves","Sweaters","Tanks","Evening","Others"],"Women Bottoms":["Jeans","Casual Pants","Dress Pants","Work Pants","Shorts","Capris","Jumpsuits/Overalls","Leggings","Leather Pants","Others"],"Women Dresses":["Maxi Dress","Short Work Dresses","Short Casual Dresses","Short Skirts","Long Skirts","Leather Skirts"],"Women Gowns":["Bridal Gowns","Formal Gowns","Prom Gowns","Homecoming Gowns","Short Formal Dresses"],"Women Shoes/Boots":["Heels","Flats","Pumps","Comfort Shoes","Sandals","Gym Shoes","Short Boots","Tall Boots"],"Women Purses":["Designer Bags","Fashion Bags","Evening Bags","Back Packs","Others"],"Women Suits":["Pant Suits","Skirt Suits","Fashion Sets","Blazers Only"],"Women Jackets/Coats":["Vest","Denim Jackets","Short Trench Jacket","Long Trench Coat","Short Wool Coats","Long Wool Coats","Short Puffer Jackets","Long Puffer Jackets","Leather Jackets","Leather Coats","Short Furs","Long Furs","Others"],"Women Jewelry":["Earrings - Clip Ons","Earrings - Pierced","Necklaces","Necklace Earring Sets","Bracelets","Broche","Rings"],"Women Accessories":["Hats","Winter Hats","Scarves","Gloves","Petti-Coats"]},"site_main":{"Women Tops":"Tops","Women Bottoms":"Bottoms","Women Dresses":"Dresses","Women Gowns":"Gowns","Women Shoes/Boots":"Shoes","Women Purses":"Purses","Women Suits":"Suits","Women Jackets/Coats":"Coats and Jackets","Women Jewelry":"Accessories","Women Accessories":"Accessories"},"sizes":{"clothes":["Small","Medium","Large","X-large","2X-Large +"],"clothes_numbers":["2","4","6","8","10","12","14","16","18","20","22","24+"],"shoes":["5.5","6","6.5","7","7.5","8","8.5","9","9.5","10","10.5","11","12+"]},"colors":["Red","Black","Blue","Green","Yellow","Orange","Brown","Purple","White","Cream"]};
  function siteCategory(main, sub) {
    main = clean(main, 60); sub = clean(sub, 60);
    for (const [hers, site] of Object.entries(LISTS.site_main)) {
      if (hers.toLowerCase() === main.toLowerCase() || hers.replace(/^women\s+/i, '').toLowerCase() === main.toLowerCase()) return [site, sub, hers, sub];
    }
    return [main, sub, main, sub];
  }
  // Her department / words in the description -> her main category (a small version of pieces_category_for()).
  const SECTION = { tops: 'Women Tops', sweaters: 'Women Tops', bottoms: 'Women Bottoms', pants: 'Women Bottoms', dresses: 'Women Dresses', gowns: 'Women Gowns', shoes: 'Women Shoes/Boots', boots: 'Women Shoes/Boots',
    accessories: 'Women Accessories', handbags: 'Women Purses', purses: 'Women Purses', bags: 'Women Purses', jewelry: 'Women Jewelry', suits: 'Women Suits', coats: 'Women Jackets/Coats', jackets: 'Women Jackets/Coats', outerwear: 'Women Jackets/Coats' };
  const RULES = [[/\b(gown|prom|bridal)\b/, 'Women Gowns'], [/\b(coat|jacket|blazer|parka|puffer)\b/, 'Women Jackets/Coats'], [/\b(dress|skirt)\b/, 'Women Dresses'], [/\b(jeans|pants|slacks|shorts|leggings|trousers)\b/, 'Women Bottoms'],
    [/\b(sweater|cardigan|blouse|shirt|top|tank|tee)\b/, 'Women Tops'], [/\b(boots?|heels?|flats?|sandals?|shoes?|pumps?|mules?)\b/, 'Women Shoes/Boots'], [/\b(purse|bag|clutch|handbag|crossbody)\b/, 'Women Purses'],
    [/\b(necklace|earrings?|bracelet|brooch|broche|ring)\b/, 'Women Jewelry'], [/\b(scarf|scarves|hat|gloves?|belt)\b/, 'Women Accessories'], [/\bsuit\b/, 'Women Suits']];
  function categoryFor(section, name) {
    const t = ' ' + String(name || '').toLowerCase() + ' ';
    for (const [rx, main] of RULES) if (rx.test(t)) return { main, sub: '', sure: true, note: '' };
    const key = String(section || '').toLowerCase().replace(/[^a-z]/g, '');
    if (SECTION[key]) return { main: SECTION[key], sub: '', sure: true, note: 'Sub-category not clear from the name — pick one if you like.' };
    return { main: '', sub: '', sure: false, note: 'Pick a category: neither the name nor the section row says what it is.' };
  }
  const sizeFromName = n => { const m = String(n).match(/\b(?:size|siz|ize|sz)\s*[:#]?\s*(\d{1,2}(?:\.5)?(?:\s*\/\s*\d{1,2})?w?|xxs|xs|s|m|l|xl|xxl|xxxl|[0-4]x)\b/i); if (!m) return ''; const s = m[1].replace(/\s+/g, ''); return /^[a-z]/i.test(s) || /x$/i.test(s) ? s.toUpperCase() : s; };
  const nameFromDescription = d => { const n = String(d).replace(/\s+/g, ' ').replace(/\s+-\s*\d{1,2}$/, '').trim(); return n.charAt(0).toUpperCase() + n.slice(1); };

  // ---- state ---------------------------------------------------------------------------------------------
  const S = () => D.state();
  function A() {
    const s = S();
    if (!s.adm || !s.adm.init) s.adm = Object.assign(emptyAdm(), s.adm || {});
    return s.adm;
  }
  const emptyAdm = () => ({ init: true, ticks: {}, held: {}, soldLog: {}, consignors: [], items: [], sales: [], payouts: [], events: [], seq: { c: 0, i: 0, s: 0, p: 0, e: 0, r: 0 },
    pstate: {}, ov: {}, editlog: {}, photos: {}, setup: { square: true, ebay: { demo_store_one: true, demo_store_two: true }, location: 'DEMO' }, ebayEvents: [], runs: [], lastStore: null });
  function commit() { if (!D.save()) throw new Err('The demo ran out of room in your browser storage. Press “Reset demo” (top of the page) or delete a piece, then try again.', 507, 'storage_full'); }
  const event = (cid, itemNo, ev, detail) => { const a = A(); a.events.unshift({ id: ++a.seq.e, consignor_id: cid, item_no: itemNo, event: ev, detail: String(detail).slice(0, 500), created_at: nowIso() }); if (a.events.length > 400) a.events.length = 400; };
  const editLog = (entity, ref, before, after, labels) => {
    const a = A(); const key = entity + ':' + ref; const rows = a.editlog[key] || (a.editlog[key] = []);
    Object.keys(after).forEach(f => { const o = before[f] ?? '', n = after[f] ?? ''; if (String(o) !== String(n)) rows.unshift({ field: f, old: String(o), new: String(n), actor: 'Demo admin', at: nowIso() }); });
    if (rows.length > 120) rows.length = 120;
  };

  // ---- catalog helpers (the demo's own products.json + pieces added in the admin) ---------------------------
  let ALL = [], BYSKU = new Map(), BYLOW = new Map();
  async function loadAll() {
    ALL = await D.products();
    BYSKU = new Map(); BYLOW = new Map();
    ALL.forEach(p => { BYSKU.set(String(p.sku), p); BYLOW.set(String(p.sku).toLowerCase(), p); });
  }
  const findProduct = sku => BYSKU.get(String(sku)) || BYLOW.get(String(sku).trim().toLowerCase()) || null;
  const imgPath = (im, size) => im ? (im[size] || im.card || im.lg || im.thumb || '') : '';
  const prodView = p => {
    const price = D.priceOf(p);
    const im = (p.images || [])[0];
    return {
      sku: String(p.sku), name: p.name, price_cents: price, image: imgPath(im, 'thumb'), image_card: imgPath(im, 'card'), origin: p.source || '',
      local_photos: !!im && /^products\/img\//.test(String(im.lg || im.card || '')),
      piece: { images: (p.images || []).filter(i => i && i.lg).map(i => ({ lg: i.lg, thumb: i.thumb || i.lg })), sub: p.sub || '', price_text: p.price_text || '', regular_text: p.regular_text || '',
        specs: (p.specs || []).filter(Array.isArray), details: (p.details || []).filter(x => typeof x === 'string'), size: p.size || '', color: p.color || '', main_category: p.main_category || '',
        sub_category: p.sub_category || '', categories: p.categories || [], weight_lb: p.weight_lb ?? null, length_in: p.length_in ?? null, width_in: p.width_in ?? null, height_in: p.height_in ?? null },
    };
  };
  const pstate = sku => A().pstate[String(sku)] || null;
  function putState(sku, fields) { const a = A(); a.pstate[String(sku)] = Object.assign(a.pstate[String(sku)] || {}, fields, { updated_at: nowIso() }); }
  function siteStatus(sku) {
    const p = findProduct(sku); if (!p) return null;
    if (D.priceOf(p) <= 0) return 'unpriced';
    return D.statusOf(sku, D.soldSkus());
  }

  // ---- consignors (port of shop/lib/consign.php, in integer cents) --------------------------------------------
  function consignorById(id) { const c = A().consignors.find(x => x.id === Number(id)); if (!c) throw new Err('Consignor not found.', 404, 'not_found'); return c; }
  function itemById(id) { const i = A().items.find(x => x.id === Number(id)); if (!i) throw new Err('Item not found.', 404, 'not_found'); return i; }
  function itemForSku(sku) { sku = String(sku); const a = A(); return a.items.find(i => i.sku === sku) || a.items.find(i => i.item_no === sku) || a.items.find(i => i.item_no.toLowerCase() === sku.toLowerCase()) || null; }
  const itemSplit = i => (i.split_pct !== null && i.split_pct !== undefined ? i.split_pct : consignorById(i.consignor_id).split_pct);
  function totals(cid) {
    const a = A(); const sales = a.sales.filter(s => s.consignor_id === cid && s.status === 'sold');
    const earned = sales.reduce((n, s) => n + s.cut_cents, 0), sold = sales.reduce((n, s) => n + s.sold_cents, 0);
    const paid = a.payouts.filter(p => p.consignor_id === cid).reduce((n, p) => n + p.amount_cents, 0);
    const def = consignorById(cid).split_pct; const counts = { in_store: 0, sold: 0, returned: 0, donated: 0 }; let pending = 0;
    a.items.filter(i => i.consignor_id === cid).forEach(i => { counts[i.status] = (counts[i.status] || 0) + 1; if (i.status === 'in_store' && i.price_cents !== null) pending += consignCut(i.price_cents, i.split_pct !== null ? i.split_pct : def); });
    return { sold_cents: sold, earned_cents: earned, paid_cents: paid, owed_cents: earned - paid, pending_cents: pending, items: counts };
  }
  function consignList() {
    return A().consignors.slice().sort((x, y) => (x.status === y.status ? (x.number < y.number ? -1 : 1) : (x.status < y.status ? -1 : 1)))
      .map(c => ({ id: c.id, number: c.number, name: c.name, phone: c.phone, email: c.email, contract_expires: c.contract_expires, split_pct: c.split_pct, status: c.status, totals: totals(c.id) }));
  }
  function consignDetail(id) {
    const a = A(); const c = consignorById(id);
    const consignor = Object.assign({}, c); delete consignor.portal_key; consignor.has_link = !!c.portal_key;
    const items = a.items.filter(i => i.consignor_id === c.id).sort((x, y) => ((y.status === 'in_store') - (x.status === 'in_store')) || (x.item_no < y.item_no ? -1 : x.item_no > y.item_no ? 1 : 0)).map(i => {
      const prod = i.sku ? findProduct(i.sku) : null; const pv = prod ? prodView(prod) : null;
      const sales = a.sales.filter(s => s.item_id === i.id).sort((x, y) => (y.sold_at < x.sold_at ? -1 : y.sold_at > x.sold_at ? 1 : y.id - x.id)).map(s => {
        const p = s.payout_id ? a.payouts.find(x => x.id === s.payout_id) : null; return Object.assign({}, s, { check_no: p ? p.check_no : null, paid_at: p ? p.paid_at : null }); });
      const split = itemSplit(i);
      return Object.assign({}, i, { split, on_site: !!prod, site_status: prod ? siteStatus(i.sku) : null, site_url: prod ? 'index.html?item=' + encodeURIComponent(i.sku) : null,
        image: pv ? pv.image : null, piece: pv ? pv.piece : null, product_name: pv ? pv.name : null, sale: sales.find(s => s.status === 'sold') || null, sales,
        potential_cut_cents: i.price_cents !== null ? consignCut(i.price_cents, split) : null });
    });
    const payouts = a.payouts.filter(p => p.consignor_id === c.id).sort((x, y) => (y.paid_at < x.paid_at ? -1 : y.paid_at > x.paid_at ? 1 : y.id - x.id))
      .map(p => Object.assign({}, p, { sales: a.sales.filter(s => s.payout_id === p.id).length }));
    return { consignor, totals: totals(c.id), items, payouts, events: a.events.filter(e => e.consignor_id === c.id).slice(0, 40).map(e => ({ item_no: e.item_no, event: e.event, detail: e.detail, created_at: e.created_at })) };
  }
  function cleanConsignor(inp, current) {
    const out = {}; const set = k => k in inp || current === null;
    if (set('number')) {
      const n = clean(inp.number, 20).toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(n)) throw new Err('Consignor number: letters and digits, like TK1185.', 400, 'bad_number');
      out.number = n;
    }
    if (set('name')) { const n = clean(inp.name, 120); if (!n) throw new Err('The consignor needs a name.', 400, 'bad_name'); out.name = n; }
    if (set('email')) { const e = clean(inp.email, 160); if (e && !emailOk(e)) throw new Err('That email address does not look right.', 400, 'bad_email'); out.email = e || null; }
    for (const [k, max] of [['phone', 40], ['contract_no', 40]]) if (set(k)) out[k] = clean(inp[k], max) || null;
    if (set('address')) out.address = String(inp.address ?? '').replace(/\r/g, '').split('\n').map(l => l.replace(/[^\S\n]+/g, ' ').trim()).join('\n').trim().slice(0, 300) || null;
    for (const k of ['contract_date', 'contract_expires']) if (set(k)) out[k] = dateOnly(inp[k]);
    if (set('split_pct')) out.split_pct = pct(inp.split_pct, 40);
    if (set('notes')) out.notes = String(inp.notes ?? '').trim().slice(0, 2000) || null;
    if (set('status')) { const st = String(inp.status ?? 'active'); if (!['active', 'closed'].includes(st)) throw new Err('Status must be active or closed.', 400, 'bad_status'); out.status = st; }
    return out;
  }
  function saveConsignor(id, inp) {
    const a = A(); const current = id !== null ? consignorById(id) : null;
    const fields = cleanConsignor(inp, current);
    if (fields.number) { const taken = a.consignors.find(c => c.number === fields.number && c.id !== (id || 0)); if (taken) throw new Err(`Consignor number ${fields.number} is already used by ${taken.name}.`, 409, 'number_taken'); }
    if (current === null) {
      const c = Object.assign({ id: ++a.seq.c, number: '', name: '', email: null, phone: null, contract_no: null, address: null, contract_date: null, contract_expires: null, split_pct: 40, notes: null, status: 'active', portal_key: null, created_at: nowIso() }, fields);
      a.consignors.push(c); event(c.id, null, 'added', 'Consignor added'); id = c.id;
    } else Object.assign(current, fields, { updated_at: nowIso() });
    commit();
    return consignDetail(id);
  }
  function saveItem(cid, itemId, inp) {
    const a = A(); consignorById(cid);
    const current = itemId !== null ? itemById(itemId) : null;
    if (current && current.consignor_id !== cid) throw new Err('That item belongs to another consignor.', 409, 'wrong_consignor');
    const set = k => k in inp || current === null; const f = {};
    if (set('item_no')) {
      const no = clean(inp.item_no, 40).toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(no)) throw new Err('Tag number: letters and digits, like T1185001.', 400, 'bad_item_no');
      const taken = a.items.find(i => i.item_no === no && i.id !== (itemId || 0));
      if (taken) throw new Err(`Tag number ${no} is already used (consignor ${consignorById(taken.consignor_id).number}).`, 409, 'item_no_taken');
      f.item_no = no;
    }
    if (set('description')) { const d = clean(inp.description, 200); if (!d) throw new Err('Describe the piece (brand, what it is, color, size).', 400, 'bad_description'); f.description = d; }
    if (set('price')) { const raw = inp.price; const p = (raw === null || raw === undefined || raw === '') ? null : dollarsToCents(raw); if (raw !== null && raw !== undefined && raw !== '' && (p === null || p < 0)) throw new Err('The price must be an amount like 39.99.', 400, 'bad_price'); f.price_cents = p; }
    for (const [k, max] of [['department', 60], ['location', 30]]) if (set(k)) f[k] = clean(inp[k], max) || null;
    if (set('notes')) f.notes = String(inp.notes ?? '').trim().slice(0, 1000) || null;
    if (set('split_pct')) f.split_pct = pct(inp.split_pct, null);
    if (set('received_at')) f.received_at = dateOnly(inp.received_at) || (current === null ? todayLocal() : null);
    if ('sku' in inp || current === null) {
      let sku = clean(inp.sku, 64);
      if (sku === '') { const no = f.item_no || (current && current.item_no) || ''; sku = BYSKU.has(no) ? no : ''; }
      else if (!BYSKU.has(sku)) { const hit = findProduct(sku); if (!hit) throw new Err(`There is no piece ${sku} on the website.`, 400, 'bad_sku'); sku = String(hit.sku); }
      if (sku !== '') { const taken = a.items.find(i => i.sku === sku && i.id !== (itemId || 0)); if (taken) throw new Err(`Website piece ${sku} is already linked to tag ${taken.item_no}.`, 409, 'sku_taken'); }
      f.sku = sku !== '' ? sku : null;
    }
    if (current === null) {
      const item = Object.assign({ id: ++a.seq.i, consignor_id: cid, item_no: '', description: '', price_cents: null, department: null, location: null, notes: null, split_pct: null, received_at: todayLocal(), sku: null, status: 'in_store', created_at: nowIso() }, f);
      a.items.push(item); event(cid, item.item_no, 'item_added', item.description);
    } else if (Object.keys(f).length) Object.assign(current, f, { updated_at: nowIso() });
    commit();
    return consignDetail(cid);
  }
  function recordSale(item, channel, ref, soldCents, discount, at, note, split) {
    const a = A(); const same = a.sales.find(s => s.channel === channel && s.ref === ref && s.item_id === item.id);
    if (same) return same.status !== 'reversed';
    const active = a.sales.find(s => s.item_id === item.id && s.status === 'sold');
    const CH = { website: 'Website', ebay: 'eBay', store: 'In the store', manual: 'Marked sold' };
    if (active) { event(item.consignor_id, item.item_no, 'double_sale', `Also sold ${(CH[channel] || channel).toLowerCase()} (${ref}) but it was already sold ${(CH[active.channel] || active.channel).toLowerCase()} (${active.ref}) — check which sale is real; only the first one counts.`); return false; }
    const sp = split ?? itemSplit(item); const cut = consignCut(soldCents, sp);
    a.sales.push({ id: ++a.seq.s, item_id: item.id, consignor_id: item.consignor_id, channel, ref, sold_cents: soldCents, discount_cents: Math.max(0, discount || 0), split_pct: sp, cut_cents: cut, status: 'sold', sold_at: at || nowIso(), reversed_at: null, note: note || null, payout_id: null });
    item.status = 'sold'; item.updated_at = nowIso();
    event(item.consignor_id, item.item_no, 'sold', `${CH[channel] || channel} ${ref}: ${money(soldCents)} at ${sp}% = ${money(cut)} for the consignor`);
    return true;
  }
  function reverseSale(sale, why) {
    if (sale.status !== 'sold') return;
    sale.status = 'reversed'; sale.reversed_at = nowIso();
    const item = A().items.find(i => i.id === sale.item_id);
    if (item && item.status === 'sold') item.status = 'in_store';
    const paid = sale.payout_id ? ` It was already paid by check, so the next check is ${money(sale.cut_cents)} less.` : '';
    event(sale.consignor_id, item ? item.item_no : null, 'reversed', `${why}: ${money(sale.cut_cents)} taken back.${paid}`);
  }
  function itemAction(itemId, inp) {
    const a = A(); const item = itemById(itemId); const action = String(inp.action || ''); const cid = item.consignor_id;
    switch (action) {
      case 'sold': {
        const amount = dollarsToCents(inp.amount);
        if (amount === null || amount < 0) throw new Err('Enter what it sold for, like 39.99.', 400, 'bad_amount');
        const discount = dollarsToCents(inp.discount ?? 0) ?? 0;
        const split = 'split_pct' in inp && inp.split_pct !== '' ? pct(inp.split_pct, null) : null;
        const date = dateOnly(inp.date);
        if (!recordSale(item, 'manual', 'manual-' + hex(3), amount, discount, date, clean(inp.note, 200) || null, split)) throw new Err('This piece already has a sale recorded. Undo that sale first.', 409, 'already_sold');
        if (item.sku) { const st = pstate(item.sku); if (!st || !['sold', 'hidden'].includes(st.status)) putState(item.sku, { status: 'sold', source: 'admin', reason: 'Sold in the store (marked by the boutique)', order_id: null }); }
        break;
      }
      case 'unsell': {
        const sale = a.sales.filter(s => s.item_id === item.id && s.status === 'sold').pop();
        if (!sale) throw new Err('This piece has no sale to undo.', 409, 'not_sold');
        reverseSale(sale, 'Sale undone by the boutique');
        if (item.sku && ['admin', 'store'].includes((pstate(item.sku) || {}).source)) putState(item.sku, { status: 'available', source: null, order_id: null, reason: null });
        break;
      }
      case 'returned': case 'donated': case 'back': {
        const status = action === 'back' ? 'in_store' : action;
        if (item.status === 'sold') throw new Err('This piece is sold. Undo the sale first.', 409, 'is_sold');
        item.status = status; item.updated_at = nowIso();
        event(cid, item.item_no, status, { returned: 'Given back to the consignor', donated: 'Donated', in_store: 'Back in the store' }[status]);
        if (item.sku && status !== 'in_store') { const st = siteStatus(item.sku); if (st === 'available') putState(item.sku, { status: 'hidden', source: 'admin', reason: status === 'returned' ? 'Returned to the consignor' : 'Donated' }); }
        break;
      }
      case 'delete': {
        if (a.sales.some(s => s.item_id === item.id)) throw new Err('This piece has sales on record, so it cannot be deleted. Mark it returned or donated instead.', 409, 'has_sales');
        a.items = a.items.filter(i => i.id !== item.id); event(cid, item.item_no, 'item_deleted', item.description);
        break;
      }
      default: throw new Err('Unknown item action.', 400, 'bad_action');
    }
    commit();
    return consignDetail(cid);
  }
  function recordPayout(cid, inp) {
    const a = A(); consignorById(cid);
    const owed = totals(cid).owed_cents;
    const amount = inp.amount !== undefined && inp.amount !== '' ? dollarsToCents(inp.amount) : owed;
    if (amount === null || amount <= 0) throw new Err(owed <= 0 ? 'Nothing is owed right now.' : 'Enter the check amount, like 120.00.', 400, 'bad_amount');
    const paidAt = dateOnly(inp.date) || todayLocal(); const check = clean(inp.check_no, 30) || null;
    const p = { id: ++a.seq.p, consignor_id: cid, amount_cents: amount, check_no: check, paid_at: paidAt, note: clean(inp.note, 200) || null, created_at: nowIso() };
    a.payouts.push(p);
    let left = amount;   // the check covers the oldest unpaid sales first, as far as its amount reaches
    for (const s of a.sales.filter(x => x.consignor_id === cid && x.status === 'sold' && !x.payout_id).sort((x, y) => (x.sold_at < y.sold_at ? -1 : x.sold_at > y.sold_at ? 1 : x.id - y.id))) {
      if (s.cut_cents > left) break; s.payout_id = p.id; left -= s.cut_cents;
    }
    event(cid, null, 'paid', `Check ${check ?? '(no number)'} for ${money(amount)} on ${paidAt}`);
    commit();
    return consignDetail(cid);
  }
  function deletePayout(pid) {
    const a = A(); const p = a.payouts.find(x => x.id === Number(pid)); if (!p) throw new Err('Check not found.', 404, 'not_found');
    a.sales.forEach(s => { if (s.payout_id === p.id) s.payout_id = null; });
    a.payouts = a.payouts.filter(x => x.id !== p.id);
    event(p.consignor_id, null, 'check_removed', `Check ${p.check_no ?? ''} for ${money(p.amount_cents)} removed`);
    commit();
    return consignDetail(p.consignor_id);
  }

  // A paid website order credits the consignor of each consigned piece in it; a refund takes it back.
  D.hooks.orderPaid = o => {
    A(); o.items.forEach(l => { const item = itemForSku(l.sku); if (item) recordSale(item, 'website', o.number, l.price_cents, 0, o.paid_at || nowIso()); });
  };
  function consignOnRefund(order, skus) {
    skus.forEach(sku => { const item = itemForSku(sku); if (!item) return; const sale = A().sales.find(s => s.channel === 'website' && s.ref === order.number && s.item_id === item.id); if (sale) reverseSale(sale, 'Refunded on website order ' + order.number); });
  }

  // ---- orders ------------------------------------------------------------------------------------------------------
  const orderById = id => { const o = S().orders.find(x => x.id === Number(id)); if (!o) throw new Err('Order not found.', 404, 'not_found'); return o; };
  const label = o => o.label || (o.label = { status: 'none' });
  function commissionOf(o) {
    const base = o.items_cents, cents = bpsOf(base, 1000), refunded = o.commission_refunded_cents || 0;
    return { mode: A().setup.square ? 'app_fee' : 'ledger', rate_bps: 1000, base_cents: base, cents, refunded_cents: refunded,
      net_cents: ['paid', 'partially_refunded', 'refunded'].includes(o.status) ? cents - refunded : 0 };
  }
  function orderAdmin(o) {
    const a = A(); const lab = label(o);
    const items = o.items.map(i => ({ sku: i.sku, name: i.name, price_cents: i.price_cents, image: i.image || '', refunded: !!i.refunded }));
    const sh = o.ship_to;
    const pub = D.orderPublic(o);
    return Object.assign({}, pub, {
      id: o.id, name: o.name, created_at: o.created_at, fulfillment_status: o.fulfillment_status, items, phone: o.phone || '', paid_at: o.paid_at || o.created_at,
      address: sh ? { name: sh.name || o.name, street1: sh.street1 || '', street2: sh.street2 || '', city: sh.city || '', state: sh.state || '', zip: sh.zip || '', country: 'US' } : null,
      rate: o.fulfillment === 'ship' ? { provider: 'USPS', service: o.shipping_rate || o.service || 'Ground Advantage', amount_cents: o.shipping_cents } : null,
      payment_mode: 'test', square_payment_id: o.payment_ref || 'demo_pay_' + o.id, payment_error: null,
      commission: commissionOf(o), label: { status: lab.status, url: lab.url || null, error: null, cost_cents: lab.cost_cents ?? null },
      refunds: (o.refunds || []).map(r => Object.assign({}, r)), refundable_cents: ['paid', 'partially_refunded'].includes(o.status) ? o.total_cents - o.refunded_cents : 0, notes: o.notes || '',
    });
  }
  function ordersList(query) {
    const f = query.get('filter') || 'all';
    return S().orders.filter(o => o.status !== 'pending').filter(o => {
      if (f === 'to_ship') return o.fulfillment === 'ship' && ['paid', 'partially_refunded'].includes(o.status) && ['unfulfilled', 'label_created'].includes(o.fulfillment_status);
      if (f === 'pickup') return o.fulfillment === 'pickup' && ['paid', 'partially_refunded'].includes(o.status) && o.fulfillment_status !== 'picked_up';
      if (f === 'refunds') return ['refunded', 'partially_refunded'].includes(o.status);
      return true;
    }).sort((x, y) => y.id - x.id).slice(0, 300).map(o => ({ id: o.id, number: o.number, status: o.status, fulfillment: o.fulfillment, fulfillment_status: o.fulfillment_status, name: o.name,
      total_cents: o.total_cents, refunded_cents: o.refunded_cents, commission_cents: commissionOf(o).net_cents, commission_mode: commissionOf(o).mode, label_status: label(o).status,
      items: o.items.map(i => i.name), payment_mode: 'test', created_at: o.created_at }));
  }
  function buyLabel(o) {
    if (o.fulfillment !== 'ship') throw new Err('This is a pickup order; it needs no label.', 409, 'pickup');
    if (!['paid', 'partially_refunded'].includes(o.status)) throw new Err('Labels can only be bought for paid orders.', 409, 'not_paid');
    const lab = label(o);
    if (!['none', 'error', 'voided'].includes(lab.status)) throw new Err('This order already has a label (or one is being bought).', 409, 'label_exists');
    const num = '9400' + Array.from(crypto.getRandomValues(new Uint8Array(18)), b => b % 10).join('');
    o.label = { status: 'purchased', cost_cents: Math.max(0, (o.shipping_cents || 650) - 100), url: SHOP_DIR + 'demo-label.html?n=' + encodeURIComponent(o.number) + '&t=' + num };
    o.tracking = { carrier: 'USPS', number: num, url: SHOP_DIR + 'demo-label.html?n=' + encodeURIComponent(o.number) + '&t=' + num };
    if (o.fulfillment_status === 'unfulfilled') o.fulfillment_status = 'label_created';
    commit(); return orderAdmin(o);
  }
  function voidLabel(o) {
    if (label(o).status !== 'purchased') throw new Err('There is no active label to void.', 409, 'no_label');
    if (o.fulfillment_status === 'shipped') throw new Err('This order is marked shipped; a used label cannot be voided.', 409, 'shipped');
    o.label = Object.assign({}, o.label, { status: 'voided' });
    if (o.fulfillment_status === 'label_created') o.fulfillment_status = 'unfulfilled';
    commit(); return orderAdmin(o);
  }
  function setFulfillment(o, inp) {
    const status = String(inp.status || '');
    const allowed = o.fulfillment === 'ship' ? ['unfulfilled', 'label_created', 'shipped', 'delivered'] : ['unfulfilled', 'ready_for_pickup', 'picked_up'];
    if (!allowed.includes(status)) throw new Err('That status does not fit this order.', 400, 'bad_status');
    const tn = clean(inp.tracking_number, 60);
    if (tn) o.tracking = Object.assign(o.tracking || { carrier: 'USPS' }, { number: tn });
    o.fulfillment_status = status; commit(); return orderAdmin(o);
  }
  function refundOrder(o, inp) {
    if (!['paid', 'partially_refunded'].includes(o.status)) throw new Err('Only paid orders can be refunded.', 409, 'not_refundable');
    const key = String(inp.idempotency_key || '');
    o.refunds = o.refunds || [];
    const prior = key && o.refunds.find(r => r.key === key);
    if (prior) return { order: orderAdmin(o), refund: prior };
    const mode = String(inp.mode || 'full'); const remaining = o.total_cents - o.refunded_cents; const commissionLeft = commissionOf(o).cents - (o.commission_refunded_cents || 0);
    let amount = 0, skus = [], itemCents = null;
    if (mode === 'full') { amount = remaining; skus = o.items.filter(i => !i.refunded).map(i => i.sku); }
    else if (mode === 'items') {
      const wanted = (Array.isArray(inp.skus) ? inp.skus : []).map(String); itemCents = 0;
      for (const i of o.items) if (wanted.includes(String(i.sku))) { if (i.refunded) throw new Err(i.name + ' was already refunded.', 409, 'already_refunded'); skus.push(i.sku); itemCents += i.price_cents; }
      if (!skus.length) throw new Err('Pick the pieces to refund.', 400, 'no_items');
      const itemTax = o.items_cents > 0 ? Math.floor((o.tax_cents * itemCents + Math.floor(o.items_cents / 2)) / o.items_cents) : 0;
      amount = itemCents + itemTax + (inp.include_shipping ? o.shipping_cents : 0);
    } else if (mode === 'amount') amount = Math.round(Number(inp.amount_cents) || 0);
    else throw new Err('Unknown refund type.', 400, 'bad_mode');
    if (amount < 1 || amount > remaining) throw new Err('The refund must be between $0.01 and ' + money(remaining) + '.', 400, 'bad_amount');
    let share;
    if (amount >= remaining) share = commissionLeft;
    else if (itemCents !== null) share = bpsOf(itemCents, 1000);
    else share = o.total_cents > 0 ? Math.floor((commissionOf(o).cents * amount + Math.floor(o.total_cents / 2)) / o.total_cents) : 0;
    share = Math.max(0, Math.min(commissionLeft, share, amount));
    const refund = { id: o.refunds.length + 1, key, square_refund_id: 'demo_rf_' + hex(5), amount_cents: amount, commission_cents: share, status: 'COMPLETED', origin: 'admin', reason: clean(inp.reason, 150), skus, created_at: nowIso() };
    o.refunds.push(refund);
    o.refunded_cents += amount; o.commission_refunded_cents = (o.commission_refunded_cents || 0) + share;
    if (!skus.length && o.refunded_cents >= o.total_cents) skus = o.items.filter(i => !i.refunded).map(i => i.sku);
    o.items.forEach(i => { if (skus.includes(i.sku)) i.refunded = true; });
    o.status = o.refunded_cents <= 0 ? 'paid' : (o.refunded_cents >= o.total_cents ? 'refunded' : 'partially_refunded');
    consignOnRefund(o, skus);
    skus.forEach(sku => {   // "back on the site" unless the piece is kept sold
      if (inp.restock) { const st = pstate(sku); if (st && st.status === 'sold') delete A().pstate[String(sku)]; }
      else putState(sku, { status: 'sold', source: 'site', order_id: o.id, reason: 'Sold on the website (' + o.number + ') — refunded, not restocked' });
    });
    if (inp.void_label && label(o).status === 'purchased' && o.fulfillment_status !== 'shipped') { o.label = Object.assign({}, o.label, { status: 'voided' }); if (o.fulfillment_status === 'label_created') o.fulfillment_status = 'unfulfilled'; }
    commit();
    return { order: orderAdmin(o), refund };
  }

  // ---- commission / status / start / keys ------------------------------------------------------------------------------
  const chicagoDay = iso => { const d = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso); const day = d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); const [y, m, dd] = day.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, dd)); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return [day, t.toISOString().slice(0, 10)]; };
  function commissionSummary() {
    const a = A(); const entries = []; const byDay = {}, byWeek = {}, cDay = {}, cWeek = {}, comDay = {}, comWeek = {};
    S().orders.forEach(o => {
      if (!['paid', 'partially_refunded', 'refunded'].includes(o.status)) return;
      const c = commissionOf(o); const when = o.paid_at || o.created_at;
      entries.push({ order: o.number, kind: 'earned', amount_cents: c.cents, mode: c.mode, note: 'Commission on ' + o.number, created_at: when });
      (o.refunds || []).forEach(r => { if (r.commission_cents > 0) entries.push({ order: o.number, kind: 'reversed', amount_cents: -r.commission_cents, mode: c.mode, note: 'Refund from the shop admin', created_at: r.created_at }); });
    });
    entries.sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
    let collected = 0;
    entries.forEach(e => { collected += e.amount_cents; const [d, w] = chicagoDay(e.created_at); byDay[d] = (byDay[d] || 0) + e.amount_cents; byWeek[w] = (byWeek[w] || 0) + e.amount_cents; });
    let cash = 0, owedSales = 0;
    a.sales.filter(s => s.status === 'sold').forEach(s => {
      const [d, w] = chicagoDay(s.sold_at); comDay[d] = (comDay[d] || 0) + s.cut_cents; comWeek[w] = (comWeek[w] || 0) + s.cut_cents; owedSales += s.cut_cents;
      if (s.channel === 'manual') { const c = s.sold_cents - s.cut_cents; cash += c; cDay[d] = (cDay[d] || 0) + c; cWeek[w] = (cWeek[w] || 0) + c; }
    });
    const periods = (sq, ca, co) => [...new Set([...Object.keys(sq), ...Object.keys(ca), ...Object.keys(co)])].sort().reverse().map(k => ({ period: k, cents: sq[k] || 0, cash_cents: ca[k] || 0, commission_cents: co[k] || 0 }));
    const paid = a.payouts.reduce((n, p) => n + p.amount_cents, 0);
    return { square_by_day: periods(byDay, cDay, comDay), square_by_week: periods(byWeek, cWeek, comWeek), rate_bps: 1000, base: 'items', collected_by_square_cents: collected, owed_cents: 0, cash_cents: cash,
      consignor_owed_cents: owedSales - paid, consignor_paid_cents: paid, totals: {}, entries: entries.slice(0, 200) };
  }
  function ebayLinked() { return Object.values(A().pstate).filter(s => s.ebay_item_id).length; }
  function statusView() {
    const a = A(); const sq = a.setup.square; const stores = Object.keys(a.setup.ebay).map(u => ({ username: u, connected: !!a.setup.ebay[u], can_list: !!a.setup.ebay[u], connected_at: null, sign_in_until: null }));
    const last = a.runs.find(r => r.job === 'ebay');
    return {
      shop_mode: 'test', public_url: SITE.replace(/\/$/, ''),
      square: { mode: 'mock', application_id_set: false, application_secret_set: false, access_token_set: false, location_id: null, webhook_key_set: false, webhook_url: SHOP_DIR + 'api/square/webhook',
        oauth_redirect_url: SHOP_DIR + 'api/square/oauth/callback', can_connect: true, connected: sq, merchant_id: sq ? 'DEMOMERCHANT' : null, location_name: sq ? 'Demo Boutique (sample)' : null,
        connected_location_id: sq ? 'DEMO' : null, token_expires_at: null, commission_mode: sq ? 'app_fee' : 'ledger', live: null },
      shipping: { provider: 'mock', token: 'none (demo)', auto_label: false, carriers: 'USPS', from: { name: 'ThomKat Demo', street1: '123 Example St', city: 'Anytown', state: 'IL', zip: '60000', email: 'shop@example.com' },
        label_format: 'PDF_4x6', handling_cents: 0, pickup: true },
      ebay: { mode: 'mock', keys_set: false, seller_username: Object.keys(a.setup.ebay).join(', '), runame_set: false, can_connect: true, seller_connected: stores.some(s => s.connected), oauth_accept_url: SHOP_DIR + 'api/ebay/oauth/callback',
        stores, privacy_url: SITE + 'policies.html#privacy', end_waiting: 0, end_failed: 0, linked: ebayLinked(), ended_means_sold: true, ended_confirmations: 2,
        last_sync: last ? { at: last.finished_at, ok: true, summary: last.summary } : null },
      commission: { rate_bps: 1000, base: 'items', require_app_fee: false }, tax: { rate_bps: 0, states: 'IL' },
      notify: { mode: 'log', owner_email: 'owner@example.com', from: 'ThomKat Demo <orders@example.com>' },
      warnings: ['This is the public demo: made-up data that lives only in your browser. Nothing here is connected to a real store, bank, key or customer.'],
    };
  }
  function startView() {
    const a = A(); const t = a.ticks; const url = SITE.replace(/\/$/, '');
    const online = a.items.filter(i => i.sku).length, waiting = a.items.filter(i => i.status === 'in_store' && !i.sku).length, consignors = a.consignors.length;
    const stores = Object.keys(a.setup.ebay).filter(u => a.setup.ebay[u]);
    const steps = [
      { id: 'site', phase: 'live', who: 'josh', done: true, detail: 'The shop’s address right now: ' + url },
      { id: 'info', phase: 'live', who: 'her', manual: true, done: !!t.info, detail: t.info ? 'Checked.' : '' },
      { id: 'email', phase: 'live', who: 'her', done: false, detail: 'Emails are only saved on the shop computer for now.' },
      { id: 'ebay_app', phase: 'live', who: 'josh', done: true, detail: 'eBay accepts the shop’s keys.' },
      { id: 'ebay', phase: 'live', who: 'her', done: stores.length >= 2, detail: stores.length + ' of 2 stores connected (' + Object.keys(a.setup.ebay).map(u => u + (a.setup.ebay[u] ? ' ✓' : '')).join(', ') + ').' },
      { id: 'consignors', phase: 'live', who: 'her', done: consignors > 0 && online > 0, detail: `${consignors} consignors · ${online} of their pieces on the website` + (waiting ? ` · ${waiting} not on the website yet` : '') + '.' },
      { id: 'square_app', phase: 'live', who: 'josh', done: true, detail: 'Square accepts the shop’s production keys.' },
      { id: 'square', phase: 'live', who: 'her', done: a.setup.square, detail: a.setup.square ? 'Connected (Demo Boutique (sample)).' : 'Not connected yet.' },
      { id: 'shippo', phase: 'pay', who: 'her', done: false, detail: 'No Shippo live token yet.' },
      { id: 'tax', phase: 'pay', who: 'her', done: false, detail: 'Sales tax is off.' },
      { id: 'checkout', phase: 'pay', who: 'josh', done: false, detail: 'Card payments are off.' },
      { id: 'first_order', phase: 'pay', who: 'her', manual: true, done: !!t.first_order, detail: '' },
    ];
    return { steps, links: { site: url + '/', policies: SITE + 'policies.html' }, done: steps.filter(s => s.done).length, total: steps.length };
  }
  const KEYS = [['SQUARE_MODE', 'enum', ['mock', 'sandbox', 'live']], ['SQUARE_SANDBOX_APPLICATION_ID', 'text'], ['SQUARE_SANDBOX_ACCESS_TOKEN', 'secret'], ['SQUARE_SANDBOX_LOCATION_ID', 'text'], ['SQUARE_SANDBOX_APPLICATION_SECRET', 'secret'],
    ['SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY', 'secret'], ['SQUARE_LIVE_APPLICATION_ID', 'text'], ['SQUARE_LIVE_ACCESS_TOKEN', 'secret'], ['SQUARE_LIVE_LOCATION_ID', 'text'], ['SQUARE_LIVE_APPLICATION_SECRET', 'secret'],
    ['SQUARE_LIVE_WEBHOOK_SIGNATURE_KEY', 'secret'], ['SHIPPING_PROVIDER', 'enum', ['mock', 'shippo', 'flat']], ['SHIPPO_TEST_TOKEN', 'secret'], ['SHIPPO_LIVE_TOKEN', 'secret'], ['SHIPPING_FROM_EMAIL', 'email'],
    ['EBAY_MODE', 'enum', ['off', 'public', 'seller']], ['EBAY_SELLER_USERNAME', 'text'], ['EBAY_CLIENT_ID', 'text'], ['EBAY_CLIENT_SECRET', 'secret'], ['EBAY_RUNAME', 'text'], ['NOTIFY_MODE', 'enum', ['off', 'log', 'smtp', 'resend']],
    ['SMTP_USERNAME', 'email'], ['SMTP_PASSWORD', 'secret'], ['SMTP_HOST', 'text'], ['SMTP_PORT', 'enum', ['587', '465']], ['RESEND_API_KEY', 'secret'], ['NOTIFY_FROM', 'from'], ['NOTIFY_OWNER_EMAIL', 'email'], ['NOTIFY_REPLY_TO', 'email'], ['TAX_RATE_BPS', 'int']];
  function keysView() {
    // Every key is "not set": the demo never holds, stores or returns a key value.
    return { editable: true, scope: 'full', tests: {}, keys: KEYS.map(([key, kind, options]) => { const row = { key, kind, set: false }; if (kind === 'enum') row.options = options; if (kind === 'secret') row.hint = null; else row.value = null; return row; }),
      setup: { shop_mode: 'test', square_mode: 'mock', shipping_provider: 'mock', ebay_mode: 'mock', notify_mode: 'log', square_connected: A().setup.square, square_live_connected: false, square_live_location: null,
        square_redirect_url: SHOP_DIR + 'api/square/oauth/callback', square_webhook_url: SHOP_DIR + 'api/square/webhook', ebay_accept_url: SHOP_DIR + 'api/ebay/oauth/callback' } };
  }

  // ---- the consignor's own page --------------------------------------------------------------------------------------
  const CHANNEL_NAME = { website: 'Website', ebay: 'eBay', store: 'In the store', manual: 'Marked sold' };
  function portalPayload(c) {
    const d = consignDetail(c.id);
    const items = d.items.map(i => ({ item_no: i.item_no, description: i.description, price_cents: i.price_cents, status: i.status, split: (i.sale && i.sale.split_pct) ?? i.split, received_at: i.received_at,
      sold_cents: i.sale ? i.sale.sold_cents : null, cut_cents: i.sale ? i.sale.cut_cents : null, sold_at: i.sale ? i.sale.sold_at : null, channel: i.sale ? (CHANNEL_NAME[i.sale.channel] || null) : null,
      paid: !!(i.sale && i.sale.payout_id), potential_cut_cents: i.potential_cut_cents, site_url: i.site_status === 'available' ? i.site_url : null, image: i.image, piece: i.piece, product_name: i.product_name }));
    return { consignor: { first_name: c.name.split(' ')[0], number: c.number, split_pct: c.split_pct, contract_no: c.contract_no, contract_date: c.contract_date, contract_expires: c.contract_expires },
      totals: d.totals, items, payouts: d.payouts.map(p => ({ paid_at: p.paid_at, amount_cents: p.amount_cents, check_no: p.check_no })), phone: PICKUP.phone };
  }
  function portalRoute(route, method, body, ctx) {
    const a = A();
    if (route === 'consignor' && method === 'GET') {
      const key = String((ctx.headers || {})['x-consignor-key'] || '');
      if (!/^[a-f0-9]{48}$/.test(key)) throw new Err('This link is not complete. Ask the boutique for a new one.', 404, 'bad_link');
      const c = a.consignors.find(x => x.portal_key === key && x.status === 'active');
      if (!c) throw new Err('This link no longer works. Ask the boutique for a new one.', 404, 'bad_link');
      return ok(portalPayload(c));
    }
    if (route === 'consignor/login' && method === 'POST') {
      const nrm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      const n = nrm(String(body.name || '').slice(0, 120)), cno = nrm(String(body.contract_no || '').slice(0, 40)).replace(/^0+/, ''), e = String(body.email || '').slice(0, 160).trim().toLowerCase();
      const fail = new Err('We couldn’t find that contract number with that name or email. Check them against your contract, or call the boutique.', 404, 'bad_login');
      if (cno === '' || (n.length < 2 && e === '')) throw fail;
      let found = null;
      for (const row of a.consignors.filter(x => x.status === 'active' && x.contract_no)) {
        if (nrm(row.contract_no).replace(/^0+/, '') !== cno) continue;
        if (e && row.email && row.email.trim().toLowerCase() === e) { found = row; break; }
        const parts = String(row.name).trim().split(/\s+/), full = nrm(row.name), first = nrm(parts[0]), last = nrm(parts[parts.length - 1]);
        if (n.length >= 2 && (n === full || (last && n === last) || (n === first && full === first))) { found = row; break; }
      }
      if (!found) throw fail;
      if (body.remember) { try { localStorage.setItem(PORTAL_KEY, String(found.id)); } catch { /* fine */ } }
      return ok(portalPayload(found));
    }
    if (route === 'consignor/session' && method === 'GET') {
      let id = null; try { id = Number(localStorage.getItem(PORTAL_KEY)); } catch { /* none */ }
      const c = id ? a.consignors.find(x => x.id === id && x.status === 'active') : null;
      if (!c) throw new Err('Please sign in.', 401, 'no_session');
      return ok(portalPayload(c));
    }
    if (route === 'consignor/logout' && method === 'POST') { try { localStorage.removeItem(PORTAL_KEY); } catch { /* fine */ } return ok({}); }
    return null;
  }

  // ---- her consignor workbook (DEMO: a clearly labelled made-up sample; the demo does not read the file) ------------------
  const SAMPLE_WORKBOOK = [
    { number: 'TK9101', name: 'Riley Placeholder', email: 'riley.placeholder@example.com', phone: '555-0111', contract_no: '9101', split: 40, items: [
      ['T9261001', 'Sample navy wool coat size M', 7500, 'Coats'], ['T9261002', 'Sample floral midi dress size S', 3900, 'Dresses'], ['T9261003', 'Sample leather ankle boots size 8', 4800, 'Shoes']], sold: [1] },
    { number: 'TK9102', name: 'Morgan Sample', email: 'morgan.sample@example.com', phone: '555-0112', contract_no: '9102', split: 50, items: [
      ['T9261004', 'Sample silk blouse size L', 2800, 'Tops'], ['T9261005', 'Sample black evening gown size 10', 12900, 'Gowns']], sold: [] },
    { number: 'TK9103', name: 'Casey Mockup', email: 'casey.mockup@example.com', phone: '555-0113', contract_no: '9103', split: 40, items: [
      ['T9261006', 'Sample wide-leg trousers size 12', 3200, 'Pants'], ['T9261007', 'Sample cashmere scarf', 2400, 'Accessories'], ['T9261008', 'Sample quilted handbag', 5500, 'Handbags']], sold: [] },
  ];
  function importWorkbook(inp) {
    const a = A(); const apply = !!inp.apply; const out = []; const warnings = [
      'DEMO: the demo cannot read your real file. This preview is built from a made-up sample workbook with 3 fake consignors, so you can see how the import works.'];
    SAMPLE_WORKBOOK.forEach(w => {
      const existing = a.consignors.find(c => c.number === w.number);
      const known = existing ? a.items.filter(i => i.consignor_id === existing.id).length : 0;
      out.push({ number: w.number, name: w.name, new: !existing, items_new: existing ? Math.max(0, w.items.length - known) : w.items.length, items_known: existing ? Math.min(known, w.items.length) : 0,
        sales: w.sold.length, contract_expires: isoDate(Date.now() + 300 * DAY) });
      if (!apply || existing) return;
      const c = { id: ++a.seq.c, number: w.number, name: w.name, email: w.email, phone: w.phone, contract_no: w.contract_no, address: '123 Example St\nAnytown, IL 60000', contract_date: isoDate(Date.now() - 20 * DAY),
        contract_expires: isoDate(Date.now() + 300 * DAY), split_pct: w.split, notes: 'Imported from the demo sample workbook (made-up).', status: 'active', portal_key: null, created_at: nowIso() };
      a.consignors.push(c); event(c.id, null, 'added', 'Consignor added (demo sample workbook)');
      w.items.forEach(([no, desc, price, dept], idx) => {
        const item = { id: ++a.seq.i, consignor_id: c.id, item_no: no, description: desc, price_cents: price, department: dept, location: 'TK', notes: null, split_pct: null, received_at: isoDate(Date.now() - 12 * DAY), sku: null, status: 'in_store', created_at: nowIso() };
        a.items.push(item); event(c.id, no, 'item_added', desc);
        if (w.sold.includes(idx)) recordSale(item, 'manual', 'import-' + no, price, 0, isoDate(Date.now() - 5 * DAY), 'From the sample workbook', null);
      });
    });
    if (apply) commit();
    return { consignors: out, warnings };
  }
  // "Put on website": consigned pieces in the store that are not on the website yet.
  function publishRow(i) {
    const c = consignorById(i.consignor_id); const cat = categoryFor(i.department || '', i.description); const problems = [];
    if (i.price_cents === null || i.price_cents <= 0) problems.push('No price — add one.');
    if (!cat.sure) problems.push('Pick a category.');
    const group = cat.main ? siteCategory(cat.main, cat.sub)[0] : '';
    return { item_no: i.item_no, consignor: c.number, consignor_name: c.name, description: i.description, name: nameFromDescription(i.description), price: i.price_cents !== null ? Math.round(i.price_cents) / 100 : null,
      size: sizeFromName(i.description), section: i.department, main_category: cat.main, sub_category: cat.sub, site_group: group, category_note: cat.note, location: String(i.location || 'TK').toUpperCase(),
      photo_key: norm(i.item_no).toLowerCase(), problems };
  }
  async function consignPublish(inp) {
    const a = A();
    if (!inp.apply) {
      let list = a.items.filter(i => i.status === 'in_store' && !i.sku);
      const up = v => String(v).toUpperCase();
      if (Array.isArray(inp.consignors) && inp.consignors.length) { const nums = inp.consignors.map(up); list = list.filter(i => nums.includes(up(consignorById(i.consignor_id).number))); }
      if (Array.isArray(inp.items) && inp.items.length) { const tags = inp.items.map(up); list = list.filter(i => tags.includes(up(i.item_no))); }
      const pieces = [], already = [];
      list.sort((x, y) => { const cx = consignorById(x.consignor_id).number, cy = consignorById(y.consignor_id).number; return cx === cy ? (x.item_no < y.item_no ? -1 : 1) : (cx < cy ? -1 : 1); }).forEach(i => { if (BYSKU.has(i.item_no)) already.push(i.item_no); else pieces.push(publishRow(i)); });
      return { pieces, ready: pieces.filter(p => !p.problems.length).length, already_on_website: already };
    }
    const list = Array.isArray(inp.pieces) ? inp.pieces : [];
    if (!list.length) throw new Err('Choose the pieces to put on the website.', 400, 'no_pieces');
    if (list.length > 20) throw new Err('Up to 20 pieces at a time.', 400, 'too_many');
    const rows = [], errors = [], items = {};
    list.forEach((p, i) => {
      const tag = clean(p && p.item_no, 40).toUpperCase(); const item = tag ? a.items.find(x => x.item_no === tag) : null; let refuse = null;
      if (!item) refuse = [`Tag ${tag} is not a consigned piece.`, 'not_consigned'];
      else if (item.status !== 'in_store') refuse = [`Tag ${tag} is marked ${item.status} — only pieces in the store go on the website.`, 'not_in_store'];
      else if (item.sku || BYSKU.has(item.item_no)) refuse = [`Tag ${tag} is already on the website.`, 'already_listed'];
      if (refuse) { errors.push({ row: i + 1, item: tag, error: refuse[0], status: 409, code: refuse[1] }); return; }
      const base = publishRow(item); const given = k => (p[k] !== undefined && p[k] !== null && String(p[k]).trim() !== '' ? String(p[k]) : null);
      const main = given('main_category');
      rows.push({ row: i + 1, item_number: item.item_no, name: given('name') ?? base.name, price: given('price') ?? String(base.price), main_category: main ?? base.main_category, sub_category: main !== null ? (given('sub_category') ?? '') : (given('sub_category') ?? base.sub_category),
        size: given('size') ?? base.size, color: given('color') ?? '', brand: given('brand') ?? '', condition: given('condition') ?? '', details: Array.isArray(p.details) ? p.details : (given('details') ?? ''), location: base.location, photos: Array.isArray(p.photos) ? p.photos : [] });
      items[item.item_no.toLowerCase()] = item;
    });
    const result = rows.length ? await addMany(rows) : { added: [], errors: [] };
    result.added.forEach(add => { const item = items[String(add.sku).toLowerCase()]; if (!item) return; item.sku = add.sku; event(item.consignor_id, item.item_no, 'on_website', 'Put on the website: ' + add.name); });
    commit();
    return { added: result.added, errors: [...errors, ...result.errors] };
  }

  // ---- adding pieces (port of shop/lib/pieces.php; photos are kept in the browser) ----------------------------------------------
  function b64ToBlob(b64, type) { const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new Blob([bytes], { type }); }
  const blobToDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  async function swControls() {
    if (!('serviceWorker' in navigator) || !('caches' in window)) return false;
    try { await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(r, 2500))]); } catch { return false; }
    return !!navigator.serviceWorker.controller;
  }
  async function photoUpload(inp) {
    const a = A(); const id = hex(10); const sizes = ['lg', 'card', 'thumb']; const meta = { at: Date.now(), sw: await swControls() };
    for (const size of sizes) {
      const raw = String(inp[size] || '');
      if (!raw) throw new Err('A photo size is missing. Try adding the photo again.', 400, 'photo_missing');
      if (raw.length > 6_000_000) throw new Err('That photo is too large. Try a smaller one.', 400, 'photo_big');
      const blob = b64ToBlob(raw, 'image/jpeg'); let w = 0, h = 0;
      try { const bm = await createImageBitmap(blob); w = bm.width; h = bm.height; bm.close && bm.close(); } catch { throw new Err('Photos must be JPEG pictures.', 400, 'photo_type'); }
      meta[size + '_w'] = w; meta[size + '_h'] = h;
      if (meta.sw) { const cache = await caches.open(PHOTO_CACHE); await cache.put(SITE + photoPath(id, size), new Response(blob, { headers: { 'Content-Type': 'image/jpeg' } })); }
      else { meta[size + '_data'] = await blobToDataUrl(blob); }   // no service worker here: keep a small copy in the page's own storage
    }
    // Only the small sizes are kept as data when we cannot cache: the large one reuses the card size.
    if (!meta.sw) { meta.lg_data = meta.card_data; meta.lg_w = meta.card_w; meta.lg_h = meta.card_h; }
    a.photos[id] = meta;
    return Object.assign({ id }, { lg_w: meta.lg_w, lg_h: meta.lg_h, card_w: meta.card_w, card_h: meta.card_h, thumb_w: meta.thumb_w, thumb_h: meta.thumb_h });
  }
  const photoPath = (id, size) => 'products/img/demo-' + id + '-' + size + '.jpg';
  function imagesFor(ids) {
    const a = A();
    return ids.map(id => {
      const m = a.photos[id]; if (!m) throw new Err('A photo upload expired. Add the photos again.', 409, 'photo_gone');
      const im = { source: 'added in the admin (demo)' };
      for (const size of ['lg', 'card', 'thumb']) { im[size] = m.sw ? photoPath(id, size) : m[size + '_data']; im[size + '_w'] = m[size + '_w']; im[size + '_h'] = m[size + '_h']; }
      im.w = im.lg_w; im.h = im.lg_h; return im;
    });
  }
  function checkPiece(inp) {
    const sku = clean(inp.item_number, 60);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/.test(sku)) throw new Err('Item number: 2 to 40 letters and numbers (dashes, dots and underscores are fine), e.g. her tag number T2261100.', 400, 'bad_item_number');
    const name = clean(inp.name, 120); if (name.length < 3) throw new Err('Give the piece a name (it is also the eBay title, up to 80 characters).', 400, 'bad_name');
    const price = Math.round(parseFloat(String(inp.price ?? '0').replace(/[^0-9.]/g, '') || '0') * 100) / 100;
    if (!(price > 0) || price > 100000) throw new Err('Enter the price in dollars.', 400, 'bad_price');
    const [main, subCategory, herMain, herSub] = siteCategory(inp.main_category, inp.sub_category);
    if (main === '') throw new Err('Pick a category.', 400, 'bad_category');
    const ids = (Array.isArray(inp.photos) ? inp.photos : []).map(String).filter(i => /^[a-f0-9]{16,64}$/.test(i));
    if (!ids.length) throw new Err('Add at least one photo.', 400, 'no_photos');
    if (ids.length > 12) throw new Err('Up to 12 photos per piece.', 400, 'too_many_photos');
    const size = clean(inp.size, 30), color = clean(inp.color, 40); const specs = [], seen = {};
    [['Condition', 'condition'], ['Brand', 'brand'], ['Type', 'type'], ['Style', 'style'], ['Material', 'material'], ['Color', 'color'], ['Size', 'size']].forEach(([label, key]) => { const v = clean(inp[key], 160); if (v) { specs.push([label, v]); seen[label.toLowerCase()] = true; } });
    (Array.isArray(inp.specs) ? inp.specs : []).forEach(pair => { const l = clean(pair && pair[0], 40), v = clean(pair && pair[1], 200); if (l && v && !seen[l.toLowerCase()]) { specs.push([l, v]); seen[l.toLowerCase()] = true; } });
    let details = Array.isArray(inp.details) ? inp.details : String(inp.details ?? '').split(/\r?\n/);
    details = details.map(l => clean(l, 160)).filter(Boolean).slice(0, 40);
    const description = clean(inp.description, 300);
    const box = (k, def, max) => { const v = parseFloat(inp[k]); return v > 0 && v <= max ? Math.round(v * 10) / 10 : def; };
    return { ids, product: {
      sku, name, regular_price: price, sale_price: null, price, price_text: '$' + price.toFixed(2), regular_text: '', color, color_filter: color.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), color_filter_label: color,
      size, sub: description || [color, size ? 'Size ' + size : ''].filter(Boolean).join(' · '), badge: size ? 'Size ' + size : '', item_number: clean(inp.item_label, 80) || sku, specs, details,
      categories: [[main, subCategory || main]], tags: [], stock: 1, shipping_class: 'USPS', weight_lb: box('weight_lb', 2, 70), length_in: box('length_in', 15, 108), width_in: box('width_in', 11, 108), height_in: box('height_in', 3, 108),
      images: [], source: 'demo-admin', added_at: nowIso(), main_category: main, sub_category: subCategory, her_category: [herMain, herSub], category_source: 'owner', location: clean(inp.location, 20),
      search: [sku, name, color, size, main, subCategory, description].join(' ').toLowerCase(), vintage: /vintage/i.test(name) } };
  }
  async function addMany(rows) {
    if (rows.length > 60) throw new Err('Add up to 60 pieces at a time.', 400, 'too_many');
    const checked = [], errors = [], batch = new Set();
    rows.forEach((inp, i) => {
      try {
        const c = checkPiece(inp || {}); const key = String(c.product.sku).toLowerCase();
        if (BYLOW.has(key)) throw new Err(`Item number ${c.product.sku} is already on the site (${BYLOW.get(key).name}).`, 409, 'sku_taken');
        if (batch.has(key)) throw new Err(`Item number ${c.product.sku} is twice in this batch.`, 409, 'sku_twice');
        batch.add(key); checked.push(Object.assign({ row: Number((inp || {}).row) || i + 1 }, c));
      } catch (e) { if (!(e instanceof Err)) throw e; errors.push({ row: Number((inp || {}).row) || i + 1, item: String((inp || {}).item_number || ''), error: e.message, status: e.status, code: e.code }); }
    });
    if (!checked.length) return { added: [], errors };
    const st = S(); const before = st.custom.length;
    checked.slice().reverse().forEach(c => { c.product.images = imagesFor(c.ids); st.custom.unshift(c.product); });   // new pieces go first
    if (!D.save()) { st.custom.splice(0, st.custom.length - before); throw new Err('The demo ran out of room in your browser storage. Press “Reset demo”, or use fewer / smaller photos.', 507, 'storage_full'); }
    await loadAll();
    return { added: checked.map(c => ({ sku: c.product.sku, name: c.product.name, url: 'index.html?item=' + encodeURIComponent(c.product.sku) })), errors };
  }
  function piecesForm() {
    const sizes = LISTS.sizes; const colors = {};
    ALL.forEach(p => { const c = (p.color_filter_label || '').trim(); if (c) colors[c] = (colors[c] || 0) + 1; });
    return { categories: LISTS.categories, sizes, colors: [...new Set([...LISTS.colors, ...Object.keys(colors).sort((x, y) => colors[y] - colors[x]).slice(0, 20)])],
      brands: ['Ralph Lauren', 'Talbots', 'J. Crew', 'Banana Republic', 'Calvin Klein', 'Eileen Fisher'], locations: ['TK', 'WARE'], conditions: ['New with tags', 'New without tags', 'Pre-owned – excellent', 'Pre-owned – good', 'Pre-owned – fair', 'Vintage'] };
  }
  // ---- spreadsheets (.csv really parsed; .xlsx -> a labelled sample) ---------------------------------------------------------------
  const COLS = { item_number: ['itemnumber', 'item', 'itemno', 'itemnum', 'tag', 'tagnumber', 'tagno', 'sku', 'productid'], name: ['name', 'title', 'productname', 'itemname'], regular_price: ['price', 'regularprice', 'ourprice', 'sellingprice', 'listprice'],
    sale_price: ['saleprice'], main_category: ['category', 'maincategory', 'categories', 'department'], sub_category: ['subcategory', 'subcategories', 'subcat'], size: ['size'], color: ['color', 'colour'], brand: ['brand', 'brandname', 'designer'],
    condition: ['condition'], type: ['type', 'style', 'itemtype'], material: ['material', 'fabric'], description: ['shortdescription', 'summary'], details: ['description', 'details', 'measurements', 'notes', 'comments'], location: ['location', 'keptat', 'storage'],
    weight_lb: ['weight', 'weightlbs', 'weightlb'], length_in: ['length', 'lengthin'], width_in: ['width', 'widthin'], height_in: ['height', 'heightin'], photos_named: ['images', 'photos', 'photo', 'image', 'pictures', 'imagefilename', 'imagefilenames', 'photofilename'] };
  function parseCsv(text) {
    const delim = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
  }
  function sheetParse(inp) {
    const name = clean(inp.name || 'sheet', 120); let bytes;
    try { const bin = atob(String(inp.data || '')); bytes = Uint8Array.from(bin, c => c.charCodeAt(0)); } catch { bytes = null; }
    if (!bytes || !bytes.length) throw new Err('Choose a spreadsheet first.', 400, 'no_file');
    if (bytes.length > 8_000_000) throw new Err('That file is over 8 MB.', 400, 'too_big');
    if (bytes[0] === 0xD0 && bytes[1] === 0xCF) throw new Err('That is an old Excel file (.xls). In Excel choose File → Save As → Excel Workbook (.xlsx), then drop it again.', 400, 'old_xls');
    if (bytes[0] === 0x50 && bytes[1] === 0x4B) {   // .xlsx = a zip: the demo does not unzip it
      if (/consign|workbook/i.test(name)) return { kind: 'consignors', sheets: 3 };
      const rows = [['T9262001', 'Sample linen blazer size M', 3400, 'Women Jackets/Coats', 'Short Wool Coats', 'M', 'Beige'], ['T9262002', 'Sample pleated midi skirt size S', 2200, 'Women Dresses', 'Long Skirts', 'S', 'Navy'],
        ['T9262003', 'Sample suede ankle boots size 8', 3900, 'Women Shoes/Boots', 'Short Boots', '8', 'Brown']].map(r => ({ item_number: r[0], name: r[1], price: r[2] / 100, main_category: r[3], sub_category: r[4], size: r[5], color: r[6], brand: 'Sample', condition: 'Pre-owned – excellent',
        details: 'Made-up demo row', photo_key: r[0].toLowerCase(), problems: [] }));
      return { kind: 'pieces', sheet: 'Sample', columns: Object.keys(rows[0]), rows, warnings: ['DEMO: the demo cannot read .xlsx files, so these 3 rows are a made-up sample. Save your sheet as .csv to try your own rows.'], consignor_sheets: 0 };
    }
    const text = new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
    const table = parseCsv(text);
    if (table.length < 2) throw new Err('That sheet has no rows under the column names.', 400, 'empty_sheet');
    const headers = table[0].map(h => String(h).toLowerCase().replace(/[^a-z0-9]/g, '')); const map = {};
    headers.forEach((h, i) => { for (const [field, names] of Object.entries(COLS)) if (names.includes(h) && !(field in map)) map[field] = i; });
    if (!('item_number' in map) && !('name' in map)) throw new Err('I could not find the column names (item number, name, price, category). Use the template.', 400, 'no_columns');
    const rowsOut = [];
    table.slice(1).forEach(cells => {
      const row = {}; for (const [field, idx] of Object.entries(map)) row[field] = String(cells[idx] ?? '').trim();
      const regular = parseFloat(String(row.regular_price || '').replace(/[^0-9.]/g, '')) || 0, sale = parseFloat(String(row.sale_price || '').replace(/[^0-9.]/g, '')) || 0;
      row.price = sale > 0 && (regular <= 0 || sale < regular) ? sale : (regular > 0 ? regular : ''); delete row.regular_price; delete row.sale_price;
      row.item_number = String(row.item_number || '').replace(/[^A-Za-z0-9._-]/g, ''); row.photo_key = norm(row.item_number).toLowerCase();
      if (row.main_category && !row.sub_category) { const m = row.main_category.match(/^([^,>]+)>\s*([^,]+)/); if (m) { row.main_category = m[1].trim(); row.sub_category = m[2].trim(); } }
      if (row.main_category) row.main_category = row.main_category.split(',')[0].trim();
      if (row.photos_named) row.photos_named = row.photos_named.split(/[,;|\s]+/).map(u => u.replace(/^.*[\\/]/, '').split('?')[0]).filter(Boolean); else delete row.photos_named;
      if (!row.name && !row.item_number && !row.price) return;
      const problems = []; if (!row.item_number) problems.push('no item number'); if (!row.name) problems.push('no name'); if (row.price === '' || row.price <= 0) problems.push('no price'); if (!row.main_category) problems.push('no category');
      row.problems = problems; rowsOut.push(row);
    });
    if (rowsOut.length > 500) throw new Err('That sheet has over 500 pieces. Split it into smaller sheets.', 400, 'too_many');
    return { kind: 'pieces', sheet: name, columns: Object.keys(map), rows: rowsOut, warnings: rowsOut.length ? [] : ['The sheet has column names but no pieces under them.'], consignor_sheets: 0 };
  }

  // ---- weekly uploads: sold items, held pieces ------------------------------------------------------------------------------------
  function soldState() { const a = A(); const all = Object.values(a.soldLog); return { sold: all.filter(r => !r.relisted).sort((x, y) => y.soldAt - x.soldAt), relisted: all.filter(r => r.relisted), cutoff: Date.now() - 44 * DAY }; }
  function soldSplit(sku) { const i = itemForSku(sku); if (i) { const p = String(itemSplit(i)); if (p === '40' || p === '50') return p; } return '40'; }
  function soldView(p) {
    const v = prodView(p); const rec = A().soldLog[v.sku] || null;
    return { item: v.sku, name: v.name, price_cents: v.price_cents, image: v.image_card || v.image, status: siteStatus(v.sku), record: rec, split: soldSplit(v.sku) };
  }
  function soldMark(inp) {
    const a = A(); const p = findProduct(inp.item); if (!p) throw new Err('No product with that item number.', 404, 'not_found');
    const sku = String(p.sku); const location = clean(inp.location, 40);
    if (!['Warehouse', 'Tomcat'].includes(location)) throw new Err('Choose a location first.', 400, 'bad_location');
    if (a.soldLog[sku] && !a.soldLog[sku].relisted) throw new Err('This item is already in sold items.', 409, 'already_sold');
    if (siteStatus(sku) === 'sold') throw new Err('This item is already marked sold on the shop.', 409, 'already_sold');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(inp.date || '')) ? inp.date : todayLocal();
    const when = new Date(day + 'T12:00:00').getTime() || Date.now(); const v = prodView(p);
    putState(sku, { status: 'sold', reason: 'Sold in store (' + location + ')', source: 'admin', order_id: null });
    const item = itemForSku(sku);
    if (item && item.status === 'in_store' && v.price_cents) recordSale(item, 'store', 'weekly-' + sku, v.price_cents, 0, day, 'Marked sold on the weekly uploads page (' + location + ')');
    a.soldLog[sku] = { item: sku, name: v.name, location, soldAt: when, saleAmount: v.price_cents ? (v.price_cents / 100).toFixed(2) : '', splitPercent: soldSplit(sku), image: v.image_card || v.image };
    commit(); return soldState();
  }
  const SOLD_EDITABLE = ['saleAmount', 'transactionNumber', 'mailedDate', 'carrier', 'shipperName', 'trackingNumber', 'deliveredDate', 'packageSize', 'recipient', 'address', 'fulfillment'];
  function soldUpdate(inp) {
    const a = A(); const p = findProduct(inp.item); const sku = p ? String(p.sku) : null; const r0 = sku ? a.soldLog[sku] : null;
    if (!r0 || r0.relisted) throw new Err('That item is not in sold items.', 404, 'not_found');
    const r = Object.assign({}, r0);
    SOLD_EDITABLE.forEach(k => { if (k in inp) r[k] = clean(inp[k], k === 'address' ? 400 : 150); });
    if (inp.splitPercent !== undefined && ['40', '50'].includes(String(inp.splitPercent))) r.splitPercent = String(inp.splitPercent);
    if ('completed' in inp) r.completed = !!inp.completed;
    if ((r.saleAmount ?? '') !== '' && (isNaN(Number(r.saleAmount)) || Number(r.saleAmount) < 0)) throw new Err('Amount sold must be a number.', 400, 'bad_amount');
    for (const k of ['mailedDate', 'deliveredDate']) if ((r[k] ?? '') !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(r[k])) throw new Err('Bad date.', 400, 'bad_date');
    a.soldLog[sku] = r;
    const item = itemForSku(sku); const sale = item ? a.sales.find(s => s.item_id === item.id && s.ref === 'weekly-' + sku && s.status === 'sold') : null;
    if (sale) {   // the consignor's credit follows the amount and split on this page
      const cents = (r.saleAmount ?? '') !== '' ? dollarsToCents(r.saleAmount) : sale.sold_cents; const pc = ['40', '50'].includes(String(r.splitPercent)) && 'splitPercent' in inp ? Number(r.splitPercent) : sale.split_pct;
      if (cents !== null && (cents !== sale.sold_cents || pc !== sale.split_pct)) { sale.sold_cents = cents; sale.split_pct = pc; sale.cut_cents = consignCut(cents, pc); event(item.consignor_id, item.item_no, 'sale_changed', `Weekly page: sold for ${money(cents)} at ${pc}% = ${money(sale.cut_cents)}`); }
    }
    commit(); return soldState();
  }
  function soldRelist(inp) {
    const a = A(); const p = findProduct(inp.item); const sku = p ? String(p.sku) : null; const r = sku ? a.soldLog[sku] : null;
    if (!r || r.relisted) throw new Err('That item is not in sold items.', 404, 'not_found');
    if (pstate(sku) && pstate(sku).order_id) throw new Err('This item was sold through a website order; refund or handle it from Orders.', 409, 'order_sale');
    putState(sku, { status: 'available', reason: null, source: null, order_id: null });
    const item = itemForSku(sku); const sale = item ? a.sales.find(s => s.item_id === item.id && s.ref === 'weekly-' + sku && s.status === 'sold') : null;
    if (sale) reverseSale(sale, 'Put back on the site from the weekly uploads page');
    r.relisted = true; r.relistedAt = Date.now(); commit(); return soldState();
  }
  function holdPieces(inp) {
    const a = A();
    (Array.isArray(inp.rows) ? inp.rows : []).slice(0, 500).forEach(r => {
      if (!r || typeof r !== 'object') return; const sku = clean(r.item_number, 40).toUpperCase(); if (!sku) return;
      const row = { item_number: sku, saved: nowIso() };
      ['name', 'price', 'main_category', 'sub_category', 'size', 'color', 'brand', 'condition', 'photo_key'].forEach(f => { row[f] = clean(r[f], 120); });
      row.details = Array.isArray(r.details) ? r.details : clean(r.details, 2000); row.needs = (Array.isArray(r.needs) ? r.needs : []).slice(0, 10).map(x => clean(x, 120)); a.held[sku] = row;
    });
    (Array.isArray(inp.remove) ? inp.remove : []).forEach(sku => { delete a.held[clean(sku, 40).toUpperCase()]; });
    commit(); return { held: Object.values(a.held) };
  }
  function uploadedList() {
    const items = S().custom.filter(p => p.added_at).map(p => ({ t: p.added_at, images: (p.images || []).length, sku: String(p.sku), name: p.name, price: p.price_text || '', image: imgPath((p.images || [])[0], 'card') }));
    return { added: items.map(i => i.t), items };
  }

  // ---- Find & edit -----------------------------------------------------------------------------------------------------------------
  function flatItem(d) { return { name: d.name, regular_price: d.regular_price, sale_price: d.sale_price, size: d.size, color: d.color, main_category: d.main_category, sub_category: d.sub_category, details: d.details, stock: d.stock, location: d.location,
    weight_lb: d.weight_lb, length_in: d.length_in, width_in: d.width_in, height_in: d.height_in, photos: (d.images || []).length, consign_price: d.consignment ? d.consignment.price_cents : '', consign_split_pct: d.consignment ? d.consignment.split_pct : '', consign_notes: d.consignment ? d.consignment.notes : '' }; }
  function itemDetail(sku) {
    const p = findProduct(sku); if (!p) throw new Err(`There is no piece ${sku} on the site.`, 404, 'not_found');
    const c = itemForSku(p.sku); let consign = null;
    if (c) { const cr = consignorById(c.consignor_id); consign = { id: c.id, consignor_id: c.consignor_id, consignor: cr.name, consignor_number: cr.number, item_no: c.item_no, description: c.description, price_cents: c.price_cents, split_pct: c.split_pct,
      effective_split: itemSplit(c), consignor_split: cr.split_pct, payout_cents: c.price_cents !== null ? consignCut(c.price_cents, itemSplit(c)) : null, status: c.status, notes: c.notes, location: c.location }; }
    return { sku: String(p.sku), name: p.name, regular_price: p.regular_price ?? null, sale_price: p.sale_price ?? null, price: p.price ?? null, size: p.size || '', color: p.color || '',
      main_category: p.main_category || ((p.categories || [])[0] || [])[0] || '', sub_category: p.sub_category || ((p.categories || [])[0] || [])[1] || '', details: (p.details || []).join('\n'), stock: p.stock ?? 1, location: p.location || '',
      weight_lb: p.weight_lb ?? null, length_in: p.length_in ?? null, width_in: p.width_in ?? null, height_in: p.height_in ?? null, status: siteStatus(p.sku), images: (p.images || []).map(i => ({ lg: i.lg || null, card: i.card || null, thumb: i.thumb || null })),
      consignment: consign, url: 'index.html?item=' + encodeURIComponent(p.sku), history: (A().editlog['item:' + p.sku] || []).slice(0, 60) };
  }
  function itemUpdate(sku, inp) {
    const p0 = findProduct(sku); if (!p0) throw new Err(`There is no piece ${sku} on the site.`, 404, 'not_found');
    const key = String(p0.sku); const st = S(); const a = A(); const num = (v, label, max) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > max) throw new Err(`${label} must be a number between 0 and ${max}.`, 400, 'bad_number'); return n; };
    const before = flatItem(itemDetail(key)); const e = {};
    if ('name' in inp) { const n = clean(inp.name, 200); if (!n) throw new Err('The name cannot be empty.', 400, 'bad_name'); e.name = n; }
    if ('regular_price' in inp) { e.regular_price = num(inp.regular_price, 'The price', 100000); if (e.regular_price === null) throw new Err('The price is required.', 400, 'bad_price'); }
    if ('sale_price' in inp) e.sale_price = num(inp.sale_price, 'The sale price', 100000);
    [['size', 40], ['color', 60], ['location', 30], ['main_category', 80], ['sub_category', 80]].forEach(([k, m]) => { if (k in inp) e[k] = clean(inp[k], m); });
    if ('details' in inp) e.details = String(inp.details).split(/\r?\n/).map(l => clean(l, 300)).filter(Boolean).slice(0, 30);
    if ('stock' in inp) { const n = Number(inp.stock); if (!Number.isInteger(n) || n < 0 || n > 9999) throw new Err('Stock must be a whole number.', 400, 'bad_stock'); e.stock = n; }
    [['weight_lb', 150], ['length_in', 200], ['width_in', 200], ['height_in', 200]].forEach(([k, m]) => { if (k in inp) e[k] = num(inp[k], k, m); });
    const remove = (Array.isArray(inp.remove_images) ? inp.remove_images : []).map(String), order = (Array.isArray(inp.image_order) ? inp.image_order : []).map(String), add = Array.isArray(inp.add_photos) ? inp.add_photos : [];
    if (add.length > 12) throw new Err('At most 12 new photos at a time.', 400, 'too_many_photos');
    const c = itemForSku(key); const ci = inp.consign && typeof inp.consign === 'object' ? inp.consign : null;
    if (ci && !c) throw new Err('This piece is not a consignment item.', 400, 'not_consigned');
    const cs = {};
    if (ci) {
      if ('split_pct' in ci) { cs.split_pct = ci.split_pct === '' ? null : ci.split_pct; pct(cs.split_pct, null); }
      if ('price' in ci) cs.price = ci.price;
      if ('payout' in ci && ci.payout !== null && ci.payout !== '' && !('split_pct' in ci)) {
        const priceCents = 'price' in cs ? ((cs.price === null || cs.price === '') ? null : dollarsToCents(cs.price)) : c.price_cents; const pay = dollarsToCents(ci.payout);
        if (pay === null || pay < 0) throw new Err('The payout must be an amount like 15.99.', 400, 'bad_payout');
        if (priceCents === null || priceCents <= 0) throw new Err('Set the consignment price first; the payout is worked out from it.', 400, 'payout_needs_price');
        if (pay > priceCents) throw new Err('The payout cannot be more than the price.', 400, 'payout_too_high');
        cs.split_pct = Math.round(pay * 100 / priceCents);
      }
      if ('notes' in ci) cs.notes = ci.notes;
    }
    const newImages = imagesFor(add);
    const target = st.custom.find(p => String(p.sku) === key); const base = Object.assign({}, p0); const out = {};
    ['name', 'size', 'color', 'location', 'stock', 'weight_lb', 'length_in', 'width_in', 'height_in', 'details'].forEach(k => { if (k in e) out[k] = e[k]; });
    if ('regular_price' in e || 'sale_price' in e) {
      const regular = 'regular_price' in e ? e.regular_price : (base.regular_price ?? null); let sale = 'sale_price' in e ? e.sale_price : (base.sale_price ?? null);
      if (sale !== null && regular !== null && sale >= regular) sale = null;
      out.regular_price = regular; out.sale_price = sale; out.price = sale ?? regular; out.price_text = '$' + Number(out.price).toFixed(2); out.regular_text = sale !== null ? '$' + Number(regular).toFixed(2) : '';
    }
    if ('size' in e) { out.sub = e.size !== '' ? 'Size ' + e.size : ''; out.badge = out.sub; out.specs = (base.specs || []).filter(s => !Array.isArray(s) || String(s[0]).toLowerCase() !== 'size'); if (e.size !== '') out.specs.unshift(['Size', e.size]); }
    if ('main_category' in e || 'sub_category' in e) {
      const main = e.main_category ?? (base.main_category || ''), sub = e.sub_category ?? (base.sub_category || ''); if (main === '') throw new Err('The category cannot be empty.', 400, 'bad_category');
      const [sm, ss, hers, hs] = siteCategory(main, sub); out.main_category = sm; out.sub_category = ss; out.categories = [[sm, ss]]; out.her_category = [hers, hs]; out.category_source = 'owner';
    }
    if (remove.length || order.length || newImages.length) {
      let images = (base.images || []).slice();
      if (remove.length) { const keep = images.filter(i => !remove.includes(String(i.lg || ''))); if (!keep.length && !newImages.length) throw new Err('A piece needs at least one photo. Add a new one before removing the last.', 400, 'last_photo'); images = keep; }
      if (order.length) { const pos = {}; order.forEach((v, i) => { pos[v] = i; }); images.sort((x, y) => (pos[x.lg] ?? 999) - (pos[y.lg] ?? 999)); }
      out.images = images.concat(newImages);
    }
    if (target) Object.assign(target, out); else if (Object.keys(out).length) a.ov[key] = Object.assign(a.ov[key] || {}, out);
    if (Object.keys(cs).length && c) {
      const f = {}; if ('split_pct' in cs) f.split_pct = pct(cs.split_pct, null);
      if ('price' in cs) f.price_cents = (cs.price === null || cs.price === '') ? null : dollarsToCents(cs.price);
      if ('notes' in cs) f.notes = String(cs.notes ?? '').trim().slice(0, 1000) || null;
      Object.assign(c, f, { updated_at: nowIso() });
    }
    commit();
    return loadAll().then(() => { const d = itemDetail(key); editLog('item', key, before, flatItem(d)); if (c && Object.keys(cs).length) event(c.consignor_id, c.item_no, 'edited', 'Edited in Find & edit by Demo admin'); commit(); return d; });
  }
  function itemsSearch(q) {
    q = clean(q, 120); if (!q) return [];
    const qn = norm(q).toLowerCase(); const tokens = q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); const a = A(); const found = [];
    ALL.forEach(p => {
      const sku = String(p.sku).toLowerCase(); const name = String(p.name).toLowerCase(); const c = itemForSku(p.sku); const cn = c ? (consignorById(c.consignor_id).name + ' ' + consignorById(c.consignor_id).number).toLowerCase() : '';
      let score = 0, why = '';
      if (sku === q.toLowerCase() || norm(sku).toLowerCase() === qn) { score = 100; why = 'item number'; }
      else if (sku.includes(q.toLowerCase())) { score = 80; why = 'item number'; }
      else if (tokens.length && tokens.every(t => name.includes(t) || sku.includes(t) || cn.includes(t))) { score = 60; why = cn && tokens.some(t => cn.includes(t)) ? 'consignor' : 'name'; }
      if (score >= 30) found.push({ score, why, p, c });
    });
    found.sort((x, y) => y.score - x.score || (String(x.p.sku) < String(y.p.sku) ? -1 : 1));
    return found.slice(0, 20).map(f => { const v = prodView(f.p); return { sku: v.sku, name: v.name, price_cents: v.price_cents, image: v.image, status: siteStatus(v.sku), score: f.score, why: f.why, consignor: f.c ? `${consignorById(f.c.consignor_id).name} (${consignorById(f.c.consignor_id).number})` : null }; });
  }
  function ordersSearch(q) {
    q = clean(q, 80).toLowerCase(); if (!q) return [];
    return S().orders.filter(o => [o.number, o.name, o.email, o.phone, (o.tracking || {}).number, ...o.items.map(i => i.sku)].some(v => String(v || '').toLowerCase().includes(q))).sort((x, y) => y.id - x.id).slice(0, 20)
      .map(o => ({ id: o.id, number: o.number, name: o.name, email: o.email, status: o.status, fulfillment: o.fulfillment, fulfillment_status: o.fulfillment_status, total_cents: o.total_cents, created_at: o.created_at }));
  }
  function orderDetails(o, inp) {
    const before = { name: o.name, email: o.email, phone: o.phone, fulfillment_status: o.fulfillment_status, carrier: o.carrier || '', service: o.service || '', tracking_number: (o.tracking || {}).number || '', tracking_url: (o.tracking || {}).url || '', notes: o.notes || '' };
    const f = {};
    ['name', 'email', 'phone', 'carrier', 'service', 'tracking_number', 'tracking_url', 'notes'].forEach(k => { if (k in inp) f[k] = clean(inp[k], k === 'notes' ? 1000 : 300); });
    if (f.email && !emailOk(f.email)) throw new Err('That email address does not look right.', 400, 'bad_email');
    if ('fulfillment_status' in inp) {
      const ok2 = ['new', 'processing', 'shipped', 'delivered', 'ready', 'picked_up', 'cancelled', 'unfulfilled', 'label_created', 'ready_for_pickup'];
      if (!ok2.includes(inp.fulfillment_status)) throw new Err('That status does not fit this order.', 400, 'bad_status'); f.fulfillment_status = inp.fulfillment_status;
    }
    if (inp.address && typeof inp.address === 'object') { const ad = inp.address; o.ship_to = { name: clean(ad.name, 120), street1: clean(ad.street1, 120), street2: clean(ad.street2, 120), city: clean(ad.city, 80), state: clean(ad.state, 2).toUpperCase(), zip: clean(ad.zip, 10) }; }
    ['name', 'email', 'phone', 'notes', 'fulfillment_status', 'carrier', 'service'].forEach(k => { if (k in f) o[k] = f[k]; });
    if ('tracking_number' in f || 'tracking_url' in f) o.tracking = Object.assign(o.tracking || { carrier: o.carrier || 'USPS' }, 'tracking_number' in f ? { number: f.tracking_number } : {}, 'tracking_url' in f ? { url: f.tracking_url } : {});
    const after = { name: o.name, email: o.email, phone: o.phone, fulfillment_status: o.fulfillment_status, carrier: o.carrier || '', service: o.service || '', tracking_number: (o.tracking || {}).number || '', tracking_url: (o.tracking || {}).url || '', notes: o.notes || '' };
    editLog('order', o.number, before, after); commit();
    return Object.assign(orderAdmin(o), { history: (A().editlog['order:' + o.number] || []).slice(0, 60) });
  }

  // ---- pieces & eBay (everything eBay is a mock: no listing is ever posted anywhere) ----------------------------------------------
  const EBAY_CATEGORIES = [{ id: '63861', name: 'Dresses', path: 'Clothing, Shoes & Accessories > Women > Dresses' }, { id: '63862', name: 'Coats, Jackets & Vests', path: 'Clothing, Shoes & Accessories > Women > Coats, Jackets & Vests' },
    { id: '53159', name: 'Tops', path: 'Clothing, Shoes & Accessories > Women > Tops' }];
  const parseEbayId = raw => { const m = String(raw).match(/(?:^|[^0-9])(\d{12})(?:[^0-9]|$)/); return m ? m[1] : null; };
  function adminProducts() {
    const orderNo = sku => { const o = S().orders.find(x => x.items.some(i => String(i.sku) === sku && !i.refunded)); return o ? o.number : null; };
    return ALL.filter(p => p.source !== 'ebay').map(p => {
      const v = prodView(p); const st = pstate(v.sku) || {}; const status = siteStatus(v.sku);
      const linked = st.ebay_item_id || null;
      return { sku: v.sku, name: v.name, price_cents: v.price_cents, image: v.image, status, source: st.source || null, reason: st.reason || null, order_number: status === 'sold' ? (orderNo(v.sku) || null) : null,
        ebay_item_id: linked, ebay_status: st.ebay_status || null, ebay_text: st.ebay_text || null, ebay_title: st.ebay_title || null, ebay_checked_at: st.ebay_checked_at || null, keep_on_site: !!st.keep_on_site,
        weight_lb: p.weight_lb ?? 2, length_in: p.length_in ?? 15, width_in: p.width_in ?? 11, height_in: p.height_in ?? 3, still_on_ebay: false, ebay_seller: st.ebay_seller || null, ebay_by_shop: !!st.ebay_by_shop,
        ebay_end_status: st.ebay_end_status || null, ebay_end_detail: st.ebay_end_detail || null, from_ebay: false,
        can_list: v.local_photos && v.price_cents > 0 && status === 'available' && (!linked || ['gone', 'sold'].includes(st.ebay_status)) };
    });
  }
  function updateProduct(sku, inp) {
    const p = findProduct(sku); if (!p) throw new Err('Unknown SKU.', 404, 'not_found'); sku = String(p.sku); const f = {}; let check = null;
    if ('status' in inp) {
      const s = String(inp.status); if (!['available', 'sold', 'hidden'].includes(s)) throw new Err('Status must be available, sold or hidden.', 400, 'bad_status');
      Object.assign(f, { status: s, source: 'admin', reason: s === 'available' ? null : (s === 'sold' ? 'Marked sold by the boutique' : 'Hidden by the boutique') });
      if (s === 'available') f.order_id = null;
      const cur = pstate(sku) || {};
      if (s === 'sold' && cur.ebay_item_id && cur.ebay_status === 'available') Object.assign(f, { ebay_status: 'gone', ebay_end_status: 'ended', ebay_end_detail: 'Ended the eBay listing (demo).', ebay_checked_at: nowIso() });
    }
    if ('ebay_item' in inp) {
      const raw = String(inp.ebay_item || '').trim();
      if (raw === '') Object.assign(f, { ebay_item_id: null, ebay_status: null, ebay_text: null, ebay_title: null, ebay_checked_at: null });
      else {
        const id = parseEbayId(raw); if (!id) throw new Err('Paste an eBay listing link or the 12-digit item number.', 400, 'bad_ebay_item');
        const taken = Object.entries(A().pstate).find(([k, v]) => v.ebay_item_id === id && k !== sku); if (taken) throw new Err(`That eBay listing is already linked to ${taken[0]}.`, 409, 'ebay_linked');
        Object.assign(f, { ebay_item_id: id, ebay_status: 'available', ebay_checked_at: nowIso(), ebay_text: 'Active on eBay (demo: not a real listing).', ebay_title: p.name, ebay_seller: 'demo_store_one' });
        check = { state: 'available', detail: 'Active on eBay (demo: not a real listing).', title: p.name, seller: 'demo_store_one' };
      }
    }
    if ('keep_on_site' in inp) f.keep_on_site = !!inp.keep_on_site;
    const dims = {};
    for (const d of ['length_in', 'width_in', 'height_in']) if (d in inp && inp[d] !== '' && inp[d] !== null) { const v = Number(inp[d]); if (!(v > 0 && v <= 108)) throw new Err('Box sides must be between 0 and 108 inches.', 400, 'bad_dims'); dims[d] = v; }
    if ('weight_lb' in inp && inp.weight_lb !== '' && inp.weight_lb !== null) { const v = Number(inp.weight_lb); if (!(v > 0 && v <= 70)) throw new Err('Weight must be between 0 and 70 lb.', 400, 'bad_weight'); dims.weight_lb = v; }
    if (Object.keys(f).length) putState(sku, f);
    if (Object.keys(dims).length) { const t = S().custom.find(x => String(x.sku) === sku); if (t) Object.assign(t, dims); else A().ov[sku] = Object.assign(A().ov[sku] || {}, dims); }
    commit();
    return loadAll().then(() => ({ product: adminProducts().find(x => x.sku === sku), ebay_check: check }));
  }
  function ebayListOptions(sku, store) {
    const p = findProduct(sku); if (!p) throw new Err('There is no such piece.', 404, 'not_found'); const v = prodView(p); const stores = Object.keys(A().setup.ebay).filter(u => A().setup.ebay[u]);
    if (!stores.length) throw new Err('Connect her eBay stores first (admin → Setup → eBay → Make a sign-in link).', 409, 'ebay_no_store');
    const pol = kind => [{ id: kind + '-1', name: 'Demo ' + kind + ' policy', about: '' }, { id: kind + '-2', name: 'Demo ' + kind + ' policy (alternate)', about: '' }];
    return { piece: { sku: v.sku, title: v.name.slice(0, 80), name: v.name, price_cents: v.price_cents, photos: v.piece.images.map(i => i.lg), weight_lb: p.weight_lb ?? 2, box: `${p.length_in ?? 15}×${p.width_in ?? 11}×${p.height_in ?? 3} in` },
      stores, store: stores.includes(store) ? store : stores[0], policies: { fulfillment: pol('shipping'), return: pol('return'), payment: pol('payment') }, chosen: {}, categories: EBAY_CATEGORIES };
  }
  const ebayCategory = (sku, id) => ({ category_id: id, aspects: [{ name: 'Brand', required: true, free: true, multi: false, values: ['Talbots', 'Ralph Lauren', 'J. Crew'] }, { name: 'Size', required: true, free: true, multi: false, values: [] },
    { name: 'Color', required: false, free: true, multi: false, values: ['Black', 'Blue', 'Cream'] }, { name: 'Department', required: false, free: false, multi: false, values: ['Women'] }],
    conditions: [{ id: 1000, name: 'New with tags' }, { id: 1500, name: 'New without tags' }, { id: 3000, name: 'Pre-owned' }], guess: { aspects: { Brand: 'Sample', Department: 'Women' }, condition_id: 3000 } });
  function ebayList(inp) {
    const p = findProduct(inp.sku); if (!p) throw new Err('There is no such piece.', 404, 'not_found'); const sku = String(p.sku); const store = clean(inp.store, 60) || Object.keys(A().setup.ebay)[0];
    const id = '1100' + Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b % 10).join('');
    putState(sku, { ebay_item_id: id, ebay_seller: store, ebay_by_shop: true, ebay_status: 'available', ebay_checked_at: nowIso(), ebay_end_status: null, ebay_text: `Listed on eBay by the shop (store ${store}) — demo, nothing was posted`, ebay_title: clean(inp.title, 80) || p.name });
    A().ebayEvents.unshift({ created_at: nowIso(), sku, event: 'listed', detail: `Demo: pretended to post to eBay store ${store} at ${money(Math.round(Number(inp.price) * 100) || 0)}` });
    commit(); return { item_id: id, url: SITE + 'shop/admin/#pieces', store };
  }
  function ebayEnd(sku) {
    const st = pstate(sku); if (!st || !st.ebay_item_id) throw new Err('This piece is not linked to an eBay listing.', 409, 'ebay_not_linked');
    putState(sku, { ebay_status: 'gone', ebay_checked_at: nowIso(), ebay_end_status: 'ended', ebay_end_detail: 'Ended the eBay listing (demo).' });
    A().ebayEvents.unshift({ created_at: nowIso(), sku, event: 'ended', detail: 'Demo: pretended to end the listing (by hand in the admin)' }); commit();
    return { detail: 'Ended the eBay listing (demo: nothing was changed on eBay).' };
  }
  const storeStatus = () => { const a = A(); return { ready: true, why: null, env: 'mock', last_run: a.lastStore, last_ok: a.lastStore ? true : null, matched: 0, unmatched: [], errors: [], in_library: a.items.filter(i => i.sku).length }; };

  // ---- the router ---------------------------------------------------------------------------------------------------------------------------
  const hasSession = () => { try { return Number(localStorage.getItem(SESSION_KEY)) > Date.now(); } catch { return false; } };
  async function adminRoute(sub, method, body, ctx) {
    const write = method !== 'GET'; const q = ctx.query; let m;
    if (sub === 'login' && method === 'POST') {
      if (String(body.password || '') !== 'demo') throw new Err('That password is not right. In the demo it is “demo”.', 401, 'bad_password');
      try { localStorage.setItem(SESSION_KEY, String(Date.now() + 8 * 3600 * 1000)); } catch { /* the page still works until reload */ }
      return ok({ csrf: 'demo-csrf', scope: 'full' });
    }
    if (sub === 'logout' && method === 'POST') { try { localStorage.removeItem(SESSION_KEY); } catch { /* fine */ } return ok({}); }
    if (sub === 'staff-login' && method === 'POST') throw new Err('Staff sign-in is not part of the demo: use the admin password “demo”.', 401, 'bad_password');
    if (sub === 'keys-link' && method === 'POST') throw new Err('Private keys links are not part of the demo.', 404, 'bad_link');
    if (!hasSession()) throw new Err('Please sign in.', 401, 'unauthorized');
    await loadAll(); A();
    if (sub === 'me') return ok({ csrf: 'demo-csrf', scope: 'full' });
    if (sub === 'status') return ok({ status: statusView() });
    if (sub === 'start') {
      if (!write) return ok(startView());
      if (!['info', 'first_order'].includes(String(body.id || ''))) throw new Err('That step ticks itself.', 400, 'bad_step');
      if (body.done) A().ticks[body.id] = nowIso(); else delete A().ticks[body.id]; commit(); return ok(startView());
    }
    // keys: the demo never stores or shows a key
    if (sub === 'keys' && !write) return ok(keysView());
    if (sub === 'keys' && write) throw new Err('This is the demo: nothing you type here is saved anywhere, and no real key is ever stored. (On the real shop this button saves the key.)', 403, 'demo');
    if (sub === 'keys/test' && write) return ok({ result: { ok: false, text: 'This is the demo, so there is nothing real to test. On the real shop this checks the connection.' }, switched: false });
    // orders
    if (sub === 'orders' && !write) return ok({ orders: ordersList(q) });
    if (sub === 'orders/search' && !write) return ok({ orders: ordersSearch(q.get('q') || '') });
    if ((m = sub.match(/^orders\/(\d+)\/details$/))) { const o = orderById(m[1]); return ok({ order: write ? orderDetails(o, body) : Object.assign(orderAdmin(o), { history: (A().editlog['order:' + o.number] || []).slice(0, 60) }) }); }
    if ((m = sub.match(/^orders\/(\d+)$/)) && !write) return ok({ order: orderAdmin(orderById(m[1])) });
    if ((m = sub.match(/^orders\/(\d+)\/label$/)) && write) return ok({ order: buyLabel(orderById(m[1])) });
    if ((m = sub.match(/^orders\/(\d+)\/label\/void$/)) && write) return ok({ order: voidLabel(orderById(m[1])) });
    if ((m = sub.match(/^orders\/(\d+)\/refund$/)) && write) return ok(refundOrder(orderById(m[1]), body));
    if ((m = sub.match(/^orders\/(\d+)\/fulfillment$/)) && write) return ok({ order: setFulfillment(orderById(m[1]), body) });
    if ((m = sub.match(/^orders\/(\d+)\/notes$/)) && write) { const o = orderById(m[1]); o.notes = clean(body.notes, 2000); commit(); return ok({ order: orderAdmin(o) }); }
    // pieces & eBay
    if (sub === 'products' && !write) return ok({ products: adminProducts() });
    if ((m = sub.match(/^products\/([A-Za-z0-9._-]{1,64})$/)) && write) return ok(await updateProduct(decodeURIComponent(m[1]), body));
    if (sub === 'ebay/sync' && write) {
      const dry = !!body.dry_run; const run = { job: 'ebay', started_at: nowIso(), finished_at: nowIso(), ok: true, summary: { checked: ebayLinked(), removed: [], errors: [] } };
      if (!dry) { A().runs.unshift(run); A().runs.length = Math.min(A().runs.length, 30); commit(); }
      return ok({ result: { checked: ebayLinked(), orders_seen: 0, removed: [], would_remove: [], errors: [] } });
    }
    if (sub === 'ebay/import' && write) return ok({ result: { listings: ebayLinked(), on_site: ALL.filter(p => p.source !== 'ebay').length, added: [], updated: [], removed: [], skipped: [], errors: [] } });
    if (sub === 'ebay/search' && !write) return ok({ items: [{ item_id: '110000000001', title: 'Demo listing: ' + clean(q.get('q'), 60), price: '$25.00' }] });
    if (sub === 'ebay/stores' && !write) return ok({ stores: statusView().ebay.stores });
    if (sub === 'ebay/list-options' && !write) return ok(ebayListOptions(q.get('sku') || '', q.get('store')));
    if (sub === 'ebay/category' && !write) return ok(ebayCategory(q.get('sku'), q.get('id') || '63861'));
    if (sub === 'ebay/policies' && !write) return ok({ policies: ebayListOptions(q.get('sku') || ALL[0].sku, q.get('store')).policies });
    if (sub === 'ebay/list' && write) return ok({ result: ebayList(body) });
    if (sub === 'ebay/end' && write) return ok({ result: ebayEnd(String(body.sku || '')) });
    if (sub === 'ebay/disconnect' && write) { const st = clean(body.store, 60); if (st in A().setup.ebay) A().setup.ebay[st] = false; commit(); return ok({ stores: statusView().ebay.stores }); }
    if ((m = sub.match(/^connect\/(square|ebay)$/)) && write) {
      // A demo "sign-in link" goes nowhere real: it just reconnects the pretend account when opened here.
      if (m[1] === 'square') A().setup.square = true; else Object.keys(A().setup.ebay).forEach(u => { A().setup.ebay[u] = true; }); commit();
      return ok({ url: SITE + 'shop/admin/#setup', expires_at: new Date(Date.now() + 3600000).toISOString(), env: body.env || 'sandbox' });
    }
    if (sub === 'square/disconnect' && write) { A().setup.square = false; commit(); return ok({}); }
    if (sub === 'square/locations' && !write) return ok({ locations: [{ id: 'DEMO', name: 'Demo Boutique (sample)', address: '123 Example St', takes_cards: true }], current: 'DEMO' });
    if (sub === 'square/location' && write) return ok({ location_id: 'DEMO' });
    if (sub === 'events' && !write) return ok({ ebay: A().ebayEvents.slice(0, 100), runs: A().runs.slice(0, 30) });
    if (sub === 'commission' && !write) return ok({ commission: commissionSummary() });
    if (sub === 'reconcile' && write) return ok({ result: { refunds_checked: S().orders.filter(o => ['paid', 'partially_refunded'].includes(o.status)).length, refunds_found: 0, pending_settled: 0, errors: [] } });
    // weekly uploads
    if (sub === 'sold/lookup' && !write) {
      const p = findProduct(q.get('q') || ''); if (!p) { const h = A().held[String(q.get('q') || '').trim().toUpperCase()]; return ok(h ? { found: false, pending: h.name || h.item_number } : { found: false }); }
      return ok(Object.assign({ found: true }, soldView(p)));
    }
    if (sub === 'sold/state' && !write) return ok(soldState());
    if (sub === 'sold/mark' && write) return ok(soldMark(body));
    if (sub === 'sold/update' && write) return ok(soldUpdate(body));
    if (sub === 'sold/relist' && write) return ok(soldRelist(body));
    if (sub === 'pieces/form' && !write) return ok(piecesForm());
    if (sub === 'pieces/photo' && write) return ok({ photo: await photoUpload(body) });
    if (sub === 'pieces/new' && write) { const r = await addMany([body]); if (r.errors.length) throw new Err(r.errors[0].error, r.errors[0].status || 400, r.errors[0].code || 'bad_piece'); return ok(r.added[0]); }
    if (sub === 'pieces/batch' && write) return ok(await addMany(Array.isArray(body.pieces) ? body.pieces : []));
    if (sub === 'pieces/sheet' && write) return ok(sheetParse(body));
    if (sub === 'pieces/uploaded' && !write) return ok(uploadedList());
    if (sub === 'pieces/hold') return ok(write ? holdPieces(body) : { held: Object.values(A().held) });
    // Find & edit
    if (sub === 'items/search' && !write) return ok({ items: itemsSearch(q.get('q') || '') });
    if ((m = sub.match(/^items\/([A-Za-z0-9._-]{1,64})$/)) && m[1] !== 'search') { const sku = decodeURIComponent(m[1]); return ok({ item: write ? await itemUpdate(sku, body) : itemDetail(sku) }); }
    // consignors
    if (sub === 'consignors' && !write) return ok({ consignors: consignList(), store: storeStatus() });
    if (sub === 'consignors' && write) return ok(saveConsignor(null, body));
    if ((m = sub.match(/^consignors\/(\d+)$/))) return ok(write ? saveConsignor(Number(m[1]), body) : consignDetail(Number(m[1])));
    if ((m = sub.match(/^consignors\/(\d+)\/items$/)) && write) return ok(saveItem(Number(m[1]), null, body));
    if ((m = sub.match(/^consignors\/(\d+)\/items\/(\d+)$/)) && write) return ok(saveItem(Number(m[1]), Number(m[2]), body));
    if ((m = sub.match(/^consign-items\/(\d+)\/action$/)) && write) return ok(itemAction(Number(m[1]), body));
    if ((m = sub.match(/^consignors\/(\d+)\/payouts$/)) && write) return ok(recordPayout(Number(m[1]), body));
    if ((m = sub.match(/^consign-payouts\/(\d+)\/delete$/)) && write) return ok(deletePayout(Number(m[1])));
    if ((m = sub.match(/^consignors\/(\d+)\/link$/)) && write) {
      const c = consignorById(Number(m[1])); if (c.status !== 'active') throw new Err('This consignor is closed. Reopen them first.', 409, 'closed');
      c.portal_key = hex(24); event(c.id, null, 'link', 'New private account link made (any older link stopped working)'); commit();
      return ok({ url: SITE + 'consignor.html#k=' + c.portal_key, name: c.name });
    }
    if (sub === 'consignors/import' && write) return ok({ result: importWorkbook(body) });
    if (sub === 'consignors/publish' && write) return ok(await consignPublish(body));
    if (sub === 'store/sync' && write) { A().lastStore = nowIso(); commit(); return ok({ result: { orders: 0, matched: [], returns: [], skipped_website: 0, errors: [] }, store: storeStatus() }); }
    if (sub.startsWith('mock/')) throw new Err('Only available when Square runs in mock mode (not in the demo).', 409, 'not_mock');
    throw new Err('Unknown admin request.', 404, 'not_found');
  }

  D.extend(async (route, method, body, ctx) => {
    try {
      if (route.startsWith('admin/')) return await adminRoute(route.slice(6), method, body, ctx);
      if (route === 'consignor' || route.startsWith('consignor/')) { await loadAll(); return portalRoute(route, method, body, ctx); }
      return null;
    } catch (e) {
      if (e instanceof Err) return { status: e.status, body: Object.assign({ ok: false, error: e.message, code: e.code }, e.extra || {}) };
      console.error('demo admin backend', e);
      return { status: 500, body: { ok: false, error: 'Something went wrong in the demo. Press “Reset demo” and try again.', code: 'server_error' } };
    }
  });

  // ---- sample data (all made up) ----------------------------------------------------------------------------------------------------------------
  D.onSeed(async state => {
    await loadAll(); const a = state.adm = Object.assign(emptyAdm(), state.adm || {}); const now = Date.now();
    const mkItem = sku => { const p = findProduct(sku); if (!p) return null; const v = prodView(p); return { sku: v.sku, name: v.name, price_cents: v.price_cents, image: v.image, refunded: false }; };
    const people = {
      a: ['Sample Customer', 'sample.customer@example.com', '555-0101'], b: ['Sample Buyer', 'sample.buyer@example.com', '555-0102'], c: ['Test Shopper', 'test.shopper@example.com', '555-0103'],
      d: ['Demo Guest', 'demo.guest@example.com', '555-0104'], e: ['Example Person', 'example.person@example.com', '555-0105'] };
    function mkOrder(who, ful, skus, o) {
      const [name, email, phone] = people[who]; const items = skus.map(mkItem).filter(Boolean);
      const items_cents = items.reduce((n, i) => n + i.price_cents, 0); const shipping_cents = ful === 'ship' ? (o.priority ? 985 : 650) : 0; const id = ++state.seq;
      const order = { id, token: hex(16), number: 'TK-' + id, status: 'paid', created_at: new Date(now - o.days * DAY).toISOString(), paid_at: new Date(now - o.days * DAY + 60000).toISOString(), name, email, phone: '630-' + phone,
        fulfillment: ful, ship_to: ful === 'ship' ? { name, street1: '123 Example St', street2: '', city: 'Anytown', state: 'IL', zip: '60000' } : null, items, items_cents, shipping_cents, tax_cents: 0, refunded_cents: 0,
        total_cents: items_cents + shipping_cents, fulfillment_status: o.fs || 'unfulfilled', tracking: o.tracking || null, card: { brand: 'VISA', last4: '1111' }, test_payment: true, notes: o.notes || '', payment_ref: 'demo_pay_' + hex(6),
        shipping_rate: ful === 'ship' ? (o.priority ? 'Priority Mail' : 'Ground Advantage') : '', carrier: ful === 'ship' ? 'USPS' : '', label: o.label || { status: 'none' }, refunds: [], commission_cents: 0, commission_refunded_cents: 0 };
      state.orders.unshift(order); return order;
    }
    const trk = n => { const num = '94001118992230' + n; return { carrier: 'USPS', number: num, url: SHOP_DIR + 'demo-label.html?n=TK&t=' + num }; };
    const o1 = mkOrder('a', 'ship', ['T12344', 'T1261105'], { days: 5, fs: 'delivered', tracking: trk(1111), label: { status: 'purchased', cost_cents: 550, url: SHOP_DIR + 'demo-label.html?n=TK-1001&t=940011189922301111' }, notes: 'Sample order: shipped and delivered.' });
    mkOrder('b', 'pickup', ['T2261100'], { days: 2, fs: 'unfulfilled' });
    mkOrder('c', 'ship', ['T3261101'], { days: 1, priority: true });
    const o4 = mkOrder('d', 'pickup', ['T1261101'], { days: 4, fs: 'picked_up' });
    const o5 = mkOrder('e', 'ship', ['T3261108', 'T3261109'], { days: 3, fs: 'shipped', tracking: trk(2222), label: { status: 'purchased', cost_cents: 550, url: SHOP_DIR + 'demo-label.html?n=TK-1005&t=940011189922302222' } });
    const refundOf = (o, amount, skus, reason) => { const share = skus.length === o.items.length ? bpsOf(o.items_cents, 1000) : bpsOf(o.items.filter(i => skus.includes(i.sku)).reduce((n, i) => n + i.price_cents, 0), 1000);
      o.refunds.push({ id: o.refunds.length + 1, key: '', square_refund_id: 'demo_rf_' + hex(5), amount_cents: amount, commission_cents: share, status: 'COMPLETED', origin: 'admin', reason, skus, created_at: new Date(now - DAY).toISOString() });
      o.refunded_cents += amount; o.commission_refunded_cents += share; o.items.forEach(i => { if (skus.includes(i.sku)) i.refunded = true; }); };
    refundOf(o4, o4.total_cents, o4.items.map(i => i.sku), 'Customer changed her mind (sample)'); o4.status = 'refunded';
    refundOf(o5, o5.items[1].price_cents, [o5.items[1].sku], 'Small stain found (sample)'); o5.status = 'partially_refunded';
    a.pstate[o5.items[1].sku] = { status: 'sold', source: 'site', order_id: o5.id, reason: 'Sold on the website (' + o5.number + ') — refunded, not restocked', updated_at: nowIso() };
    // consignors: Jane Sample (40%), Pat Example (50%), Alex Demo (40%, one piece at 50%)
    const mkC = (n, name, email, phone, cno, split) => { const c = { id: ++a.seq.c, number: n, name, email, phone, contract_no: cno, address: '123 Example St\nAnytown, IL 60000', contract_date: isoDate(now - 60 * DAY), contract_expires: isoDate(now + 300 * DAY),
      split_pct: split, notes: 'Made-up sample consignor.', status: 'active', portal_key: null, created_at: nowIso() }; a.consignors.push(c); event(c.id, null, 'added', 'Consignor added'); return c; };
    const jane = mkC('TK9001', 'Jane Sample', 'jane.sample@example.com', '555-0121', '9001', 40), pat = mkC('TK9002', 'Pat Example', 'pat.example@example.com', '555-0122', '9002', 50), alex = mkC('TK9003', 'Alex Demo', 'alex.demo@example.com', '555-0123', '9003', 40);
    const mkI = (c, no, desc, price, dept, o) => { const it = Object.assign({ id: ++a.seq.i, consignor_id: c.id, item_no: no, description: desc, price_cents: price, department: dept, location: 'TK', notes: null, split_pct: null, received_at: isoDate(now - 30 * DAY), sku: null, status: 'in_store', created_at: nowIso() }, o || {});
      if (it.sku && !findProduct(it.sku)) it.sku = null; a.items.push(it); event(c.id, no, 'item_added', desc); return it; };
    const i1 = mkI(jane, 'T12341', 'Black velvet evening gown', 12900, 'Gowns', { sku: 'T12341' }); mkI(jane, 'T12342', 'Floral silk wrap dress', 7400, 'Dresses', { sku: 'T12342' });
    mkI(jane, 'TK-J-003', 'Navy wool skirt size 8', 3200, 'Dresses'); mkI(jane, 'TK-J-004', 'Cream silk blouse size S', 2800, 'Tops');
    mkI(pat, 'T12343', 'Camel wool coat', 9800, 'Coats', { sku: 'T12343' }); const i6 = mkI(pat, 'T12344', 'Dark wash straight jeans', 3800, 'Pants', { sku: 'T12344' }); mkI(pat, 'TK-P-001', 'Silk scarf', 2500, 'Accessories');
    mkI(alex, 'T12345', 'Cream cashmere sweater', 5600, 'Tops', { sku: 'T12345', split_pct: 50 }); const i9 = mkI(alex, 'T12346', 'Leather crossbody bag', 6400, 'Handbags', { sku: 'T12346' });
    const brooch = mkI(alex, 'TK-A-002', 'Vintage brooch', 1800, 'Jewelry'); brooch.status = 'returned'; event(alex.id, 'TK-A-002', 'returned', 'Given back to the consignor'); mkI(alex, 'TK-A-003', 'Black ankle boots size 8', 4200, 'Shoes');
    // sales: Jane's gown sold in the store and paid by check; Pat's jeans sold on the website (order TK-1001); Alex's bag sold by hand, not paid yet
    recordSale(i1, 'manual', 'manual-demo1', 12900, 0, isoDate(now - 9 * DAY), 'Sold in the store (sample)', null);
    a.pstate['T12341'] = { status: 'sold', source: 'admin', reason: 'Sold in the store (marked by the boutique)', updated_at: nowIso() };
    const chk = { id: ++a.seq.p, consignor_id: jane.id, amount_cents: consignCut(12900, 40), check_no: '1001', paid_at: isoDate(now - 6 * DAY), note: null, created_at: nowIso() }; a.payouts.push(chk);
    a.sales.forEach(s => { if (s.consignor_id === jane.id && s.status === 'sold') s.payout_id = chk.id; }); event(jane.id, null, 'paid', `Check 1001 for ${money(chk.amount_cents)} on ${chk.paid_at}`);
    recordSale(i6, 'website', o1.number, 3800, 0, o1.paid_at, null, null);
    recordSale(i9, 'manual', 'manual-demo2', 6400, 0, isoDate(now - 3 * DAY), 'Sold in the store (sample)', null);
    a.pstate['T12346'] = { status: 'sold', source: 'admin', reason: 'Sold in the store (marked by the boutique)', updated_at: nowIso() };
    // the weekly "Item search" page: one item sold at the Tomcat store, one pending piece waiting for its photos
    const sp = findProduct('T2261102'); if (sp) { const v = prodView(sp);
      a.soldLog['T2261102'] = { item: 'T2261102', name: v.name, location: 'Tomcat', soldAt: now - 2 * DAY, saleAmount: (v.price_cents / 100).toFixed(2), splitPercent: '40', image: v.image_card || v.image, fulfillment: 'pickup' };
      a.pstate['T2261102'] = { status: 'sold', source: 'admin', reason: 'Sold in store (Tomcat)', updated_at: nowIso() }; }
    a.held['T9262004'] = { item_number: 'T9262004', saved: nowIso(), name: 'Sample linen blazer size M', price: '34', main_category: 'Women Jackets/Coats', sub_category: 'Short Wool Coats', size: 'M', color: 'Beige', brand: 'Sample', condition: 'Pre-owned – excellent', photo_key: 't9262004', details: 'Made-up pending piece: add photos named t9262004a.jpg to put it on the website.', needs: ['photos'] };
    state.seq = Math.max(state.seq, 1005);
  });

  // ---- page furniture: Reset demo, sign-in hint, template download, photo service worker ------------------------------------------------------
  async function resetAll() {
    if (!window.confirm('Reset the demo? Everything you added in it is removed and the made-up sample data comes back.')) return;
    try { if ('caches' in window) await caches.delete(PHOTO_CACHE); } catch { /* none */ }
    ['tk_tasklist_v1', PORTAL_KEY].forEach(k => { try { localStorage.removeItem(k); } catch { /* fine */ } });
    try { Object.keys(sessionStorage).filter(k => k.startsWith('thomkat.demo')).forEach(k => sessionStorage.removeItem(k)); } catch { /* fine */ }
    D.reset(); location.reload();
  }
  D.resetAll = resetAll;
  const TEMPLATE = 'Item number,Name,Price,Category,Sub category,Size,Color,Brand,Condition,Type,Material,Description,Details,Location,Weight,Length,Width,Height,Photos\nT9262010,Sample wool blazer size M,45,Women Jackets/Coats,Short Wool Coats,M,Navy,Sample,Pre-owned – excellent,Blazer,Wool,,Made-up example row,TK,2,15,11,3,t9262010a.jpg\n';
  function furniture() {
    const path = location.pathname; const admin = /\/shop\/admin\//.test(path); const portal = /\/consignor\.html$/.test(path);
    if (!admin && !portal) return;
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = SHOP_DIR + 'demo-admin.css'; document.head.appendChild(css);
    const bar = document.createElement('div'); bar.className = 'tkdemo-bar'; bar.setAttribute('role', 'note');
    const text = document.createElement('span'); text.textContent = admin ? 'DEMO: made-up sample data, saved only in this browser. Nothing here is real.' : 'DEMO: a made-up consignor account. Nothing here is real.'; bar.append(text);
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'tkdemo-reset'; reset.id = 'tkdemoReset'; reset.textContent = 'Reset demo'; reset.addEventListener('click', resetAll); bar.append(reset);
    document.body.insertBefore(bar, document.body.firstChild);
    const form = document.getElementById('loginForm');
    if (form) { const p = document.createElement('p'); p.className = 'tkdemo-hint'; p.innerHTML = 'This is a demo of the real admin, on made-up data. The password is <b>demo</b>.'; form.insertBefore(p, form.firstChild); }
    document.addEventListener('click', e => {   // "Download the Excel template" is a plain link to the PHP backend: give a small CSV instead
      const link = e.target.closest && e.target.closest('a[href*="template.xlsx"]'); if (!link) return; e.preventDefault();
      const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' })); const dl = document.createElement('a'); dl.href = url; dl.download = 'ThomKat pieces template (demo).csv'; document.body.appendChild(dl); dl.click(); dl.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, true);
  }
  if (document.body) furniture(); else document.addEventListener('DOMContentLoaded', furniture);
  // Photos added in the demo are kept in the browser's Cache and served to the page by this tiny service worker (no server involved).
  if ('serviceWorker' in navigator) { try { navigator.serviceWorker.register(SITE + 'demo-sw.js', { scope: SITE }).catch(() => {}); } catch { /* optional */ } }
})();
