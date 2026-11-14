// ThomKat "Start here": the go-live steps in plain words, one at a time. Each step turns green by itself when the shop
// can see it done (admin/start works that out); two steps are ticked by hand. Signed in with the admin password.
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

  // ---- the words for each step --------------------------------------------------------------------------
  const here = path => new URL(path, location.href).href;
  const STEPS = {
    site: { title: 'Josh puts the new website on thelroom.com', why: 'Your website moves from the test computer to www.thelroom.com.' },
    info: {
      title: 'Check your shop details', why: 'Customers see these first.',
      how: ['Open your website and read the phone numbers, store hours and addresses.',
        'Open the Policies page and read returns, shipping and privacy.',
        'Tell Josh anything that needs changing. When it all looks right, press “Everything looks right”.'],
      buttons: links => [['Open your website', links.site, true], ['Policies page', links.policies, true]],
      tick: 'Everything looks right',
    },
    email: {
      title: 'Turn on order emails', why: 'Customers get a receipt, and you get an email for every new order.',
      how: ['Sign in to GoDaddy’s Email & Office Dashboard. Next to ck@example.com press Manage → Advanced settings → turn on SMTP Authentication → Continue.',
        'Wait about 15 minutes.',
        'Press “Open Order emails”. Choose “Send with her Outlook mailbox”, type ck@example.com and its password, put info@example.com in the two boxes below it, then press Save & test.',
        'A test email arrives in your inbox, and this step turns green.'],
      buttons: () => [['Open Order emails', here('keys.html#card-email')], ['GoDaddy dashboard', 'https://productivity.godaddy.com', true]],
    },
    ebay_app: { title: 'Josh sets up the eBay connection', why: 'This lets your eBay stores talk to the website.' },
    ebay: {
      title: 'Connect your two eBay stores', why: 'When a piece sells in one place, the shop takes it down everywhere else.',
      how: ['Press “Open Setup” and find the eBay box.',
        'Press “Make a sign-in link for her”, then open the link it makes.',
        'Sign in to your first eBay store and press Agree.',
        'Do the same for your second store.'],
      buttons: () => [['Open Setup', here('./#setup')]],
    },
    consignors: {
      title: 'Add your consignors and put their pieces online', why: 'Their pieces show on the website, and every sale counts toward their check.',
      how: ['Press “Open Weekly uploads”, then “Create a batch”.',
        'Drop in your consignor workbook (the Excel file). Check the preview, then press Import.',
        'Press “Next: put their pieces on the website”. Drop in the photos, named by tag (like T1261100a.jpg).',
        'Check the list, then press “Put … on the website”.'],
      buttons: () => [['Open Weekly uploads', here('./#weekly')]],
    },
    square_app: { title: 'Josh connects the shop to Square', why: 'Needed before your own Square account can be connected.' },
    square: {
      title: 'Connect your Square account', why: 'Pieces you ring up at the register come off the website by themselves. Later, card payments go straight to your Square account.',
      how: ['Press “Open Setup” and find “Her real Square account”.',
        'Press “Connect her real Square account”.',
        'Sign in with your Square login and press Allow.'],
      buttons: () => [['Open Setup', here('./#setup')]],
    },
    shippo: {
      title: 'Set up shipping labels', why: 'Shipped orders get a postage label you print at the store. Postage is charged to your Shippo account.',
      how: ['Make a free account at goshippo.com with the shop’s email.',
        'In Shippo, add the card that pays for postage.',
        'In Shippo → Settings → API, make a test token and a live token.',
        'Press “Open Shipping”. Paste both tokens and the sender email, then press Save & test.'],
      buttons: () => [['Open Shipping', here('keys.html#card-shippo')], ['Shippo', 'https://goshippo.com', true]],
    },
    tax: {
      title: 'Set the sales tax rate', why: 'It is added to pickups and to Illinois orders.',
      how: ['Ask your accountant for the Lombard sales tax rate.', 'Press “Open Sales tax”, type the rate (like 8.25) and press Save.'],
      buttons: () => [['Open Sales tax', here('keys.html#card-tax')]],
    },
    checkout: { title: 'Josh turns on card payments', why: 'After this, the website takes real money.' },
    first_order: {
      title: 'Make one real $1 order, then refund it', why: 'It proves everything works with real money.',
      how: ['Ask Josh for the $1 test piece.', 'Buy it on the website with your own card and choose pickup.',
        'Check you got the receipt and the new-order email.', 'In Admin → Orders, open the order and press Refund.'],
      buttons: links => [['Open your website', links.site, true]],
      tick: 'I did the $1 order',
    },
  };
  const PHASES = { live: 'Part 1 · Put the website live', pay: 'Part 2 · Take card payments (later)' };

  // ---- drawing ---------------------------------------------------------------------------------------------
  function buttons(id, step, primary) {
    const words = STEPS[id];
    const list = words.buttons ? words.buttons(data.links) : [];
    return el('div', { class: 'start-buttons' },
      list.map(([text, href, external], i) => el('a', { class: 'btn' + (primary && i === 0 ? ' big' : ' ghost'), href, target: external ? '_blank' : null, rel: external ? 'noopener noreferrer' : null }, text, external ? ' ↗' : '')),
      step.manual ? el('button', { class: 'btn' + (step.done ? ' ghost' : primary && !list.length ? ' big' : ''), type: 'button', onclick: () => tick(id, !step.done) },
        step.done ? 'Undo the tick' : words.tick) : null);
  }

  function body(id, step, primary) {
    const words = STEPS[id];
    if (step.who === 'josh') {
      return el('div', { class: 'start-body' }, el('p', {}, words.why), el('p', { class: 'muted' }, step.done ? 'Done.' : 'Nothing for you to do here. It turns green when Josh is done.'),
        step.detail ? el('p', { class: 'start-detail' }, step.detail) : null);
    }
    return el('div', { class: 'start-body' }, el('p', {}, words.why),
      words.how ? el('ol', { class: 'start-how' }, words.how.map(line => el('li', {}, line))) : null,
      buttons(id, step, primary),
      step.detail ? el('p', { class: 'start-detail' + (step.done ? ' ok' : '') }, step.detail) : null);
  }

  const who = step => el('span', { class: 'badge ' + (step.who === 'josh' ? '' : 'pink') }, step.who === 'josh' ? 'Josh' : 'You');

  function render() {
    const steps = data.steps;
    const pct = Math.round(100 * data.done / data.total);
    $('progress').replaceChildren(el('p', {}, el('strong', {}, `${data.done} of ${data.total} done`)),
      el('div', { class: 'start-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(data.total), 'aria-valuenow': String(data.done) },
        el('span', { class: 'start-fill', 'data-pct': String(pct) })));
    document.querySelector('.start-fill').style.width = pct + '%';

    const mine = steps.find(s => !s.done && s.who !== 'josh');
    const josh = steps.find(s => !s.done && s.who === 'josh');
    const n = id => steps.findIndex(s => s.id === id) + 1;
    let next;
    if (!mine && !josh) {
      next = el('div', { class: 'card start-next done' }, el('p', { class: 'mono' }, 'All done'), el('h2', {}, 'Your shop is fully open.'),
        el('p', {}, 'Everything on this page is green. New orders and consignor sales now look after themselves.'));
    } else if (!mine) {
      next = el('div', { class: 'card start-next waiting' }, el('p', { class: 'mono' }, 'Nothing for you right now'),
        el('h2', {}, `Waiting on Josh: ${STEPS[josh.id].title.replace(/^Josh /, '')}`), el('p', {}, 'This page turns green by itself when it’s done.'));
    } else {
      next = el('div', { class: 'card start-next' }, el('p', { class: 'mono' }, `Your next step · step ${n(mine.id)} of ${steps.length}`),
        el('h2', {}, STEPS[mine.id].title), body(mine.id, mine, true));
    }
    $('next').replaceChildren(next);

    $('all').replaceChildren(...Object.entries(PHASES).map(([phase, heading]) => el('div', { class: 'start-phase' }, el('h3', {}, heading),
      steps.filter(s => s.phase === phase).map(step => el('details', { class: 'start-step' + (step.done ? ' done' : '') + (mine && step.id === mine.id ? ' current' : ''), 'data-step': step.id },
        el('summary', {}, el('span', { class: 'start-tick', 'aria-hidden': 'true' }, step.done ? '✓' : String(n(step.id))),
          el('span', { class: 'start-name' }, STEPS[step.id].title, el('span', { class: 'sr-only' }, step.done ? ' (done)' : ' (not done yet)')), who(step)),
        body(step.id, step, false))))));
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
