// ThomKat shop admin: orders (labels, refunds, fulfillment), pieces + eBay links, commission, setup.
(function () {
  'use strict';
  const API = new URL('../api/', location.href).href;
  const $ = id => document.getElementById(id);
  const money = cents => (cents < 0 ? '-$' : '$') + (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const when = iso => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
  let csrf = null;
  let status = null;
  let orderFilter = 'all';
  let pieceFilter = 'all';
  let products = [];
  let currentOrderId = null;
  const extraTabs = {};   // tabs added by other scripts (consignors.js) through window.TKAdmin

  /** Tiny DOM builder: el('div', {class: 'x', onclick: fn}, 'text', childNode, ...). Text is never parsed as HTML. */
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  // Product photos are site paths (products/img/…) or full eBay photo links for imported eBay pieces.
  const imageSrc = path => /^https:\/\//.test(path) ? path : '../../' + path;
  async function api(path, options = {}) {
    const method = options.method || 'GET';
    const headers = { Accept: 'application/json' };
    if (method !== 'GET') { headers['Content-Type'] = 'application/json'; if (csrf) headers['X-CSRF-Token'] = csrf; }
    const response = await fetch(API + path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(options.body || {}), credentials: 'same-origin', cache: 'no-store' });
    let data = {};
    try { data = await response.json(); } catch { data = {}; }
    if (response.status === 401 && !path.startsWith('admin/login')) { showLogin(); }
    if (!response.ok || data.ok === false) throw Object.assign(new Error(data.error || `Request failed (${response.status})`), { code: data.code, data });
    return data;
  }

  function flash(id, text, kind = 'info') {
    const box = $(id);
    box.className = 'msg ' + kind;
    box.textContent = text;
    box.hidden = !text;
  }
  const appError = error => flash('appError', error.message || String(error), 'error');

  // ---- sign in -------------------------------------------------------------------------------------
  function showLogin() {
    $('app').hidden = true;
    $('login').hidden = false;
    $('password').focus();
  }
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    flash('loginError', '');
    try {
      const data = await api('admin/login', { method: 'POST', body: { password: $('password').value } });
      csrf = data.csrf;
      $('password').value = '';
      showApp();
    } catch (error) {
      flash('loginError', error.message, 'error');
    }
  });
  $('logout').addEventListener('click', async () => {
    try { await api('admin/logout', { method: 'POST' }); } catch { /* already out */ }
    csrf = null;
    showLogin();
  });

  async function showApp() {
    $('login').hidden = true;
    $('app').hidden = false;
    await loadStatus();
    selectTab(location.hash.replace('#', '') || 'orders');
  }

  async function loadStatus() {
    try {
      status = (await api('admin/status')).status;
      const badge = $('modeBadge');
      badge.hidden = status.shop_mode === 'live' && status.square.mode === 'live';
      badge.textContent = `Test mode · Square ${status.square.mode} · shipping ${status.shipping.provider}`;
      $('warnings').replaceChildren(...status.warnings.map(w => el('div', { class: 'msg' }, '⚠ ', w)));
    } catch (error) { appError(error); }
  }

  // ---- tabs ----------------------------------------------------------------------------------------
  function selectTab(name) {
    if (!document.querySelector(`[data-panel="${name}"]`)) name = 'orders';
    document.querySelectorAll('[role="tab"]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.tab === name)));
    document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
    history.replaceState(null, '', '#' + name);
    flash('appError', '');
    ({ orders: loadOrders, pieces: loadPieces, commission: loadCommission, setup: loadSetup, ...extraTabs })[name]();
  }
  document.querySelectorAll('[role="tab"]').forEach(tab => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));

  // ---- orders --------------------------------------------------------------------------------------
  const statusBadge = s => el('span', { class: 'badge ' + ({ paid: 'ok', refunded: 'bad', partially_refunded: 'pink', failed: 'bad', pending: 'test' }[s] || '') }, s.replace('_', ' '));
  const fulfillLabel = { unfulfilled: 'not shipped', label_created: 'label ready', shipped: 'shipped', delivered: 'delivered', ready_for_pickup: 'ready for pickup', picked_up: 'picked up' };

  document.querySelectorAll('#orderFilters .chip').forEach(chip => chip.addEventListener('click', () => {
    document.querySelectorAll('#orderFilters .chip').forEach(c => c.classList.toggle('on', c === chip));
    orderFilter = chip.dataset.filter;
    loadOrders();
  }));
  $('reloadOrders').addEventListener('click', () => loadOrders());

  async function loadOrders() {
    try {
      const { orders } = await api('admin/orders?filter=' + encodeURIComponent(orderFilter));
      $('orderList').replaceChildren(...(orders.length ? orders.map(o => el('button', { class: 'order' + (o.id === currentOrderId ? ' on' : ''), type: 'button', 'data-id': o.id, onclick: () => openOrder(o.id) },
        el('span', { class: 'top-line' }, el('span', {}, o.number, ' · ', o.name || ''), el('span', { class: 'money' }, money(o.total_cents))),
        el('span', { class: 'items' }, o.items.join(', ')),
        el('span', { class: 'badges' }, statusBadge(o.status),
          el('span', { class: 'badge dim' }, o.fulfillment === 'pickup' ? 'pickup' : 'ship'),
          o.status !== 'failed' ? el('span', { class: 'badge dim' }, fulfillLabel[o.fulfillment_status] || o.fulfillment_status) : null,
          o.payment_mode !== 'live' ? el('span', { class: 'badge test' }, 'test') : null,
          el('span', { class: 'badge dim' }, when(o.created_at)))))
        : [el('p', { class: 'muted' }, 'No orders here yet.')]));
      if (currentOrderId) openOrder(currentOrderId, true);
    } catch (error) { appError(error); }
  }

  async function openOrder(id, quiet = false) {
    currentOrderId = id;
    document.querySelectorAll('.order').forEach(b => b.classList.toggle('on', Number(b.dataset.id) === id));
    try {
      const { order } = await api('admin/orders/' + id);
      renderOrder(order);
      if (!quiet && window.matchMedia('(max-width: 900px)').matches) $('orderDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { if (!quiet) appError(error); }
  }

  const inFlight = new Set();   // one request per action at a time: a double tap must not buy two labels
  async function orderAction(path, body, confirmText) {
    if (inFlight.has(path)) return;
    if (confirmText && !window.confirm(confirmText)) return;
    inFlight.add(path);
    try {
      const data = await api(path, { method: 'POST', body });
      renderOrder(data.order);
      loadOrders();
      return data;
    } catch (error) {
      appError(error);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      inFlight.delete(path);
    }
  }

  function renderOrder(o) {
    const box = $('orderDetail');
    const a = o.address;
    const c = o.commission;
    const base = `admin/orders/${o.id}`;
    const parts = [
      el('div', { class: 'bar' }, el('h2', {}, `Order ${o.number}`), el('span', { class: 'badges' }, statusBadge(o.status), o.test_payment ? el('span', { class: 'badge test' }, 'test payment') : null)),
      el('p', { class: 'muted' }, `Placed ${when(o.created_at)}`, o.paid_at ? ` · paid ${when(o.paid_at)}` : '', o.payment_error ? ` · ${o.payment_error}` : ''),
      el('table', { class: 'items-table' }, el('tbody', {}, o.items.map(i => el('tr', {},
        el('td', {}, i.image ? el('img', { src: imageSrc(i.image), alt: '' }) : ''),
        el('td', {}, el('strong', {}, i.name), el('br'), el('span', { class: 'muted' }, 'SKU ' + i.sku), i.refunded ? el('span', { class: 'badge bad' }, ' refunded') : ''),
        el('td', { class: 'money' }, money(i.price_cents)))))),
      el('dl', { class: 'kv' },
        el('dt', {}, 'Pieces'), el('dd', { class: 'money' }, money(o.items_cents)),
        el('dt', {}, o.fulfillment === 'pickup' ? 'Pickup' : 'Shipping'), el('dd', {}, el('span', { class: 'money' }, money(o.shipping_cents)), o.rate ? ` · ${o.rate.provider} ${o.rate.service}` : ''),
        o.tax_cents ? [el('dt', {}, 'Sales tax'), el('dd', { class: 'money' }, money(o.tax_cents))] : null,
        el('dt', {}, 'Total'), el('dd', { class: 'money' }, el('strong', {}, money(o.total_cents))),
        o.refunded_cents ? [el('dt', {}, 'Refunded'), el('dd', { class: 'money' }, money(o.refunded_cents))] : null),
      el('div', { class: 'section' }, el('h3', {}, 'Customer'),
        el('dl', { class: 'kv' },
          el('dt', {}, 'Name'), el('dd', {}, o.name || '—'),
          el('dt', {}, 'Email'), el('dd', {}, o.email ? el('a', { href: 'mailto:' + o.email }, o.email) : '—'),
          el('dt', {}, 'Phone'), el('dd', {}, o.phone ? el('a', { href: 'tel:' + o.phone }, o.phone) : '—'),
          a ? [el('dt', {}, 'Ship to'), el('dd', {}, [a.name, a.street1, a.street2, `${a.city}, ${a.state} ${a.zip}`].filter(Boolean).join('\n').split('\n').flatMap((line, i) => i ? [el('br'), line] : [line]))] : null)),
      el('div', { class: 'section' }, el('h3', {}, 'Your commission'),
        el('dl', { class: 'kv' },
          el('dt', {}, 'Rate'), el('dd', {}, `${c.rate_bps / 100}% of ${money(c.base_cents)}`),
          el('dt', {}, 'Commission'), el('dd', { class: 'money' }, money(c.cents)),
          c.refunded_cents ? [el('dt', {}, 'Given back'), el('dd', { class: 'money' }, money(c.refunded_cents))] : null,
          el('dt', {}, 'Kept'), el('dd', { class: 'money' }, el('strong', {}, money(c.net_cents))),
          el('dt', {}, 'How'), el('dd', {}, c.mode === 'app_fee' ? 'Paid to you automatically — Square deposits it in your Square account' : 'Not paid automatically — Square was not connected, settle by hand'))),
    ];

    if (o.fulfillment === 'ship' && ['paid', 'partially_refunded', 'refunded'].includes(o.status)) {
      const label = o.label;
      const actions = [];
      if (['none', 'error', 'voided'].includes(label.status) && o.status !== 'refunded') actions.push(el('button', { class: 'btn small', type: 'button', onclick: () => orderAction(base + '/label', {}, 'Buy a shipping label for this order now?') }, label.status === 'voided' ? 'Buy a new label' : 'Buy label'));
      if (label.status === 'purchased' && label.url) actions.push(el('a', { class: 'btn small', href: label.url, target: '_blank', rel: 'noopener' }, 'Print label ↗'));
      if (label.status === 'purchased' && o.fulfillment_status !== 'shipped') actions.push(el('button', { class: 'btn ghost small', type: 'button', onclick: () => orderAction(base + '/label/void', {}, 'Void this label? Only do this if it was never used.') }, 'Void label'));
      if (o.fulfillment_status !== 'shipped' && o.status !== 'refunded') actions.push(el('button', { class: 'btn ghost small', type: 'button', onclick: () => orderAction(base + '/fulfillment', { status: 'shipped' }) }, 'Mark shipped'));
      parts.push(el('div', { class: 'section' }, el('h3', {}, 'Shipping'),
        el('dl', { class: 'kv' },
          el('dt', {}, 'Label'), el('dd', {}, { none: 'not bought yet', buying: 'buying…', purchased: 'ready to print', error: 'problem', voided: 'voided', void_pending: 'void requested' }[label.status] || label.status,
            label.cost_cents ? ` · cost ${money(label.cost_cents)}` : ''),
          label.error ? [el('dt', {}, 'Problem'), el('dd', {}, label.error)] : null,
          el('dt', {}, 'Tracking'), el('dd', {}, o.shipping?.tracking_number ? (o.shipping.tracking_url ? el('a', { href: o.shipping.tracking_url, target: '_blank', rel: 'noopener' }, o.shipping.tracking_number) : o.shipping.tracking_number) : '—'),
          el('dt', {}, 'Status'), el('dd', {}, fulfillLabel[o.fulfillment_status] || o.fulfillment_status)),
        el('div', { class: 'row' }, actions)));
    }
    if (o.fulfillment === 'pickup' && ['paid', 'partially_refunded'].includes(o.status)) {
      parts.push(el('div', { class: 'section' }, el('h3', {}, 'Pickup'), el('p', {}, fulfillLabel[o.fulfillment_status] || o.fulfillment_status),
        el('div', { class: 'row' },
          o.fulfillment_status === 'unfulfilled' ? el('button', { class: 'btn small', type: 'button', onclick: () => orderAction(base + '/fulfillment', { status: 'ready_for_pickup' }) }, 'Ready for pickup') : null,
          o.fulfillment_status !== 'picked_up' ? el('button', { class: 'btn ghost small', type: 'button', onclick: () => orderAction(base + '/fulfillment', { status: 'picked_up' }) }, 'Picked up') : null)));
    }
    if (o.refundable_cents > 0) parts.push(el('div', { class: 'section' }, refundForm(o)));
    if (o.refunds.length) {
      parts.push(el('div', { class: 'section' }, el('h3', {}, 'Refunds'),
        el('table', { class: 'table' }, el('thead', {}, el('tr', {}, ['When', 'Amount', 'Commission back', 'Status', 'From'].map(h => el('th', {}, h)))),
          el('tbody', {}, o.refunds.map(r => el('tr', {}, el('td', {}, when(r.created_at)), el('td', { class: 'money' }, money(r.amount_cents)),
            el('td', { class: 'money' }, money(r.commission_cents)), el('td', {}, r.status), el('td', {}, r.origin === 'admin' ? 'this page' : 'Square Dashboard')))))));
    }
    const notes = el('textarea', { 'aria-label': 'Private notes' });
    notes.value = o.notes || '';
    parts.push(el('div', { class: 'section' }, el('h3', {}, 'Private notes'), notes,
      el('div', { class: 'row' }, el('button', { class: 'btn ghost small', type: 'button', onclick: () => orderAction(base + '/notes', { notes: notes.value }) }, 'Save notes')),
      o.square_payment_id ? el('p', { class: 'muted' }, `Square payment ${o.square_payment_id} (${o.payment_mode})`) : null));
    box.replaceChildren(...parts);
  }

  function refundForm(o) {
    const node = $('refundTpl').content.firstElementChild.cloneNode(true);
    const open = o.items.filter(i => !i.refunded);
    const itemsBox = node.querySelector('div.rpart[data-part="items"]');
    open.forEach(i => itemsBox.append(el('label', {}, el('input', { type: 'checkbox', class: 'ritem', value: i.sku, checked: open.length === 1 }), `${i.name} (${money(i.price_cents)})`)));
    if (!open.length) node.querySelector('input[value="items"]').closest('label').hidden = true;
    const voidRow = node.querySelector('.rvoid');
    voidRow.hidden = !(o.label.status === 'purchased' && o.fulfillment_status !== 'shipped');
    const go = node.querySelector('.rgo');
    const preview = node.querySelector('.rpreview');
    let armed = false;
    const mode = () => node.querySelector('input[name="rmode"]:checked').value;
    function compute() {
      const left = o.refundable_cents;
      const c = o.commission;
      const commissionLeft = c.cents - c.refunded_cents;
      let amount = 0;
      let share = 0;
      if (mode() === 'full') { amount = left; share = commissionLeft; }
      if (mode() === 'items') {
        const picked = [...node.querySelectorAll('.ritem:checked')].map(x => x.value);
        const itemCents = open.filter(i => picked.includes(i.sku)).reduce((s, i) => s + i.price_cents, 0);
        const tax = o.items_cents ? Math.round(o.tax_cents * itemCents / o.items_cents) : 0;
        amount = itemCents + tax + (node.querySelector('.rship').checked ? o.shipping_cents : 0);
        share = Math.round(itemCents * c.rate_bps / 10000);
      }
      if (mode() === 'amount') { amount = Math.round(parseFloat(node.querySelector('.ramount').value || '0') * 100); share = o.total_cents ? Math.round(c.cents * amount / o.total_cents) : 0; }
      if (amount >= left) share = commissionLeft;
      share = Math.max(0, Math.min(share, commissionLeft, amount));
      return { amount: Math.min(amount, left), share };
    }
    function update() {
      armed = false;
      node.querySelectorAll('.rpart').forEach(p => { p.hidden = p.dataset.part !== mode(); });
      const { amount, share } = compute();
      preview.textContent = amount > 0 ? `Refund ${money(amount)} to the customer’s card. ${money(share)} of your commission goes back with it${o.commission.mode === 'app_fee' ? ' (Square takes it from your Square balance)' : ''}.` : 'Choose what to refund.';
      go.textContent = 'Review refund';
      go.disabled = amount <= 0;
    }
    node.addEventListener('change', update);
    node.addEventListener('input', update);
    go.addEventListener('click', async () => {
      const { amount } = compute();
      if (!armed) {
        armed = true; go.textContent = `Confirm: refund ${money(amount)}`;
        go.disabled = true; setTimeout(() => { go.disabled = false; }, 900);   // a fast double tap must not confirm by accident
        return;
      }
      go.disabled = true;
      const body = { mode: mode(), restock: node.querySelector('.rrestock').checked, reason: node.querySelector('.rreason').value,
        void_label: !voidRow.hidden && node.querySelector('.rvoidbox').checked, idempotency_key: 'rf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12) };
      if (body.mode === 'items') { body.skus = [...node.querySelectorAll('.ritem:checked')].map(x => x.value); body.include_shipping = node.querySelector('.rship').checked; }
      if (body.mode === 'amount') body.amount_cents = amount;
      const data = await orderAction(`admin/orders/${o.id}/refund`, body);
      if (!data) { update(); return; }   // it failed: the message is at the top; let her try again
      if (data?.refund?.label_void_error) appError(new Error('Refund done, but the label could not be voided: ' + data.refund.label_void_error));
      else if (data) flash('appError', `Refunded ${money(data.refund.amount_cents)} (${data.refund.status}). Commission given back: ${money(data.refund.commission_cents)}.`, 'ok');
    });
    update();
    return node;
  }

  // ---- pieces & eBay ---------------------------------------------------------------------------------
  document.querySelectorAll('#pieceFilters .chip').forEach(chip => chip.addEventListener('click', () => {
    document.querySelectorAll('#pieceFilters .chip').forEach(c => c.classList.toggle('on', c === chip));
    pieceFilter = chip.dataset.filter;
    renderPieces();
  }));
  $('pieceSearch').addEventListener('input', () => renderPieces());
  $('ebaySync').addEventListener('click', () => runEbay(false));
  $('ebayDry').addEventListener('click', () => runEbay(true));
  $('ebayImport').addEventListener('click', async () => {
    const button = $('ebayImport');
    button.disabled = true;
    flash('ebayResult', 'Reading her eBay listings… the first time takes a few minutes.');
    try {
      const { result } = await api('admin/ebay/import', { method: 'POST', body: {} });
      const names = list => list.slice(0, 5).map(x => x.name).join('; ') + (list.length > 5 ? ` and ${list.length - 5} more` : '');
      flash('ebayResult', `${result.listings} active eBay listing(s); ${result.on_site} on the website. `
        + (result.added.length ? `Added ${result.added.length}: ${names(result.added)}. ` : 'Nothing new to add. ')
        + (result.updated.length ? `Updated ${result.updated.length}. ` : '')
        + (result.removed.length ? `Removed ${result.removed.length} that ended on eBay. ` : '')
        + (result.skipped.length ? `Skipped ${result.skipped.length}: ${result.skipped.map(x => `${x.name} (${x.why})`).join('; ')}. ` : '')
        + (result.errors.length ? `Problems: ${result.errors.join('; ')}` : ''), result.errors.length ? 'error' : 'ok');
      loadPieces();
    } catch (error) { flash('ebayResult', error.message, 'error'); } finally { button.disabled = false; }
  });

  async function runEbay(dry) {
    flash('ebayResult', dry ? 'Checking eBay (dry run — nothing changes)…' : 'Checking eBay…');
    try {
      const { result } = await api('admin/ebay/sync', { method: 'POST', body: { dry_run: dry } });
      if (result.skipped) { flash('ebayResult', result.skipped, 'error'); return; }
      const list = dry ? result.would_remove : result.removed;
      flash('ebayResult', `${result.checked} linked listing(s) checked${result.orders_seen ? `, ${result.orders_seen} eBay order line(s) read` : ''}. `
        + (list.length ? `${dry ? 'Would take off' : 'Took off'} the site: ${list.map(x => `${x.sku} (${x.why})`).join('; ')}.` : 'Nothing sold on eBay.')
        + (result.errors.length ? ` Problems: ${result.errors.join('; ')}` : ''), result.errors.length ? 'error' : 'ok');
      loadPieces();
    } catch (error) { flash('ebayResult', error.message, 'error'); }
  }

  async function loadPieces() {
    try {
      products = (await api('admin/products')).products;
      const linked = products.filter(p => p.ebay_item_id).length;
      const last = status?.ebay?.last_sync;
      $('ebaySummary').textContent = `${linked} of ${products.length} pieces linked to eBay. eBay mode: ${status?.ebay?.mode || '?'}`
        + (status?.ebay?.seller_username ? ` · seller ${status.ebay.seller_username}` : ' · seller not set')
        + (last ? ` · last check ${when(last.at)}${last.ok ? '' : ' (with problems)'}` : ' · not checked yet') + '.';
      renderPieces();
    } catch (error) { appError(error); }
  }

  const pieceBadge = p => el('span', { class: 'badge ' + ({ available: 'ok', sold: 'bad', hidden: 'dim', on_hold: 'test', unpriced: 'dim' }[p.status] || '') },
    { available: 'on the site', sold: 'sold', hidden: 'hidden', on_hold: 'on hold', unpriced: 'no price' }[p.status] || p.status);
  const ebayBadge = s => s ? el('span', { class: 'badge ' + ({ available: 'ok', sold: 'bad', gone: 'test', error: 'bad' }[s] || '') }, { available: 'active on eBay', sold: 'sold on eBay', gone: 'ended on eBay', error: 'eBay error' }[s] || s) : null;

  function renderPieces() {
    const query = $('pieceSearch').value.trim().toLowerCase();
    const shown = products.filter(p => {
      if (query && !(`${p.name} ${p.sku}`.toLowerCase().includes(query))) return false;
      if (pieceFilter === 'linked') return Boolean(p.ebay_item_id);
      if (pieceFilter === 'attention') return p.still_on_ebay || p.ebay_status === 'error' || p.ebay_status === 'gone' || p.status === 'on_hold' || ['pending', 'failed'].includes(p.ebay_end_status);
      if (pieceFilter !== 'all') return p.status === pieceFilter;
      return true;
    });
    $('pieces').replaceChildren(...(shown.length ? shown.map(pieceRow) : [el('p', { class: 'muted' }, 'No pieces match.')]));
  }

  async function updatePiece(sku, body, note) {
    try {
      const data = await api('admin/products/' + encodeURIComponent(sku), { method: 'POST', body });
      products = products.map(p => (p.sku === sku ? data.product : p));
      renderPieces();
      const check = data.ebay_check;
      if (check) flash('ebayResult', `${sku}: ${check.title ? `“${check.title}” — ` : ''}${check.detail}${check.warning ? ' ⚠ ' + check.warning : ''}`, check.state === 'error' || check.warning ? 'error' : 'ok');
      else if (note) flash('ebayResult', note, 'ok');
    } catch (error) { flash('ebayResult', `${sku}: ${error.message}`, 'error'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  }

  function pieceRow(p) {
    const ebayInput = el('input', { value: p.ebay_item_id || '', placeholder: 'Paste the eBay link or item number', 'aria-label': `eBay listing for ${p.name}` });
    const found = el('div', { class: 'found' });
    const keep = el('input', { type: 'checkbox', checked: p.keep_on_site, onchange: event => updatePiece(p.sku, { keep_on_site: event.target.checked }, 'Saved.') });
    const dims = ['weight_lb', 'length_in', 'width_in', 'height_in'].map(key => el('input', { type: 'number', step: '0.1', min: '0', value: p[key], 'aria-label': key, 'data-key': key }));
    const actions = [];
    if (p.status !== 'available' && p.status !== 'on_hold') actions.push(el('button', { class: 'btn ghost small', type: 'button', onclick: () => updatePiece(p.sku, { status: 'available' }, `${p.sku} is back on the site.`) }, 'Put back on site'));
    if (p.status === 'available') {
      actions.push(el('button', { class: 'btn ghost small', type: 'button', onclick: () => window.confirm(`Mark “${p.name}” as sold (sold in the store)? It comes off the website.`) && updatePiece(p.sku, { status: 'sold' }, `${p.sku} marked sold.`) }, 'Sold in store'));
      actions.push(el('button', { class: 'btn ghost small', type: 'button', onclick: () => updatePiece(p.sku, { status: 'hidden' }, `${p.sku} hidden.`) }, 'Hide'));
    }
    return el('div', { class: 'piece' + (p.still_on_ebay ? ' alert' : '') },
      p.image ? el('img', { src: imageSrc(p.image), alt: '' }) : el('div'),
      el('div', {},
        el('div', { class: 'name' }, p.name),
        el('div', { class: 'sub' }, `SKU ${p.sku} · ${p.price_cents ? money(p.price_cents) : 'no price'}`),
        el('div', { class: 'row' }, pieceBadge(p), p.order_number ? el('span', { class: 'badge dim' }, p.order_number) : null),
        p.reason ? el('div', { class: 'sub' }, p.reason) : null,
        p.ebay_end_status === 'pending' ? el('div', { class: 'msg info' }, p.ebay_end_detail || 'Ending its eBay listing…') : null,
        p.ebay_end_status === 'failed' ? el('div', { class: 'msg error' }, p.ebay_end_detail || 'Could not end it on eBay — end it there by hand.') : null,
        p.still_on_ebay && !['pending', 'failed'].includes(p.ebay_end_status) ? el('div', { class: 'msg error' }, 'Sold here but still listed on eBay — use “End on eBay”.') : null,
        el('div', { class: 'row' }, actions),
        el('details', {}, el('summary', {}, `Box: ${p.weight_lb} lb · ${p.length_in}×${p.width_in}×${p.height_in} in`),
          el('div', { class: 'dims' }, dims.map((input, i) => el('label', {}, ['Weight lb', 'Length in', 'Width in', 'Height in'][i], input))),
          el('button', { class: 'btn ghost small', type: 'button', onclick: () => updatePiece(p.sku, Object.fromEntries(dims.map(d => [d.dataset.key, d.value])), 'Box size saved.') }, 'Save box size'))),
      el('div', { class: 'ebay' },
        el('div', { class: 'row' }, ebayBadge(p.ebay_status), p.ebay_seller ? el('span', { class: 'badge dim' }, p.ebay_seller) : null,
          p.ebay_checked_at ? el('span', { class: 'sub' }, 'checked ' + when(p.ebay_checked_at)) : null),
        el('div', { class: 'row' },
          p.can_list ? el('button', { class: 'btn small', type: 'button', onclick: () => window.TKEbay?.list(p) }, p.ebay_item_id ? 'List on eBay again' : 'List on eBay') : null,
          p.ebay_item_id && p.ebay_status === 'available' ? el('button', { class: 'btn ghost small', type: 'button', onclick: () => window.TKEbay?.end(p) }, 'End on eBay') : null),
        p.ebay_title ? el('div', { class: 'sub' }, '“' + p.ebay_title + '”') : null,
        p.ebay_text ? el('div', { class: 'sub' }, p.ebay_text) : null,
        el('div', { class: 'copy' }, ebayInput, el('button', { class: 'btn small', type: 'button', onclick: () => updatePiece(p.sku, { ebay_item: ebayInput.value }) }, p.ebay_item_id ? 'Save' : 'Link')),
        el('div', { class: 'row' },
          p.ebay_item_id ? el('a', { href: 'https://www.ebay.com/itm/' + p.ebay_item_id, target: '_blank', rel: 'noopener' }, 'Open on eBay ↗') : null,
          p.ebay_item_id ? el('button', { class: 'link', type: 'button', onclick: () => updatePiece(p.sku, { ebay_item: '' }, 'Unlinked.') }, 'Unlink') : null,
          el('button', { class: 'link', type: 'button', onclick: () => findOnEbay(p, found, ebayInput) }, 'Find on eBay')),
        el('label', {}, keep, 'Keep on the site even if eBay sells it'),
        found));
  }

  async function findOnEbay(p, box, input) {
    const words = p.name.replace(/\bsize\b.*$/i, '').split(/\s+/).filter(w => w.length > 2).slice(0, 5).join(' ');
    box.replaceChildren(el('span', { class: 'sub' }, `Searching eBay for “${words}”…`));
    try {
      const { items } = await api('admin/ebay/search?q=' + encodeURIComponent(words));
      box.replaceChildren(...(items.length ? items.map(item => el('button', { type: 'button', onclick: () => { input.value = item.item_id; updatePiece(p.sku, { ebay_item: item.item_id }); } },
        el('strong', {}, item.title), el('br'), el('span', { class: 'sub' }, `${item.price || ''} · item ${item.item_id} — click to link`)))
        : [el('span', { class: 'sub' }, 'No matching listings from the boutique’s eBay account.')]));
    } catch (error) { box.replaceChildren(el('span', { class: 'sub' }, error.message)); }
  }

  // ---- commission ------------------------------------------------------------------------------------
  let squareData = null;
  function renderSquarePeriods() {
    if (!squareData) return;
    const week = $('squarePeriod').value === 'week';
    const rows = (week ? squareData.square_by_week : squareData.square_by_day) || [];
    $('squarePeriodHead').textContent = week ? 'Week starting (Mon)' : 'Day';
    $('squareByPeriod').querySelector('tbody').replaceChildren(...(rows.length
      ? rows.map(r => el('tr', {}, el('td', {}, r.period), el('td', { class: 'money' }, money(r.cents)), el('td', { class: 'money' }, money(r.cash_cents || 0)), el('td', { class: 'money' }, money(r.commission_cents || 0))))
      : [el('tr', {}, el('td', { colspan: 4, class: 'muted' }, 'Nothing recorded yet'))]));
  }
  async function loadCommission() {
    try {
      const { commission: c } = await api('admin/commission');
      const connected = status?.square?.connected;
      $('commissionStats').replaceChildren(
        el('div', { class: 'stat' }, el('p', { class: 'mono' }, 'Square payment'), el('div', { class: 'big' }, money(c.collected_by_square_cents)), el('p', { class: 'muted' }, 'Commission Square already deposited in your Square account (after refunds)')),
        el('div', { class: 'stat' }, el('p', { class: 'mono' }, 'Cash'), el('div', { class: 'big' }, money(c.cash_cents || 0)), el('p', { class: 'muted' }, 'Your share of consignment pieces sold for cash (recorded by hand)')),
        el('div', { class: 'stat' }, el('p', { class: 'mono' }, 'Commission to pay consignors'), el('div', { class: 'big' }, money(c.consignor_owed_cents || 0)), el('p', { class: 'muted' }, `Still owed to consignors for sold pieces (${money(c.consignor_paid_cents || 0)} already paid out)`)));
      squareData = c;
      renderSquarePeriods();
      $('squarePeriod').onchange = renderSquarePeriods;
      $('commissionHow').textContent = connected
        ? 'Square is connected: every website payment carries your commission as a Square “app fee”, which Square deposits in your Square account. When an order is refunded, the same share of the commission goes back — refunds made here say exactly how much; refunds made in the Square Dashboard take it back proportionally (Square’s rule).'
        : 'Square is NOT connected yet, so payments go straight to the shop’s Square account and your commission is only recorded here (“owed”). Connect Square in Setup so Square splits it automatically on every sale and refund.';
      $('ledger').querySelector('tbody').replaceChildren(...c.entries.map(e => el('tr', {}, el('td', {}, when(e.created_at)), el('td', {}, e.order),
        el('td', {}, { earned: 'Sale', reversed: 'Refund', restored: 'Refund failed — restored' }[e.kind] || e.kind), el('td', { class: 'money' }, money(e.amount_cents)),
        el('td', {}, e.mode === 'app_fee' ? 'Square app fee' : 'Recorded only'))));
    } catch (error) { appError(error); }
  }

  // ---- setup -------------------------------------------------------------------------------------------
  function copyField(value) {
    const input = el('input', { value, readonly: true });
    return el('div', { class: 'copy' }, input, el('button', { class: 'btn ghost small', type: 'button', onclick: () => { input.select(); navigator.clipboard?.writeText(value); } }, 'Copy'));
  }
  const line = (label, value) => el('div', { class: 'status-line' }, el('span', { class: 'muted' }, label), el('span', {}, value));
  const yes = (ok, good = 'yes', bad = 'no') => el('span', { class: 'badge ' + (ok ? 'ok' : 'bad') }, ok ? good : bad);

  async function connectLink(provider, box, env) {
    try {
      const data = await api('admin/connect/' + provider, { method: 'POST', body: env ? { env } : {} });
      const real = provider === 'square' && data.env === 'live' && status.square.mode !== 'live';
      box.replaceChildren(el('p', { class: 'muted' }, real
          ? `Open this link, sign in with HER Square login (the boutique’s account, not yours) and tap Allow. It works once, until ${when(data.expires_at)}.`
          : provider === 'ebay'
            ? `Send this link to her (works once, until ${when(data.expires_at)}). She signs in with ONE store’s eBay login and clicks Agree. Make a second link for her other store.`
            : `Send this link to the boutique owner (works once, until ${when(data.expires_at)}). She signs in to Square and taps Allow:`),
        copyField(data.url), el('div', { class: 'row' }, el('a', { class: 'btn small', href: data.url, target: '_blank', rel: 'noopener' }, 'Open it here ↗')));
    } catch (error) { box.replaceChildren(el('p', { class: 'msg error' }, error.message)); }
  }

  /** When the boutique's Square account has several stores: which one gets the website's sales. */
  async function loadLocations(box, env) {
    try {
      const r = await api('admin/square/locations' + (env ? '?env=' + env : ''));
      if (r.locations.length < 2) return;
      const select = el('select', { 'aria-label': 'Square location for website sales' }, r.locations.map(l =>
        el('option', { value: l.id, selected: l.id === r.current, disabled: !l.takes_cards }, l.name + (l.address ? ` · ${l.address}` : '') + (l.takes_cards ? '' : ' (no card payments)'))));
      const save = el('button', { class: 'btn ghost small', type: 'button', onclick: async () => {
        try { await api('admin/square/location', { method: 'POST', body: { location_id: select.value, env } }); loadSetup(); } catch (error) { appError(error); }
      } }, 'Save');
      box.replaceChildren(el('label', {}, 'Website sales go to this store in her Square account', el('div', { class: 'copy' }, select, save)));
    } catch (error) { box.replaceChildren(el('p', { class: 'msg error' }, error.message)); }
  }

  async function loadSetup() {
    await loadStatus();
    const s = status;
    const squareLink = el('div');
    const ebayLink = el('div');
    const locationBox = el('div');
    if (s.square.connected) loadLocations(locationBox);
    // Until checkout takes real money, her real account is connected separately (Square's test mode can
    // only connect sandbox test accounts) and waits for the switch to production.
    const real = s.square.live;
    const realLink = el('div');
    const realLocations = el('div');
    if (real?.connected) loadLocations(realLocations, 'live');
    const disconnect = (env, question) => async () => {
      if (!window.confirm(question)) return;
      try { await api('admin/square/disconnect', { method: 'POST', body: env ? { env } : {} }); loadSetup(); } catch (error) { appError(error); }
    };
    $('setup').replaceChildren(
      el('div', { class: 'card' }, el('h2', {}, 'Square (payments + commission)'),
        line('Mode', el('span', { class: 'badge ' + (s.square.mode === 'live' ? 'ok' : 'test') }, s.square.mode)),
        line('Card form (application ID)', yes(s.square.application_id_set || s.square.mode === 'mock')),
        line('Shop access token + location', yes(s.square.access_token_set || s.square.mode === 'mock')),
        line(real ? 'Test account connected (test payments)' : 'Her Square account connected', yes(s.square.connected, s.square.location_name || 'connected', 'not connected')),
        locationBox,
        line('Commission', s.square.connected ? 'paid to you automatically by Square' : 'only recorded — you settle it by hand'),
        line('Webhook key', yes(s.square.webhook_key_set || s.square.mode === 'mock', 'set', 'not set')),
        real ? el('div', { class: 'section' }, el('h3', {}, 'Her real Square account'),
          el('p', { class: 'muted' }, 'Connect it any time. The website keeps taking test payments until “Checkout payments” is switched to production on the keys page; from then on real sales go to this account.'),
          line('Connected', yes(real.connected, real.location_name || 'connected', 'not connected')),
          realLocations,
          el('div', { class: 'row' },
            el('button', { class: 'btn small', type: 'button', disabled: !real.can_connect, onclick: () => connectLink('square', realLink, 'live') }, real.connected ? 'Connect it again' : 'Connect her real Square account'),
            real.connected ? el('button', { class: 'btn ghost small', type: 'button', onclick: disconnect('live', 'Disconnect her real Square account? It has to be connected again before real sales.') }, 'Disconnect') : null),
          real.can_connect ? null : el('p', { class: 'muted' }, 'Paste the Production keys on the keys page first.'),
          realLink) : null,
        el('p', { class: 'muted' }, 'In the Square Developer Console → OAuth, set the Redirect URL to this on both the Sandbox and the Production tab:'), copyField(s.square.oauth_redirect_url),
        el('p', { class: 'muted' }, 'Webhook URL (events: payment.updated, refund.created, refund.updated, oauth.authorization.revoked):'), copyField(s.square.webhook_url),
        el('div', { class: 'row' },
          el('button', { class: real ? 'btn ghost small' : 'btn small', type: 'button', disabled: !s.square.can_connect, onclick: () => connectLink('square', squareLink) },
            real ? (s.square.connected ? 'New test-account link' : 'Connect a Square test account') : (s.square.connected ? 'New Connect-Square link' : 'Connect Square')),
          s.square.connected ? el('button', { class: 'btn ghost small', type: 'button', onclick: disconnect(null, real
            ? 'Disconnect the Square test account? Test payments fall back to the shop’s own sandbox token.'
            : 'Disconnect the boutique’s Square account? Website payments fall back to the shop token and commission stops being collected automatically.') }, 'Disconnect') : null),
        squareLink),
      el('div', { class: 'card' }, el('h2', {}, 'Shipping (Shippo)'),
        line('Provider', el('span', { class: 'badge ' + (s.shipping.provider === 'shippo' ? 'ok' : 'test') }, s.shipping.provider)),
        line('Shippo token', s.shipping.token),
        line('Carriers offered', s.shipping.carriers),
        line('Labels bought automatically after payment', yes(s.shipping.auto_label)),
        line('Label format', s.shipping.label_format),
        line('Handling fee added to rates', money(s.shipping.handling_cents)),
        line('Free in-store pickup', yes(s.shipping.pickup)),
        line('Ships from', `${s.shipping.from.street1}, ${s.shipping.from.city}, ${s.shipping.from.state} ${s.shipping.from.zip}`)),
      el('div', { class: 'card' }, el('h2', {}, 'eBay'),
        line('Mode', el('span', { class: 'badge ' + (['public', 'seller'].includes(s.ebay.mode) ? 'ok' : 'test') }, s.ebay.mode)),
        line('App keys', yes(s.ebay.keys_set || s.ebay.mode === 'mock')),
        line('Boutique eBay user ID', s.ebay.seller_username || el('span', { class: 'badge bad' }, 'not set')),
        line('Pieces linked to eBay', String(s.ebay.linked)),
        el('div', { class: 'section' }, el('h3', {}, 'Her eBay stores'),
          el('p', { class: 'muted' }, 'Each store signs in once. Then eBay sales come off the website within minutes, website and store sales end the eBay listing, and pieces can be posted to eBay from Pieces & eBay.'),
          ...(s.ebay.stores || []).map(store => el('div', { class: 'status-line' }, el('span', {}, store.username),
            el('span', { class: 'row', style: 'margin:0' },
              store.connected ? yes(store.can_list, 'connected', 'sign in again') : yes(false, '', 'not connected'),
              store.connected ? el('button', { class: 'link', type: 'button', onclick: async () => {
                if (!window.confirm(`Disconnect the eBay store ${store.username}? Sales there stop ending website listings until it signs in again.`)) return;
                try { await api('admin/ebay/disconnect', { method: 'POST', body: { store: store.username } }); loadSetup(); } catch (error) { appError(error); }
              } }, 'Disconnect') : null))),
          (s.ebay.end_waiting || s.ebay.end_failed) ? line('Waiting to end on eBay', `${s.ebay.end_waiting} waiting · ${s.ebay.end_failed} failed`) : null),
        line('Ended listing counts as sold', s.ebay.ended_means_sold ? `yes, after ${s.ebay.ended_confirmations} checks in a row` : 'no'),
        line('Last check', s.ebay.last_sync ? when(s.ebay.last_sync.at) : 'never'),
        el('p', { class: 'muted' }, 'In the eBay developer portal (User Tokens → your RuName), “auth accepted URL”:'), copyField(s.ebay.oauth_accept_url),
        el('p', { class: 'muted' }, 'Privacy policy URL for the same form:'), copyField(s.ebay.privacy_url),
        el('div', { class: 'row' }, el('button', { class: 'btn small', type: 'button', disabled: !s.ebay.can_connect, onclick: () => connectLink('ebay', ebayLink) }, 'Make a sign-in link for her'),
          s.ebay.can_connect ? null : el('span', { class: 'sub' }, 'Paste the RuName on the keys page first.')),
        ebayLink),
      el('div', { class: 'card' }, el('h2', {}, 'Order emails'),
        line('Mode', el('span', { class: 'badge ' + (s.notify.mode === 'resend' || s.notify.mode === 'smtp' ? 'ok' : s.notify.mode === 'log' ? 'test' : 'bad') }, s.notify.mode)),
        line('New-order alerts go to', s.notify.owner_email || el('span', { class: 'badge bad' }, 'not set')),
        line('Sent from', s.notify.from || '—'),
        el('p', { class: 'muted' }, 'Customers get a confirmation, a shipped/ready-for-pickup note and a refund note. “log” only saves them on the server.')),
      el('div', { class: 'card' }, el('h2', {}, 'Money settings'),
        line('Commission', `${s.commission.rate_bps / 100}% of ${s.commission.base}`),
        line('Block checkout until Square is connected', yes(s.commission.require_app_fee)),
        line('Sales tax', s.tax.rate_bps ? `${s.tax.rate_bps / 100}% on pickups + ${s.tax.states} addresses` : el('span', { class: 'badge bad' }, 'off')),
        el('p', { class: 'muted' }, 'These live in the private key file (shop.env) on the server, not on this page.')));
    try {
      const events = await api('admin/events');
      $('runs').querySelector('tbody').replaceChildren(...events.runs.map(r => el('tr', {}, el('td', {}, r.job), el('td', {}, when(r.finished_at || r.started_at)),
        el('td', {}, r.ok === null ? 'running' : r.ok ? `ok · ${r.summary?.checked ?? 0} checked, ${r.summary?.removed?.length ?? 0} removed` : `problems: ${(r.summary?.errors || []).join('; ')}`))));
      $('ebayEvents').querySelector('tbody').replaceChildren(...events.ebay.map(e => el('tr', {}, el('td', {}, when(e.created_at)), el('td', {}, e.sku || ''), el('td', {}, e.event), el('td', {}, e.detail || ''))));
    } catch (error) { appError(error); }
  }
  $('reconcile').addEventListener('click', async () => {
    flash('reconcileResult', 'Checking Square…');
    try {
      const { result } = await api('admin/reconcile', { method: 'POST' });
      flash('reconcileResult', `Checked ${result.refunds_checked} paid order(s); found ${result.refunds_found} refund(s) made in Square; settled ${result.pending_settled} unfinished payment(s).`
        + (result.errors.length ? ' Problems: ' + result.errors.join('; ') : ''), result.errors.length ? 'error' : 'ok');
    } catch (error) { flash('reconcileResult', error.message, 'error'); }
  });

  window.TKAdmin = { api, el, money, when, flash, appError, imageSrc, tabs: extraTabs, reloadStatus: loadStatus, reloadPieces: () => loadPieces(), copyField };

  // ---- start -------------------------------------------------------------------------------------------
  (async () => {
    try {
      const me = await api('admin/me');
      if (me.scope !== 'full') { showLogin(); return; }   // a keys-link sign-in only opens keys.html
      csrf = me.csrf;
      showApp();
    } catch {
      showLogin();
    }
  })();
})();
