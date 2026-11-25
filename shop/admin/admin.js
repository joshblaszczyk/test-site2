// ThomKat shop admin: orders (labels, refunds, fulfillment), pieces + eBay links, sales, setup.
(function () {
  'use strict';
  const API = new URL('../api/', location.href).href;
  const $ = id => document.getElementById(id);
  const money = cents => (cents < 0 ? '-$' : '$') + (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const when = iso => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
  let csrf = null;
  let session = null;   // who is signed in: {scope:'full'} for the owner, {scope:'staff', id, name, perms, check_all, ends_at, remember} for a worker
  let status = null;
  let orderFilter = 'all';
  let orderQuery = '';   // set = the list shows search results (order number, email, name, phone, tracking, item)
  let pieceFilter = 'all';
  let products = [];
  let currentOrderId = null;
  const extraTabs = {};   // tabs added by other scripts (consignors.js) through window.TKAdmin

  // Fallback wording when the server sends a code but no message (the server's own text wins).
  const FRIENDLY = {
    no_permission: 'Ask the owner to turn that on for you.',
    owner_only_field: 'Only the owner can change that.',
    owner_only_piece: 'Only the owner can delete that piece.',
    owner_only_file: 'That’s the consignor workbook. Please give it to the owner.',
    staff_only: 'Staff sign-ins can’t open that. Ask the owner.',
  };
  const isStaff = () => !!session && session.scope === 'staff';
  const isOwner = () => !!session && session.scope === 'full';
  /** Staff switches: the owner can do everything; a worker only what the owner turned on for them. */
  const can = perm => isOwner() || (isStaff() && (session.perms || []).includes(perm));
  /** Who did it, for history lines: 'full'/'owner' -> the owner, 'staff:Maria' -> Maria, '' / 'system' -> nothing. */
  function who(actor) {
    const a = String(actor || '').trim();
    if (!a || a === 'system') return '';
    if (a === 'owner' || a === 'full' || a === 'keys') return 'the owner';
    if (a.startsWith('staff:')) return a.slice(6).trim() || 'staff';
    return a;
  }
  function setSession(scope, staff) {
    session = scope === 'staff' && staff
      ? { scope: 'staff', id: staff.id, name: staff.name || '', perms: Array.isArray(staff.perms) ? staff.perms.slice() : [], check_all: !!staff.check_all, ends_at: staff.ends_at || null, remember: !!staff.remember }
      : scope === 'full' ? { scope: 'full' } : null;
  }

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
    if (response.status === 401 && !path.startsWith('admin/login') && !path.startsWith('admin/staff-login')) { showLogin(isStaff() ? 'expired' : ''); }
    if (!response.ok || data.ok === false) throw Object.assign(new Error(data.error || FRIENDLY[data.code] || `Request failed (${response.status})`), { code: data.code, data });
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
  // Two forms live in #login: the owner's password form and the worker's name + code form. No names are ever listed here.
  let loginMode = 'owner';
  function setLoginMode(mode) {
    loginMode = mode === 'staff' ? 'staff' : 'owner';
    $('loginForm').hidden = loginMode === 'staff';
    $('staffForm').hidden = loginMode !== 'staff';
  }
  function showLogin(reason) {
    $('app').hidden = true;
    $('login').hidden = false;
    if (reason === 'expired') {
      session = null; csrf = null;
      setLoginMode('staff');
      flash('staffError', 'You were signed out. Sign in again.', 'info');
    }
    if (loginMode === 'staff') { ($('staffName').value ? $('staffCode') : $('staffName')).focus(); } else { $('password').focus(); }
  }
  $('toStaff').addEventListener('click', () => { flash('loginError', ''); setLoginMode('staff'); $('staffName').focus(); });
  $('toOwner').addEventListener('click', () => { flash('staffError', ''); setLoginMode('owner'); $('password').focus(); });
  // The owner can send a one-tap link: .../shop/admin/?as=staff#n=Maria&c=482913. The fragment never reaches the server;
  // read it once, fill the form, and wipe it from the address bar. The worker still taps Start shift.
  let linkSignIn = false;
  (function readSignInLink() {
    try {
      if (new URLSearchParams(location.search).get('as') === 'staff') setLoginMode('staff');
      const frag = new URLSearchParams(location.hash.replace(/^#/, ''));
      if (frag.has('n') || frag.has('c')) {
        $('staffName').value = (frag.get('n') || '').slice(0, 30);
        $('staffCode').value = (frag.get('c') || '').replace(/[^0-9 -]/g, '').slice(0, 9);
        setLoginMode('staff');
        linkSignIn = true;
        history.replaceState(null, '', location.pathname + location.search);
      }
    } catch { /* a bad link just shows the empty form */ }
  })();
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    flash('loginError', '');
    try {
      const data = await api('admin/login', { method: 'POST', body: { password: $('password').value } });
      csrf = data.csrf;
      setSession('full');
      $('password').value = '';
      showApp();
    } catch (error) {
      flash('loginError', error.message, 'error');
    }
  });
  $('staffForm').addEventListener('submit', async event => {
    event.preventDefault();
    flash('staffError', '');
    const name = $('staffName').value.trim();
    const code = $('staffCode').value.replace(/[\s-]+/g, '');
    if (!name || !code) { flash('staffError', 'Type your name and your 6-digit code.', 'error'); return; }
    const go = $('staffStart');
    go.disabled = true;
    try {
      const data = await api('admin/staff-login', { method: 'POST', body: { name, code, remember: $('staffRemember').checked } });
      csrf = data.csrf;
      setSession('staff', data.staff);
      $('staffCode').value = '';
      // The page was already showing someone's screens (kicked out mid-shift, or the owner signed out here):
      // start from a clean page so the new worker never sees, or lands on, what was left behind.
      if (appShown) { location.reload(); return; }
      showApp();
    } catch (error) {
      $('staffCode').value = '';
      flash('staffError', error.message || 'That didn’t work. Try again.', 'error');
    } finally {
      go.disabled = false;
    }
  });
  $('logout').addEventListener('click', async () => {
    const wasStaff = isStaff();
    try { await api('admin/logout', { method: 'POST' }); } catch { /* already out */ }
    csrf = null;
    session = null;
    $('staffName').value = ''; $('staffCode').value = '';
    // A worker's phone is wiped clean: a hard reload leaves nothing of this shift in memory.
    if (wasStaff) { location.reload(); return; }
    showLogin();
  });
  // Forgot password: the shop emails a one-time reset link to the boutique's own address.
  $('forgot').addEventListener('click', async () => {
    flash('loginError', '');
    $('forgot').disabled = true;
    try {
      const data = await api('admin/forgot', { method: 'POST', body: {} });
      flash('forgotMsg', `We emailed a reset link to ${data.sent_to}. It works once, for 30 minutes.`, 'info');
    } catch (error) {
      flash('forgotMsg', error.message, 'error');
    } finally {
      $('forgot').disabled = false;
    }
  });

  /** Hide what the person may not use. CSS does the hiding (nothing is ever removed from the page: other scripts click hidden buttons). */
  function applyRole() {
    const body = document.body;
    const staff = isStaff();
    if (staff) body.dataset.role = 'staff'; else delete body.dataset.role;
    for (const perm of ['post', 'edit', 'price', 'delete', 'tasks']) {
      const key = 'can' + perm.charAt(0).toUpperCase() + perm.slice(1);
      if (staff && can(perm)) body.dataset[key] = '1'; else delete body.dataset[key];
    }
    const chip = $('whoAmI');
    chip.hidden = !staff;
    chip.textContent = staff ? session.name : '';
    chip.title = staff && session.ends_at ? 'Your access ends ' + when(session.ends_at) : '';
    $('staffHubEmpty').hidden = !(staff && !['post', 'edit', 'delete', 'tasks'].some(can));
    document.dispatchEvent(new CustomEvent('tk-role'));   // later scripts (weekly-uploads.js) redraw what depends on who is signed in
  }
  // The owner can change a worker's switches at any time; pick the change up when the page comes back to the front.
  let lastRoleCheck = Date.now();
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !isStaff() || Date.now() - lastRoleCheck < 30000) return;
    lastRoleCheck = Date.now();
    try { const me = await api('admin/me'); if (me.scope === 'staff') { setSession('staff', me.staff); applyRole(); } } catch { /* a 401 already showed the sign-in */ }
  });

  let appShown = false;
  async function showApp() {
    appShown = true;
    $('login').hidden = true;
    $('app').hidden = false;
    // The order panel sticks just under the header, whatever height the header wraps to (1024px: 3 rows).
    const topBar = document.querySelector('.top');
    if (topBar && window.ResizeObserver) new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', topBar.offsetHeight + 'px')).observe(topBar);
    applyRole();
    if (!isStaff()) await loadStatus();   // admin/status is the owner's: a worker would only get a red banner
    selectTab(isStaff() ? 'weekly' : (location.hash.replace('#', '') || 'orders'));
  }

  async function loadStatus() {
    try {
      status = (await api('admin/status')).status;
      const badge = $('modeBadge');
      badge.hidden = status.shop_mode === 'live' && status.square.mode === 'live';
      badge.textContent = `Test mode · Square ${status.square.mode} · shipping ${status.shipping.provider}`;
      $('warnings').replaceChildren(...status.warnings.map(w => el('div', { class: 'msg' }, '⚠ ', w)));
      setStaffBadge(status.staff_pending);
    } catch (error) { appError(error); }
  }
  /** The number on the Staff tab: pieces waiting for the owner's OK. */
  function setStaffBadge(n) {
    const badge = $('staffTabCount');
    n = Number(n) || 0;
    badge.hidden = n < 1;
    badge.textContent = n > 99 ? '99+' : String(n);
  }

  // ---- tabs ----------------------------------------------------------------------------------------
  function selectTab(name) {
    if (isStaff()) name = 'weekly';   // a worker only ever has the Weekly uploads hub
    if (!/^[a-z]+$/.test(name) || !document.querySelector(`[data-panel="${name}"]`)) name = 'orders';
    document.querySelectorAll('[role="tab"]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.tab === name)));
    document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
    history.replaceState(null, '', '#' + name);
    flash('appError', '');
    const loader = ({ orders: loadOrders, pieces: loadPieces, sales: loadSales, setup: loadSetup, ...extraTabs })[name];
    // A quick sign-in can finish before the later scripts (weekly-uploads.js, ...) have registered their tab: wait for them.
    if (typeof loader === 'function') loader();
    else if (document.readyState !== 'complete') { window.addEventListener('load', () => selectTab(name), { once: true }); return; }
    if (name === 'orders') window.TKEbayShip?.load();   // eBay orders to ship (ebay-ship.js)
    if (name === 'pieces') window.TKEbayQueue?.load();   // the eBay queue card (ebay-queue.js)
  }
  document.querySelectorAll('[role="tab"]').forEach(tab => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));

  // ---- orders --------------------------------------------------------------------------------------
  const statusBadge = s => el('span', { class: 'badge ' + ({ paid: 'ok', refunded: 'bad', partially_refunded: 'pink', failed: 'bad', pending: 'test' }[s] || '') }, s.replace('_', ' '));
  const fulfillLabel = { unfulfilled: 'not shipped', label_created: 'label ready', shipped: 'shipped', delivered: 'delivered', ready_for_pickup: 'ready for pickup', picked_up: 'picked up' };

  document.querySelectorAll('#orderFilters .chip').forEach(chip => chip.addEventListener('click', () => {
    document.querySelectorAll('#orderFilters .chip').forEach(c => c.classList.toggle('on', c === chip));
    orderFilter = chip.dataset.filter;
    setOrderQuery('');
    loadOrders();
  }));
  $('reloadOrders').addEventListener('click', () => { loadOrders(); window.TKEbayShip?.load(); });
  function setOrderQuery(q) {
    orderQuery = q;
    $('orderSearch').value = q;
    $('orderSearchClear').hidden = !q;
    if (!q) $('orderSearchNote').hidden = true;
    document.querySelectorAll('#orderFilters .chip').forEach(c => c.classList.toggle('on', !q && c.dataset.filter === orderFilter));
  }
  $('orderSearchForm').addEventListener('submit', event => {
    event.preventDefault();
    setOrderQuery($('orderSearch').value.trim());
    loadOrders(true);
  });
  $('orderSearchClear').addEventListener('click', () => { setOrderQuery(''); loadOrders(); });

  async function loadOrders(fromSearch = false) {
    try {
      const { orders } = orderQuery ? await api('admin/orders/search?q=' + encodeURIComponent(orderQuery)) : await api('admin/orders?filter=' + encodeURIComponent(orderFilter));
      if (orderQuery) {
        const note = $('orderSearchNote');
        note.hidden = false;
        note.textContent = orders.length ? `${orders.length} order${orders.length === 1 ? '' : 's'} match “${orderQuery}”.` : `No order matches “${orderQuery}”. Try part of the email, the last 4 digits of the phone, or the order number.`;
        if (fromSearch && orders.length === 1) currentOrderId = orders[0].id;   // one match: open it
      }
      $('orderList').replaceChildren(...(orders.length ? orders.map(o => el('button', { class: 'order' + (o.id === currentOrderId ? ' on' : ''), type: 'button', 'data-id': o.id, onclick: () => openOrder(o.id) },
        el('span', { class: 'top-line' }, el('span', {}, o.number, ' · ', o.name || ''), el('span', { class: 'money' }, money(o.total_cents))),
        el('span', { class: 'items' }, o.items.join(', ')),
        el('span', { class: 'badges' }, statusBadge(o.status),
          o.needs_attention ? el('span', { class: 'badge bad' }, 'needs attention') : null,   // pending over an hour: Square has not answered
          el('span', { class: 'badge dim' }, o.fulfillment === 'pickup' ? 'pickup' : 'ship'),
          o.status !== 'failed' ? el('span', { class: 'badge dim' }, fulfillLabel[o.fulfillment_status] || o.fulfillment_status) : null,
          o.payment_mode !== 'live' ? el('span', { class: 'badge test' }, 'test') : null,
          el('span', { class: 'badge dim' }, when(o.created_at)))))
        : [el('p', { class: 'muted' }, orderQuery ? 'No matches.' : 'No orders here yet.')]));
      if (currentOrderId) openOrder(currentOrderId, true);
    } catch (error) { appError(error); }
  }

  async function openOrder(id, quiet = false) {
    currentOrderId = id;
    document.querySelectorAll('.order').forEach(b => b.classList.toggle('on', Number(b.dataset.id) === id));
    try {
      const { order } = await api('admin/orders/' + id + '/details');   // = the order + its change history
      renderOrder(order);
      if (!quiet && window.matchMedia('(max-width: 900px)').matches) $('orderDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { if (!quiet) appError(error); }
  }

  let lastActionError = null;   // the error of the last orderAction (it returns nothing when it fails)
  const inFlight = new Set();   // one request per action at a time: a double tap must not buy two labels
  async function orderAction(path, body, confirmText) {
    lastActionError = null;
    if (inFlight.has(path)) return;
    if (confirmText && !window.confirm(confirmText)) return;
    inFlight.add(path);
    try {
      const data = await api(path, { method: 'POST', body });
      renderOrder(data.order);
      loadOrders();
      return data;
    } catch (error) {
      lastActionError = error;
      appError(error);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      inFlight.delete(path);
    }
  }

  function renderOrder(o) {
    const box = $('orderDetail');
    const a = o.address;
    const base = `admin/orders/${o.id}`;
    const parts = [
      el('div', { class: 'bar' }, el('h2', {}, `Order ${o.number}`), el('span', { class: 'badges' }, statusBadge(o.status), o.test_payment ? el('span', { class: 'badge test' }, 'test payment') : null)),
      el('p', { class: 'muted' }, `Placed ${when(o.created_at)}`, o.paid_at ? ` · paid ${when(o.paid_at)}` : '', o.payment_error ? ` · ${o.payment_error}` : ''),
      o.status === 'pending' ? el('p', { class: 'msg' + (Date.now() - Date.parse(o.created_at) > 3600e3 ? ' error' : '') },
        'Waiting for Square to confirm the payment; its pieces stay on hold until then. The shop asks Square again every 10 minutes. If this lasts, check that Square is connected (Setup) and look for the payment in the Square Dashboard.') : null,
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
      el('div', { class: 'section' }, el('div', { class: 'bar' }, el('h3', {}, 'Customer'),
          el('button', { class: 'btn ghost small', type: 'button', onclick: event => { event.target.hidden = true; box.querySelector('.oedit').hidden = false; box.querySelector('.oedit input').focus(); } }, 'Edit details')),
        editForm(o),
        el('dl', { class: 'kv' },
          el('dt', {}, 'Name'), el('dd', {}, o.name || '—'),
          el('dt', {}, 'Email'), el('dd', {}, o.email ? el('a', { href: 'mailto:' + o.email }, o.email) : '—'),
          el('dt', {}, 'Phone'), el('dd', {}, o.phone ? el('a', { href: 'tel:' + o.phone }, o.phone) : '—'),
          a ? [el('dt', {}, 'Ship to'), el('dd', {}, [a.name, a.street1, a.street2, `${a.city}, ${a.state} ${a.zip}`].filter(Boolean).join('\n').split('\n').flatMap((line, i) => i ? [el('br'), line] : [line]))] : null),
        o.fulfillment === 'ship' && o.address_checked === 0 ? el('p', { class: 'msg error', id: 'addrNotChecked' }, 'Address not checked: look at it before shipping.') : null,
        o.address_check_note && o.address_checked !== 0 ? el('p', { class: 'muted' }, o.address_check_note) : null),
    ];

    if (o.fulfillment === 'ship' && ['paid', 'partially_refunded', 'refunded'].includes(o.status)) {
      const label = o.label;
      const actions = [];
      // Every piece refunded (an order refunded piece by piece): nothing ships any more; the server refuses a new label too.
      const nothingToShip = o.status === 'refunded' || (o.items.length > 0 && o.items.every(i => i.refunded));
      // After an unclear Shippo answer a label may exist already: say so before buying another one.
      const buyConfirm = /look in Shippo/i.test(label.error || '')
        ? `Shippo may already have made a label for this order. Look in Shippo (Labels) for order ${o.number} first. Buy a new label anyway?`
        : 'Buy a shipping label for this order now?';
      if (['none', 'error', 'voided'].includes(label.status) && !nothingToShip) actions.push(el('button', { class: 'btn small', type: 'button', onclick: () => orderAction(base + '/label', {}, buyConfirm) }, label.status === 'voided' ? 'Buy a new label' : 'Buy label'));
      if (label.status === 'purchased' && label.url) actions.push(el('a', { class: 'btn small', href: label.url, target: '_blank', rel: 'noopener' }, 'Print label ↗'));
      if (label.status === 'purchased' && o.fulfillment_status !== 'shipped') actions.push(el('button', { class: nothingToShip ? 'btn small' : 'btn ghost small', type: 'button', onclick: () => orderAction(base + '/label/void', {}, 'Void this label? Only do this if it was never used.') }, 'Void label'));
      const fixer = label.status === 'purchased' && o.fulfillment_status !== 'shipped' && !nothingToShip ? fixAddressForm(o) : null;
      if (fixer) actions.push(el('button', { class: 'btn ghost small', type: 'button', id: 'fixAddressBtn', onclick: () => { fixer.hidden = !fixer.hidden; } }, 'Fix address + new label'));
      if (o.fulfillment_status !== 'shipped' && !nothingToShip) actions.push(el('button', { class: 'btn ghost small', type: 'button', onclick: () => orderAction(base + '/fulfillment', { status: 'shipped' }) }, 'Mark shipped'));
      parts.push(el('div', { class: 'section' }, el('h3', {}, 'Shipping'),
        nothingToShip && !['shipped', 'delivered'].includes(o.fulfillment_status) ? el('p', { class: 'msg' }, 'Every piece in this order was refunded: nothing to ship.'
          + (label.status === 'purchased' && o.fulfillment_status !== 'shipped' ? ' Void the label to get the postage back.' : '')) : null,
        el('dl', { class: 'kv' },
          el('dt', {}, 'Label'), el('dd', {}, { none: 'not bought yet', buying: 'buying…', purchased: 'ready to print', error: 'problem', voided: 'voided', void_pending: 'void requested', fixing: 'replacing…' }[label.status] || label.status,
            label.cost_cents ? ` · cost ${money(label.cost_cents)}` : ''),
          label.error ? [el('dt', {}, 'Problem'), el('dd', {}, label.error)] : null,
          el('dt', {}, 'Tracking'), el('dd', {}, o.shipping?.tracking_number ? (o.shipping.tracking_url ? el('a', { href: o.shipping.tracking_url, target: '_blank', rel: 'noopener' }, o.shipping.tracking_number) : o.shipping.tracking_number) : '—'),
          el('dt', {}, 'Status'), el('dd', {}, fulfillLabel[o.fulfillment_status] || o.fulfillment_status)),
        el('div', { class: 'row' }, actions), fixer));
    }
    if (o.fulfillment === 'pickup' && ['paid', 'partially_refunded'].includes(o.status)) {
      parts.push(el('div', { class: 'section' }, el('h3', {}, 'Pickup'), el('p', {}, fulfillLabel[o.fulfillment_status] || o.fulfillment_status),
        el('div', { class: 'row' },
          o.fulfillment_status === 'unfulfilled' ? el('button', { class: 'btn small', type: 'button', onclick: () => orderAction(base + '/fulfillment', { status: 'ready_for_pickup' }) }, 'Ready for pickup') : null,
          o.fulfillment_status !== 'picked_up' ? el('button', { class: 'btn ghost small', type: 'button', onclick: () => orderAction(base + '/fulfillment', { status: 'picked_up' }) }, 'Picked up') : null)));
    }
    if (o.review) {
      const r = o.review;
      const text = r.status === 'sent' ? `sent ${when(r.sent_at)}` : r.status === 'off' ? `off (${r.note || 'no review link yet'})`
        : r.status === 'skipped' ? `skipped (${r.note || 'not sent'})` : r.status === 'sending' ? 'sending' : `due ${when(r.due_at)}`;
      parts.push(el('p', { class: 'msg review-line', style: 'font-size:.85em;opacity:.8' }, `Review request: ${text}`));
    }
    if (o.refundable_cents > 0) parts.push(el('div', { class: 'section' }, refundForm(o)));
    if (o.refunds.length) {
      parts.push(el('div', { class: 'section' }, el('h3', {}, 'Refunds'),
        el('table', { class: 'table' }, el('thead', {}, el('tr', {}, ['When', 'Amount', 'Status', 'From'].map(h => el('th', {}, h)))),
          el('tbody', {}, o.refunds.map(r => el('tr', {}, el('td', {}, when(r.created_at)), el('td', { class: 'money' }, money(r.amount_cents)),
            el('td', {}, r.status), el('td', {}, r.origin === 'admin' ? 'this page' : 'Square Dashboard')))))));
    }
    const notes = el('textarea', { 'aria-label': 'Private notes' });
    notes.value = o.notes || '';
    parts.push(el('div', { class: 'section' }, el('h3', {}, 'Private notes'), notes,
      el('div', { class: 'row' }, el('button', { class: 'btn ghost small', type: 'button', onclick: () => orderAction(base + '/notes', { notes: notes.value }) }, 'Save notes')),
      o.square_payment_id ? el('p', { class: 'muted' }, `Square payment ${o.square_payment_id} (${o.payment_mode})`) : null));
    if (Array.isArray(o.history)) parts.push(historyList(o.history));
    box.replaceChildren(...parts);
  }

  // "Fix address + new label": the address is checked like at checkout (Did you mean / apartment needed), then the server voids the old
  // label and buys a new one with the same service. If the old label cannot be voided nothing is bought. Owner only (staff have no order routes).
  function fixAddressForm(o) {
    const a = o.address || {};
    const f = (label, name, value, max) => el('label', {}, label, el('input', { name, value: value ?? '', maxlength: max || 100, autocomplete: 'off' }));
    const answer = el('div', { class: 'addr-answer', 'aria-live': 'polite' });
    const form = el('form', { class: 'oedit afix', hidden: true },
      el('p', { class: 'muted' }, 'Type the corrected address. We check it, void the old label and buy a new one with the same service. Only works while the old label has not been used.'),
      el('div', { class: 'oedit-grid' }, f('Name on package', 'name', a.name || o.name, 80), f('Street', 'street1', a.street1), f('Apt / suite', 'street2', a.street2),
        f('City', 'city', a.city, 60), f('State (2 letters)', 'state', a.state, 2), f('ZIP', 'zip', a.zip, 10)),
      answer,
      el('div', { class: 'row' }, el('button', { class: 'btn small', type: 'submit', id: 'fixAddressGo' }, 'Check address + replace label'),
        el('button', { class: 'btn ghost small', type: 'button', onclick: () => { form.hidden = true; } }, 'Cancel')));
    const read = () => { const v = n => (form.elements[n]?.value ?? '').trim(); return { name: v('name'), street1: v('street1'), street2: v('street2'), city: v('city'), state: v('state').toUpperCase(), zip: v('zip'), country: 'US' }; };
    const lines = x => [x.street1 + (x.street2 ? ' ' + x.street2 : ''), `${x.city}, ${x.state} ${x.zip}`];
    const submit = async (choice, chosenAddress) => {
      const button = form.querySelector('#fixAddressGo');
      button.disabled = true;
      // one choice box only: once a card is picked it collapses to the chosen address (the cards are never shown twice)
      answer.replaceChildren(...(chosenAddress ? [el('p', { class: 'msg info', id: 'fixChosen' }, '✓ Using this address: ' + lines(chosenAddress).join(', '))] : []));
      try {
        const body = { address: read() };
        if (choice) body.address_choice = choice;
        const data = await api(`admin/orders/${o.id}/fix-address`, { method: 'POST', body });
        if (data.done) { renderOrder(data.order); loadOrders(); flash('appError', `Order ${o.number}: address fixed and a new label bought.`, 'ok'); return; }
        const c = data.address_check || {};
        if (c.status === 'invalid') { answer.append(el('p', { class: 'msg error' }, c.message)); button.disabled = false; return; }
        const card = (t, x, choice, id) => el('button', { class: 'addr-card', type: 'button', id, 'aria-pressed': 'false', onclick: () => submit(choice, x) }, el('strong', {}, t), ...lines(x).flatMap(l => [el('br'), l]), el('br'), el('em', {}, choice === 'suggested' ? 'Tap to use this' : 'Tap to keep mine'));
        answer.append(el('p', { class: 'msg info' }, c.status === 'suggest' ? 'Did you mean…?' : c.message),
          el('div', { class: 'addr-cards' }, card('You typed', c.entered, 'mine', 'fixKeepMine'), c.suggestion ? card('Suggested', c.suggestion, 'suggested', 'fixUseThis') : null));
        button.disabled = false;
      } catch (error) { appError(error); button.disabled = false; window.scrollTo({ top: 0, behavior: 'smooth' }); openOrder(o.id, true); }
    };
    form.addEventListener('submit', event => { event.preventDefault(); submit(null); });
    return form;
  }

  // Edit who and where the order goes (name, email, phone, ship-to address, carrier/tracking): admin/orders/<id>/details.
  function editForm(o) {
    const a = o.address || {};
    const sh = o.shipping || {};
    const f = (label, name, value, extra = {}) => el('label', {}, label, el('input', { name, value: value ?? '', maxlength: extra.max || 120, type: extra.type || 'text', autocomplete: 'off', placeholder: extra.ph || '' }));
    const form = el('form', { class: 'oedit', hidden: true },
      el('div', { class: 'oedit-grid' }, f('Name', 'name', o.name, { max: 80 }), f('Email', 'email', o.email, { type: 'email', max: 120 }), f('Phone', 'phone', o.phone, { max: 30 })),
      o.fulfillment === 'ship' ? el('fieldset', {}, el('legend', {}, 'Ship to'),
        el('div', { class: 'oedit-grid' }, f('Name on package', 'a_name', a.name, { max: 80 }), f('Street', 'a_street1', a.street1), f('Apt / suite', 'a_street2', a.street2),
          f('City', 'a_city', a.city, { max: 80 }), f('State (2 letters)', 'a_state', a.state, { max: 2 }), f('ZIP', 'a_zip', a.zip, { max: 10 }))) : null,
      o.fulfillment === 'ship' ? el('fieldset', {}, el('legend', {}, 'Carrier & tracking'),
        el('div', { class: 'oedit-grid' }, f('Carrier', 'carrier', sh.carrier, { max: 40 }), f('Service', 'service', sh.service, { max: 60 }),
          f('Tracking number', 'tracking_number', sh.tracking_number, { max: 60 }), f('Tracking link', 'tracking_url', sh.tracking_url, { max: 300, ph: 'https://…' }))) : null,
      el('div', { class: 'row' }, el('button', { class: 'btn small', type: 'submit' }, 'Save details'),
        el('button', { class: 'btn ghost small', type: 'button', onclick: () => openOrder(o.id, true) }, 'Cancel')));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const v = name => (form.elements[name]?.value ?? '').trim();
      const body = { name: v('name'), email: v('email'), phone: v('phone') };
      if (o.fulfillment === 'ship') {
        body.address = { name: v('a_name'), street1: v('a_street1'), street2: v('a_street2'), city: v('a_city'), state: v('a_state').toUpperCase(), zip: v('a_zip'), country: 'US' };
        Object.assign(body, { carrier: v('carrier'), service: v('service'), tracking_number: v('tracking_number'), tracking_url: v('tracking_url') });
      }
      const button = form.querySelector('button[type=submit]');
      button.disabled = true;
      try {
        const data = await api(`admin/orders/${o.id}/details`, { method: 'POST', body });
        renderOrder(data.order);
        loadOrders();
        flash('appError', `Order ${o.number} saved.`, 'ok');
      } catch (error) { appError(error); button.disabled = false; window.scrollTo({ top: 0, behavior: 'smooth' }); }
    });
    return form;
  }

  const HISTORY_LABELS = { name: 'Name', email: 'Email', phone: 'Phone', notes: 'Notes', fulfillment_status: 'Status', carrier: 'Carrier', service: 'Service', tracking_number: 'Tracking number', tracking_url: 'Tracking link',
    address_name: 'Ship-to name', address_street1: 'Street', address_street2: 'Apt / suite', address_city: 'City', address_state: 'State', address_zip: 'ZIP' };
  function historyList(h) {
    return el('details', { class: 'section ohistory' }, el('summary', {}, `Change history${h.length ? ` (${h.length})` : ''}`),
      h.length ? el('ul', {}, h.map(r => el('li', {}, el('strong', {}, HISTORY_LABELS[r.field] || r.field), ' ', el('s', {}, r.old || '(blank)'), ' → ', r.new || '(blank)',
        el('span', { class: 'muted' }, ` · ${when(r.at)}`)))) : el('p', { class: 'muted' }, 'Not edited yet.'));
  }

  /** Opens one order in the Orders tab (used by Find & edit). */
  function showOrder(id) {
    currentOrderId = Number(id);
    selectTab('orders');
  }

  function refundForm(o) {
    const node = $('refundTpl').content.firstElementChild.cloneNode(true);
    const open = o.items.filter(i => !i.refunded);
    const itemsBox = node.querySelector('div.rpart[data-part="items"]');
    open.forEach(i => itemsBox.append(el('label', {}, el('input', { type: 'checkbox', class: 'ritem', value: i.sku, checked: open.length === 1 }), `${i.name} (${money(i.price_cents)})`)));
    if (!open.length) node.querySelector('input[value="items"]').closest('label').hidden = true;
    // One piece left (most orders are one piece): refunding it means the whole order, so that is the default (shipping and the label included).
    if (open.length === 1) node.querySelector('input[name="rmode"][value="full"]').checked = true;
    // A piece the customer already has (shipped, delivered, picked up) is not here to sell again: "put back on the website" starts unticked.
    if (['shipped', 'delivered', 'picked_up'].includes(o.fulfillment_status)) node.querySelector('.rrestock').checked = false;
    const voidRow = node.querySelector('.rvoid');
    voidRow.hidden = !(o.label.status === 'purchased' && o.fulfillment_status !== 'shipped');
    // "Also relist on eBay (…)": offered only when a piece this refund puts back on the website had an eBay listing that can go up again
    // (i.had_ebay; the server decides). The store is named per piece (i.relist_label): "Store 1" for pieces the website posted (a new listing
    // through the queue), "her store <name>" for pieces imported from her eBay store (eBay relists the ended listing in that store).
    // Ticked by default; hidden and cleared while "put back on the website" is unticked.
    const restockBox = node.querySelector('.rrestock');
    const relistTo = o.ebay_relist_to || null;
    const relistBox = el('input', { type: 'checkbox', class: 'rrelistbox' });
    const relistText = el('span', {}, ` Also relist on eBay (${relistTo?.label || 'Store 1'})`);
    const relistRow = el('label', { class: 'rrelist', hidden: true }, relistBox, relistText);
    restockBox.closest('label').after(relistRow);
    let relistWanted = true;
    relistBox.addEventListener('change', () => { relistWanted = relistBox.checked; });
    const go = node.querySelector('.rgo');
    const preview = node.querySelector('.rpreview');
    let armed = false;
    // The void-label box follows the refund kind (ticked for the whole order, or when every piece left is ticked) until she changes it by hand;
    // "Also refund shipping" follows every-piece-left the same way, and is not offered once the shipping was refunded (or for a pickup).
    const voidBox = node.querySelector('.rvoidbox');
    const shipBox = node.querySelector('.rship');
    const shipRefundable = o.shipping_cents > 0 && !o.shipping_refunded;
    const notSent = !['shipped', 'delivered'].includes(o.fulfillment_status);
    let voidTouched = false;
    let shipTouched = false;
    voidBox.addEventListener('change', () => { voidTouched = true; });
    shipBox.addEventListener('change', () => { shipTouched = true; });
    const mode = () => node.querySelector('input[name="rmode"]:checked').value;
    const allPicked = () => open.length > 0 && open.every(i => [...node.querySelectorAll('.ritem:checked')].some(x => x.value === i.sku));
    function compute() {
      const left = o.refundable_cents;
      let amount = 0;
      if (mode() === 'full') amount = left;
      if (mode() === 'items') {
        const picked = [...node.querySelectorAll('.ritem:checked')].map(x => x.value);
        const itemCents = open.filter(i => picked.includes(i.sku)).reduce((s, i) => s + i.price_cents, 0);
        const tax = o.items_cents ? Math.round(o.tax_cents * itemCents / o.items_cents) : 0;
        amount = itemCents + tax + (node.querySelector('.rship').checked ? o.shipping_cents : 0);
      }
      if (mode() === 'amount') amount = Math.round(parseFloat(node.querySelector('.ramount').value || '0') * 100);
      return { amount: Math.min(amount, left) };
    }
    function update() {
      armed = false;
      if (!voidTouched) voidBox.checked = mode() === 'full' || (mode() === 'items' && allPicked());
      if (!shipTouched) shipBox.checked = shipRefundable && notSent && mode() === 'items' && allPicked();
      node.querySelectorAll('.rpart').forEach(p => { p.hidden = p.dataset.part !== mode(); });
      if (!shipRefundable) { shipBox.checked = false; shipBox.closest('label').hidden = true; }
      // The pieces this refund puts back: every piece left (whole order) or the ticked ones; a custom amount puts none back.
      const back = mode() === 'full' ? open : mode() === 'items' ? open.filter(i => [...node.querySelectorAll('.ritem:checked')].some(x => x.value === i.sku)) : [];
      const relistWasHidden = relistRow.hidden;
      const relistable = back.filter(i => i.had_ebay);
      relistRow.hidden = !(restockBox.checked && relistable.length);
      const where = [...new Set(relistable.map(i => i.relist_label || relistTo?.label || 'Store 1'))];
      if (where.length) relistText.textContent = ` Also relist on eBay (${where.join('; ')})`;
      if (relistRow.hidden) relistBox.checked = false;            // hidden = cleared (nothing is sent)
      else if (relistWasHidden) relistBox.checked = relistWanted;  // shown again: her last choice (ticked by default)
      const { amount } = compute();
      preview.textContent = amount > 0 ? `Refund ${money(amount)} to the customer’s card.` : 'Choose what to refund.';
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
      const body = { mode: mode(), restock: restockBox.checked, reason: node.querySelector('.rreason').value,
        void_label: !voidRow.hidden && node.querySelector('.rvoidbox').checked, relist_ebay: restockBox.checked && !relistRow.hidden && relistBox.checked,
        idempotency_key: 'rf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12) };
      if (body.mode === 'items') { body.skus = [...node.querySelectorAll('.ritem:checked')].map(x => x.value); body.include_shipping = node.querySelector('.rship').checked; }
      if (body.mode === 'amount') body.amount_cents = amount;
      const data = await orderAction(`admin/orders/${o.id}/refund`, body);
      if (!data) {   // it failed: the message is at the top; let her try again
        update();
        if (lastActionError?.code === 'refund_found') { openOrder(o.id, true); loadOrders(); }   // the earlier refund was just recorded: show it, in the list too
        if (lastActionError?.code === 'refund_unknown') {   // outcome unknown: Confirm stays ready, the server sends it only once
          armed = true; go.textContent = `Confirm: refund ${money(amount)}`;
        }
        return;
      }
      const voidError = data?.refund?.label_void_error;
      // "Back on the website; queued to relist on eBay (Store 1)." / "…; relisted on eBay as 2… in <store>." / "Not relisted on eBay: … (why)."
      const relistNote = data?.refund?.ebay_relist?.note ? ' ' + data.refund.ebay_relist.note : '';
      if (data?.refund?.ebay_relist?.error && !data?.refund?.already_recorded && !voidError && ['PENDING', 'COMPLETED'].includes(data.refund.status)) {
        // eBay would not relist a piece (or did not answer): the refund is done and the piece is on the website; show the reason as a problem.
        appError(new Error(`Refunded ${money(data.refund.amount_cents)}.` + relistNote));
        return;
      }
      if (data?.refund?.already_recorded) {
        if (voidError) appError(new Error('That refund had already gone through. It was not sent a second time. ' + voidError + relistNote));
        else flash('appError', 'That refund had already gone through. It was not sent a second time.' + relistNote, 'ok');
      }
      else if (voidError) appError(new Error('Refund done. ' + voidError + relistNote));
      else if (!['PENDING', 'COMPLETED'].includes(data.refund.status)) flash('appError', 'Square did not make that refund. Nothing was refunded.', 'error');
      else if (data.refund.status === 'PENDING') flash('appError', `Refund of ${money(data.refund.amount_cents)} sent. Square is still working on it.` + relistNote, 'ok');
      else flash('appError', `Refunded ${money(data.refund.amount_cents)}.` + relistNote, 'ok');
    });
    update();
    return node;
  }

  // ---- pieces & eBay ---------------------------------------------------------------------------------
  document.querySelectorAll('#pieceFilters .chip').forEach(chip => chip.addEventListener('click', () => {
    document.querySelectorAll('#pieceFilters .chip').forEach(c => c.classList.toggle('on', c === chip));
    pieceFilter = chip.dataset.filter;
    renderPieces(true);
  }));
  $('pieceSearch').addEventListener('input', () => renderPieces(true));
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

  // 40 pieces at a time ("Show more"): the full list is 200+ cards, far too long on a phone.
  const PIECE_PAGE = 40;
  let pieceLimit = PIECE_PAGE;
  function renderPieces(resetLimit = false) {
    if (resetLimit) pieceLimit = PIECE_PAGE;
    const query = $('pieceSearch').value.trim().toLowerCase();
    const shown = products.filter(p => {
      if (query && !(`${p.name} ${p.sku}`.toLowerCase().includes(query))) return false;
      if (pieceFilter === 'linked') return Boolean(p.ebay_item_id);
      if (pieceFilter === 'attention') return p.still_on_ebay || p.ebay_status === 'error' || p.ebay_status === 'gone' || p.status === 'on_hold' || ['pending', 'failed'].includes(p.ebay_end_status);
      if (pieceFilter !== 'all') return p.status === pieceFilter;
      return true;
    });
    const left = shown.length - pieceLimit;
    $('pieces').replaceChildren(...(shown.length ? shown.slice(0, pieceLimit).map(pieceRow) : [el('p', { class: 'muted' }, 'No pieces match.')]),
      ...(left > 0 ? [el('button', { class: 'btn ghost more-pieces', type: 'button', onclick: () => { pieceLimit += PIECE_PAGE; renderPieces(); } },
        `Show ${Math.min(PIECE_PAGE, left)} more (${left} not shown yet)`)] : []));
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

  // Delete = off the website into Recently deleted (Weekly uploads → Find & edit) for 30 days; it can be put back there.
  async function deletePiece(p) {
    if (!window.confirm(`Delete “${p.name}” from the website?\n\nIt goes to Recently deleted for 30 days (Weekly uploads → Recently deleted), where you can put it back. After that it is deleted for good.${p.from_ebay ? ' It stays listed on eBay.' : ''}`)) return;
    try {
      const data = await api('admin/items/' + encodeURIComponent(p.sku) + '/delete', { method: 'POST', body: {} });
      products = products.filter(x => x.sku !== p.sku);
      renderPieces();
      flash('ebayResult', `${p.sku} deleted. It waits in Recently deleted until ${new Date(data.deleted.purge_after).toLocaleDateString()}, where you can put it back.`, 'ok');
    } catch (error) { flash('ebayResult', `${p.sku}: ${error.message}`, 'error'); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    if (p.status !== 'on_hold') actions.push(el('button', { class: 'btn ghost small', type: 'button', onclick: () => deletePiece(p) }, 'Delete'));
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

  // ---- sales ------------------------------------------------------------------------------------------
  let squareData = null;
  function renderSquarePeriods() {
    if (!squareData) return;
    const week = $('squarePeriod').value === 'week';
    const rows = (week ? squareData.square_by_week : squareData.square_by_day) || [];
    $('squarePeriodHead').textContent = week ? 'Week starting (Mon)' : 'Day';
    $('squareByPeriod').querySelector('tbody').replaceChildren(...(rows.length
      ? rows.map(r => el('tr', {}, el('td', {}, r.period), el('td', { class: 'money' }, money(r.website_cents || 0)), el('td', { class: 'money' }, money(r.cash_cents || 0)), el('td', { class: 'money' }, money(r.consignor_cents || 0))))
      : [el('tr', {}, el('td', { colspan: 4, class: 'muted' }, 'Nothing recorded yet'))]));
  }
  async function loadSales() {
    try {
      const { sales: c } = await api('admin/sales');
      $('salesStats').replaceChildren(
        el('div', { class: 'stat' }, el('p', { class: 'mono' }, 'Website sales'), el('div', { class: 'big' }, money(c.website_cents || 0)), el('p', { class: 'muted' }, 'Paid on the website, after refunds')),
        el('div', { class: 'stat' }, el('p', { class: 'mono' }, 'Cash'), el('div', { class: 'big' }, money(c.cash_cents || 0)), el('p', { class: 'muted' }, 'Your share of consignment pieces sold for cash (recorded by hand)')),
        el('div', { class: 'stat' }, el('p', { class: 'mono' }, 'Owed to consignors'), el('div', { class: 'big' }, money(c.consignor_owed_cents || 0)), el('p', { class: 'muted' }, `Still owed to consignors for sold pieces (${money(c.consignor_paid_cents || 0)} already paid out)`)));
      squareData = c;
      renderSquarePeriods();
      $('squarePeriod').onchange = renderSquarePeriods;
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
          : provider === 'ebay' && data.env === 'sandbox'
            ? `Open this link (works once, until ${when(data.expires_at)}) and sign in with an eBay Sandbox test user (developer portal → Sandbox user), then click Agree.`
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
      el('div', { class: 'card' }, el('h2', {}, 'Square (card payments)'),
        line('Mode', el('span', { class: 'badge ' + (s.square.mode === 'live' ? 'ok' : 'test') }, s.square.mode)),
        line('Card form (application ID)', yes(s.square.application_id_set || s.square.mode === 'mock')),
        line('Shop access token + location', yes(s.square.access_token_set || s.square.mode === 'mock')),
        line(real ? 'Test account connected (test payments)' : 'Her Square account connected', yes(s.square.connected, s.square.location_name || 'connected', 'not connected')),
        locationBox,
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
            : 'Disconnect the boutique’s Square account? Website card payments stop until it is connected again.') }, 'Disconnect') : null),
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
          ...(s.ebay.stores || []).map(store => el('div', { class: 'status-line' }, el('span', {}, store.username, store.test ? el('span', { class: 'badge test' }, store.sandbox ? 'sandbox' : 'test account') : null),
            el('span', { class: 'row', style: 'margin:0' },
              store.connected ? yes(store.can_list && store.can_ship, 'connected', 'sign in again') : yes(false, '', 'not connected'),
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
          s.ebay.can_connect ? null : el('span', { class: 'sub' }, 'Paste the RuName on the keys page first.'),
          s.ebay.sandbox_ready ? el('button', { class: 'btn ghost small', type: 'button', onclick: () => connectLink('ebay', ebayLink, 'sandbox') }, 'Sign-in link for a sandbox test user') : null),
        ebayLink),
      s.accounts ? el('div', { class: 'card' }, el('h2', {}, 'Customer accounts'),
        line('Accounts', String(s.accounts.accounts)),
        line('Favorites saved', String(s.accounts.favorites)),
        line('Price alerts turned on', String(s.accounts.alerts_on)),
        s.accounts.top.length ? el('div', { class: 'section' }, el('h3', {}, 'Most favorited'),
          ...s.accounts.top.map(t => line(t.name, `♥ ${t.count}`))) : el('p', { class: 'muted' }, 'Customers make accounts on the website (the person icon at the top) to save favorites and see their orders.')) : null,
      el('div', { class: 'card' }, el('h2', {}, 'Order emails'),
        line('Mode', el('span', { class: 'badge ' + (s.notify.mode === 'resend' || s.notify.mode === 'smtp' ? 'ok' : s.notify.mode === 'log' ? 'test' : 'bad') }, s.notify.mode)),
        line('New-order alerts go to', s.notify.owner_email || el('span', { class: 'badge bad' }, 'not set')),
        line('Sent from', s.notify.from || '—'),
        el('p', { class: 'muted' }, 'Customers get a confirmation, a shipped/ready-for-pickup note and a refund note. “log” only saves them on the server.')),
      el('div', { class: 'card' }, el('h2', {}, 'Money settings'),
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

  window.TKAdmin = {
    api, el, money, when, flash, appError, imageSrc, tabs: extraTabs, copyField, showOrder, can, isOwner, isStaff, who, setStaffBadge,
    get session() { return session; },
    // A worker has no pieces list or status page: these do nothing for them (the old stub did the same).
    reloadStatus: () => (isStaff() ? Promise.resolve() : loadStatus()),
    reloadPieces: () => (isStaff() ? Promise.resolve() : loadPieces()),
  };

  // ---- start -------------------------------------------------------------------------------------------
  (async () => {
    try {
      const me = await api('admin/me');
      if (me.scope !== 'full' && me.scope !== 'staff') { showLogin(); return; }   // a keys-link sign-in only opens keys.html
      // Opened from a sign-in link: show the prefilled form (Start shift swaps in that person) instead of the shift already on this phone.
      if (linkSignIn && me.scope === 'staff') { setLoginMode('staff'); showLogin(); return; }
      csrf = me.csrf;
      setSession(me.scope, me.staff);
      // A staff sign-in link opened while the owner is signed in: never leave the worker's name and code lying in the form.
      if (linkSignIn && me.scope === 'full') {
        $('staffName').value = ''; $('staffCode').value = '';
        await showApp();
        flash('appError', 'That was a staff sign-in link. You’re signed in as the owner.', 'info');
        return;
      }
      showApp();
    } catch {
      showLogin();
    }
  })();
})();
