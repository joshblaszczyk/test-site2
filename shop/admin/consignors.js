// ThomKat shop admin → Consignors: people, their pieces, sales from every channel, checks, private links,
// her spreadsheet import, and the register (Square) sync. Uses admin.js helpers via window.TKAdmin.
(function () {
  'use strict';
  const A = window.TKAdmin;
  if (!A) return;
  const { api, el, money, flash, appError, imageSrc } = A;
  const $ = id => document.getElementById(id);
  const day = iso => iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const dollars = cents => cents === null || cents === undefined ? '' : (cents / 100).toFixed(2);
  const CHANNEL = { website: 'on website', ebay: 'on eBay', store: 'at register', manual: 'by hand' };
  let list = [];
  let store = null;
  let current = null;      // the open consignor's detail
  let openForm = null;     // which inline form is open: 'edit' | 'add' | 'sold:<id>' | 'item:<id>' | 'check'
  let lastLink = null;     // {id, url} shown once after making a link

  A.tabs.consignors = loadList;

  async function loadList() {
    try {
      const data = await api('admin/consignors');
      list = data.consignors;
      store = data.store;
      renderStore();
      renderList();
      if (current) openConsignor(current.consignor.id, true);
    } catch (error) { appError(error); }
  }

  // ---- register (Square) card ---------------------------------------------------------------------
  function renderStore(result) {
    const s = store;
    if (!s) return;
    const lines = [];
    if (!s.ready) lines.push(el('p', { class: 'msg' }, '⚠ ', s.why, ' Until then, pieces sold at the register stay on the website.'));
    else lines.push(el('p', { class: 'muted' }, 'Ring up a piece by its tag number (it is in her Square items as “T… · description”). When it sells, it comes off the website and the consignor gets their cut. ',
      s.last_run ? `Last check ${A.when(s.last_run)}${s.last_ok === false ? ' (had problems)' : ''}. ` : 'Not checked yet. ', `${s.in_library} consigned piece(s) are in her Square items.`));
    if (s.errors?.length) lines.push(el('p', { class: 'msg error' }, 'Problems: ', s.errors.join('; ')));
    if (s.unmatched?.length) {
      lines.push(el('details', {}, el('summary', {}, `${s.unmatched.length} register sale(s) had no tag number`),
        el('p', { class: 'muted' }, 'These were rung up as a custom amount without a tag number, so nothing was taken off the website. Mark the piece sold by hand if it was a consigned piece.'),
        el('ul', {}, s.unmatched.map(u => el('li', {}, `${u.name} · ${money(u.cents)}`)))));
    }
    if (result) {
      const text = result.skipped ? result.skipped
        : `Checked ${result.orders} register sale(s): ${result.matched.length} piece(s) matched, ${result.returns.length} return(s)` + (result.skipped_website ? `, ${result.skipped_website} website order(s) skipped` : '') + '.';
      lines.push(el('p', { class: 'msg ' + (result.errors?.length ? 'error' : 'ok') }, text));
    }
    $('storeCard').replaceChildren(
      el('div', { class: 'bar' }, el('h2', {}, 'Sales at the register (Square)'),
        el('button', { class: 'btn ghost small', type: 'button', disabled: !s.ready, onclick: syncStore }, 'Check register sales now')),
      ...lines);
  }

  async function syncStore() {
    try {
      const data = await api('admin/store/sync', { method: 'POST' });
      store = data.store;
      renderStore(data.result);
      loadListQuiet();
    } catch (error) { appError(error); }
  }

  async function loadListQuiet() {
    try { const data = await api('admin/consignors'); list = data.consignors; renderList(); if (current) openConsignor(current.consignor.id, true); } catch { /* shown next time */ }
  }

  // ---- list ------------------------------------------------------------------------------------------
  $('consignorSearch').addEventListener('input', renderList);
  $('addConsignor').addEventListener('click', () => { current = null; openForm = 'edit'; renderNew(); });

  function expiry(c) {
    if (!c.contract_expires) return null;
    const daysLeft = Math.round((new Date(c.contract_expires + 'T12:00:00') - Date.now()) / 86400000);
    if (daysLeft < 0) return el('span', { class: 'badge bad' }, 'contract ended');
    if (daysLeft <= 30) return el('span', { class: 'badge test' }, `ends in ${daysLeft} d`);
    return null;
  }

  function renderList() {
    const q = $('consignorSearch').value.trim().toLowerCase();
    const rows = list.filter(c => !q || [c.number, c.name, c.phone, c.email].some(v => (v || '').toLowerCase().includes(q)));
    $('consignorList').replaceChildren(...(rows.length ? rows.map(c => {
      const t = c.totals;
      return el('button', { class: 'order cs-row' + (current?.consignor.id === c.id ? ' on' : ''), type: 'button', 'data-id': c.id, onclick: () => { openForm = null; openConsignor(c.id); } },
        el('span', { class: 'top-line' }, el('span', {}, c.number, ' · ', c.name), el('span', { class: 'money' + (t.owed_cents > 0 ? ' owed' : '') }, t.owed_cents ? 'owed ' + money(t.owed_cents) : '')),
        el('span', { class: 'badges' },
          el('span', { class: 'badge dim' }, `${t.items.in_store} in store`),
          t.items.sold ? el('span', { class: 'badge ok' }, `${t.items.sold} sold`) : null,
          el('span', { class: 'badge dim' }, `${c.split_pct}%`),
          c.status === 'closed' ? el('span', { class: 'badge dim' }, 'closed') : expiry(c)));
    }) : [el('p', { class: 'muted' }, list.length ? 'No consignor matches that.' : 'No consignors yet. Add one, or import her spreadsheet.')]));
  }

  async function openConsignor(id, quiet = false) {
    try {
      current = await api('admin/consignors/' + id);
      document.querySelectorAll('.cs-row').forEach(b => b.classList.toggle('on', Number(b.dataset.id) === id));
      renderDetail();
    } catch (error) { if (!quiet) appError(error); }
  }

  let acting = false;   // one save at a time: a double tap on Save / Save check must not send it twice
  async function act(path, body, confirmText) {
    if (acting) return null;
    if (confirmText && !window.confirm(confirmText)) return null;
    acting = true;
    document.querySelectorAll('#consignorDetail button[type=submit]').forEach(b => { b.disabled = true; });
    try {
      const data = await api(path, { method: 'POST', body });
      if (data.consignor) { current = data; openForm = null; renderDetail(); loadListQuiet(); }
      return data;
    } catch (error) {
      document.querySelectorAll('#consignorDetail button[type=submit]').forEach(b => { b.disabled = false; });
      flashDetail(error.message); return null;
    } finally { acting = false; }
  }
  function flashDetail(text) {
    const box = $('consignorDetail').querySelector('.cs-msg');
    if (box) { box.textContent = text; box.hidden = !text; box.scrollIntoView({ block: 'nearest' }); } else appError(new Error(text));
  }

  // ---- forms -----------------------------------------------------------------------------------------
  function field(label, name, value, attrs = {}) {
    const { textarea, wide, note, ...rest } = attrs;
    const input = textarea ? el('textarea', { name, maxlength: rest.maxlength || 300 }) : el('input', { name, type: 'text', ...rest });
    input.value = value ?? '';
    return el('label', { class: wide ? 'wide' : null }, label, input, note ? el('span', { class: 'field-note' }, note) : null);
  }
  function splitField(value, allowBlank) {
    const input = el('input', { name: 'split_pct', type: 'number', min: 0, max: 100, step: 1, inputmode: 'numeric', placeholder: allowBlank ? 'their %' : '' });
    input.value = value ?? '';
    const pills = [40, 50].map(p => el('button', { type: 'button', 'aria-pressed': String(Number(input.value) === p), onclick: () => { input.value = p; sync(); } }, p + '%'));
    const sync = () => pills.forEach((b, i) => b.setAttribute('aria-pressed', String(Number(input.value) === [40, 50][i] && input.value !== '')));
    input.addEventListener('input', sync);
    return el('label', {}, allowBlank ? 'Consignor’s share (blank = their usual)' : 'Consignor’s share of a sale', el('span', { class: 'split-field' }, el('span', { class: 'seg' }, pills), input, '%'));
  }
  const formData = form => Object.fromEntries(new FormData(form).entries());

  function consignorForm(c) {
    const form = el('form', { class: 'section' },
      el('h3', {}, c ? 'Edit details' : 'New consignor'),
      el('div', { class: 'form-grid' },
        field('Consignor number', 'number', c?.number, { required: true, maxlength: 20, placeholder: 'TK1191', note: 'The TK number on her sheet' }),
        field('Name', 'name', c?.name, { required: true, maxlength: 120, autocomplete: 'off' }),
        field('Email', 'email', c?.email, { type: 'email', maxlength: 160, autocomplete: 'off' }),
        field('Phone', 'phone', c?.phone, { type: 'tel', maxlength: 40, autocomplete: 'off' }),
        field('Address', 'address', c?.address, { textarea: true, wide: true }),
        field('Contract #', 'contract_no', c?.contract_no, { maxlength: 40 }),
        splitField(c ? c.split_pct : 40, false),
        field('Contract date', 'contract_date', c?.contract_date, { type: 'date' }),
        field('Contract ends', 'contract_expires', c?.contract_expires, { type: 'date' }),
        field('Private notes', 'notes', c?.notes, { textarea: true, wide: true, maxlength: 2000 }),
        c ? el('label', {}, 'Status', (() => { const s = el('select', { name: 'status' }, el('option', { value: 'active' }, 'Active'), el('option', { value: 'closed' }, 'Closed (no new pieces)')); s.value = c.status; return s; })()) : null),
      el('div', { class: 'row' }, el('button', { class: 'btn small', type: 'submit' }, c ? 'Save' : 'Add consignor'),
        el('button', { class: 'btn ghost small', type: 'button', onclick: () => { openForm = null; c ? renderDetail() : $('consignorDetail').replaceChildren(el('p', { class: 'muted' }, 'Pick a consignor, or add one.')); } }, 'Cancel')));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const data = await act(c ? 'admin/consignors/' + c.id : 'admin/consignors', formData(form));
      if (data && !c) openConsignor(data.consignor.id);
    });
    return form;
  }

  function renderNew() {
    document.querySelectorAll('.cs-row').forEach(b => b.classList.remove('on'));
    $('consignorDetail').replaceChildren(el('p', { class: 'msg error cs-msg', hidden: true }), consignorForm(null));
    $('consignorDetail').querySelector('input[name=number]').focus();
  }

  function itemForm(item) {
    const c = current.consignor;
    const form = el('form', { class: 'inline-form' },
      el('strong', {}, item ? `Edit ${item.item_no}` : 'Add a piece'),
      el('div', { class: 'form-grid' },
        field('Tag number', 'item_no', item?.item_no, { required: true, maxlength: 40, placeholder: 'T1185027' }),
        field('Description', 'description', item?.description, { required: true, maxlength: 200, placeholder: 'Brand, what it is, color, size' }),
        field('Price ($)', 'price', dollars(item?.price_cents), { inputmode: 'decimal', placeholder: '39.99' }),
        splitField(item?.split_pct ?? '', true),
        field('On the website as (SKU)', 'sku', item?.sku, { maxlength: 64, note: 'Leave blank: it links by itself when a website piece has the same number' }),
        field('Where', 'location', item?.location, { maxlength: 30, placeholder: 'TK or WARE' }),
        field('Received', 'received_at', item?.received_at, { type: 'date' })),
      el('div', { class: 'row' }, el('button', { class: 'btn small', type: 'submit' }, item ? 'Save piece' : 'Add piece'),
        el('button', { class: 'btn ghost small', type: 'button', onclick: () => { openForm = null; renderDetail(); } }, 'Cancel')));
    form.addEventListener('submit', event => {
      event.preventDefault();
      act(`admin/consignors/${c.id}/items` + (item ? '/' + item.id : ''), formData(form));
    });
    return form;
  }

  function soldForm(item) {
    const form = el('form', { class: 'inline-form' },
      el('strong', {}, `Mark ${item.item_no} sold`),
      el('div', { class: 'form-grid' },
        field('Sold for ($, after any discount)', 'amount', dollars(item.price_cents), { required: true, inputmode: 'decimal' }),
        field('Discount given ($)', 'discount', '', { inputmode: 'decimal', placeholder: '0.00' }),
        field('Date', 'date', new Date().toISOString().slice(0, 10), { type: 'date' })),
      el('p', { class: 'muted cut-preview' }),
      el('div', { class: 'row' }, el('button', { class: 'btn small', type: 'submit' }, 'Mark sold'),
        el('button', { class: 'btn ghost small', type: 'button', onclick: () => { openForm = null; renderDetail(); } }, 'Cancel')));
    const preview = () => {
      const cents = Math.round(parseFloat(form.amount.value || '0') * 100) || 0;
      form.querySelector('.cut-preview').textContent = `${current.consignor.name.split(' ')[0]} gets ${item.split}% = ${money(Math.floor((cents * item.split + 50) / 100))}; the shop keeps ${money(cents - Math.floor((cents * item.split + 50) / 100))}.`;
    };
    form.amount.addEventListener('input', preview);
    preview();
    form.addEventListener('submit', event => { event.preventDefault(); act(`admin/consign-items/${item.id}/action`, { action: 'sold', ...formData(form) }); });
    return form;
  }

  function checkForm(t) {
    const form = el('form', { class: 'inline-form' },
      el('strong', {}, 'Record a check'),
      el('div', { class: 'form-grid' },
        field('Check number', 'check_no', '', { maxlength: 30 }),
        field('Date', 'date', new Date().toISOString().slice(0, 10), { type: 'date' }),
        field('Amount ($)', 'amount', dollars(Math.max(0, t.owed_cents)), { inputmode: 'decimal' })),
      el('div', { class: 'row' }, el('button', { class: 'btn small', type: 'submit' }, 'Save check'),
        el('button', { class: 'btn ghost small', type: 'button', onclick: () => { openForm = null; renderDetail(); } }, 'Cancel')));
    form.addEventListener('submit', event => { event.preventDefault(); act(`admin/consignors/${current.consignor.id}/payouts`, formData(form)); });
    return form;
  }

  // ---- detail ----------------------------------------------------------------------------------------
  function statusCell(i) {   // el() flattens one level, so this returns a flat list
    if (i.status === 'sold' && i.sale) {
      return [el('span', { class: 'badge ok' }, 'sold ' + (CHANNEL[i.sale.channel] || i.sale.channel)), el('br'), el('span', { class: 'muted' }, day(i.sale.sold_at)),
        i.sale.payout_id ? [el('br'), el('span', { class: 'muted' }, 'paid' + (i.sale.check_no ? ' · ck ' + i.sale.check_no : ''))] : null].flat();
    }
    const label = { in_store: 'in store', returned: 'given back', donated: 'donated', sold: 'sold' }[i.status] || i.status;
    return [el('span', { class: 'badge ' + (i.status === 'in_store' ? 'pink' : 'dim') }, label),
      i.on_site ? [el('br'), el('a', { href: '../../' + i.site_url, target: '_blank', rel: 'noopener', class: 'small-link' }, i.site_status === 'available' ? 'on the website ↗' : `website: ${i.site_status} ↗`)] : null].flat();
  }

  function itemActions(i) {
    const go = (action, confirmText) => () => act(`admin/consign-items/${i.id}/action`, { action }, confirmText);
    const show = name => () => { openForm = name; renderDetail(); };
    const links = [];
    if (i.status === 'in_store') {
      links.push(el('button', { class: 'link', type: 'button', onclick: show('sold:' + i.id) }, 'Mark sold'));
      links.push(el('button', { class: 'link', type: 'button', onclick: show('item:' + i.id) }, 'Edit'));
      links.push(el('button', { class: 'link', type: 'button', onclick: go('returned', `Give ${i.item_no} back to the consignor? It comes off the website.`) }, 'Given back'));
      links.push(el('button', { class: 'link', type: 'button', onclick: go('donated', `Mark ${i.item_no} donated? It comes off the website.`) }, 'Donated'));
      if (!i.sales.length) links.push(el('button', { class: 'link', type: 'button', onclick: go('delete', `Delete ${i.item_no}? Only for a mistake — it has no sales.`) }, 'Delete'));
    } else if (i.status === 'sold') {
      links.push(el('button', { class: 'link', type: 'button', onclick: go('unsell', `Undo the sale of ${i.item_no}? The consignor’s cut is taken back${i.sale?.payout_id ? ' (it was already paid, so the next check is smaller)' : ''}.`) }, 'Undo sale'));
    } else {
      links.push(el('button', { class: 'link', type: 'button', onclick: go('back') }, 'Back in store'));
    }
    return el('div', { class: 'acts' }, links);
  }

  // ---- product review popup ---------------------------------------------------------------------------
  function openViewer(i) {
    const c = current.consignor;
    const st = { in_store: 'In store', returned: 'Given back', donated: 'Donated', sold: 'Sold' }[i.status] || i.status;
    const rows = [['Tag', i.item_no], ['Consignor', `${c.number} · ${c.name}`], ['Status', st], ['Price', i.price_cents !== null ? money(i.price_cents) : '—'],
      ['Their split', i.split + '%'], ['Their cut if sold', i.potential_cut_cents !== null && i.potential_cut_cents !== undefined ? money(i.potential_cut_cents) : '—'],
      ['Where', i.location], ['Received', i.received_at ? day(i.received_at) : ''], ['Website SKU', i.sku],
      ['Sold', i.sale ? `${money(i.sale.sold_cents)} on ${day(i.sale.sold_at)} via ${CHANNEL[i.sale.channel] || i.sale.channel}` : ''],
      ['Their cut', i.sale ? money(i.sale.cut_cents) : ''], ['Paid', i.sale ? (i.sale.payout_id ? 'Yes' + (i.sale.check_no ? ' · check ' + i.sale.check_no : '') : 'Not yet') : '']]
      .filter(r => r[1] !== '' && r[1] !== null && r[1] !== undefined);
    const close = () => overlay.remove();
    const overlay = el('div', { style: 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:12px', onclick: e => { if (e.target === overlay) close(); } },
      el('div', { style: 'background:#fff;color:#222;border-radius:12px;max-width:760px;width:100%;max-height:92vh;overflow:auto;padding:16px;position:relative' },
        el('button', { class: 'btn ghost small', type: 'button', onclick: close, style: 'position:absolute;top:10px;right:10px' }, 'Close ✕'),
        el('h3', { style: 'margin:0 70px 12px 0' }, i.description || i.item_no),
        el('div', { style: 'display:flex;flex-wrap:wrap;gap:16px' },
          i.image ? el('a', { href: imageSrc(i.image), target: '_blank', rel: 'noopener', title: 'Open the photo on its own' }, el('img', { src: imageSrc(i.image), alt: i.description || '', style: 'max-width:100%;width:340px;max-height:60vh;object-fit:contain;border-radius:8px;background:#f4f4f4' })) : el('div', { class: 'muted', style: 'width:340px;max-width:100%;padding:60px 0;text-align:center;background:#f4f4f4;border-radius:8px' }, 'No photo'),
          el('dl', { class: 'kv', style: 'flex:1;min-width:220px' }, rows.flatMap(r => [el('dt', {}, r[0]), el('dd', {}, String(r[1]))]))),
        el('div', { class: 'row', style: 'margin-top:12px' },
          i.site_url ? el('a', { class: 'btn small', href: '../../' + i.site_url, target: '_blank', rel: 'noopener' }, 'See it on the website ↗') : null)));
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
    document.body.appendChild(overlay);
  }

  function renderDetail() {
    const d = current;
    if (!d) return;
    const c = d.consignor;
    const t = d.totals;
    const box = $('consignorDetail');
    const parts = [
      el('div', { class: 'bar' }, el('h2', {}, `${c.number} · ${c.name}`),
        el('span', { class: 'badges' }, el('span', { class: 'badge ' + (c.status === 'active' ? 'ok' : 'dim') }, c.status), el('span', { class: 'badge dim' }, `${c.split_pct}% to them`))),
      el('p', { class: 'msg error cs-msg', hidden: true }),
      el('div', { class: 'cs-stats' },
        el('div', {}, el('p', { class: 'mono' }, 'Total consignment'), el('div', { class: 'big' }, money(d.items.reduce((n, i) => n + (i.price_cents || 0), 0))), el('span', { class: 'muted' }, `all ${d.items.length} piece(s) at tag price`)),
        el('div', {}, el('p', { class: 'mono' }, 'Sold'), el('div', { class: 'big' }, money(t.earned_cents)), el('span', { class: 'muted' }, `their share of ${money(t.sold_cents)} in sales`)),
        el('div', { class: t.owed_cents < 0 ? 'neg' : 'owed' }, el('p', { class: 'mono' }, t.owed_cents < 0 ? 'They owe back' : 'Owed now'), el('div', { class: 'big' }, money(Math.abs(t.owed_cents))),
          el('span', { class: 'muted' }, t.owed_cents < 0 ? 'a paid piece was refunded' : 'not paid yet')),
        el('div', {}, el('p', { class: 'mono' }, 'Paid'), el('div', { class: 'big' }, money(t.paid_cents)), el('span', { class: 'muted' }, `${d.payouts.length} check(s)`)),
        el('div', {}, el('p', { class: 'mono' }, 'If the rest sell'), el('div', { class: 'big' }, '+' + money(t.pending_cents)), el('span', { class: 'muted' }, `${t.items.in_store} piece(s) in store`))),
    ];

    if (openForm === 'edit') parts.push(consignorForm(c));
    else {
      parts.push(el('dl', { class: 'kv' },
        el('dt', {}, 'Phone'), el('dd', {}, c.phone ? el('a', { href: 'tel:' + c.phone }, c.phone) : '—'),
        el('dt', {}, 'Email'), el('dd', {}, c.email ? el('a', { href: 'mailto:' + c.email }, c.email) : '—'),
        el('dt', {}, 'Address'), el('dd', {}, c.address ? c.address.split('\n').flatMap((line, i) => i ? [el('br'), line] : [line]) : '—'),
        el('dt', {}, 'Contract'), el('dd', {}, [c.contract_no ? '#' + c.contract_no : null, c.contract_date ? 'from ' + day(c.contract_date) : null, c.contract_expires ? 'ends ' + day(c.contract_expires) : null].filter(Boolean).join(' · ') || '—', ' ', expiry(c)),
        c.notes ? [el('dt', {}, 'Notes'), el('dd', {}, c.notes)] : null),
        el('div', { class: 'row' }, el('button', { class: 'btn ghost small', type: 'button', onclick: () => { openForm = 'edit'; renderDetail(); } }, 'Edit details')));
    }

    // pieces
    const rows = d.items.flatMap(i => {
      const out = [el('tr', { class: i.status === 'in_store' ? '' : 'done' },
        el('td', {}, i.image ? el('img', { src: imageSrc(i.image), alt: i.description || '', width: 84, height: 112, title: 'Click to review this piece', onclick: () => openViewer(i), style: 'width:84px;height:112px;object-fit:cover;border-radius:6px;display:block;cursor:zoom-in' }) : el('span', { class: 'muted' }, 'No photo')),
        el('td', {}, el('span', { class: 'tag' }, i.item_no), el('br'), el('a', { href: '#', onclick: e => { e.preventDefault(); openViewer(i); } }, i.description || 'Review piece'), i.location ? el('span', { class: 'muted' }, ' · ' + i.location) : null,
          el('div', { class: 'muted', style: 'font-size:12px;margin-top:4px;line-height:1.5' },
            [i.received_at ? 'Received ' + day(i.received_at) : null, 'Split ' + i.split + '%', i.sale && i.sale.sold_at ? 'Sold ' + day(i.sale.sold_at) : null, i.sale && i.sale.channel ? 'via ' + i.sale.channel : null, i.site_url ? 'on website' : null].filter(Boolean).join(' · '))),
        el('td', { class: 'money' }, i.price_cents !== null ? money(i.price_cents) : '—', el('br'), el('span', { class: 'muted' }, i.split + '%')),
        el('td', {}, statusCell(i)),
        el('td', { class: 'money' }, i.sale ? [money(i.sale.sold_cents), el('br'), el('strong', {}, money(i.sale.cut_cents))] : (i.potential_cut_cents !== null && i.status === 'in_store' ? el('span', { class: 'muted' }, '→ ' + money(i.potential_cut_cents)) : '')),
        el('td', {}, itemActions(i)))];
      if (openForm === 'sold:' + i.id) out.push(el('tr', {}, el('td', { colspan: 6 }, soldForm(i))));
      if (openForm === 'item:' + i.id) out.push(el('tr', {}, el('td', { colspan: 6 }, itemForm(i))));
      return out;
    });
    parts.push(el('div', { class: 'section' },
      el('div', { class: 'bar' }, el('h3', {}, `Pieces (${d.items.length})`),
        c.status === 'active' ? el('button', { class: 'btn small', type: 'button', onclick: () => { openForm = 'add'; renderDetail(); } }, '+ Add a piece') : null),
      openForm === 'add' ? itemForm(null) : null,
      d.items.length ? el('div', { class: 'scroll-x' }, el('table', { class: 'table cs-items' },
        el('thead', {}, el('tr', {}, ['', 'Tag · piece', 'Price', 'Status', 'Sold · their cut', ''].map(h => el('th', {}, h)))),
        el('tbody', {}, rows))) : el('p', { class: 'muted' }, 'No pieces yet.')));

    // checks
    parts.push(el('div', { class: 'section' },
      el('div', { class: 'bar' }, el('h3', {}, 'Checks'),
        t.owed_cents > 0 && openForm !== 'check' ? el('button', { class: 'btn small', type: 'button', onclick: () => { openForm = 'check'; renderDetail(); } }, `Pay ${money(t.owed_cents)}`) : null),
      openForm === 'check' ? checkForm(t) : null,
      d.payouts.length ? el('table', { class: 'table' }, el('thead', {}, el('tr', {}, ['Date', 'Check', 'Amount', 'Covers', ''].map(h => el('th', {}, h)))),
        el('tbody', {}, d.payouts.map(p => el('tr', {}, el('td', {}, day(p.paid_at)), el('td', {}, p.check_no || '—'), el('td', { class: 'money' }, money(p.amount_cents)),
          el('td', {}, `${p.sales} sale(s)`),
          el('td', {}, el('button', { class: 'link', type: 'button', onclick: () => act(`admin/consign-payouts/${p.id}/delete`, {}, `Remove check ${p.check_no || ''} for ${money(p.amount_cents)}? Only if it was entered by mistake.`) }, 'Remove'))))))
        : el('p', { class: 'muted' }, 'No checks yet.')));

    // private account page
    const linkBox = lastLink && lastLink.id === c.id
      ? el('div', { class: 'portal-link' }, el('p', {}, `Text or email this link to ${c.name.split(' ')[0]}. It shows their pieces, what sold, their cut and their checks — nothing else. Anyone with the link can see it, so send it only to them.`),
        el('div', { class: 'copy' }, (() => { const i = el('input', { readonly: true, 'aria-label': 'Private link' }); i.value = lastLink.url; return i; })(),
          el('button', { class: 'btn small', type: 'button', onclick: async e => { try { await navigator.clipboard.writeText(lastLink.url); e.target.textContent = 'Copied'; } catch { e.target.previousSibling.select(); } } }, 'Copy')))
      : null;
    parts.push(el('div', { class: 'section' }, el('h3', {}, 'Their account page'),
      el('p', { class: 'muted' }, c.has_link ? 'They have a private link. Making a new one turns the old one off (use this if a link was shared by mistake).' : 'Make a private link so they can check their pieces and money any time, no password needed.'),
      c.status === 'active' ? el('div', { class: 'row' }, el('button', { class: 'btn ghost small', type: 'button', onclick: makeLink }, c.has_link ? 'Make a new link' : 'Make a private link')) : null,
      linkBox));

    if (d.events.length) {
      parts.push(el('details', { class: 'section' }, el('summary', {}, 'Activity'),
        el('ul', { class: 'events' }, d.events.map(e => el('li', {}, `${A.when(e.created_at)} · ${e.item_no ? e.item_no + ' · ' : ''}${e.detail}`)))));
    }
    box.replaceChildren(...parts);
    const firstInput = box.querySelector('.inline-form input:not([type=date])');
    if (firstInput) firstInput.focus({ preventScroll: false });
  }

  async function makeLink() {
    const c = current.consignor;
    if (c.has_link && !window.confirm('Make a new link? The link they have now stops working.')) return;
    try {
      const data = await api(`admin/consignors/${c.id}/link`, { method: 'POST' });
      lastLink = { id: c.id, url: data.url };
      current.consignor.has_link = true;
      renderDetail();
    } catch (error) { flashDetail(error.message); }
  }

  // ---- import her spreadsheet ---------------------------------------------------------------------
  let pending = null;
  $('importFile').addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    pending = { name: file.name, data };
    runImport(false);
  });

  async function runImport(apply) {
    const box = $('importBox');
    box.hidden = false;
    box.replaceChildren(el('p', { class: 'muted' }, apply ? 'Importing…' : 'Reading the spreadsheet…'));
    try {
      const { result } = await api('admin/consignors/import', { method: 'POST', body: { ...pending, apply } });
      const rows = result.consignors.map(c => el('tr', {}, el('td', {}, c.number), el('td', {}, c.name), el('td', {}, c.new ? 'new' : 'update'),
        el('td', {}, `${c.items_new} new, ${c.items_known} known`), el('td', {}, String(c.sales)), el('td', {}, c.contract_expires ? day(c.contract_expires) : '—')));
      box.replaceChildren(...[   // (replaceChildren would print a null as the word "null")
        el('div', { class: 'bar' }, el('h2', {}, apply ? 'Imported' : `Import “${pending.name}”?`), el('button', { class: 'link', type: 'button', onclick: () => { box.hidden = true; } }, 'Close')),
        el('p', { class: 'muted' }, apply ? 'Done. Consignors and pieces are saved; you can change anything here from now on.'
          : 'This is what the website found. Nothing is saved until you press Import. Running it again later only adds what is new.'),
        el('div', { class: 'scroll-x' }, el('table', { class: 'table' }, el('thead', {}, el('tr', {}, ['Number', 'Name', '', 'Pieces', 'Sold', 'Contract ends'].map(h => el('th', {}, h)))), el('tbody', {}, rows))),
        result.warnings.length ? el('details', { open: true }, el('summary', {}, `${result.warnings.length} note(s)`), el('ul', {}, result.warnings.map(w => el('li', {}, w)))) : null,
        apply ? null : el('div', { class: 'row' }, el('button', { class: 'btn small', type: 'button', onclick: () => runImport(true) }, `Import ${result.consignors.length} consignor(s)`)),
        // Next step after an import: review their pieces and put them on the website (Weekly uploads → Put on website).
        apply ? el('div', { class: 'row' }, el('button', { class: 'btn small', type: 'button', onclick: () => putOnWebsite(result.consignors.map(c => c.number)) }, 'Next: put their pieces on the website →')) : null].filter(Boolean));
      if (apply) { pending = null; loadList(); }
    } catch (error) {
      box.replaceChildren(el('p', { class: 'msg error' }, error.message), el('button', { class: 'link', type: 'button', onclick: () => { box.hidden = true; } }, 'Close'));
    }
  }

  // "Put on website" lives in the Weekly uploads tab (window.TKWeekly); this opens it for the consignors just imported.
  function putOnWebsite(numbers) {
    document.querySelector('[data-tab="weekly"]')?.click();
    if (window.TKWeekly && typeof window.TKWeekly.putOnWebsite === 'function') window.TKWeekly.putOnWebsite({ consignors: numbers });
  }

  const asBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  // Her workbook can also be dropped anywhere on the Consignors tab, or handed over from Pieces → Add from a spreadsheet.
  window.TKConsignors = {
    importData(name, data) { pending = { name, data }; document.querySelector('[data-tab="consignors"]')?.click(); runImport(false); },
    putOnWebsite,
  };
  const panel = document.querySelector('[data-panel="consignors"]');
  if (panel) {
    panel.addEventListener('dragover', event => { if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); panel.classList.add('dropping'); } });
    panel.addEventListener('dragleave', event => { if (!panel.contains(event.relatedTarget)) panel.classList.remove('dropping'); });
    panel.addEventListener('drop', async event => {
      event.preventDefault();
      panel.classList.remove('dropping');
      const file = [...event.dataTransfer.files].find(f => /\.xlsx$/i.test(f.name));
      if (!file) { appError(new Error('Drop her consignor workbook (.xlsx) here.')); return; }
      pending = { name: file.name, data: await asBase64(file) };
      runImport(false);
    });
  }
})();
