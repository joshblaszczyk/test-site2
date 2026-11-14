// ThomKat shop keys page: paste the Shippo / Square / eBay / email keys, save, test, switch them on.
// Opened with the admin password or a private link (keys.html#k=…, made by shop/cron/keys-link.php).
(function () {
  'use strict';
  const API = new URL('../api/', location.href).href;
  const $ = id => document.getElementById(id);
  const when = iso => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  let csrf = null;
  let data = null;          // last admin/keys answer
  const notices = {};       // section id -> {kind, text}; kept across re-renders
  let scrolledToCard = false;

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
  const link = (text, href) => el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text, ' ↗');
  const b = text => el('strong', {}, text);

  async function api(path, options = {}) {
    const method = options.method || 'GET';
    const headers = { Accept: 'application/json' };
    if (method !== 'GET') { headers['Content-Type'] = 'application/json'; if (csrf) headers['X-CSRF-Token'] = csrf; }
    const response = await fetch(API + path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(options.body || {}), credentials: 'same-origin', cache: 'no-store' });
    let json = {};
    try { json = await response.json(); } catch { json = {}; }
    if (!response.ok || json.ok === false) throw Object.assign(new Error(json.error || `Request failed (${response.status})`), { code: json.code, status: response.status });
    return json;
  }

  function copyField(value) {
    const input = el('input', { value, readonly: true, 'aria-label': 'Copy this' });
    return el('div', { class: 'copy' }, input, el('button', { class: 'btn ghost small', type: 'button', onclick: () => { input.select(); navigator.clipboard?.writeText(value); } }, 'Copy'));
  }

  // ---- what each card asks for ---------------------------------------------------------------------
  const PREFIXES = { shippo_test_: 'SHIPPO_TEST_TOKEN', shippo_live_: 'SHIPPO_LIVE_TOKEN', 'sandbox-sq0idb-': 'SQUARE_SANDBOX_APPLICATION_ID',
    'sq0idp-': 'SQUARE_LIVE_APPLICATION_ID', 'sandbox-sq0csb-': 'SQUARE_SANDBOX_APPLICATION_SECRET', 'sq0csp-': 'SQUARE_LIVE_APPLICATION_SECRET' };

  const squareFields = (env, name) => [
    { key: `SQUARE_${env}_APPLICATION_ID`, label: 'Application ID', where: 'Credentials page', placeholder: env === 'SANDBOX' ? 'sandbox-sq0idb-…' : 'sq0idp-…' },
    { key: `SQUARE_${env}_ACCESS_TOKEN`, label: 'Access token', where: 'Credentials page', placeholder: 'EAAA…' },
    { key: `SQUARE_${env}_LOCATION_ID`, label: 'Location ID', where: 'Locations page', placeholder: 'L…', note: 'Leave it empty if the account has one location; the test fills it in.' },
    { key: `SQUARE_${env}_APPLICATION_SECRET`, label: 'Application secret', where: 'OAuth page', placeholder: env === 'SANDBOX' ? 'sandbox-sq0csb-…' : 'sq0csp-…',
      note: `For the automatic 10% commission (${name}).` },
  ];

  function cards() {
    const s = data.setup;
    return [
      { id: 'shippo', test: 'shippo', title: 'Shipping labels', provider: 'Shippo',
        what: 'Live shipping prices at checkout and a shipping label for every order.',
        steps: [
          ['Sign in at ', link('goshippo.com', 'https://apps.goshippo.com/join'), ' (free account).'],
          ['Open ', link('Settings → API', 'https://apps.goshippo.com/settings/api'), ' and copy the tokens. Paste both if you can.'],
        ],
        fields: [
          { key: 'SHIPPO_TEST_TOKEN', label: 'Test token', placeholder: 'shippo_test_…', note: 'Free test labels, used while the shop is in test mode.' },
          { key: 'SHIPPO_LIVE_TOKEN', label: 'Live token', placeholder: 'shippo_live_…', note: 'Real labels paid from the Shippo account. Only real orders use it.' },
          { key: 'SHIPPING_FROM_EMAIL', label: 'Sender email for labels', placeholder: 'the boutique’s email', type: 'email', note: 'Shippo won’t make a label without it. The carrier can use it to reach the boutique about a package.' },
        ],
        advanced: [{ key: 'SHIPPING_PROVIDER', label: 'Checkout shipping', options: { mock: 'Pretend rates (no Shippo)', shippo: 'Shippo rates + labels', flat: 'One flat price, no labels' } }] },
      { id: 'square', title: 'Card payments + your 10% commission', provider: 'Square',
        what: 'Customers pay by card through Square. Once the boutique connects her Square account, Square sends your 10% to your Square account on every sale and takes it back on refunds.',
        steps: [
          ['Open the ', link('Square Developer Console', 'https://developer.squareup.com/apps'), ' and sign in with ', b('your own'), ' Square account. The commission is paid to it.'],
          ['Create an app called “ThomKat Shop”. Don’t use the MWD app.'],
          ['Square has ', b('Sandbox'), ' (test) and ', b('Production'), ' (real money) keys; switch at the top of the Square page. Paste each set in its own box below.'],
          ['On Square’s OAuth page, set the Redirect URL to this on both the Sandbox and the Production tab:', copyField(s.square_redirect_url)],
        ],
        envs: [
          { id: 'square_sandbox', test: 'square_sandbox', label: 'Sandbox (test money)', fields: squareFields('SANDBOX', 'test') },
          { id: 'square_live', test: 'square_live', label: 'Production (real money)', fields: squareFields('LIVE', 'real sales') },
        ],
        advanced: [
          { key: 'SQUARE_MODE', label: 'Checkout payments', options: { mock: 'Pretend card (no Square)', sandbox: 'Square sandbox (test cards)', live: 'Square production (real money)' } },
          { key: 'SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY', label: 'Sandbox webhook signature key (optional)' },
          { key: 'SQUARE_LIVE_WEBHOOK_SIGNATURE_KEY', label: 'Production webhook signature key (optional)' },
          { text: ['Webhooks are optional: a check every 10 minutes finds refunds made in Square anyway. If you add one, use this URL with the events payment.updated, refund.created, refund.updated and oauth.authorization.revoked:', copyField(s.square_webhook_url)] },
        ] },
      { id: 'ebay', test: 'ebay', title: 'eBay listings', provider: 'eBay',
        what: 'Pieces that sell on eBay come off the website by themselves.',
        steps: [
          ['The shop already has working eBay app keys. It only needs the boutique’s eBay user ID.'],
          ['To use other keys: ', link('eBay Application Keys', 'https://developer.ebay.com/my/keys'), ' → the ', b('Production'), ' keyset → App ID and Cert ID. The Dev ID isn’t needed.'],
          ['If eBay says the keyset is turned off, open its “Marketplace account deletion” notification setting and choose the exemption (this shop doesn’t keep eBay user data).'],
        ],
        fields: [
          { key: 'EBAY_SELLER_USERNAME', label: 'Her eBay user IDs (one per store, separated by commas)', placeholder: 'the seller names on her listings', note: 'A link to her eBay profile (ebay.com/usr/…) works too.' },
          { key: 'EBAY_CLIENT_ID', label: 'App ID (Client ID)', placeholder: 'Name-AppName-PRD-…' },
          { key: 'EBAY_CLIENT_SECRET', label: 'Cert ID (Client Secret)', placeholder: 'PRD-…' },
        ],
        advanced: [
          { key: 'EBAY_MODE', label: 'eBay checks', options: { off: 'Off', public: 'Check linked listings', seller: 'Also read her eBay orders (needs the RuName + Connect eBay)' } },
          { key: 'EBAY_RUNAME', label: 'RuName (lets her stores sign in: eBay orders, posting and ending listings)', placeholder: 'from eBay → User Tokens' },
          { text: ['Set the RuName’s “auth accepted URL” to:', copyField(s.ebay_accept_url)] },
          { text: ['Then admin → Setup → eBay → “Make a sign-in link for her”, once per store.'] },
        ] },
      { id: 'email', test: 'email', title: 'Order emails', provider: 'Her Outlook mailbox or Resend', optional: true,
        what: 'Order confirmations for customers and a new-order alert for the boutique.',
        steps: [
          ['Her Outlook mailbox: in GoDaddy’s ', link('Email & Office Dashboard', 'https://productivity.godaddy.com'), ', choose Manage next to the mailbox → Advanced settings → turn on SMTP Authentication. Then pick “Send with her Outlook mailbox” and type the mailbox and its password here.'],
          ['Or Resend: at ', link('resend.com', 'https://resend.com/domains'), ', verify the boutique’s domain, create an ', link('API key', 'https://resend.com/api-keys'), ' (sending access) and paste it here.'],
        ],
        fields: [
          { key: 'NOTIFY_MODE', label: 'Emails', options: { off: 'Off', log: 'Save on the server only (test)', smtp: 'Send with her Outlook mailbox', resend: 'Send with Resend' } },
          { key: 'SMTP_USERNAME', label: 'Outlook mailbox (emails come from this address)', where: 'Outlook', placeholder: 'name@example.com', type: 'email' },
          { key: 'SMTP_PASSWORD', label: 'Mailbox password', where: 'Outlook', placeholder: 'the password for that mailbox', type: 'password', note: 'Kept only on the shop’s server. If the mailbox asks for a sign-in code, use an app password.' },
          { key: 'RESEND_API_KEY', label: 'Resend API key', where: 'Resend', placeholder: 're_…' },
          { key: 'NOTIFY_FROM', label: 'Send from', placeholder: 'ThomKat <orders@example.com>', note: 'With Outlook only the name is used: the address is always the mailbox above.' },
          { key: 'NOTIFY_OWNER_EMAIL', label: 'New-order alerts go to', placeholder: 'boutique email', type: 'email' },
          { key: 'NOTIFY_REPLY_TO', label: 'Customer replies go to', placeholder: 'boutique email', type: 'email' },
        ],
        advanced: [
          { key: 'SMTP_HOST', label: 'Outlook mail server', placeholder: 'smtp.office365.com (leave blank for this)' },
          { key: 'SMTP_PORT', label: 'Port', options: { '587': '587 (normal)', '465': '465' } },
        ] },
      { id: 'tax', title: 'Sales tax', optional: true,
        what: 'Added to pickups and to Illinois addresses. Ask the boutique’s accountant for the Lombard rate.',
        fields: [{ key: 'TAX_RATE_BPS', label: 'Sales tax rate (%)', placeholder: 'e.g. 8.0', percent: true }] },
    ];
  }

  // ---- status ----------------------------------------------------------------------------------------
  const keyInfo = key => data.keys.find(k => k.key === key) || { key, set: false };
  const isSet = key => keyInfo(key).set;
  function testState(id, keys) {
    const last = data.tests[id];
    if (!keys.some(isSet)) return { kind: 'bad', text: 'Not set up' };
    if (!last) return { kind: 'dim', text: 'Saved, not tested' };
    return last.ok ? { kind: 'ok', text: 'Working' } : { kind: 'bad', text: 'Needs a fix' };
  }
  const chip = state => el('span', { class: 'badge ' + state.kind }, state.text);

  function renderChecklist() {
    const s = data.setup;
    const row = (ok, label, detail, optional) => el('div', { class: 'check' + (ok ? ' done' : optional ? ' later' : '') },
      el('span', { class: 'tick', 'aria-hidden': 'true' }, ok ? '✓' : optional ? '·' : '!'), el('div', {}, b(label), detail ? el('div', { class: 'muted' }, detail) : null));
    const pay = { mock: 'pretend card (no Square yet)', sandbox: 'Square sandbox (test cards)', live: 'Square production (REAL money)' }[s.square_mode];
    const ship = { mock: 'pretend rates (no Shippo yet)', shippo: 'Shippo', flat: 'one flat price' }[s.shipping_provider];
    $('checklist').replaceChildren(el('h2', {}, 'Where things stand'),
      row(s.shipping_provider === 'shippo' && data.tests.shippo?.ok, 'Shipping', `Checkout uses ${ship}. Test token ${isSet('SHIPPO_TEST_TOKEN') ? '✓' : '✗'} · live token ${isSet('SHIPPO_LIVE_TOKEN') ? '✓' : '✗'}`),
      row(s.square_mode !== 'mock' && !!data.tests.square_sandbox?.ok, 'Card payments', `Checkout uses ${pay}.`),
      row(!!data.tests.square_live?.ok, 'Square production keys', 'Needed before real sales.'),
      row(s.square_live_connected, 'Her real Square account connected (automatic commission)', s.square_live_connected
        ? `Real sales go to ${s.square_live_location || 'her account'}${s.square_mode === 'live' ? '' : ' once checkout is switched to production'}. Square pays the 10% automatically.`
        : 'After the Production keys: Admin → Setup → “Connect her real Square account”, then sign in with her Square login.'),
      row(isSet('EBAY_SELLER_USERNAME') && !!data.tests.ebay?.ok, 'eBay', isSet('EBAY_SELLER_USERNAME') ? `Watching ${keyInfo('EBAY_SELLER_USERNAME').value}` : 'Needs the boutique’s eBay user ID.'),
      row((s.notify_mode === 'resend' || s.notify_mode === 'smtp') && !!data.tests.email?.ok, 'Order emails',
        { resend: 'Sent with Resend.', smtp: `Sent from her Outlook mailbox${isSet('SMTP_USERNAME') ? ' ' + keyInfo('SMTP_USERNAME').value : ''}.` }[s.notify_mode] || 'Optional, later.', true),
      row(Number(keyInfo('TAX_RATE_BPS').value || 0) > 0, 'Sales tax', Number(keyInfo('TAX_RATE_BPS').value || 0) > 0 ? `${Number(keyInfo('TAX_RATE_BPS').value) / 100}%` : 'Off for now.', true));
    $('modeBadge').textContent = s.shop_mode === 'live' ? 'Live shop' : 'Test mode: no real money';
    $('modeBadge').className = 'badge ' + (s.shop_mode === 'live' ? 'ok' : 'test');
  }

  // ---- inputs ----------------------------------------------------------------------------------------
  function fieldInput(f, inputs) {
    const k = keyInfo(f.key);
    let input;
    if (f.options) {
      const options = Object.entries(f.options);
      if (k.value && !f.options[k.value]) options.unshift([k.value, k.value]);
      input = el('select', {}, (k.value ? [] : [el('option', { value: '' }, '(not set)')]),
        options.map(([value, text]) => el('option', { value, selected: value === (k.value ?? ''), disabled: value === 'live' && f.key === 'SQUARE_MODE' && data.scope !== 'full' }, text)));
      input.dataset.initial = k.value ?? '';
    } else {
      const secret = k.kind === 'secret';
      const shown = f.percent ? (k.value ? String(Number(k.value) / 100) : '') : (secret ? '' : (k.value ?? ''));
      input = el('input', { type: f.type || 'text', value: shown, autocomplete: f.type === 'password' ? 'new-password' : 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false',
        inputmode: f.percent ? 'decimal' : null, placeholder: secret && k.set ? `saved (${k.hint}). Paste a new one to replace it` : (f.placeholder || '') });
      input.dataset.initial = shown;
      input.addEventListener('input', () => routePaste(f.key, input, inputs));
    }
    input.dataset.key = f.key;
    inputs[f.key] = input;
    const remove = k.kind === 'secret' && k.set ? el('button', { class: 'link small-link', type: 'button', onclick: event => {
      const button = event.currentTarget;
      if (button.dataset.armed) { input.dataset.clear = '1'; button.textContent = 'Will be removed when you save'; button.disabled = true; return; }
      button.dataset.armed = '1'; button.textContent = 'Really remove it?';
    } }, 'Remove') : null;
    return el('label', { class: 'field' }, el('span', { class: 'field-top' }, el('span', {}, f.label, f.where ? el('span', { class: 'muted' }, ` · ${f.where}`) : null),
      k.set && k.kind === 'secret' ? el('span', { class: 'badge ok' }, 'saved ' + k.hint) : null), input,
      el('span', { class: 'field-note' }, f.note || '', ' ', remove), el('span', { class: 'moved', hidden: true }));
  }

  /** A pasted key whose prefix says it belongs in another box goes there (the server does the same). */
  function routePaste(key, input, inputs) {
    const value = input.value.trim();
    for (const [prefix, target] of Object.entries(PREFIXES)) {
      if (!value.startsWith(prefix) || target === key) continue;
      const other = document.querySelector(`[data-key="${target}"]`);
      if (!other || !(key.startsWith('SHIPPO_') || key.startsWith('SQUARE_'))) return;
      other.value = value;
      input.value = input.dataset.initial;
      const note = other.closest('label').querySelector('.moved');
      note.hidden = false;
      note.textContent = `Moved here: it starts with ${prefix}`;
      if (other.closest('details')) other.closest('details').open = true;
      other.focus();
      return;
    }
  }

  function changedValues(inputs) {
    const values = {};
    const clear = [];
    for (const [key, input] of Object.entries(inputs)) {
      if (input.dataset.clear) { clear.push(key); continue; }
      let value = key === 'SMTP_PASSWORD' ? input.value : input.value.trim();   // a password keeps its spaces
      if (value === input.dataset.initial || (input.tagName === 'SELECT' && value === '')) continue;
      if (key === 'TAX_RATE_BPS') {
        if (value !== '' && !(Number(value) >= 0 && Number(value) <= 20)) throw new Error('Type the tax rate as a percent from 0 to 20, like 8.25.');
        value = value === '' ? '' : String(Math.round(Number(value) * 100));
      }
      values[key] = value;
    }
    return { values, clear };
  }

  // ---- one section = fields + a Save & test button ---------------------------------------------------
  function section(id, test, fields, extra = []) {
    const inputs = {};
    const result = el('p', { class: 'msg', role: 'status', hidden: true });
    const show = notice => { result.hidden = !notice; if (notice) { result.className = 'msg ' + notice.kind; result.textContent = notice.text; } };
    show(notices[id]);
    const button = el('button', { class: 'btn small', type: 'button', onclick: async () => {
      let body;
      try { body = changedValues(inputs); } catch (error) { show({ kind: 'error', text: error.message }); return; }
      const nothing = !Object.keys(body.values).length && !body.clear.length;
      if (nothing && !test) { show({ kind: 'info', text: 'Nothing changed.' }); return; }
      button.disabled = true;
      show({ kind: 'info', text: nothing ? 'Testing…' : 'Saving…' });
      try {
        let notice;
        if (nothing) {
          const r = await api('admin/keys/test', { method: 'POST', body: { which: test } });
          notice = { kind: r.result.ok ? 'ok' : 'error', text: r.result.text };
        } else {
          const r = await api('admin/keys', { method: 'POST', body: { ...body, test: test || undefined } });
          const moved = (r.moved || []).map(m => `${label(m.from)} → saved as ${label(m.to)}.`).join(' ');
          notice = r.test ? { kind: r.test.ok ? 'ok' : 'error', text: [moved, 'Saved.', r.test.text].filter(Boolean).join(' ') }
            : { kind: 'ok', text: [moved, 'Saved.'].filter(Boolean).join(' ') };
        }
        notices[id] = notice;
        await load(Object.keys(inputs));
      } catch (error) {
        if (error.status === 401) { showLogin('Your sign-in ran out. Please sign in again.'); return; }
        show({ kind: 'error', text: error.message });
        button.disabled = false;
      }
    } }, test ? 'Save & test' : 'Save');
    return el('div', { class: 'section-box', 'data-section': id }, fields.map(f => f.text ? el('div', { class: 'muted note-block' }, f.text) : fieldInput(f, inputs)),
      extra, el('div', { class: 'row' }, button), result);
  }

  const label = key => {
    for (const card of cards()) {
      for (const f of [...(card.fields || []), ...(card.advanced || []), ...(card.envs || []).flatMap(e => e.fields)]) {
        if (f.key === key) return (card.envs && key.startsWith('SQUARE_') ? (key.includes('_LIVE_') ? 'Production ' : 'Sandbox ') : '') + f.label.toLowerCase();
      }
    }
    return key;
  };

  function renderCards() {
    $('cards').replaceChildren(...cards().map(card => {
      const keys = [...(card.fields || []), ...(card.envs || []).flatMap(e => e.fields)].map(f => f.key).filter(Boolean);
      const head = el('div', { class: 'card-head' }, el('div', {}, el('h2', {}, card.title), card.provider ? el('p', { class: 'mono' }, card.provider + (card.optional ? ' · optional' : '')) : card.optional ? el('p', { class: 'mono' }, 'optional') : null),
        card.test && !card.envs ? chip(testState(card.test, keys)) : null);
      const steps = card.steps ? el('ol', { class: 'steps' }, card.steps.map(step => el('li', {}, step))) : null;
      const body = card.envs
        ? card.envs.map(env => el('div', { class: 'env' }, el('div', { class: 'card-head' }, el('h3', {}, env.label), chip(testState(env.test, env.fields.map(f => f.key)))),
          section(env.id, env.test, env.fields)))
        : [section(card.id, card.test, card.fields || [])];
      const advanced = card.advanced ? el('details', { class: 'advanced' }, el('summary', {}, 'More settings'),
        section(card.id + '_more', card.envs ? null : card.test, card.advanced)) : null;
      return el('section', { class: 'card key-card', id: 'card-' + card.id }, head, el('p', { class: 'muted' }, card.what), steps, body, advanced);
    }));
  }

  /** (Re)draws the page. Keys typed into other boxes but not saved yet stay in their boxes. */
  async function load(justSaved = []) {
    const typed = {};
    document.querySelectorAll('#cards input[data-key], #cards select[data-key]').forEach(input => {
      if (input.value !== input.dataset.initial && !justSaved.includes(input.dataset.key)) typed[input.dataset.key] = input.value;
    });
    const open = [...document.querySelectorAll('#cards details[open]')].map(d => d.closest('section')?.id);
    try {
      data = await api('admin/keys');
      if (!data.editable) {
        $('cards').replaceChildren(el('p', { class: 'msg error' }, 'Pasting keys here is turned off on this server (ADMIN_CAN_EDIT_KEYS=0). Edit shop.env on the server instead.'));
        return;
      }
      $('adminLink').hidden = data.scope !== 'full';
      $('startLink').hidden = data.scope !== 'full';
      renderChecklist();
      renderCards();
      // keys.html#card-email (from the Start here page): jump to that card once, below the sticky header.
      const target = !scrolledToCard && /^#card-[a-z_]+$/.test(location.hash) ? document.querySelector(location.hash) : null;
      if (target) {
        scrolledToCard = true;
        target.scrollIntoView({ block: 'start' });
        window.scrollBy(0, -(document.querySelector('.top')?.offsetHeight || 0) - 12);
        target.classList.add('flash');
      }
      for (const [key, value] of Object.entries(typed)) {
        const input = document.querySelector(`#cards [data-key="${key}"]`);
        if (input) input.value = value;
      }
      open.forEach(id => { const details = id && document.querySelector(`#${id} details`); if (details) details.open = true; });
    } catch (error) {
      if (error.status === 401) { showLogin(); return; }
      $('appError').hidden = false;
      $('appError').textContent = error.message;
    }
  }

  // ---- sign in -----------------------------------------------------------------------------------------
  function showLogin(note) {
    $('app').hidden = true;
    $('login').hidden = false;
    $('linkNote').hidden = !note;
    $('linkNote').textContent = note || '';
    $('password').focus();
  }
  function showApp() {
    $('login').hidden = true;
    $('app').hidden = false;
    load();
  }
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
    showLogin('Signed out.');
  });

  (async () => {
    let note = null;
    const key = new URLSearchParams(location.hash.slice(1)).get('k');
    if (key) {
      history.replaceState(null, '', location.pathname + location.search);   // the link works once; keep it out of the address bar
      try {
        const r = await api('admin/keys-link', { method: 'POST', body: { key } });
        csrf = r.csrf;
        showApp();
        return;
      } catch (error) {
        note = error.message;
      }
    }
    try {
      const me = await api('admin/me');
      csrf = me.csrf;
      showApp();
    } catch {
      showLogin(note);
    }
  })();
})();
