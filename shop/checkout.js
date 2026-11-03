// ThomKat checkout: bag -> contact -> ship (live rates) or free pickup -> Square card -> order.
// The server prices everything; this page only sends SKUs, the chosen rate and a Square card token.
(function () {
  'use strict';
  const API = new URL('api/', document.currentScript.src).href;
  const SITE = new URL('../', document.currentScript.src).href;   // site root (this file is shop/checkout.js)
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

  // ---- quotes ------------------------------------------------------------------------------------
  function address() {
    return { name: $('name').value.trim(), street1: $('street1').value.trim(), street2: $('street2').value.trim(),
      city: $('city').value.trim(), state: $('state').value, zip: $('zip').value.trim() };
  }
  function contact() {
    return { name: $('name').value.trim(), email: $('email').value.trim(), phone: $('phone').value.trim() };
  }

  async function getQuote() {
    message('deliveryError', '');
    const items = bag();
    if (!items.length) return;
    const body = { items, fulfillment: fulfillment(), contact: contact() };
    if (body.fulfillment === 'ship') {
      const a = address();
      if (!a.name) { message('deliveryError', 'Please enter your name in step 1 (it goes on the shipping label).'); $('name').focus(); return; }
      if (!a.street1 || !a.city || !a.state || !a.zip) { message('deliveryError', 'Please fill in the street, city, state and ZIP.'); return; }
      body.address = a;
    }
    $('getRates').disabled = true;
    $('getRates').textContent = 'Finding rates…';
    try {
      const data = await api('checkout/quote', { method: 'POST', body });
      quote = data.quote;
      rateId = null;
      renderRates();
      renderTotals();
    } catch (error) {
      invalidateQuote();
      handleUnavailable(error);
      message('deliveryError', error.message);
    } finally {
      $('getRates').disabled = false;
      $('getRates').textContent = 'Show shipping options';
    }
  }

  function handleUnavailable(error) {
    const gone = error.data?.unavailable;
    if (error.code === 'unavailable' && Array.isArray(gone) && gone.length) {
      writeBag(readBag().filter(sku => !gone.includes(sku)));
      renderBag();
      const names = gone.map(sku => info.get(sku)?.name).filter(Boolean);
      error.message = `${names.length ? names.join(', ') : 'A piece'} just sold or is on hold, so we took it out of your bag.` + (bag().length ? ' Please check your order again.' : '');
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
    if (!square.available) { message('payError', 'Card payments are not set up yet. Please call the boutique at 630.615.0640.'); return; }
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
      showDone(data.order);
    } catch (error) {
      message('payStatus', '');
      if (error instanceof TypeError) {
        // Network trouble: the same attempt (same key + card token) can be retried without a double charge.
        message('payError', 'Connection problem. Please press Pay again — you will not be charged twice.');
      } else {
        attempt = null;
        if (error.code === 'payment_unknown' && error.data?.order?.token) {
          showDone(error.data.order);
          return;
        }
        handleUnavailable(error);
        if (['quote_expired', 'price_changed', 'unavailable'].includes(error.code)) {
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
    else if (!paid) text = 'Please do not pay again. We will email you as soon as Square confirms it.';
    else if (order.fulfillment === 'pickup') {
      text = `Pick it up at ${order.pickup?.address || 'the boutique'}. ` + (order.email_sent
        ? `We emailed a confirmation to ${order.email} and will email again when it is ready.`
        : `We will contact you when it is ready — questions? Call ${order.pickup?.phone || '630.615.0640'}.`);
    } else {
      text = (order.email_sent ? `A confirmation email is on its way to ${order.email}. ` : '') + `We ship to ${order.ship_to?.name || ''}, ${order.ship_to?.city || ''} ${order.ship_to?.state || ''}.`;
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
    if (config.test_mode) {
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
      const response = await fetch(SITE + 'products/products.json', { cache: 'no-store' });
      const data = await response.json();
      info = new Map(data.products.map(p => {
        const price = p.sale_price ?? p.price ?? p.regular_price;
        return [String(p.sku), { name: p.name, sub: p.sub, price_text: p.price_text, price_cents: price ? Math.round(price * 100) : 0, image: p.images?.[0]?.thumb || p.images?.[0]?.card }];
      }));
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
    ['street1', 'street2', 'city', 'state', 'zip'].forEach(id => $(id).addEventListener('input', () => { if (quote && quote.fulfillment === 'ship') invalidateQuote(); }));
    $('getRates').addEventListener('click', getQuote);
    $('payButton').addEventListener('click', pay);
    $('zip').addEventListener('keydown', event => { if (event.key === 'Enter') getQuote(); });
    await setupPayment();
  }

  init();
})();
