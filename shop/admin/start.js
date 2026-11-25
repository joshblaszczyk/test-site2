// ThomKat "Grow your shop" (was "Start here" until 2026-11-22; the go-live steps are all done). Four cards: everything running
// (each line checked by admin/start), free listings to claim (ticked by hand), this week's numbers, and where she signs in.
// Signed in with the owner's admin password.
(function () {
  'use strict';
  const API = new URL('../api/', location.href).href;
  const $ = id => document.getElementById(id);
  let csrf = null;
  let data = null;
  let busy = false;
  let seq = 0;              // only the newest answer is drawn

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'class') node.className = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  async function api(path, options = {}) {
    const method = options.method || 'GET';
    const headers = { Accept: 'application/json' };
    if (method !== 'GET') { headers['Content-Type'] = 'application/json'; if (csrf) headers['X-CSRF-Token'] = csrf; }
    const response = await fetch(API + path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(options.body || {}), credentials: 'same-origin', cache: 'no-store' });
    let json = {};
    try { json = await response.json(); } catch { json = {}; }
    if (!response.ok || json.ok === false) throw Object.assign(new Error(json.error || `Request failed (${response.status})`), { status: response.status });
    return json;
  }

  // ---- the words ----------------------------------------------------------------------------------------------
  const here = path => new URL(path, location.href).href;
  // 1. Everything running: one line each; the shop checks every line itself (admin/start).
  const RUNNING = {
    site: 'Website', payments: 'Card payments', email: 'Order emails', ebay: 'eBay stores', register: 'Register sales',
    shipping: 'Shipping labels', tax: 'Sales tax', ebay_reviews: 'eBay ratings on your site', review_email: 'Google review emails',
  };
  // 2. Get found: free listings, in this order (Google first: Bing copies it).
  const LISTINGS = {
    google: {
      title: 'Google Business Profile', why: 'The most important one. It is what people see on Google Maps and when they search for a boutique or consignment shop near Lombard.',
      how: ['Go to business.google.com and sign in with the shop’s Google account.',
        'Find ThomKat Fashion & Art Boutique (or add it) and finish the check Google asks for.',
        'Check the address (1 N. Main St., Lombard), phone 224.474.4625, hours and website www.thelroom.com. Main category: Boutique. Add Consignment shop too.',
        'Add at least 10 photos: the storefront, inside the shop, the racks and a few favorite pieces.',
        'On your profile press “Ask for reviews”, copy the link and text it to Josh. That turns on the review emails.'],
      buttons: [['Google Business Profile', 'https://business.google.com', true]],
    },
    social: {
      title: 'Instagram and Facebook', why: 'Most of your shoppers already follow you there. Every post can send them to the website.',
      how: ['Put www.thelroom.com as the website on your Instagram profile and on your Facebook page.',
        'On Facebook, add a button to your page that opens www.thelroom.com.'],
      buttons: [['Meta Business Suite', 'https://business.facebook.com', true]],
    },
    bing: {
      title: 'Bing Places', why: 'Puts you on Bing and Bing Maps. It copies your Google profile, so it takes about 5 minutes.',
      how: ['Do the Google step first.', 'Go to bingplaces.com, sign in and choose “Import from Google Business Profile”.', 'Pick ThomKat and press Import.'],
      buttons: [['Bing Places', 'https://www.bingplaces.com', true]],
    },
    apple: {
      title: 'Apple Maps', why: 'iPhone users search with Apple Maps and Siri. Claiming your place there is free.',
      how: ['Go to businessconnect.apple.com and sign in with an Apple Account.', 'Search for ThomKat, claim it and follow the steps to verify.',
        'Add your hours, photos and website www.thelroom.com.'],
      buttons: [['Apple Business Connect', 'https://businessconnect.apple.com', true]],
    },
    yelp: {
      title: 'Yelp', why: 'A free page for people who look for shops on Yelp. You do not need to buy ads.',
      how: ['Go to biz.yelp.com and claim ThomKat (or add it).', 'Add your hours, photos and website www.thelroom.com. If Yelp calls about ads, you can say no: the free page is enough.'],
      buttons: [['Yelp for Business', 'https://biz.yelp.com', true]],
    },
    merchant: {
      title: 'Google Shopping (free listings)', why: 'Your pieces can show in Google’s Shopping tab for free.', josh: true,
      how: ['Go to merchants.google.com and sign in with the same Google account as your Business Profile.', 'Add your business and the website www.thelroom.com.',
        'Tell Josh you are done. He connects your pieces.'],
      buttons: [['Google Merchant Center', 'https://merchants.google.com', true]],
    },
  };
  // 4. Where she signs in to run the shop day to day.
  const SIGNINS = [
    ['Shop admin', 'Orders, pieces, consignors and this page.', () => here('./'), false],
    ['Square Dashboard', 'Card payments from the website and the register. Money from website orders lands here.', () => 'https://squareup.com/dashboard', true],
    ['Shippo', 'The card that pays for postage, and your label history.', () => 'https://apps.goshippo.com', true],
    ['eBay Seller Hub', 'Sign in to each of your two stores.', () => 'https://www.ebay.com/sh/ovw', true],
    ['Your shop email', 'New orders and consign requests arrive here (GoDaddy Email & Office).', () => 'https://productivity.godaddy.com', true],
    ['Google Business Profile', 'Reviews, photos and hours.', () => 'https://business.google.com', true],
  ];
  const TIPS = [
    'Post 3 new pieces a week on Instagram and Facebook, with the link www.thelroom.com.',
    'Good photos sell: daylight, a plain background, the whole piece first, then close-ups and the label.',
    'Once review emails are on, ask happy shoppers at the register for a Google review too.',
    'Answer every Google review, good or bad, within a few days.',
    'Add a new photo or post to your Google profile each week. It keeps your profile fresh for shoppers.',
  ];

  // ---- drawing ---------------------------------------------------------------------------------------------
  const ago = iso => {
    if (!iso) return '';
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (!isFinite(s)) return '';
    if (s < 90) return 'just now';
    if (s < 5400) return Math.round(s / 60) + ' min ago';
    if (s < 129600) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' days ago';
  };
  const day = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  const link = (text, href, external, cls) => el('a', { class: cls || 'btn ghost', href, target: external ? '_blank' : null, rel: external ? 'noopener noreferrer' : null }, text, external ? ' ↗' : '');

  function runningCard() {
    const bad = data.running.filter(r => r.state !== 'ok');
    const head = bad.length ? `${data.running_ok} of ${data.running_total} running` : 'Everything is running';
    return el('section', { class: 'card grow-card', id: 'running' },
      el('p', { class: 'mono' }, '1 · Everything running'),
      el('h2', {}, head),
      el('p', { class: 'muted' }, bad.length ? 'The shop checks each line by itself. Amber means it waits on you; red means tell Josh.' : 'The shop checks each line by itself. Nothing for you to do here.'),
      el('ul', { class: 'grow-run' }, data.running.map(r => el('li', { class: 'grow-run-row ' + r.state, 'data-run': r.id },
        el('span', { class: 'grow-dot', 'aria-hidden': 'true' }, r.state === 'ok' ? '✓' : r.state === 'wait' ? '…' : '!'),
        el('span', { class: 'grow-run-text' }, el('strong', {}, RUNNING[r.id] || r.id), el('span', { class: 'sr-only' }, r.state === 'ok' ? ' (running)' : r.state === 'wait' ? ' (waiting on you)' : ' (needs Josh)'),
          el('span', { class: 'grow-run-detail' }, r.detail + (r.at && r.state === 'ok' && ['ebay', 'register'].includes(r.id) ? ' Last checked ' + ago(r.at) + '.' : ''), r.state === 'bad' ? ' Tell Josh.' : ''))))));
  }

  function listingBody(item, words, primary) {
    return el('div', { class: 'start-body' }, el('p', {}, words.why),
      el('ol', { class: 'start-how' }, words.how.map(line => el('li', {}, line))),
      el('div', { class: 'start-buttons' }, words.buttons.map(([text, href, external], i) => link(text, href, external, 'btn' + (primary && i === 0 ? ' big' : ' ghost'))),
        item.auto ? null : el('button', { class: 'btn' + (item.done ? ' ghost' : ''), type: 'button', onclick: () => tick(item.id, !item.done) }, item.done ? 'Undo the tick' : 'I did this')),
      item.detail ? el('p', { class: 'start-detail' + (item.done ? ' ok' : '') }, item.detail) : null);
  }

  function listingsCard() {
    const list = data.listings;
    const next = list.find(l => !l.done);
    return el('section', { class: 'card grow-card', id: 'listings' },
      el('p', { class: 'mono' }, '2 · Get found (free)'),
      el('h2', {}, next ? `${data.listings_done} of ${list.length} done` : 'All claimed'),
      el('p', { class: 'muted' }, 'Free listings bring people who search for a boutique near them. Do them in this order; each takes 5 to 20 minutes.'),
      el('div', { class: 'start-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(list.length), 'aria-valuenow': String(data.listings_done) },
        el('span', { class: 'start-fill', 'data-pct': String(Math.round(100 * data.listings_done / list.length)) })),
      list.map((item, i) => {
        const words = LISTINGS[item.id];
        if (!words) return null;
        return el('details', { class: 'start-step' + (item.done ? ' done' : '') + (next && item.id === next.id ? ' current' : ''), 'data-step': item.id, open: next && item.id === next.id ? true : null },
          el('summary', {}, el('span', { class: 'start-tick', 'aria-hidden': 'true' }, item.done ? '✓' : String(i + 1)),
            el('span', { class: 'start-name' }, words.title, el('span', { class: 'sr-only' }, item.done ? ' (done)' : ' (not done yet)')),
            words.josh ? el('span', { class: 'badge' }, 'You + Josh') : null),
          listingBody(item, words, next && item.id === next.id));
      }));
  }

  function weekCard() {
    const w = data.week;
    const rows = [
      ['New pieces this week', String(w.added), w.added > 0 ? 'ok' : 'wait', w.newest ? 'Newest added ' + day(w.newest) + '. New arrivals give people a reason to come back.' : 'New arrivals give people a reason to come back.', ['Weekly uploads', here('./#weekly')]],
      ['Website orders', `${w.orders_week} this week`, 'info', `${w.orders_total} so far` + (w.last_order ? ' · last one ' + day(w.last_order) : '') + '.', ['Orders', here('./#orders')]],
      ['Waiting to ship', String(w.to_ship), w.to_ship ? 'wait' : 'ok', 'Ship within one business day. Fast shipping brings good reviews.', w.to_ship ? ['Orders', here('./#orders')] : null],
      ['Waiting for pickup', String(w.pickups), w.pickups ? 'wait' : 'ok', 'Call or email when an order is ready to pick up.', w.pickups ? ['Orders', here('./#orders')] : null],
      ['New consign requests', String(w.requests), w.requests ? 'wait' : 'ok', 'People who sent photos of pieces they want to consign. Answer within a day or two.', w.requests ? ['Customers', here('./#customers')] : null],
      ['Consignors who can sign in', `${w.consignor_pw} of ${w.consignors}`, w.consignors && w.consignor_pw < w.consignors ? 'wait' : 'ok', 'Set a password for each consignor (Admin → Consignors) so they can check their own sales instead of calling.', w.consignors && w.consignor_pw < w.consignors ? ['Consignors', here('./#consignors')] : null],
    ];
    return el('section', { class: 'card grow-card', id: 'week' },
      el('p', { class: 'mono' }, '3 · This week'),
      el('h2', {}, 'Keep it moving'),
      el('ul', { class: 'grow-week' }, rows.map(([label, value, state, note, btn]) => el('li', { class: 'grow-week-row ' + state },
        el('div', { class: 'grow-week-top' }, el('span', {}, label), el('strong', {}, value)),
        el('p', {}, note), btn ? link(btn[0], btn[1], false, 'btn ghost small') : null))),
      el('h3', {}, 'Easy wins'),
      el('ul', { class: 'grow-tips' }, TIPS.map(t => el('li', {}, t))));
  }

  function signinsCard() {
    return el('section', { class: 'card grow-card', id: 'signins' },
      el('p', { class: 'mono' }, '4 · Where you sign in'),
      el('h2', {}, 'Your accounts'),
      el('ul', { class: 'grow-signins' }, SIGNINS.map(([name, note, href, external]) => el('li', {},
        link(name, href(), external, 'grow-signin-link'), el('span', { class: 'muted' }, note)))));
  }

  function render() {
    $('progress').replaceChildren();
    $('next').replaceChildren(runningCard());
    $('all').replaceChildren(listingsCard(), weekCard(), signinsCard());
    document.querySelectorAll('.start-fill').forEach(f => { f.style.width = f.dataset.pct + '%'; });
    $('checked').textContent = 'Checked ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  async function load() {
    if (busy) return;
    busy = true;
    const mine = ++seq;
    try {
      const fresh = await api('admin/start');
      if (mine !== seq) return;   // a tick answered while this was on its way: keep the newer picture
      data = fresh;
      $('appError').hidden = true;
      render();
    } catch (error) {
      if (error.status === 401 || error.status === 403) { showLogin(); return; }
      $('appError').hidden = false;
      $('appError').textContent = error.message;
    } finally {
      busy = false;
    }
  }

  async function tick(id, done) {
    const mine = ++seq;
    try {
      const fresh = await api('admin/start', { method: 'POST', body: { id, done } });
      if (mine !== seq) return;
      data = fresh;
      render();
    } catch (error) {
      if (error.status === 401) { showLogin(); return; }
      $('appError').hidden = false;
      $('appError').textContent = error.message;
    }
  }

  // ---- sign in --------------------------------------------------------------------------------------------
  function showLogin() { $('app').hidden = true; $('login').hidden = false; $('password').focus(); }
  function showApp() { $('login').hidden = true; $('app').hidden = false; load(); }
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    $('loginError').hidden = true;
    try {
      const r = await api('admin/login', { method: 'POST', body: { password: $('password').value } });
      csrf = r.csrf;
      $('password').value = '';
      showApp();
    } catch (error) {
      $('loginError').hidden = false;
      $('loginError').textContent = error.message;
    }
  });
  $('logout').addEventListener('click', async () => {
    try { await api('admin/logout', { method: 'POST' }); } catch { /* already out */ }
    csrf = null;
    showLogin();
  });
  $('refresh').addEventListener('click', load);
  // Coming back from GoDaddy, eBay or Square in another tab: look again.
  let lastFocus = 0;
  window.addEventListener('focus', () => { if (!$('app').hidden && Date.now() - lastFocus > 5000) { lastFocus = Date.now(); load(); } });

  (async () => {
    try {
      const me = await api('admin/me');
      if (me.scope !== 'full') { showLogin(); return; }
      csrf = me.csrf;
      showApp();
    } catch {
      showLogin();
    }
  })();
})();
