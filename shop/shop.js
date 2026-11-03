// ThomKat shop: the shopping bag (kept in this browser) and live sold / on-hold states.
// Loaded at the end of index.html, after the page's own scripts. Pieces are one of a kind, so the
// bag holds SKUs only; prices and availability always come from the shop API at checkout.
(function () {
  'use strict';
  const API = new URL('api/', document.currentScript.src).href;
  const BAG_KEY = 'thomkat.bag.v1';
  const products = JSON.parse(document.getElementById('productData')?.textContent || '[]');
  const bySku = new Map(products.map(p => [String(p.sku), p]));
  const byName = new Map(products.map(p => [p.name, p]));
  const live = new Map();          // sku -> available | on_hold | sold | hidden | unpriced (from the API)
  const say = message => (typeof window.showToast === 'function' ? window.showToast(message) : console.log(message));

  // localStorage can be blocked (private browsing): fall back to a bag that lasts for this page.
  let storageOk = true;
  function readBag() {
    try {
      const raw = localStorage.getItem(BAG_KEY);
      return raw === null ? [] : JSON.parse(raw).filter(sku => typeof sku === 'string' && bySku.has(sku));
    } catch { storageOk = false; return null; }
  }
  let memoryBag = readBag() || [];
  const bag = () => { const stored = storageOk ? readBag() : null; return stored === null ? memoryBag : stored; };
  function setBag(items) {
    memoryBag = [...new Set(items)];
    try { localStorage.setItem(BAG_KEY, JSON.stringify(memoryBag)); } catch { storageOk = false; }
    render();
  }

  // ---- drawer --------------------------------------------------------------------------------
  const backdrop = document.createElement('div');
  backdrop.className = 'tk-bag-backdrop';
  const drawer = document.createElement('aside');
  drawer.className = 'tk-bag';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', 'Your bag');
  drawer.innerHTML = `
    <div class="tk-bag-head"><h2>Your bag</h2><button class="tk-bag-close" type="button" aria-label="Close your bag">×</button></div>
    <ul class="tk-bag-list"></ul>
    <div class="tk-bag-foot">
      <div class="tk-bag-total"><span>Subtotal</span><span class="tk-bag-subtotal mono">$0.00</span></div>
      <p class="tk-bag-note">Shipping or free in-store pickup is chosen at checkout.</p>
      <a class="tk-bag-checkout" href="checkout.html">Checkout</a>
      <button class="tk-bag-continue" type="button">Keep shopping</button>
    </div>`;
  document.body.append(backdrop, drawer);
  const list = drawer.querySelector('.tk-bag-list');
  let lastFocus = null;

  function open() {
    lastFocus = document.activeElement;
    render();
    drawer.classList.add('open');
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    drawer.querySelector('.tk-bag-close').focus();
  }
  function close() {
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  drawer.querySelector('.tk-bag-close').addEventListener('click', close);
  drawer.querySelector('.tk-bag-continue').addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && drawer.classList.contains('open')) close(); });

  const money = cents => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const priceCents = p => {
    const text = String(p.price_text || '').replace(/[^0-9.]/g, '');
    return text ? Math.round(parseFloat(text) * 100) : 0;
  };

  function render() {
    const items = bag();
    const count = document.getElementById('cartCount');
    if (count) count.textContent = String(items.length);
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'tk-bag-empty';
      empty.textContent = 'Your bag is waiting for a little something.';
      list.append(empty);
    }
    let subtotal = 0;
    for (const sku of items) {
      const p = bySku.get(sku);
      subtotal += priceCents(p);
      const li = document.createElement('li');
      li.className = 'tk-bag-item';
      const img = document.createElement('img');
      img.src = p.images?.[0]?.thumb || p.images?.[0]?.card || '';
      img.alt = '';
      const text = document.createElement('div');
      const name = document.createElement('p'); name.className = 'tk-name'; name.textContent = p.name;
      const sub = document.createElement('p'); sub.className = 'tk-sub'; sub.textContent = p.sub || `SKU ${p.sku}`;
      text.append(name, sub);
      const right = document.createElement('div'); right.className = 'tk-price'; right.textContent = p.price_text || '';
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'tk-remove'; remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${p.name} from your bag`);
      remove.addEventListener('click', () => setBag(bag().filter(s => s !== sku)));
      right.append(remove);
      li.append(img, text, right);
      list.append(li);
    }
    drawer.querySelector('.tk-bag-subtotal').textContent = money(subtotal);
    drawer.querySelector('.tk-bag-checkout').setAttribute('aria-disabled', String(!items.length));
  }

  // ---- add to bag (replaces the page's demo counter) -------------------------------------------
  function resolveSku(arg) {
    if (bySku.has(String(arg))) return String(arg);
    if (byName.has(arg)) return String(byName.get(arg).sku);
    const card = window.event?.target?.closest?.('[data-sku]');
    return card ? card.dataset.sku : null;
  }
  // The checks every way into the bag shares: returns the SKU, or null after telling the shopper why not.
  function bagReady(arg) {
    const sku = resolveSku(arg);
    if (!sku || !bySku.has(sku)) { say('Sorry, that piece could not be added.'); return null; }
    const state = live.get(sku);
    if (state === 'sold' || state === 'hidden') { say('Sorry — this piece was just sold.'); return null; }
    if (state === 'on_hold') { say('Someone is checking out with this piece right now. Try again in a few minutes.'); return null; }
    if (state === 'unpriced') { say('Please call 630.615.0640 for this piece’s price.'); return null; }
    return sku;
  }
  window.addToCart = function (arg) {
    const sku = bagReady(arg);
    if (!sku) return;
    const p = bySku.get(sku);
    if (bag().includes(sku)) { open(); return; }
    setBag([...bag(), sku]);
    const count = document.getElementById('cartCount');
    if (count) { count.classList.remove('tk-count-bump'); void count.offsetWidth; count.classList.add('tk-count-bump'); }
    say(`${p.name} added to your bag.`);
    open();
  };
  // "Buy it now": the piece goes in the bag (if it isn't already) and the shopper goes straight to checkout.
  window.buyNow = function (arg) {
    const sku = bagReady(arg);
    if (!sku) return;
    if (!bag().includes(sku)) setBag([...bag(), sku]);
    location.href = 'checkout.html';
  };
  document.querySelectorAll('button[aria-label="Shopping bag"]').forEach(button => {
    button.onclick = event => { event.preventDefault(); open(); };
  });

  // Product details modal: grey out "add to bag" and "add to cart" for pieces that are gone.
  const pmButtons = ['pmAdd', 'pmBuy'].map(id => document.getElementById(id)).filter(Boolean).map(button => [button, button.textContent]);
  if (pmButtons.length && typeof window.openProduct === 'function') {
    const original = window.openProduct;
    window.openProduct = function (sku) {
      original(sku);
      const state = live.get(String(sku));
      const gone = state === 'sold' || state === 'hidden';
      pmButtons.forEach(([button, label]) => {
        button.disabled = gone || state === 'on_hold';
        button.textContent = gone ? 'Sold' : state === 'on_hold' ? 'On hold' : label;
      });
    };
  }

  // ---- one address per piece: shop.html?item=SKU ---------------------------------------------
  // The sitemap (shop/lib/seo.php) lists every piece at its own address. Such a link opens the piece and
  // gives the page that piece's title, description, canonical link and Product data, so search engines
  // can list each piece on its own; closing the piece puts the shop page's own back.
  // (the address the page was opened with: shop.html's own script rewrites ?cat=/&q= before this runs)
  const opened = new URL(performance.getEntriesByType?.('navigation')[0]?.name || location.href);
  const linked = (() => {
    const wanted = opened.searchParams.get('item');
    if (!wanted || typeof window.openProduct !== 'function') return null;
    return bySku.get(wanted) || products.find(p => String(p.sku).toLowerCase() === wanted.toLowerCase()) || null;
  })();
  const withItem = sku => {
    const params = new URLSearchParams(location.search);
    if (sku === null) params.delete('item'); else params.set('item', sku);
    history.replaceState(history.state, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
  };
  const headTags = [['link', 'rel', 'canonical'], ['meta', 'name', 'description'], ['meta', 'property', 'og:title'],
    ['meta', 'property', 'og:description'], ['meta', 'property', 'og:url'], ['meta', 'property', 'og:image'], ['meta', 'property', 'og:type']];
  const headTag = ([tag, key, value]) => document.head.querySelector(`${tag}[${key}="${value}"]`);
  const pageHead = { title: document.title, tags: headTags.map(t => headTag(t)?.getAttribute(t[0] === 'link' ? 'href' : 'content') ?? null) };

  function setHead([tag, key, value], content) {
    let node = headTag([tag, key, value]);
    if (content === null) { node?.remove(); return; }
    if (!node) { node = document.createElement(tag); node.setAttribute(key, value); document.head.append(node); }
    node.setAttribute(tag === 'link' ? 'href' : 'content', content);
  }

  function describeLinked() {
    const canonical = headTag(headTags[0]);
    const site = new URL('/', canonical ? canonical.href : location.href).href;
    const url = site + 'shop.html?item=' + encodeURIComponent(linked.sku);
    const spec = key => ((linked.specs || []).find(pair => String(pair[0]).toLowerCase() === key) || [])[1] || '';
    const text = [linked.sub, ...(linked.details || [])].filter(Boolean).join('. ').replace(/\s+/g, ' ');
    const description = text.length > 155 ? text.slice(0, 154).replace(/\s+\S*$/, '') + '…' : text;
    const images = (linked.images || []).map(image => new URL(image.lg, site).href);
    const state = live.get(String(linked.sku));
    const condition = /^new/i.test(spec('condition')) ? 'https://schema.org/NewCondition' : 'https://schema.org/UsedCondition';
    document.title = linked.name + ' | The Ladies Room';
    [url, description, linked.name, description, url, images[0] || pageHead.tags[5], 'product'].forEach((content, i) => setHead(headTags[i], content));
    let script = document.getElementById('tkProductData');
    if (!script) { script = document.createElement('script'); script.type = 'application/ld+json'; script.id = 'tkProductData'; document.head.append(script); }
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Product', name: linked.name, sku: String(linked.sku), url, image: images,
      description: text || undefined, itemCondition: condition, color: linked.color || undefined, size: linked.size || undefined,
      category: [linked.main_category, linked.sub_category].filter(Boolean).join(' > ') || undefined,
      brand: spec('brand') ? { '@type': 'Brand', name: spec('brand') } : undefined,
      offers: {
        '@type': 'Offer', url, priceCurrency: 'USD', itemCondition: condition, seller: { '@id': site + '#org' },
        price: Number(linked.price ?? String(linked.price_text).replace(/[^0-9.]/g, '')).toFixed(2),
        availability: state === 'sold' || state === 'hidden' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock'
      }
    });
  }

  if (linked) {
    describeLinked();
    window.openProduct(String(linked.sku));
    withItem(String(linked.sku));
    document.getElementById('productModal')?.addEventListener('close', () => {
      document.title = pageHead.title;
      headTags.forEach((tag, i) => setHead(tag, pageHead.tags[i]));
      document.getElementById('tkProductData')?.remove();
      withItem(null);
    }, { once: true });
  }

  // ---- live availability ---------------------------------------------------------------------
  function applyLive() {
    const removed = [];
    document.querySelectorAll('.product-card[data-sku]').forEach(card => {
      const state = live.get(card.dataset.sku);
      const gone = state === 'sold' || state === 'hidden';
      card.classList.toggle('tk-gone', gone);
      card.classList.toggle('tk-on-hold', state === 'on_hold');
      let badge = card.querySelector('.tk-hold-badge');
      if (state === 'on_hold' && !badge) {
        badge = document.createElement('span');
        badge.className = 'tk-hold-badge';
        badge.textContent = 'On hold';
        card.querySelector('.product-image')?.append(badge);
      } else if (state !== 'on_hold' && badge) {
        badge.remove();
      }
      if (gone && typeof productCards !== 'undefined' && Array.isArray(productCards)) {
        const at = productCards.indexOf(card);
        if (at >= 0) productCards.splice(at, 1);     // keep the search counts honest
      }
    });
    const keep = bag().filter(sku => {
      const state = live.get(sku);
      if (state === 'sold' || state === 'hidden' || state === 'unpriced') { removed.push(sku); return false; }
      return true;
    });
    if (removed.length) {
      setBag(keep);
      say(removed.length === 1 ? 'A piece in your bag just sold, so we took it out.' : `${removed.length} pieces in your bag just sold, so we took them out.`);
    }
  }

  async function refresh() {
    try {
      const response = await fetch(API + 'catalog', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error('catalog unavailable');
      live.clear();
      data.products.forEach(p => live.set(String(p.sku), p.status));
      applyLive();
      if (linked && document.getElementById('tkProductData')) describeLinked();   // a sold piece says so
    } catch {
      // Static preview without the shop API: the bag still works; checkout explains it is offline.
    }
  }

  window.ThomKatShop = { open, close, bag, refresh, applyLive };
  window.addEventListener('storage', event => { if (event.key === BAG_KEY) render(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  render();
  refresh();
  setInterval(refresh, 120000);
})();
