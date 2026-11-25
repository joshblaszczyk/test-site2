// ThomKat checkout: bag -> contact -> ship (live rates) or free pickup -> Square card -> order.
// The server prices everything; this page only sends SKUs, the chosen rate and a Square card token.
(function () {
  'use strict';
  const API = new URL('api/', document.currentScript.src).href;
  const SITE = new URL('../', document.currentScript.src).href;   // site root (this file is shop/checkout.js)
  const CSS_URL = new URL('address-check.css' + new URL(document.currentScript.src).search, document.currentScript.src).href;   // same ?v= as this script, so a new version is never served from cache   // styles of the "Did you mean" box (loaded below)
  const BAG_KEY = 'thomkat.bag.v1';
  const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
    'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','PR','VI','GU','AS','MP','AA','AE','AP'];
  const $ = id => document.getElementById(id);
  const money = cents => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let config = null;
  let info = new Map();        // sku -> product display info from products.json
  let quote = null;
  let rateId = null;
  let card = null;
  let busy = false;
  let attempt = null;          // {key, source, verification} reused only to retry a lost answer

  // ---- bag storage (same key as the storefront) ------------------------------------------------
  function readBag() {
    try { return JSON.parse(localStorage.getItem(BAG_KEY) || '[]').filter(s => typeof s === 'string'); } catch { return []; }
  }
  function writeBag(list) {
    try { localStorage.setItem(BAG_KEY, JSON.stringify([...new Set(list)])); } catch { /* ignore */ }
  }
  const bag = () => readBag().filter(sku => info.has(sku));

  // ---- the bag's pieces: only those are downloaded (GET catalog/pieces); the whole catalog file is the fallback if that route fails ----
  function pieceInfo(p) {
    const price = p.sale_price ?? p.price ?? p.regular_price;
    return [String(p.sku), { name: p.name, sub: p.sub, price_text: p.price_text, price_cents: price ? Math.round(price * 100) : 0, image: p.images?.[0]?.thumb || p.images?.[0]?.card }];
  }
  async function loadInfo() {
    const skus = [...new Set(readBag())].filter(sku => /^[A-Za-z0-9._-]{1,64}$/.test(sku));
    if (!skus.length) return new Map();
    try {
      const found = [];
      for (let i = 0; i < skus.length; i += 50) {
        const data = await api('catalog/pieces?skus=' + encodeURIComponent(skus.slice(i, i + 50).join(',')));
        if (!Array.isArray(data.pieces)) throw new Error('no pieces');
        found.push(...data.pieces);
      }
      return new Map(found.map(pieceInfo));
    } catch {
      const response = await fetch(SITE + 'products/products.json', { cache: 'no-store' });
      const data = await response.json();
      return new Map(data.products.map(pieceInfo));
    }
  }

  async function api(path, options = {}) {
    const response = await fetch(API + path, {
      method: options.method || 'GET',
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
    });
    let data = {};
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || `Request failed (${response.status})`);
      error.code = data.code || 'http_' + response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function show(id, on) { $(id).hidden = !on; }
  function message(id, text) { $(id).textContent = text || ''; show(id, Boolean(text)); }
  const fulfillment = () => document.querySelector('input[name="fulfillment"]:checked')?.value || 'ship';
  const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')).replace(/-/g, '');

  // ---- rendering ---------------------------------------------------------------------------------
  function lineItem(name, sub, priceText, image, onRemove) {
    const li = document.createElement('li');
    li.className = 'line';
    const img = document.createElement('img');
    img.src = image || '';
    img.alt = '';
    const text = document.createElement('p');
    text.textContent = name;
    const small = document.createElement('small');
    small.textContent = sub || '';
    text.append(small);
    if (onRemove) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${name}`);
      remove.addEventListener('click', onRemove);
      text.append(document.createElement('br'), remove);
    }
    const amount = document.createElement('span');
    amount.className = 'amount';
    amount.textContent = priceText;
    li.append(img, text, amount);
    return li;
  }

  function renderBag() {
    const items = bag();
    show('emptyBag', !items.length);
    show('checkout', items.length > 0);
    $('lines').replaceChildren(...items.map(sku => {
      const p = info.get(sku);
      return lineItem(p.name, p.sub, p.price_text, p.image, () => { writeBag(readBag().filter(s => s !== sku)); invalidateQuote(); renderBag(); });
    }));
    renderTotals();
  }

  function renderTotals() {
    const items = quote ? quote.items_cents : bag().reduce((sum, sku) => sum + (info.get(sku)?.price_cents || 0), 0);
    $('tItems').textContent = money(items);
    let shipping = null;
    if (quote && quote.fulfillment === 'pickup') shipping = 0;
    if (quote && quote.fulfillment === 'ship' && rateId) shipping = quote.rates.find(r => r.id === rateId)?.amount_cents ?? null;
    $('tShipLabel').textContent = fulfillment() === 'pickup' ? 'Pickup' : 'Shipping';
    $('tShip').textContent = shipping === null ? (fulfillment() === 'pickup' ? 'Free' : 'Choose below') : (shipping === 0 ? 'Free' : money(shipping));
    const tax = quote ? quote.tax_cents : 0;
    show('tTaxRow', tax > 0);
    $('tTax').textContent = money(tax);
    const total = shipping === null ? null : items + shipping + tax;
    $('tTotal').textContent = total === null ? '—' : money(total);
    const ready = Boolean(quote) && total !== null && !busy && (card || config?.square?.mode === 'mock');
    $('payButton').disabled = !ready;
    $('payButton').textContent = total === null ? 'Pay' : `Pay ${money(total)}`;
    return total;
  }

  function renderRates() {
    const box = $('rates');
    box.replaceChildren();
    if (!quote || quote.fulfillment !== 'ship') return;
    quote.rates.forEach((rate, index) => {
      const label = document.createElement('label');
      label.className = 'choice';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'rate';
      input.value = rate.id;
      input.checked = rate.id === rateId || (!rateId && index === 0);
      if (input.checked) rateId = rate.id;
      input.addEventListener('change', () => { rateId = rate.id; renderTotals(); });
      const text = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = `${rate.provider} ${rate.service}`;
      const small = document.createElement('small');
      small.textContent = rate.days ? `About ${rate.days} business day${rate.days === 1 ? '' : 's'}` : (rate.terms || '');
      text.append(strong, small);
      const price = document.createElement('span');
      price.className = 'price';
      price.textContent = money(rate.amount_cents);
      label.append(input, text, price);
      box.append(label);
    });
  }

  function invalidateQuote() {
    quote = null;
    rateId = null;
    attempt = null;
    $('rates').replaceChildren();
    renderTotals();
  }

  // ---- address check (server: Shippo validation; the server also refuses to take payment for an unconfirmed address) -------
  function addressLines(a) { return [a.street1 + (a.street2 ? ' ' + a.street2 : ''), `${a.city}, ${a.state} ${a.zip}`]; }
  const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  /** One address as a tappable card (a real button: focus ring, aria-pressed). */
  function addressCard(title, a, other, action, chosen, onPick, id) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'addr-card' + (other ? ' suggested' : '') + (chosen ? ' chosen' : '');
    if (id) card.id = id;
    card.setAttribute('aria-pressed', chosen ? 'true' : 'false');
    const head = document.createElement('span');
    head.className = 'addr-card-title';
    head.textContent = title;
    const body = document.createElement('address');
    const mine = other ? addressLines(other) : null;
    addressLines(a).forEach((line, i) => {
      const row = document.createElement('div');
      row.textContent = line;
      if (mine && norm(mine[i]).replace(/ \d{4}$/, '') !== norm(line).replace(/ \d{4}$/, '')) row.className = 'addr-diff';
      body.append(row);
    });
    const foot = document.createElement('span');
    foot.className = 'addr-card-action';
    foot.textContent = chosen ? '✓ Using this address' : action;
    card.append(head, body, foot);
    card.addEventListener('click', () => onPick());
    return card;
  }
  /** "You typed" + "Suggested" (or just "You typed" when a unit is missing); tapping a card picks it. chosen: 'suggested' | 'mine' | null. */
  function addressChoiceCards(entered, suggestion, chosen, onPickSuggested, onPickMine, ids) {
    const cards = document.createElement('div');
    cards.className = 'addr-cards';
    cards.setAttribute('role', 'group');
    cards.setAttribute('aria-label', 'Choose the address to ship to');
    cards.append(addressCard('You typed', entered, suggestion || null, suggestion ? 'Keep mine' : 'There is no apartment: keep my address', chosen === 'mine', onPickMine, ids && ids[1]));
    if (suggestion) cards.prepend(addressCard('Suggested', suggestion, entered, 'Use this address', chosen === 'suggested', onPickSuggested, ids && ids[0]));
    return cards;
  }


  // ---- address check while typing (POST checkout/address-check; the answer shows right under the address fields) -----------------
  // Complete = street, city, state and a 5-digit ZIP. Checked after a 0.8 s pause or when a field is left; only when the normalized
  // address changed. Answers are kept for this page visit, so the quote/payment flow reuses them (it sends address_choice for the
  // shopper's pick) and the same address never goes to the server twice. "Check unavailable" shows nothing and never blocks anything.
  const LIVE_PAUSE_MS = 500;
  const live = { key: '', inflight: '', picked: null, wantRates: false, results: new Map(), choices: new Map(), timer: null };
  function addressKey(a) {
    return [a.street1, a.street2, a.city, a.state, String(a.zip || '').slice(0, 5)].map(norm).join('|');
  }
  function addressComplete(a) { return Boolean(a.street1 && a.city && a.state && /^\d{5}(-?\d{4})?$/.test(a.zip)); }
  function liveLine() {
    let line = document.getElementById('addrLive');
    if (!line) {
      line = document.createElement('div');
      line.id = 'addrLive';
      line.className = 'addr-live';
      line.setAttribute('aria-live', 'polite');
      $('getRates').closest('.row-actions').insertAdjacentElement('beforebegin', line);
      if (!document.getElementById('addrCss')) {
        const link = document.createElement('link');
        link.id = 'addrCss'; link.rel = 'stylesheet'; link.href = CSS_URL;
        document.head.append(link);
      }
    }
    return line;
  }
  function liveText(cls, text) {
    const line = liveLine();
    const p = document.createElement('p');
    p.className = 'addr-live-msg ' + cls;
    p.textContent = text;
    line.replaceChildren(p);
    return { line, p };
  }
  function liveClear() { const line = document.getElementById('addrLive'); if (line) line.replaceChildren(); }
  function liveShow(key, a) {
    if (key !== live.key) return;
    const result = live.results.get(key);
    const choice = live.choices.get(key);
    if (!result || result.status === 'unchecked') { liveClear(); return; }
    const confirmed = result.status === 'valid' || choice === 'ok' || choice === 'mine';
    if (confirmed) prefetchQuote();   // address found or picked: the shipping prices are fetched now, before the button is pressed
    const picked = live.picked && live.picked.key === key ? live.picked : null;
    if (picked) { if (picked.open) liveCards(picked.entered, picked.suggestion, picked.which); else liveChosen(picked); return; }   // chosen: one line, "Change" reopens the cards
    if (result.status === 'valid' || choice === 'ok') { liveText('ok', '✓ Address found'); return; }
    if (result.status === 'suggest' && choice === 'mine') { liveText('ok', '✓ Using the address as you typed it'); return; }
    if (result.status === 'invalid') { liveText('bad', "We can't find this address. Check the street number, city and ZIP."); return; }
    if (result.status === 'unit_needed') {
      if (choice === 'mine') { liveText('ok', '✓ No apartment number'); return; }
      const { line, p } = liveText('warn', "Add an apartment, suite or unit number, or tick 'No apartment number'. ");
      const label = document.createElement('label');
      label.className = 'addr-live-tick';
      const box = document.createElement('input');
      box.type = 'checkbox'; box.id = 'addrNoUnit';
      box.addEventListener('change', () => { if (box.checked) { live.choices.set(key, 'mine'); liveShow(key, a); if (live.wantRates) { live.wantRates = false; getQuote(); } } });
      label.append(box, document.createTextNode(' No apartment number'));
      line.append(label);
      return;
    }
    if (result.status === 'suggest' && result.suggestion) { liveCards(address(), result.suggestion, null); return; }
    liveClear();
  }
  /** "Did you mean …?" under the fields: both addresses as tappable cards (the suggested card = use it, your own card = keep it). The ONLY place the choice is shown. */
  function liveCards(entered, suggestion, which) {
    const { line } = liveText('warn', 'Did you mean this address? Tap the one to use.');
    const cards = addressChoiceCards(entered, suggestion, which,
      () => pickCard('suggested', entered, suggestion), () => pickCard('mine', entered, suggestion), ['addrLiveUse', 'addrLiveKeep']);
    line.append(cards);
  }
  /** After a tap the choice collapses to one line with the address that will be used. */
  function liveChosen(picked) {
    const used = picked.which === 'mine' ? picked.entered : picked.suggestion;
    const { line, p } = liveText('ok', '✓ Shipping to: ' + shipping_line(used) + ' · ');
    const change = document.createElement('button');
    change.type = 'button'; change.id = 'addrChange'; change.className = 'addr-change'; change.textContent = 'Change';
    change.addEventListener('click', () => { picked.open = true; liveShow(live.key, address()); const first = document.querySelector('#addrLive .addr-card'); if (first) first.focus(); });
    p.append(change);
  }
  function setFields(a) {
    ['street1', 'street2', 'city', 'zip'].forEach(id => { $(id).value = a[id] || ''; });
    $('state').value = a.state || '';
  }
  function pickCard(which, entered, suggestion) {
    const target = which === 'mine' ? entered : suggestion;
    setFields(target);
    invalidateQuote();
    const key = addressKey(address());
    live.key = key;
    if (which === 'mine') { if (!live.results.has(key)) live.results.set(key, { status: 'suggest', suggestion }); live.choices.set(key, 'mine'); }
    else live.results.set(key, { status: 'valid' });
    live.picked = { key, entered, suggestion, which, open: false };
    liveShow(key, address());
    if (live.wantRates) { live.wantRates = false; getQuote(); }   // the shopper had pressed "Show shipping options": carry on to the rates
  }
  /** The choice (Did you mean / apartment?) is open for the address as it is now and nothing has been picked. */
  function liveChoiceOpen() {
    const key = addressKey(address());
    const r = live.results.get(key);
    if (!r || key !== live.key || live.choices.get(key)) return false;
    if (live.picked && live.picked.key === key) return false;
    return (r.status === 'suggest' && Boolean(r.suggestion)) || r.status === 'unit_needed';
  }
  /** Bring the one choice box into view with a short highlight and a one-line reminder. */
  function liveAttention(text) {
    const line = liveLine();
    live.wantRates = true;
    let note = document.getElementById('addrAttn');
    if (!note) { note = document.createElement('p'); note.id = 'addrAttn'; note.className = 'addr-live-msg bad'; note.setAttribute('role', 'alert'); line.prepend(note); }
    note.textContent = text;
    line.classList.remove('attn'); void line.offsetWidth; line.classList.add('attn');
    setTimeout(() => line.classList.remove('attn'), 1600);
    line.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function shipping_line(s) { return addressLines(s).join(', '); }
  /** One address into the five fields; the shopper's own pick is "verified", so it shows ✓ without another call. */
  function fillAddress(s, verified) {
    ['street1', 'street2', 'city', 'zip'].forEach(id => { $(id).value = s[id] || ''; });
    $('state').value = s.state || '';
    invalidateQuote();
    const a = address();
    live.key = addressKey(a);
    if (verified) { live.results.set(live.key, { status: 'valid' }); liveShow(live.key, a); }
    else { live.key = ''; liveCheck(true); }
  }
  function useSuggestion(s) { fillAddress(s, true); }
  /**
   * Hook for a future type-ahead dropdown (no street-autocomplete service is chosen yet; nothing outside is called now):
   * a picked suggestion {street1, street2, city, state, zip} fills the five fields and runs the same address check.
   * window.ThomKatCheckout.pickAddress(suggestion) calls it.
   */
  function pickAddress(suggestion) { fillAddress(suggestion, false); }
  async function liveCheck(now) {
    clearTimeout(live.timer);
    if (fulfillment() !== 'ship') { liveClear(); return; }
    const a = address();
    if (!addressComplete(a)) { live.key = ''; liveClear(); return; }
    const key = addressKey(a);
    if (key === live.key && (live.results.has(key) || live.inflight === key)) return;   // unchanged: nothing is redrawn either (a focused card must stay)   // unchanged: no second check
    live.key = key;
    if (live.results.has(key)) { liveShow(key, a); return; }
    liveClear();
    live.inflight = key;
    try {
      const data = await api('checkout/address-check', { method: 'POST', body: a });
      live.results.set(key, { status: data.status, message: data.message, suggestion: data.suggestion });
    } catch (e) {
      live.results.set(key, { status: 'unchecked' });   // down, limited or closed: stay quiet, never block
    }
    if (live.inflight === key) live.inflight = '';
    liveShow(key, address());
  }
  function liveSoon() {
    clearTimeout(live.timer);
    const a = address();
    if (!addressComplete(a)) { live.key = ''; liveClear(); return; }
    live.timer = setTimeout(liveCheck, LIVE_PAUSE_MS);
  }
  /** What the quote should tell the server about the shopper's pick for the address as it is now ('mine' | null). */
  function liveChoice() {
    const key = addressKey(address());
    return live.choices.get(key) === 'mine' ? 'mine' : null;
  }
  window.ThomKatCheckout = Object.assign(window.ThomKatCheckout || {}, { pickAddress });


  // ---- quotes ------------------------------------------------------------------------------------
  function address() {
    return { name: $('name').value.trim(), street1: $('street1').value.trim(), street2: $('street2').value.trim(),
      city: $('city').value.trim(), state: $('state').value, zip: $('zip').value.trim() };
  }
  function contact() {
    return { name: $('name').value.trim(), email: $('email').value.trim(), phone: $('phone').value.trim() };
  }

  // Prefetch: once the address is found (or the shopper picked "Use this" / "Keep mine") the quote is fetched in the background for that
  // address + bag. Pressing "Show shipping options" then shows it at once if nothing changed; one request per address+bag at a time;
  // a background answer for an address or bag that has changed since is thrown away; a failed background request is silent.
  const prefetch = { requested: new Set(), key: '', inflight: null, result: null };
  const PREFETCH_MAX_AGE_MS = 10 * 60 * 1000;   // the server keeps a quote 30 minutes
  function quoteRequest(choice) {
    const items = bag();
    const body = { items, fulfillment: fulfillment(), contact: contact() };
    if (body.fulfillment === 'ship') {
      body.address = address();
      if (!choice) choice = liveChoice();
      if (choice) body.address_choice = choice;
    }
    return { body, key: JSON.stringify([body.items, body.fulfillment, body.address || null, body.address_choice || null, body.contact]) };
  }
  function prefetchQuote() {
    if (fulfillment() !== 'ship' || !bag().length) return;
    const a = address();
    if (!a.name || !addressComplete(a)) return;
    const { body, key } = quoteRequest(null);
    if (prefetch.requested.has(key)) return;
    prefetch.requested.add(key);
    const entry = { key, at: Date.now(), data: null };
    prefetch.inflight = entry;
    entry.promise = api('checkout/quote', { method: 'POST', body }).then(data => { entry.data = data; }, () => { entry.data = null; }).then(() => {
      if (prefetch.inflight === entry) prefetch.inflight = null;
      if (entry.data && !entry.data.quote.address_check?.needs_choice) prefetch.result = entry;
    });
  }
  async function getQuote(choice) {
    if (typeof choice !== 'string') choice = null;   // a click event or nothing
    message('deliveryError', '');
    const items = bag();
    if (!items.length) return;
    if (fulfillment() === 'ship') {
      const a = address();
      if (!a.name) { message('deliveryError', 'Please enter your name in step 1 (it goes on the shipping label).'); $('name').focus(); return; }
      if (!a.street1 || !a.city || !a.state || !a.zip) { message('deliveryError', 'Please fill in the street, city, state and ZIP.'); return; }
    }
    if (fulfillment() === 'ship' && !choice && liveChoiceOpen()) {   // the choice is already open under the fields: no second box, no fetch
      const r = live.results.get(live.key);
      liveAttention(r.status === 'unit_needed' ? "Add an apartment or tick 'No apartment number' first" : 'Tap the address to use first');
      return;
    }
    const { body, key } = quoteRequest(choice);
    prefetch.requested.add(key);   // asked now: no background copy of it later
    $('getRates').disabled = true;
    $('getRates').textContent = 'Finding rates…';
    try {
      let data = null;
      if (prefetch.inflight && prefetch.inflight.key === key) await prefetch.inflight.promise;   // never a second request for the same address + bag
      const ready = prefetch.result;
      prefetch.result = null;
      if (ready && ready.key === key && Date.now() - ready.at < PREFETCH_MAX_AGE_MS) data = ready.data;   // background answer, nothing changed
      if (!data) data = await api('checkout/quote', { method: 'POST', body });
      const check = data.quote.address_check;
      if (check && check.needs_choice) {   // the server wants a choice we do not have yet: show it in the one box under the fields
        invalidateQuote();
        const k = addressKey(address());
        live.key = k;
        live.results.set(k, { status: check.status, message: check.message, suggestion: check.suggestion });
        liveShow(k, address());
        liveAttention(check.status === 'unit_needed' ? "Add an apartment or tick 'No apartment number' first" : 'Tap the address to use first');
        return;
      }
      quote = data.quote;
      rateId = null;
      if (body.fulfillment === 'ship' && quote.address && check && check.status !== 'unchecked') {   // show the address that will be shipped to
        ['street1', 'street2', 'city', 'zip'].forEach(id => { $(id).value = quote.address[id] || ''; });
        $('state').value = quote.address.state;
        prefetch.requested.add(quoteRequest(null).key);   // this address is quoted already
        live.key = addressKey(address()); live.results.set(live.key, { status: 'valid' }); liveShow(live.key, address());   // the address the quote confirmed
      }
      renderRates();
      renderTotals();
    } catch (error) {
      invalidateQuote();
      handleUnavailable(error);
      message('deliveryError', error.code === 'address_invalid' ? error.message + ' Fix it above, then press “Show shipping options” again.' : error.message);
    } finally {
      $('getRates').disabled = false;
      $('getRates').textContent = 'Show shipping options';
    }
  }

  function handleUnavailable(error) {
    const gone = error.data?.unavailable;
    if (['unavailable', 'piece_sold'].includes(error.code) && Array.isArray(gone) && gone.length) {
      writeBag(readBag().filter(sku => !gone.includes(sku)));
      renderBag();
      const names = gone.map(sku => info.get(sku)?.name).filter(Boolean);
      error.message = error.code === 'piece_sold'   // checked with eBay right before charging: it sold there, nothing was charged
        ? `Sorry, ${names.length ? names.join(', ') : 'this piece'} just sold. Your card was not charged. We took it out of your bag.`
        : `${names.length ? names.join(', ') : 'A piece'} just sold or is on hold, so we took it out of your bag.`;
      if (bag().length) error.message += ' Please check your order again.';
    }
  }

  // ---- Square card form --------------------------------------------------------------------------
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      const timer = setTimeout(() => reject(new Error('The payment form took too long to load. Please reload the page.')), 20000);
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = () => { clearTimeout(timer); reject(new Error('The payment form could not load. Check your connection and reload the page.')); };
      document.head.append(script);
    });
  }

  async function setupPayment() {
    const square = config.square;
    if (!square.available) { message('payError', 'Card payments are not set up yet. Please call the boutique at 224.474.4625.'); return; }
    if (square.mode === 'mock') {
      show('mockCard', true);
      show('cardContainer', false);
      $('cardHelp').textContent = 'Test mode: pick a pretend card below. No money moves.';
      renderTotals();
      return;
    }
    if (square.mode === 'sandbox') $('cardHelp').textContent = 'Square sandbox: use test card 4111 1111 1111 1111, any future date, CVV 111, ZIP 12345.';
    try {
      if (!window.Square) await loadScript(square.sdkUrl);
      const payments = window.Square.payments(square.applicationId, square.locationId);
      card = await payments.card({ style: { '.input-container': { borderRadius: '12px', borderColor: '#171217' }, input: { color: '#171217' } } });
      await card.attach('#cardContainer');
      renderTotals();
    } catch (error) {
      message('payError', error.message || 'The payment form could not start. Please reload the page.');
    }
  }

  // ---- pay ---------------------------------------------------------------------------------------
  async function pay() {
    if (busy) return;
    message('payError', '');
    const c = contact();
    if (!c.name) { message('payError', 'Please enter your name.'); $('name').focus(); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) { message('payError', 'Please enter a valid email address for your receipt.'); $('email').focus(); return; }
    if (!quote) { message('payError', 'Please choose delivery first.'); return; }
    if (quote.fulfillment === 'ship' && !rateId) { message('payError', 'Please choose a shipping option.'); return; }
    const total = renderTotals();
    busy = true;
    renderTotals();
    message('payStatus', 'Processing your payment…');
    try {
      if (!attempt) {
        let source;
        let verification = '';
        if (config.square.mode === 'mock') {
          source = document.querySelector('input[name="mockCard"]:checked')?.value || 'mock-ok';
        } else {
          const [givenName, ...rest] = c.name.split(/\s+/);
          const billing = { givenName, familyName: rest.join(' '), email: c.email, countryCode: 'US' };
          if (c.phone) billing.phone = c.phone;
          if (quote.fulfillment === 'ship') {
            const a = address();
            Object.assign(billing, { addressLines: [a.street1, a.street2].filter(Boolean), city: a.city, state: a.state, postalCode: a.zip });
          }
          const result = await card.tokenize({ amount: (total / 100).toFixed(2), currencyCode: 'USD', intent: 'CHARGE', customerInitiated: true, sellerKeyedIn: false, billingContact: billing });
          if (result.status !== 'OK') throw Object.assign(new Error(result.errors?.map(e => e.message).filter(Boolean).join(' ') || 'Please check your card details.'), { code: 'card_form' });
          source = result.token;
          verification = result.details?.verificationToken || '';
        }
        attempt = { key: newKey(), source, verification };
      }
      const body = { quote_id: quote.quote_id, rate_id: rateId, contact: c, source_id: attempt.source, idempotency_key: attempt.key };
      if (attempt.verification) body.verification_token = attempt.verification;
      const data = await api('checkout/pay', { method: 'POST', body });
      writeBag(readBag().filter(sku => !data.order.items.some(item => item.sku === sku)));
      history.replaceState(null, '', `checkout.html?order=${data.order.token}`);
      saveAccountDetails();
      showDone(data.order);
    } catch (error) {
      message('payStatus', '');
      if (error instanceof TypeError) {
        // Network trouble: the same attempt (same key + card token) can be retried without a double charge.
        message('payError', 'Connection problem. Please press Pay again — you will not be charged twice.');
      } else if (/^http_5\d\d$/.test(error.code || '')) {
        // A gateway error page (not our JSON): the charge may have gone through. Keep the attempt: same key + card token, so a retry cannot charge twice.
        message('payError', 'We could not confirm the payment yet. Please press Pay again — you will not be charged twice.');
      } else {
        attempt = null;
        if (error.code === 'payment_unknown' && error.data?.order?.token) {
          // Keep the order's own link in the address bar (bookmark, reload, come back later to see how it ended).
          history.replaceState(null, '', `checkout.html?order=${error.data.order.token}`);
          showDone(error.data.order);
          return;
        }
        handleUnavailable(error);
        if (['quote_expired', 'price_changed', 'unavailable', 'piece_sold', 'address_unconfirmed'].includes(error.code)) {
          invalidateQuote();
          if (bag().length && (fulfillment() === 'pickup' || address().zip)) await getQuote();
        }
        message('payError', error.message);
      }
    } finally {
      busy = false;
      renderTotals();
    }
  }

  // ---- order view (after paying, or checkout.html?order=TOKEN) -----------------------------------
  function showDone(order) {
    show('checkout', false);
    show('emptyBag', false);
    show('pageLede', false);
    $('pageTitle').hidden = true;
    show('doneBox', true);
    $('doneNumber').textContent = `Order ${order.number}`;
    const paid = ['paid', 'partially_refunded', 'refunded'].includes(order.status);
    $('doneKicker').textContent = paid ? 'Thank you' : order.status === 'failed' ? 'Payment problem' : 'Almost there';
    $('doneTitle').textContent = order.status === 'refunded' ? 'This order was refunded.' : paid ? 'Your order is in.' : order.status === 'failed' ? 'The payment did not go through.' : 'We are confirming your payment.';
    let text = '';
    if (order.status === 'failed') text = (order.payment_error || 'No charge was made.') + ' You can return to the boutique and try again.';
    else if (!paid) text = 'Please do not pay again. We will email you as soon as we know whether it went through. You can also come back to this page (bookmark it) to check.';
    else if (order.fulfillment === 'pickup') {
      // email_coming: the shop sends the confirmation right after this answer (it no longer waits for the emails before answering).
      text = `Pick it up at ${order.pickup?.address || 'the boutique'}. ` + (order.email_sent
        ? `We emailed a confirmation to ${order.email} and will email again when it is ready.`
        : order.email_coming
          ? `A confirmation email is on its way to ${order.email}; we will email again when it is ready.`
          : `We will contact you when it is ready — questions? Call ${order.pickup?.phone || '224.474.4625'}.`);
    } else {
      text = (order.email_sent || order.email_coming ? `A confirmation email is on its way to ${order.email}. ` : '') + `We ship to ${order.ship_to?.name || ''}, ${order.ship_to?.city || ''} ${order.ship_to?.state || ''}.`;
      if (order.shipping?.tracking_number) text += ` Tracking: ${order.shipping.carrier || ''} ${order.shipping.tracking_number}.`;
    }
    if (paid) text += ' Bookmark this page to check on your order.';
    if (order.test_payment) text += ' (Test order — no real money moved.)';
    $('doneText').textContent = text;
    $('doneLines').replaceChildren(...order.items.map(item => lineItem(item.name, item.refunded ? 'Refunded' : `SKU ${item.sku}`, money(item.price_cents), item.image)));
    const rows = [['Pieces', order.items_cents], [order.fulfillment === 'pickup' ? 'Pickup' : 'Shipping', order.shipping_cents]];
    if (order.tax_cents) rows.push(['Sales tax', order.tax_cents]);
    if (order.refunded_cents) rows.push(['Refunded', -order.refunded_cents]);
    $('doneTotals').replaceChildren(...rows.map(([label, cents]) => {
      const div = document.createElement('div');
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = cents === 0 && label !== 'Pieces' ? 'Free' : money(cents);
      div.append(dt, dd);
      return div;
    }), (() => {
      const div = document.createElement('div');
      div.className = 'grand';
      const dt = document.createElement('dt'); dt.textContent = 'Total paid';
      const dd = document.createElement('dd'); dd.textContent = money(order.total_cents);
      div.append(dt, dd);
      return div;
    })());
    if (order.receipt_url && !order.test_payment) { $('doneReceipt').href = order.receipt_url; show('doneReceipt', true); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---- start ---------------------------------------------------------------------------------------
  async function init() {
    STATES.forEach(code => { const o = document.createElement('option'); o.value = code; o.textContent = code; $('state').append(o); });
    const params = new URLSearchParams(location.search);
    try {
      config = (await api('config'));
    } catch {
      show('offline', true);
      return;
    }
    if (config.checkout_open === false) {   // the site is live, online payments are not switched on yet
      message('offline', `Online checkout opens soon. To buy these pieces now, call the boutique at ${config.phone || '224.474.4625'} and we’ll hold them for you.`);
      return;
    }
    if (config.checkout_owner_only) {   // CHECKOUT_OPEN=owner: only a browser signed in to the admin gets here
      $('testBanner').textContent = config.test_mode
        ? `Owner test checkout (customers still see “call to buy”). Payments: ${config.square.mode}, no real charges.`
        : 'Owner test checkout: customers still see “call to buy”. This charges a REAL card — refund the order in the admin afterwards.';
      show('testBanner', true);
    } else if (config.test_mode) {
      $('testBanner').textContent = `Test mode — payments: ${config.square.mode}, shipping: ${config.shipping.provider}. No real charges.`;
      show('testBanner', true);
    }
    if (params.get('order')) {
      try {
        showDone((await api('orders/' + encodeURIComponent(params.get('order')))).order);
      } catch (error) {
        message('offline', error.message);
      }
      return;
    }
    try {
      info = await loadInfo();
    } catch {
      show('offline', true);
      return;
    }
    const pickup = config.shipping.pickup;
    show('pickupChoice', Boolean(pickup));
    if (pickup) $('pickupText').textContent = pickup.address;
    renderBag();
    if (!bag().length) return;
    document.querySelectorAll('input[name="fulfillment"]').forEach(input => input.addEventListener('change', () => {
      invalidateQuote();
      message('deliveryError', '');
      show('addressBox', fulfillment() === 'ship');
      if (fulfillment() === 'pickup') getQuote();
    }));
    ['street1', 'street2', 'city', 'state', 'zip'].forEach(id => {
      $(id).addEventListener('input', () => { if (quote && quote.fulfillment === 'ship') invalidateQuote(); liveSoon(); });
      $(id).addEventListener('change', () => liveCheck());   // leaving the field (or picking a state) checks at once
    });
    liveLine();   // the aria-live region exists before anything is said in it
    $('getRates').addEventListener('click', getQuote);
    $('payButton').addEventListener('click', pay);
    $('zip').addEventListener('keydown', event => { if (event.key === 'Enter') getQuote(); });
    accountPrefill();
    await setupPayment();
  }

  // ---- customer accounts (account.html; shop/lib/customers.php) ------------------------------------
  // Signed in: the saved name, email, phone and address are filled into empty boxes, and "Save these details" keeps
  // what was typed for next time. Signed out: a small "Sign in" link that comes back here.
  let account = null;
  const INLINE = 'margin:-6px 0 14px;font-size:14px;line-height:1.5;color:#6b6166';
  function accountApi(path, method, body) {
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'ThomKat' };
    if (account && account.csrf) headers['X-CSRF-Token'] = account.csrf;
    return fetch('shop/api/' + path, { method: method || 'GET', credentials: 'same-origin', headers, body: body ? JSON.stringify(body) : undefined }).then(r => r.json());
  }
  async function accountPrefill() {
    let flag = null;
    try { flag = localStorage.getItem('thomkat.account.v1'); } catch (e) { /* storage blocked */ }
    const title = $('contactTitle');
    const signInLink = () => {
      if (!title || document.getElementById('acctSignIn')) return;
      const p = document.createElement('p');
      p.className = 'acct-inline';
      p.id = 'acctSignIn';
      p.style.cssText = INLINE;
      p.innerHTML = 'Have an account? <a href="account.html?next=checkout.html" style="color:#b52f62;text-decoration:underline;font-weight:600">Sign in</a> to fill this in.';
      title.insertAdjacentElement('afterend', p);
    };
    if (flag !== '1') { signInLink(); return; }
    try {
      const me = await accountApi('account/me');
      if (!me || !me.signed_in) { signInLink(); return; }
      account = me;
      const fill = (id, value) => { const box = $(id); if (box && !box.value && value) { box.value = value; box.dispatchEvent(new Event('input')); } };
      const a = me.address || {};
      fill('name', a.name || me.name);
      fill('email', me.email);
      fill('phone', me.phone);
      fill('street1', a.street1); fill('street2', a.street2); fill('city', a.city); fill('zip', a.zip);
      if (a.state && $('state') && !$('state').value) { $('state').value = a.state; $('state').dispatchEvent(new Event('input')); }
      if (title && !document.getElementById('acctSaveBox')) {
        const p = document.createElement('p');
        p.className = 'acct-inline';
        p.style.cssText = INLINE;
        p.textContent = 'Signed in as ' + me.email + '. ';
        const label = document.createElement('label');
        label.id = 'acctSaveBox';
        const box = document.createElement('input');
        box.type = 'checkbox'; box.id = 'acctSave'; box.checked = true;
        label.append(box, document.createTextNode(' Save these details to my account'));
        p.append(label);
        title.insertAdjacentElement('afterend', p);
      }
    } catch (e) { signInLink(); }
  }
  function saveAccountDetails() {
    if (!account || !$('acctSave') || !$('acctSave').checked) return;
    const c = contact();
    const body = { name: c.name, phone: c.phone };
    if (fulfillment() === 'ship') body.address = address();
    accountApi('account/details', 'POST', body).catch(() => { /* the order is placed; details just aren't saved */ });
  }

  init();
})();
