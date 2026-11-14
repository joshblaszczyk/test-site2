// A consignor's own account page (consignor.html#k=KEY): their pieces, what sold, their cut, their checks.
// The key stays in the address bar's #fragment (never sent with page requests) and goes to the API in a header.
// The static /site/ link is sandboxed and has no shop backend, so hand consignors over to the live shop app.
if (location.pathname.indexOf('/site/') === 0) { location.replace('https://' + location.hostname + ':8446/consignor.html' + location.search + location.hash); }
(function () {
  'use strict';
  const main = document.getElementById('main');
  const key = (new URLSearchParams(location.hash.slice(1))).get('k') || '';
  const money = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const day = iso => iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v; else if (k === 'style') node.setAttribute('style', v); else node.setAttribute(k, v === true ? '' : v);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }
  const SOLD_WHERE = { Website: 'Sold on our website', eBay: 'Sold on eBay', 'In the store': 'Sold in the store', 'Marked sold': 'Sold in the store' };

  function problem(title, text, phone) {
    main.replaceChildren(el('div', { class: 'state' }, el('h1', {}, title), el('p', {}, text),
      el('p', {}, 'Call us at ', el('a', { href: 'tel:' + (phone || '630.615.0640').replace(/\D/g, '') }, phone || '630.615.0640'), ' and we’ll send you a new link.')));
  }

  function splitBar(pct, pending) {
    return [el('div', { class: 'split', role: 'img', 'aria-label': `${pct}% of the selling price goes to you` }, el('i', { style: `width:${pct}%` })),
      el('div', { class: 'split-key' }, el('span', {}, `You ${pct}%`), el('span', {}, `Shop ${100 - pct}%`))];
  }

  function card(i) {
    const sold = i.status === 'sold';
    const label = { in_store: 'Available', sold: 'Sold', returned: 'Returned to you', donated: 'Donated' }[i.status] || i.status;
    const ph = i.image
      ? el('div', { class: 'photo' }, el('img', { src: i.image, alt: i.description, loading: 'lazy' }), el('span', { class: 'status' + (sold ? ' sold' : i.status === 'in_store' ? '' : ' gone') }, label))
      : el('div', { class: 'photo none' }, el('span', { class: 'tagno' }, i.item_no), el('span', { class: 'status' + (sold ? ' sold' : i.status === 'in_store' ? '' : ' gone') }, label));
    const where = sold ? (SOLD_WHERE[i.channel] || 'Sold') + (i.sold_at ? ' · ' + day(i.sold_at) : '')
      : `Tag ${i.item_no}` + (i.received_at ? ` · with us since ${day(i.received_at)}` : '');
    let cut = null;
    if (sold && i.sold_cents !== null) {
      cut = el('div', { class: 'cut' }, el('div', { class: 'payout' }, el('div', {}, el('span', {}, 'Sold for'), el('b', {}, money(i.sold_cents))),
        el('div', { class: 'you' }, el('span', {}, i.paid ? 'Your cut · paid' : 'Your cut'), el('b', {}, money(i.cut_cents)))), splitBar(i.split));
    } else if (i.status === 'in_store' && i.price_cents !== null) {
      cut = el('div', { class: 'cut pending' }, el('div', { class: 'payout' }, el('div', {}, el('span', {}, 'Listed at'), el('b', {}, money(i.price_cents))),
        el('div', { class: 'you' }, el('span', {}, 'If it sells'), el('b', {}, money(i.potential_cut_cents)))), splitBar(i.split));
    }
    const art = el('article', { class: 'card clickable', tabindex: '0', role: 'button', 'aria-label': 'View ' + i.description, style: 'cursor:pointer' }, ph, el('div', { class: 'info' }, el('h3', {}, i.description), el('p', { class: 'detail' }, where), cut,
      i.site_url ? el('a', { class: 'viewon', href: i.site_url }, 'See it on our website →') : null));
    art.addEventListener('click', ev => { if (ev.target.closest('a')) return; openPiece(i, where); });
    art.addEventListener('keydown', ev => { if ((ev.key === 'Enter' || ev.key === ' ') && !ev.target.closest('a')) { ev.preventDefault(); openPiece(i, where); } });
    return art;
  }

  // The spec rows a shopper sees: the stored specs plus whatever the owner filled in on the edit form.
  function pieceSpecs(p) {
    const rows = (p.specs || []).filter(Array.isArray).map(r => [String(r[0]), String(r[1])]);
    const has = k => rows.some(r => r[0].toLowerCase() === k);
    const add = (k, v) => { if (v !== '' && v != null && !has(k.toLowerCase())) rows.push([k, String(v)]); };
    const num = v => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? String(+n.toFixed(2)) : ''; };
    add('Size', p.size);
    add('Color', p.color);
    const main = p.main_category || ((p.categories || [])[0] || [])[0] || '';
    const sub = p.sub_category || ((p.categories || [])[0] || [])[1] || '';
    add('Category', main); add('Type', sub && sub !== main ? sub : '');
    const dims = [p.length_in, p.width_in, p.height_in].map(num);
    if (dims.some(Boolean)) add('Measurements', dims.map(d => d || '–').join(' × ') + ' in (L × W × H)');
    if (num(p.weight_lb)) add('Weight', num(p.weight_lb) + ' lb');
    return rows;
  }

  // ---- One piece, shown exactly like the shop's product popup (index.html #productModal) ---------------------------
  // Same markup, same styles (copied from index.html's .product-modal / .pm-* / .photo-zoom rules: keep the two in
  // step), the same tap-to-zoom (pinch, drag, click, +/- keys) and the phone's Back button closes it, like the shop.
  // Only the cart parts differ: the dark tile shows the consignor's cut, the big button opens the piece on the website.
  const PM_CSS = `
.product-modal{--ink:#171217;--white:#ffffff;--pink:#f04e8a;--pink-pale:#f9d9e5;--pink-dark:#b52f62;--muted:#766c72;--line:#d9ced1;color:var(--ink);font-family:"DM Sans",sans-serif}
.product-modal *{box-sizing:border-box}
.product-modal a{color:inherit;text-decoration:none}
.product-modal .mono{font:10px "DM Mono",monospace;letter-spacing:.08em;text-transform:uppercase}
.product-modal .kicker{color:var(--pink-dark)}
.product-modal .button{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 20px;border:1px solid var(--ink);color:var(--white);background:var(--ink);font:10px "DM Mono",monospace;letter-spacing:.06em;text-transform:uppercase}
.product-modal .button:hover,.product-modal .button:focus-visible{color:var(--ink);background:var(--pink)}
.product-modal { --pm-w:calc((min(100vw - 56px, 1240px) - 54px) / 4); --pm-h:calc(var(--pm-w) / .78); --pm-cols:2; --pm-rows:4; --pm-gap:6px; --pm-th:calc((var(--pm-h) - (var(--pm-rows) - 1) * var(--pm-gap)) / var(--pm-rows)); --pm-tw:calc(var(--pm-th) * .9); --pm-sw:calc(var(--pm-cols) * var(--pm-tw) + (var(--pm-cols) - 1) * var(--pm-gap) + var(--pm-sb, 0px)); --pm-bar:var(--pm-th); --pm-gw:calc(var(--pm-w) + var(--pm-sw) + 38px); width:min(calc(var(--pm-gw) + 32px), calc(100% - 32px)); max-height:calc(100% - 32px); overflow-y:auto; padding:0; border:1px solid var(--ink); background:var(--white); color:var(--ink); }
.product-modal::backdrop { background:rgba(23,18,23,.5); }
.pm { position:relative; display:grid; grid-template-columns:minmax(0,1fr); align-items:start; }
.pm-gallery { justify-self:center; }
.pm-gallery { display:flex; gap:10px; margin:16px 0 16px 16px; padding:14px; border-radius:14px; background:var(--pink-pale); }
.pm-main { flex:none; width:var(--pm-w); aspect-ratio:.78; display:block; object-fit:contain; background:var(--pink-pale); border:1px solid var(--ink); border-radius:11px; }
.pm-photo { position:relative; flex:none; }
.pm-main { cursor:zoom-in; touch-action:pan-y; }
.photo-zoom { position:absolute; inset:0; overflow:hidden; border:1px solid var(--ink); border-radius:11px; background:var(--pink-pale); }
.photo-zoom[hidden] { display:none; }
.photo-zoom-view { width:100%; height:100%; overflow:auto; overscroll-behavior:contain; touch-action:none; cursor:grab; scrollbar-width:none; }
.photo-zoom-view::-webkit-scrollbar { display:none; }
.photo-zoom-view.dragging { cursor:grabbing; }
.photo-zoom-view img { display:block; width:var(--zoom-size, 200%); height:var(--zoom-size, 200%); max-width:none; object-fit:contain; }
.pm-side { flex:0 1 auto; width:var(--pm-sw); min-width:0; height:var(--pm-h); display:flex; flex-direction:column; gap:var(--pm-gap); }
.pm-thumbs { flex:1 1 0; min-height:0; display:grid; grid-template-columns:repeat(var(--pm-cols), var(--pm-tw)); grid-auto-rows:var(--pm-th); gap:var(--pm-gap); align-content:start; overflow:hidden auto; overscroll-behavior:contain; }
.pm-thumbs::-webkit-scrollbar { width:6px; }
.pm-thumbs::-webkit-scrollbar-track { border-radius:6px; background:rgba(23,18,23,.08); }
.pm-thumbs::-webkit-scrollbar-thumb { border-radius:6px; background:var(--pink-dark); }
@supports not selector(::-webkit-scrollbar) { .pm-thumbs { scrollbar-width:thin; scrollbar-color:var(--pink-dark) transparent; } }
.pm-thumbs button { padding:0; border:1px solid transparent; border-radius:6px; overflow:hidden; background:none; cursor:pointer; }
.pm-thumbs button:hover { border-color:var(--pink-dark); }
.pm-thumbs button[aria-current="true"] { border-color:var(--ink); }
.pm-thumbs img { width:100%; height:100%; display:block; object-fit:cover; }
.pm-buy { flex:none; height:var(--pm-bar); display:grid; grid-template-columns:var(--pm-tw) minmax(0,1fr); gap:var(--pm-gap); }
.pm-buy-price { display:flex; flex-direction:column; align-items:center; justify-content:center; min-width:0; margin:0; border:1px solid var(--ink); border-radius:6px; background:var(--white); white-space:nowrap; }
.pm-buy-price, .pm-buy-cut { font:700 clamp(13px, calc(var(--pm-tw) * .22), 18px)/1.15 "DM Sans",sans-serif; }
.pm-buy-price s { margin-top:3px; color:var(--muted); font-size:11px; font-weight:400; }
.pm-buy-cut { display:flex; flex-direction:column; align-items:center; justify-content:center; min-width:0; margin:0; padding:0 6px; border:1px solid var(--ink); border-radius:6px; color:var(--white); background:var(--ink); text-align:center; }
.pm-buy-cut small { margin-top:3px; font-size:11px; font-weight:400; opacity:.85; }
.pm-main[hidden], .pm-noimg[hidden] { display:none; }
.pm-noimg { width:var(--pm-w); aspect-ratio:.78; display:grid; place-items:center; border:1px solid var(--ink); border-radius:11px; background:repeating-linear-gradient(135deg,#f6eef1 0 10px,#fbf6f8 10px 20px); font:600 15px "DM Mono",monospace; letter-spacing:.06em; color:#8a6372; }
.pm-info { position:static; padding:20px 30px 30px; }
.pm-close { position:absolute; top:14px; right:14px; width:40px; height:40px; border:1px solid var(--ink); border-radius:50%; background:var(--white); color:var(--ink); font-size:20px; line-height:1; cursor:pointer; }
.pm-info .kicker { margin-right:40px; }
.pm-info h2 { margin:10px 40px 12px 0; font:500 clamp(26px,3vw,36px)/1.05 "Playfair Display",serif; letter-spacing:-.03em; }
.pm-price { margin:0 0 20px; font-size:20px; font-weight:700; }
.pm-price s { margin-left:8px; color:var(--muted); font-size:13px; font-weight:400; }
.pm-specs { display:grid; grid-template-columns:auto 1fr; gap:8px 18px; margin:0 0 20px; padding:16px 0; border-block:1px solid var(--line); font-size:13px; }
.pm-specs dt { color:var(--muted); font:10px/1.9 "DM Mono",monospace; letter-spacing:.06em; text-transform:uppercase; }
.pm-specs dd { margin:0; }
.pm-yours { margin:0 0 20px; padding:6px 16px; border-radius:12px; background:var(--pink-pale); }
.pm-yours h3 { margin:10px 0 2px; color:var(--pink-dark); font:10px "DM Mono",monospace; letter-spacing:.08em; text-transform:uppercase; }
.pm-yours dl { display:grid; grid-template-columns:1fr auto; gap:6px 14px; margin:8px 0 10px; font-size:13px; }
.pm-yours dt { color:#7a4b5e; }
.pm-yours dd { margin:0; font-weight:700; text-align:right; }
.pm-details p { margin:0 0 10px; color:var(--muted); font-size:12.5px; line-height:1.6; }
#pmAdd { width:100%; margin:10px 0 0; }
#pmAdd[hidden] { display:none; }
@media (max-width:1060px) { .product-modal { --pm-w:calc((100vw - 92px) / 3); } }
@media (max-width:760px) {
  .product-modal { --pm-w:calc((100vw - 46px) / 2); }
  .pm { grid-template-columns:1fr; }
  .pm-gallery { justify-self:center; margin:12px 0 0; }
  .pm-gallery { padding-top:56px; }
  .pm-close { top:8px; right:8px; }
  .product-modal { --pm-bar:40px; --pm-th:calc((var(--pm-h) - var(--pm-bar) - 3 * var(--pm-gap)) / 3); --pm-sw:max(126px, calc(2.3 * var(--pm-th) + var(--pm-gap) + var(--pm-sb, 0px))); }
  .pm-thumbs, .pm-buy { grid-template-columns:repeat(2, minmax(0,1fr)); }
  .pm-buy-price, .pm-buy-cut { font-size:14px; }
  .pm-buy-price s, .pm-buy-cut small { margin-top:1px; font-size:10px; }
  .pm-info { max-height:none; padding:26px 20px 24px; }
}
@media (max-width:400px) {
  .product-modal { width:calc(100% - 16px); max-width:calc(100% - 16px); max-height:calc(100% - 16px); }
  .pm-gallery { gap:6px; padding:56px 8px 8px; }
}`;
  const PM_HTML = '<div class="pm"><div class="pm-gallery"><div class="pm-photo"><img class="pm-main" id="pmMain" alt="" role="button" tabindex="0">'
    + '<div class="pm-noimg" id="pmNoImg" hidden></div><div class="photo-zoom" id="photoZoom" hidden aria-label="Zoomed product photo">'
    + '<div class="photo-zoom-view" id="zoomView" tabindex="0" aria-label="Product image"><img id="zoomImage" alt=""></div></div></div>'
    + '<div class="pm-side"><div class="pm-thumbs" id="pmThumbs"></div><div class="pm-buy"><p class="pm-buy-price" id="pmBuyPrice"></p>'
    + '<p class="pm-buy-cut" id="pmBuyCut"></p></div></div></div><div class="pm-info">'
    + '<button class="pm-close" type="button" id="pmClose" aria-label="Close">×</button><div class="kicker mono" id="pmSub"></div>'
    + '<h2 id="pmName"></h2><p class="pm-price" id="pmPrice"></p><dl class="pm-specs" id="pmSpecs"></dl>'
    + '<div class="pm-yours"><h3>Your consignment</h3><dl id="pmYours"></dl></div><div class="pm-details" id="pmDetails"></div>'
    + '<a class="button" id="pmAdd" hidden>See it on our website</a></div></div>';
  let pmModal = null;
  let pmImages = [];

  function pmSetup() {
    if (pmModal) return pmModal;
    document.head.append(el('style', { id: 'pmCss' }, PM_CSS));
    const fonts = 'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@500&display=swap';
    if (!document.getElementById('pmFonts')) document.head.append(el('link', { id: 'pmFonts', rel: 'stylesheet', href: fonts }));
    const modal = el('dialog', { class: 'product-modal', id: 'productModal', 'aria-labelledby': 'pmName' });
    modal.innerHTML = PM_HTML;   // fixed markup only; every piece value below goes in as text
    document.body.append(modal);
    const $ = id => modal.querySelector('#' + id);
    const mainPhoto = $('pmMain'), photoZoom = $('photoZoom'), zoomView = $('zoomView'), zoomImage = $('zoomImage'), thumbs = $('pmThumbs');

    // Zoom: the shop's code (index.html), unchanged.
    let zoom = 2;
    const centerZoom = () => {
      zoomView.scrollLeft = (zoomView.scrollWidth - zoomView.clientWidth) / 2;
      zoomView.scrollTop = (zoomView.scrollHeight - zoomView.clientHeight) / 2;
    };
    const setZoom = (value, point) => {
      const oldZoom = zoom;
      const rect = zoomView.getBoundingClientRect();
      const x = point ? point.x - rect.left : zoomView.clientWidth / 2;
      const y = point ? point.y - rect.top : zoomView.clientHeight / 2;
      const imageX = (zoomView.scrollLeft + x) / oldZoom;
      const imageY = (zoomView.scrollTop + y) / oldZoom;
      zoom = Math.max(1, Math.min(4, value));
      zoomImage.style.setProperty('--zoom-size', (zoom * 100) + '%');
      if (!photoZoom.hidden) { zoomView.scrollLeft = imageX * zoom - x; zoomView.scrollTop = imageY * zoom - y; }
    };
    const openPhotoZoom = () => {
      if (!pmImages.length) return;
      zoomImage.src = mainPhoto.src; zoomImage.alt = mainPhoto.alt;
      setZoom(2); photoZoom.hidden = false; centerZoom();
      zoomView.focus({ preventScroll: true });
    };
    modal.pmShow = index => {
      mainPhoto.src = pmImages[index].lg;
      mainPhoto.alt = $('pmName').textContent + ' (photo ' + (index + 1) + ' of ' + pmImages.length + ')';
      if (!photoZoom.hidden) { zoomImage.src = mainPhoto.src; zoomImage.alt = mainPhoto.alt; centerZoom(); }
      thumbs.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-current', String(i === index)));
    };
    let mainPress = null;
    mainPhoto.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      mainPress = { x: event.clientX, y: event.clientY, time: Date.now(), id: event.pointerId };
    });
    mainPhoto.addEventListener('pointerup', event => {
      if (mainPress && mainPress.id === event.pointerId && Date.now() - mainPress.time < 350 &&
          Math.hypot(event.clientX - mainPress.x, event.clientY - mainPress.y) <= 5) openPhotoZoom();
      mainPress = null;
    });
    mainPhoto.addEventListener('pointercancel', () => { mainPress = null; });
    mainPhoto.addEventListener('dragstart', event => event.preventDefault());
    mainPhoto.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPhotoZoom(); } });
    zoomView.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); photoZoom.hidden = true; mainPhoto.focus(); }
      else if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(zoom + .5); }
      else if (event.key === '-') { event.preventDefault(); setZoom(zoom - .5); }
    });
    const pointers = new Map();
    let mouseDrag = null, pinch = null;
    const pinchState = () => {
      const [a, b] = Array.from(pointers.values());
      return { distance: Math.hypot(a.x - b.x, a.y - b.y), midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    };
    zoomView.addEventListener('dragstart', event => event.preventDefault());
    zoomView.addEventListener('contextmenu', event => event.preventDefault());
    zoomView.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 2) return;
      event.preventDefault();
      zoomView.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (event.pointerType === 'mouse') {
        mouseDrag = { x: event.clientX, y: event.clientY, left: zoomView.scrollLeft, top: zoomView.scrollTop, time: Date.now(), button: event.button, moved: false };
        if (event.button === 0) zoomView.classList.add('dragging');
      } else if (pointers.size === 2) {
        pinch = pinchState();
      }
    });
    zoomView.addEventListener('pointermove', event => {
      if (!pointers.has(event.pointerId)) return;
      const previous = pointers.get(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (event.pointerType === 'mouse' && mouseDrag) {
        const dx = event.clientX - mouseDrag.x, dy = event.clientY - mouseDrag.y;
        if (Math.hypot(dx, dy) > 5) mouseDrag.moved = true;
        if (mouseDrag.button === 0 && mouseDrag.moved) { zoomView.scrollLeft = mouseDrag.left - dx; zoomView.scrollTop = mouseDrag.top - dy; }
      } else if (pointers.size === 2 && pinch) {
        const next = pinchState();
        if (pinch.distance > 0) setZoom(zoom * next.distance / pinch.distance, pinch.midpoint);
        zoomView.scrollLeft -= next.midpoint.x - pinch.midpoint.x;
        zoomView.scrollTop -= next.midpoint.y - pinch.midpoint.y;
        pinch = next;
      } else if (pointers.size === 1) {
        zoomView.scrollLeft -= event.clientX - previous.x;
        zoomView.scrollTop -= event.clientY - previous.y;
      }
    });
    const endZoomPointer = event => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      pinch = null;
      if (event.pointerType === 'mouse' && mouseDrag) {
        if (event.type === 'pointerup' && !mouseDrag.moved && Date.now() - mouseDrag.time < 350) setZoom(zoom + (mouseDrag.button === 0 ? .5 : -.5));
        mouseDrag = null;
        zoomView.classList.remove('dragging');
      }
    };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => zoomView.addEventListener(type, endZoomPointer));

    // Sizing: the shop's code, measured against this page's piece cards instead of the shop grid.
    modal.pmFit = () => {
      modal.style.removeProperty('--pm-sb');
      const bar = thumbs.offsetWidth - thumbs.clientWidth;
      if (bar > 0) modal.style.setProperty('--pm-sb', bar + 4 + 'px');
    };
    modal.pmSize = () => {
      const card = document.querySelector('.grid .card .photo');
      const width = card && card.getBoundingClientRect().width;
      if (width) {
        const avail = window.innerWidth - 32 - 38 - 16;
        modal.style.setProperty('--pm-w', Math.max(width, Math.min(width * 2, avail / 1.55, window.innerHeight * 0.9 * .78)) + 'px');
      } else modal.style.removeProperty('--pm-w');
    };
    window.addEventListener('resize', () => { if (modal.open) { modal.pmSize(); modal.pmFit(); } });

    // Closing: the × button, a tap on the dim backdrop, Escape, and (like the shop) the phone's Back button.
    let pushed = false;
    modal.pmPush = () => { if (!pushed) { pushed = true; history.pushState({ tkPiece: true }, '', location.href); } };
    modal.addEventListener('close', () => {
      photoZoom.hidden = true;
      if (pushed) { pushed = false; if (history.state && history.state.tkPiece) history.back(); }
    });
    window.addEventListener('popstate', () => { if (modal.open) { pushed = false; modal.close(); } });
    $('pmClose').addEventListener('click', () => modal.close());
    modal.addEventListener('click', event => { if (event.target === modal) modal.close(); });
    pmModal = modal;
    return modal;
  }

  function openPiece(i, where) {
    const modal = pmSetup();
    const $ = id => modal.querySelector('#' + id);
    const sold = i.status === 'sold';
    const p = i.piece || {};
    const name = i.product_name || p.name || i.description;
    pmImages = (p.images && p.images.length) ? p.images : (i.image ? [{ lg: i.image, thumb: i.image }] : []);
    $('pmSub').textContent = p.sub || ('Tag ' + i.item_no);
    $('pmName').textContent = name;
    const priceLine = $('pmPrice');
    if (sold && i.sold_cents !== null) {
      priceLine.replaceChildren(document.createTextNode(money(i.sold_cents)));
      if (i.price_cents !== null && i.price_cents !== i.sold_cents) priceLine.append(el('s', {}, money(i.price_cents)));
    } else {
      priceLine.replaceChildren(document.createTextNode(p.price_text || money(i.price_cents || 0)));
      if (p.regular_text) priceLine.append(el('s', {}, p.regular_text));
    }
    $('pmBuyPrice').replaceChildren(...priceLine.cloneNode(true).childNodes);
    const cutTile = $('pmBuyCut');
    if (sold && i.cut_cents !== null) cutTile.replaceChildren(document.createTextNode(money(i.cut_cents)), el('small', {}, i.paid ? 'your cut · paid' : 'your cut'));
    else if (i.status === 'in_store' && i.potential_cut_cents !== null) cutTile.replaceChildren(document.createTextNode(money(i.potential_cut_cents)), el('small', {}, 'yours if it sells'));
    else cutTile.replaceChildren(document.createTextNode({ returned: 'Returned to you', donated: 'Donated' }[i.status] || 'Not for sale'));
    $('pmSpecs').replaceChildren(...pieceSpecs(p).concat([['SKU', i.item_no]]).flatMap(([key, value]) => [el('dt', {}, key), el('dd', {}, value)]));
    const yours = [];
    const line = (a, b) => { if (b) yours.push(el('dt', {}, a), el('dd', {}, b)); };
    line('Status', sold ? 'Sold' : { in_store: 'Available', returned: 'Returned to you', donated: 'Donated' }[i.status] || i.status);
    line(sold ? 'Sold for' : 'Listed at', money(sold ? (i.sold_cents || 0) : (i.price_cents || 0)));
    line('Your split', i.split + '%');
    line(sold ? 'Your cut' + (i.paid ? ' (paid)' : '') : 'If it sells', sold ? money(i.cut_cents || 0) : (i.status === 'in_store' ? money(i.potential_cut_cents || 0) : ''));
    if (sold) line('Sold', where);
    line('With us since', i.received_at ? day(i.received_at) : '');
    $('pmYours').replaceChildren(...yours);
    $('pmDetails').replaceChildren(...(p.details || []).map(text => el('p', {}, text)));
    const site = $('pmAdd');
    site.hidden = !i.site_url;
    if (i.site_url) site.href = i.site_url; else site.removeAttribute('href');
    const thumbs = $('pmThumbs');
    thumbs.replaceChildren(...pmImages.map((image, index) => {
      const b = el('button', { type: 'button', 'aria-label': 'Photo ' + (index + 1) }, el('img', { src: image.thumb, alt: '' }));
      b.addEventListener('click', () => modal.pmShow(index));
      return b;
    }));
    thumbs.scrollTop = 0;
    const noImg = $('pmNoImg');
    $('pmMain').hidden = !pmImages.length;
    noImg.hidden = !!pmImages.length;
    noImg.textContent = i.item_no;
    if (pmImages.length) modal.pmShow(0);
    modal.pmSize();
    if (!modal.open) { modal.showModal(); modal.pmPush(); }
    modal.pmFit();
    $('pmClose').focus();
  }

  function render(d) {
    const c = d.consignor;
    const t = d.totals;
    const inStore = d.items.filter(i => i.status === 'in_store').length;
    const sold = d.items.filter(i => i.status === 'sold').length;
    const whole = t.earned_cents + t.pending_cents;
    const agreement = [c.contract_no ? `Agreement #${c.contract_no}` : 'Your agreement', c.contract_date ? `from ${day(c.contract_date)}` : null, c.contract_expires ? `ends ${day(c.contract_expires)}` : null].filter(Boolean).join(' · ');
    document.title = `${c.first_name}'s consignment account | ThomKat & The Ladies' Room`;
    main.replaceChildren(...[
      el('div', { class: 'intro' }, el('div', {}, el('div', { class: 'eyebrow' }, `Consignor ${c.number}`), el('h1', {}, `Hi ${c.first_name}, here’s your consignment `, el('em', {}, 'at a glance.')),
        el('p', {}, 'Your pieces, what has sold, your cut of each sale, and the checks we’ve sent. It updates as pieces sell in the store, on our website and on eBay.')),
        el('div', { class: 'demo' }, el('strong', {}, agreement), el('br'), `Your share: ${c.split_pct}% of each piece’s selling price.`, el('br'),
          'Questions? Call ', el('a', { href: 'tel:' + String(d.phone).replace(/\D/g, '') }, d.phone), '.')),
      el('div', { class: 'summary', 'aria-label': 'Your consignment summary' },
        el('div', {}, el('span', {}, 'Pieces with us'), el('strong', {}, String(d.items.length))),
        el('div', {}, el('span', {}, 'Available'), el('strong', {}, String(inStore))),
        el('div', {}, el('span', {}, 'Sold'), el('strong', {}, String(sold))),
        el('div', { class: 'earn' }, el('span', {}, 'Your cut so far'), el('strong', {}, money(t.earned_cents)),
          el('div', { class: 'earn-bar', role: 'img', 'aria-label': `${money(t.earned_cents)} earned so far, out of ${money(whole)} if everything sells` },
            el('i', { style: `width:${whole > 0 ? (100 * t.earned_cents / whole).toFixed(1) : 0}%` })),
          el('small', {}, t.pending_cents > 0 ? `+ ${money(t.pending_cents)} more if the other ${inStore} sell` : 'Everything with a price has sold'))),
      el('p', { class: 'paidline' }, el('span', {}, 'Paid to you ', el('b', {}, money(t.paid_cents))),
        t.owed_cents > 0 ? el('span', {}, 'Coming on your next check ', el('b', {}, money(t.owed_cents))) : null),
      el('div', { class: 'heading' }, el('h2', {}, 'Your pieces'), el('p', { class: 'split-note' }, el('b', {}, 'Your split'), `${c.split_pct}% of each piece’s selling price, as set in your consignment agreement`)),
      d.items.length ? el('section', { class: 'grid', 'aria-label': 'Your pieces' }, d.items.map(card)) : el('p', {}, 'No pieces yet.'),
      d.payouts.length ? el('section', { class: 'checks' }, el('div', { class: 'heading' }, el('h2', {}, 'Your checks')),
        el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Date'), el('th', {}, 'Check'), el('th', {}, 'Amount'))),
          el('tbody', {}, d.payouts.map(p => el('tr', {}, el('td', {}, day(p.paid_at)), el('td', {}, p.check_no ? '#' + p.check_no : '—'), el('td', {}, money(p.amount_cents))))))) : null,
      el('p', { class: 'footnote' }, el('a', { href: '#', id: 'signout' }, 'Sign out of this device'), ' · This page is private to you, so please don’t share the link. If you think someone else has it, call us and we’ll make you a new one (the old link then stops working).')].filter(Boolean));
  }

  function loginForm(msg) {
    const name = el('input', { id: 'cname', name: 'name', type: 'text', autocomplete: 'name', placeholder: 'e.g. Jane Smith' });
    const email = el('input', { id: 'cemail', name: 'email', type: 'email', autocomplete: 'email', placeholder: 'you@example.com' });
    const rem = el('input', { id: 'crem', type: 'checkbox', checked: true });
    const no = el('input', { id: 'cno', name: 'contract_no', type: 'text', autocomplete: 'off', required: true, placeholder: 'e.g. 1042' });
    const err = el('p', { class: 'loginerr', role: 'alert' }, msg || '');
    const btn = el('button', { type: 'submit' }, 'View my account');
    const form = el('form', { class: 'loginbox' },
      el('label', { for: 'cno' }, 'Contract number'), no,
      el('p', { class: 'hint' }, 'Then enter your name or your email. Just one is enough.'),
      el('label', { for: 'cname' }, 'Your name'), name,
      el('label', { for: 'cemail' }, 'Your email'), email,
      el('label', { style: 'display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:14px;margin-top:14px' }, rem, 'Keep me signed in on this device'),
      err, btn,
      el('p', { class: 'hint' }, 'Your contract number is on your 2026 Consignment Contract. Can’t find it? Call the boutique and we’ll help.'));
    form.addEventListener('submit', ev => {
      ev.preventDefault(); err.textContent = '';
      if (!name.value.trim() && !email.value.trim()) { err.textContent = 'Please enter your name or your email.'; return; } btn.disabled = true; btn.textContent = 'Checking…';
      fetch('shop/api/consignor/login', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, cache: 'no-store', credentials: 'same-origin',
        body: JSON.stringify({ name: name.value, email: email.value, contract_no: no.value, remember: rem.checked }) })
        .then(r => r.json().then(d => ({ ok: r.ok, d })))
        .then(({ ok, d }) => { if (ok && d.ok) render(d); else { err.textContent = d.error || 'We couldn’t find that account.'; btn.disabled = false; btn.textContent = 'View my account'; } })
        .catch(() => { if (location.port !== '8446' && /ts\.net$/.test(location.hostname)) { location.replace('https://' + location.hostname + ':8446/consignor.html'); return; } err.textContent = 'We couldn’t reach the shop. Please try again.'; btn.disabled = false; btn.textContent = 'View my account'; });
    });
    main.replaceChildren(el('div', { class: 'intro' }, el('div', {}, el('div', { class: 'eyebrow' }, 'Consignor login'),
      el('h1', {}, 'Your consignment ', el('em', {}, 'at a glance.')),
      el('p', {}, 'Enter your contract number and your name or email to see your pieces, what has sold, your cut of each sale, and the checks we’ve sent.'))), form);
    name.focus();
  }

  main.addEventListener('click', ev => {
    if (ev.target.id !== 'signout') return;
    ev.preventDefault();
    fetch('shop/api/consignor/logout', { method: 'POST', credentials: 'same-origin' }).finally(() => { history.replaceState(null, '', location.pathname); loginForm(); });
  });
  if (!key) {
    fetch('shop/api/consignor/session', { headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin' })
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => { if (ok && d.ok) render(d); else loginForm(); })
      .catch(() => loginForm());
    return;
  }
  if (!/^[a-f0-9]{48}$/.test(key)) { problem('This link is not complete', 'The address should end in a long code after “#k=”. Try opening the link from your message again.'); return; }
  fetch('shop/api/consignor', { headers: { Accept: 'application/json', 'X-Consignor-Key': key }, cache: 'no-store', credentials: 'omit' })
    .then(r => r.json().then(d => ({ ok: r.ok, d })))
    .then(({ ok, d }) => { if (ok && d.ok) render(d); else loginForm(d.error ? d.error + ' You can sign in with your name and contract number instead.' : ''); })
    .catch(() => problem('We couldn’t load your account', 'Please check your connection and try again.'));
})();
