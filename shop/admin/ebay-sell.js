// Admin → Pieces & eBay: "Add a piece" (photos resized here in the browser, then sent one at a time) and
// "List on eBay" / "End on eBay" for website pieces (shop/lib/ebay_sell.php). Uses admin.js through window.TKAdmin.
(function () {
  'use strict';
  const A = () => window.TKAdmin;
  const el = (...args) => A().el(...args);

  // ---- a simple modal window (<dialog>) ------------------------------------------------------------
  function modal(title) {
    const body = el('div', { class: 'dlg-body' });
    const close = el('button', { class: 'dlg-x', type: 'button', 'aria-label': 'Close' }, '×');
    const dialog = el('dialog', { class: 'dlg', 'aria-label': title }, el('div', { class: 'dlg-head' }, el('h2', {}, title), close), body);
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    return { dialog, body, close: () => dialog.close() };
  }
  const msg = (text, kind = 'info') => el('p', { class: 'msg ' + kind }, text);
  const field = (label, input, hint) => el('label', {}, label, input, hint ? el('span', { class: 'sub' }, hint) : null);

  // ---- List on eBay ---------------------------------------------------------------------------------
  async function list(p, storeWanted) {
    const m = modal('List on eBay');
    m.body.append(msg('Loading her eBay stores and policies…'));
    let o;
    try {
      o = await A().api('admin/ebay/list-options?sku=' + encodeURIComponent(p.sku) + (storeWanted ? '&store=' + encodeURIComponent(storeWanted) : ''));
    } catch (error) { m.body.replaceChildren(msg(error.message, 'error')); return; }

    const store = el('select', { 'aria-label': 'eBay store' }, o.stores.map(s => el('option', { value: s, selected: s === o.store }, s)));
    store.addEventListener('change', () => { m.close(); list(p, store.value); });
    const title = el('input', { value: o.piece.title, maxlength: '80', required: true });
    const count = el('span', { class: 'sub' });
    const updateCount = () => { count.textContent = `${title.value.length} of 80 characters`; };
    title.addEventListener('input', updateCount); updateCount();
    const price = el('input', { type: 'number', step: '0.01', min: '0.99', value: (o.piece.price_cents / 100).toFixed(2), required: true });
    const policy = (kind, label) => {
      const chosen = o.chosen[kind + 'PolicyId'];
      return field(label, el('select', { 'data-policy': kind }, o.policies[kind].map(x => el('option', { value: x.id, selected: x.id === chosen }, x.name))));
    };
    const catBox = el('div', { class: 'cat-list' });
    const otherCat = el('input', { inputmode: 'numeric', placeholder: 'or type an eBay category number', 'aria-label': 'Other eBay category number' });
    const details = el('div', { class: 'aspects' }, el('p', { class: 'sub' }, 'Pick a category to see the details eBay needs.'));
    let info = null;
    const pickCategory = async id => {
      details.replaceChildren(msg('Loading what eBay needs for this category…'));
      try {
        info = await A().api(`admin/ebay/category?sku=${encodeURIComponent(p.sku)}&id=${encodeURIComponent(id)}`);
        renderDetails();
      } catch (error) { info = null; details.replaceChildren(msg(error.message, 'error')); }
    };
    o.categories.forEach((c, i) => {
      const radio = el('input', { type: 'radio', name: 'ebayCat', value: c.id });
      radio.addEventListener('change', () => { otherCat.value = ''; pickCategory(c.id); });
      catBox.append(el('label', { class: 'cat' }, radio, el('span', {}, el('strong', {}, c.name), el('br'), el('span', { class: 'sub' }, `${c.path} · #${c.id}`))));
      if (i === 0) { radio.checked = true; }
    });
    if (!o.categories.length) catBox.append(el('p', { class: 'sub' }, 'eBay had no suggestion for this title: type the category number below.'));
    otherCat.addEventListener('change', () => { if (/^\d+$/.test(otherCat.value.trim())) { catBox.querySelectorAll('input').forEach(r => { r.checked = false; }); pickCategory(otherCat.value.trim()); } });

    let condition;
    let conditionNote;
    function renderDetails() {
      const inputs = info.aspects.map(a => {
        const guess = info.guess.aspects[a.name] || '';
        const label = a.name + (a.required ? ' *' : '');
        if (!a.free) {
          return field(label, el('select', { 'data-aspect': a.name, 'data-multi': a.multi ? '1' : null },
            el('option', { value: '' }, a.required ? '— pick —' : '—'), a.values.map(v => el('option', { value: v, selected: v === guess }, v))));
        }
        const listId = 'dl-' + Math.random().toString(36).slice(2);
        const input = el('input', { 'data-aspect': a.name, 'data-multi': a.multi ? '1' : null, value: guess, list: a.values.length ? listId : null,
          placeholder: a.multi ? 'one or more, separated by commas' : '' });
        return field(label, el('span', {}, input, a.values.length ? el('datalist', { id: listId }, a.values.slice(0, 150).map(v => el('option', { value: v }))) : null));
      });
      condition = el('select', {}, info.conditions.map(c => el('option', { value: String(c.id), selected: c.id === info.guess.condition_id }, c.name)));
      conditionNote = el('input', { maxlength: '1000', placeholder: 'e.g. “Excellent condition, no flaws”' });
      details.replaceChildren(el('div', { class: 'form-grid' }, field('Condition *', condition), field('Condition notes (pre-owned)', conditionNote), ...inputs),
        el('p', { class: 'sub' }, '* eBay requires these for this category. The others help buyers find it.'));
    }

    const status = el('div');
    const post = el('button', { class: 'btn', type: 'button' }, 'Post to eBay');
    const seen = () => status.scrollIntoView({ block: 'nearest' });   // the answer is below the button: scroll it into view
    post.addEventListener('click', async () => {
      if (!info) { status.replaceChildren(msg('Pick a category first.', 'error')); seen(); return; }
      const aspects = {};
      details.querySelectorAll('[data-aspect]').forEach(input => {
        const v = input.value.trim();
        if (!v) return;
        aspects[input.dataset.aspect] = input.dataset.multi ? v.split(',').map(x => x.trim()).filter(Boolean) : v;
      });
      const body = { sku: p.sku, store: store.value, category_id: info.category_id, condition_id: Number(condition.value), condition_note: conditionNote.value,
        title: title.value.trim(), price: price.value, aspects };
      m.body.querySelectorAll('[data-policy]').forEach(s => { body[s.dataset.policy + '_policy_id'] = s.value; });
      post.disabled = true;
      status.replaceChildren(msg(`Sending ${o.piece.photos.length} photo(s) and the listing to eBay… this can take a minute.`));
      try {
        const { result } = await A().api('admin/ebay/list', { method: 'POST', body });
        status.replaceChildren(msg(`Listed in ${result.store}. It comes off eBay by itself if it sells on the website or in the store.`, 'ok'),
          el('div', { class: 'row' }, el('a', { class: 'btn small', href: result.url, target: '_blank', rel: 'noopener' }, 'See it on eBay ↗'),
            el('button', { class: 'btn ghost small', type: 'button', onclick: () => m.close() }, 'Done')));
        post.remove();
        seen();
        A().reloadPieces();
      } catch (error) { status.replaceChildren(msg(error.message, 'error')); post.disabled = false; seen(); }
    });

    m.body.replaceChildren(
      el('div', { class: 'list-head' },
        el('div', {}, el('strong', {}, o.piece.name), el('div', { class: 'sub' }, `${o.piece.photos.length} photo(s) · box ${o.piece.weight_lb} lb, ${o.piece.box} (edit on the piece) · SKU ${o.piece.sku}`)),
        o.piece.photos[0] ? el('img', { src: A().imageSrc(o.piece.photos[0]), alt: '' }) : null),
      el('div', { class: 'form-grid' },
        field('Her eBay store', store), field('Price on eBay ($)', price),
        el('div', { class: 'wide' }, field('eBay title', title, null), count)),
      el('h3', {}, 'Category'), catBox, otherCat,
      el('h3', {}, 'Details'), details,
      el('h3', {}, 'Her eBay policies'),
      el('div', { class: 'form-grid' }, policy('fulfillment', 'Shipping'), policy('return', 'Returns'), policy('payment', 'Payment')),
      el('div', { class: 'row' }, post), status);
    if (o.categories[0]) pickCategory(o.categories[0].id);
  }

  async function end(p) {
    if (!window.confirm(`End the eBay listing for “${p.name}”${p.ebay_seller ? ` in ${p.ebay_seller}` : ''}? It stays on the website.`)) return;
    try {
      const { result } = await A().api('admin/ebay/end', { method: 'POST', body: { sku: p.sku } });
      A().flash('ebayResult', `${p.sku}: ${result.detail}`, 'ok');
      A().reloadPieces();
    } catch (error) { A().flash('ebayResult', `${p.sku}: ${error.message}`, 'error'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  }

  // ---- Add a piece ----------------------------------------------------------------------------------
  /** Three JPEG sizes of one photo (longest side 1600 / 800 / 240), made in the browser. */
  async function photoSizes(file) {
    let bitmap;
    try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { bitmap = await createImageBitmap(file); }
    const out = {};
    for (const [name, side, quality] of [['lg', 1600, 0.86], ['card', 800, 0.84], ['thumb', 240, 0.82]]) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      out[name] = btoa(binary);
    }
    bitmap.close?.();
    return out;
  }

  // ---- drop zone: files or whole folders -------------------------------------------------------------
  const SHEET = /\.(xlsx|xls|csv|tsv)$/i;
  const PHOTO = /\.(jpe?g|png|webp|heic|heif|gif)$/i;
  async function filesFromDrop(dataTransfer) {
    const out = [];
    const walk = entry => new Promise(resolve => {
      if (!entry) return resolve();
      if (entry.isFile) { entry.file(f => { out.push(f); resolve(); }, () => resolve()); return; }
      if (entry.isDirectory) {
        const reader = entry.createReader();
        const all = [];
        const more = () => reader.readEntries(async batch => {
          if (!batch.length) { for (const e of all) await walk(e); resolve(); return; }
          all.push(...batch); more();
        }, () => resolve());
        more();
        return;
      }
      resolve();
    });
    const entries = [...(dataTransfer.items || [])].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
    if (entries.length) { for (const e of entries) await walk(e); } else { out.push(...dataTransfer.files); }
    return out.filter(f => !f.name.startsWith('.'));
  }
  function dropZone(text, onFiles, { folder = true, accept = '' } = {}) {
    const pick = el('input', { type: 'file', multiple: true, accept, hidden: true });
    const pickFolder = el('input', { type: 'file', multiple: true, webkitdirectory: true, hidden: true });
    const zone = el('div', { class: 'dropzone', tabindex: '0', role: 'button', 'aria-label': text },
      el('strong', {}, text), el('span', { class: 'sub' }, 'Drag them here, or'),
      el('span', { class: 'row', style: 'justify-content:center;margin-top:4px' },
        el('button', { class: 'btn ghost small', type: 'button', onclick: e => { e.stopPropagation(); pick.click(); } }, 'Choose files'),
        folder ? el('button', { class: 'btn ghost small', type: 'button', onclick: e => { e.stopPropagation(); pickFolder.click(); } }, 'Choose a folder') : null),
      pick, pickFolder);
    const take = list => { const files = [...list].filter(f => !f.name.startsWith('.')); if (files.length) onFiles(files); };
    pick.addEventListener('change', () => { take(pick.files); pick.value = ''; });
    pickFolder.addEventListener('change', () => { take(pickFolder.files); pickFolder.value = ''; });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', async e => { e.preventDefault(); zone.classList.remove('over'); take(await filesFromDrop(e.dataTransfer)); });
    zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick.click(); } });
    return zone;
  }
  const asBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  /** "T2261100a.JPG" → { key: "t2261100", order: "a" } (the item number and which photo it is). */
  function photoKey(name) {
    const base = name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const m = base.match(/^(.*\d)([a-z])(\d?)$/);
    return m ? { key: m[1], order: m[2] + m[3] } : { key: base, order: '' };
  }
  async function uploadPhoto(file) {
    let sizes;
    try { sizes = await photoSizes(file); } catch { throw new Error(`${file.name} could not be read by this browser${/\.hei[cf]$/i.test(file.name) ? ' (HEIC photo: save it as JPG first)' : ''}.`); }
    return (await A().api('admin/pieces/photo', { method: 'POST', body: sizes })).photo.id;
  }

  // ---- + Add a piece ----------------------------------------------------------------------------------
  async function addPiece() {
    const m = modal('Add a piece');
    m.body.append(msg('Loading her categories…'));
    let opts;
    try { opts = await A().api('admin/pieces/form'); } catch (error) { m.body.replaceChildren(msg(error.message, 'error')); return; }
    const input = (name, attrs = {}) => el('input', { name, ...attrs });
    const dlist = (id, values) => el('datalist', { id }, values.map(v => el('option', { value: v })));
    const itemNo = input('item_number', { required: true, placeholder: 'her tag number, e.g. T2261100', autocapitalize: 'characters' });
    const name = input('name', { required: true, maxlength: '120', placeholder: 'Brand, what it is, color, Size …' });
    const price = input('price', { type: 'number', step: '0.01', min: '0.01', required: true });
    const main = el('select', { name: 'main_category', required: true }, el('option', { value: '' }, '— category —'), Object.keys(opts.categories).map(c => el('option', { value: c }, c)));
    const sub = el('select', { name: 'sub_category' }, el('option', { value: '' }, '—'));
    main.addEventListener('change', () => sub.replaceChildren(el('option', { value: '' }, '—'), ...(opts.categories[main.value] || []).map(s => el('option', { value: s }, s))));
    const sizes = Object.values(opts.sizes || {}).flat();
    const condition = el('select', { name: 'condition' }, opts.conditions.map(c => el('option', { value: c }, c)));
    const location = el('select', { name: 'location' }, opts.locations.map(l => el('option', { value: l }, l)));
    const details = el('textarea', { name: 'details', rows: '4', placeholder: 'One per line: measurements, closures, notes…' });
    const previews = el('div', { class: 'photo-row' });
    let chosen = [];
    const drawPreviews = () => previews.replaceChildren(...chosen.map((f, i) => el('figure', {},
      el('img', { src: f.url, alt: '' }), el('figcaption', {}, i === 0 ? 'main photo' : `#${i + 1}`),
      el('button', { type: 'button', class: 'dlg-x small', 'aria-label': 'Remove photo', onclick: () => { URL.revokeObjectURL(f.url); chosen.splice(i, 1); drawPreviews(); } }, '×'),
      i > 0 ? el('button', { type: 'button', class: 'link', onclick: () => { chosen.unshift(chosen.splice(i, 1)[0]); drawPreviews(); } }, 'make main') : null)));
    const addFiles = files => {
      for (const f of files.filter(f => PHOTO.test(f.name)).sort((a, b) => a.name.localeCompare(b.name))) { if (chosen.length < 12) chosen.push({ file: f, url: URL.createObjectURL(f) }); }
      drawPreviews();
    };
    const form = el('form', { class: 'form-grid', novalidate: true },
      field('Item number (tag) *', itemNo), field('Price ($) *', price),
      el('div', { class: 'wide' }, field('Name *', name, 'Shown on the website; also the eBay title (up to 80 characters).')),
      field('Category *', main), field('Sub category', sub),
      field('Size', el('span', {}, input('size', { list: 'pieceSizes' }), dlist('pieceSizes', sizes))),
      field('Color', el('span', {}, input('color', { list: 'pieceColors' }), dlist('pieceColors', opts.colors))),
      field('Brand', el('span', {}, input('brand', { list: 'pieceBrands' }), dlist('pieceBrands', opts.brands || []))), field('Condition', condition),
      field('Type', input('type', { placeholder: 'e.g. Gown, Blazer, Pumps' })), field('Material', input('material')),
      el('div', { class: 'wide' }, field('Short description', input('description', { maxlength: '300', placeholder: 'One line under the name (optional)' }))),
      el('div', { class: 'wide' }, field('Details', details)),
      field('Kept at', location),
      field('Weight (lb, boxed)', input('weight_lb', { type: 'number', step: '0.1', value: '2' })),
      field('Box (in)', el('span', { class: 'box3' }, input('length_in', { type: 'number', step: '0.5', value: '15', 'aria-label': 'Length' }), input('width_in', { type: 'number', step: '0.5', value: '11', 'aria-label': 'Width' }), input('height_in', { type: 'number', step: '0.5', value: '3', 'aria-label': 'Height' }))),
      el('div', { class: 'wide' }, el('label', {}, 'Photos * (up to 12; the first is the main photo)'), dropZone('Drop the photos here', addFiles, { folder: false, accept: 'image/*' }), previews));
    form.addEventListener('submit', e => e.preventDefault());
    const status = el('div');
    const save = el('button', { class: 'btn', type: 'button' }, 'Add to the website');
    save.addEventListener('click', async () => {
      const data = Object.fromEntries(new FormData(form).entries());
      if (!data.item_number || !data.name || !data.price || !data.main_category) { status.replaceChildren(msg('Fill in the item number, name, price and category.', 'error')); status.scrollIntoView({ block: 'nearest' }); return; }
      if (!chosen.length) { status.replaceChildren(msg('Add at least one photo.', 'error')); status.scrollIntoView({ block: 'nearest' }); return; }
      save.disabled = true;
      try {
        const ids = [];
        for (const [i, c] of chosen.entries()) {
          status.replaceChildren(msg(`Preparing photo ${i + 1} of ${chosen.length}…`));
          ids.push(await uploadPhoto(c.file));
        }
        status.replaceChildren(msg('Adding it to the website…'));
        const added = await A().api('admin/pieces/new', { method: 'POST', body: { ...data, photos: ids } });
        chosen.forEach(c => URL.revokeObjectURL(c.url));
        form.remove(); save.remove();
        status.replaceChildren(msg(`${added.name} is on the website now (item ${added.sku}).`, 'ok'),
          el('div', { class: 'row' },
            el('a', { class: 'btn ghost small', href: '../../' + added.url, target: '_blank', rel: 'noopener' }, 'See it on the site ↗'),
            el('button', { class: 'btn small', type: 'button', onclick: () => { m.close(); list({ sku: added.sku, name: added.name }); } }, 'List it on eBay too'),
            el('button', { class: 'btn ghost small', type: 'button', onclick: () => m.close() }, 'Done')));
        A().reloadPieces();
      } catch (error) { status.replaceChildren(msg(error.message, 'error')); save.disabled = false; status.scrollIntoView({ block: 'nearest' }); }
    });
    m.body.replaceChildren(form, el('div', { class: 'row' }, save), status);
  }

  // ---- Add from a spreadsheet (+ photos) -----------------------------------------------------------------
  async function bulkAdd() {
    const m = modal('Add pieces from a spreadsheet');
    const area = el('div');
    const templateLink = el('a', { class: 'btn ghost small', href: new URL('../api/admin/pieces/template.xlsx', location.href).href }, 'Download the Excel template');
    let photos = new Map();   // photo key → [{file, order}]
    let rows = [];
    let onSite = new Set();
    const keyOf = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    async function take(files) {
      const sheets = files.filter(f => SHEET.test(f.name));
      const pics = files.filter(f => PHOTO.test(f.name));
      for (const f of pics) {
        const k = photoKey(f.name);
        if (!photos.has(k.key)) photos.set(k.key, []);
        const list = photos.get(k.key);
        if (!list.some(x => x.file.name === f.name)) list.push({ file: f, order: k.order, name: f.name.replace(/\.[^.]+$/, '').toLowerCase() });
      }
      if (!sheets.length && !rows.length) { area.replaceChildren(msg(`${pics.length} photo(s) added. Now drop the spreadsheet too (Excel .xlsx or .csv).`)); return; }
      for (const sheet of sheets) {
        area.replaceChildren(msg(`Reading ${sheet.name}…`));
        try {
          const data = await asBase64(sheet);
          const r = await A().api('admin/pieces/sheet', { method: 'POST', body: { name: sheet.name, data } });
          if (r.kind === 'consignors') {
            area.replaceChildren(msg(`“${sheet.name}” is her consignor workbook (${r.sheets} consignor sheet(s)), not a list of pieces for the website.`),
              el('div', { class: 'row' }, el('button', { class: 'btn small', type: 'button', onclick: () => { m.close(); window.TKConsignors?.importData(sheet.name, data); } }, 'Import it under Consignors')));
            return;
          }
          rows.push(...r.rows.map(row => ({ ...row, sheet: sheet.name, include: true })));
        } catch (error) { area.replaceChildren(msg(`${sheet.name}: ${error.message}`, 'error')); return; }
      }
      if (!onSite.size) {
        try { onSite = new Set((await A().api('admin/products')).products.map(p => keyOf(p.sku))); } catch { /* the batch checks again */ }
      }
      render();
    }
    function photosFor(row) {
      let list = [];
      if (row.photos_named?.length) {
        const wanted = row.photos_named.map(n => n.replace(/\.[^.]+$/, '').toLowerCase());
        for (const group of photos.values()) for (const p of group) if (wanted.includes(p.name)) list.push(p);
        list.sort((a, b) => wanted.indexOf(a.name) - wanted.indexOf(b.name));
      }
      if (!list.length) list = [...(photos.get(row.photo_key) || [])].sort((a, b) => a.order.localeCompare(b.order));
      return list.slice(0, 12);
    }
    function render() {
      const table = el('tbody');
      let ready = 0;
      rows.forEach(row => {
        const pics = photosFor(row);
        const problems = [...row.problems];
        if (onSite.has(keyOf(row.item_number))) problems.push('already on the website');
        if (!pics.length) problems.push('no photos found for ' + (row.item_number || 'it'));
        row.ok = !problems.length;
        if (!row.ok) row.include = false;
        if (row.include) ready++;
        const box = el('input', { type: 'checkbox', checked: row.include, disabled: !row.ok, 'aria-label': 'Add ' + (row.name || row.item_number) });
        box.addEventListener('change', () => { row.include = box.checked; render(); });
        const thumb = pics[0] ? el('img', { src: URL.createObjectURL(pics[0].file), alt: '', onload: e => URL.revokeObjectURL(e.target.src) }) : el('span', { class: 'sub' }, '—');
        table.append(el('tr', { class: row.ok ? '' : 'dim' }, el('td', {}, box), el('td', {}, thumb),
          el('td', {}, el('strong', {}, row.item_number || '?'), row.item_label ? el('div', { class: 'sub' }, row.item_label) : null),
          el('td', {}, row.name || '—', el('div', { class: 'sub' }, [row.size && `Size ${row.size}`, row.color, row.brand, row.condition].filter(Boolean).join(' · '))),
          el('td', {}, row.price ? '$' + Number(row.price).toFixed(2) : '—'),
          el('td', {}, row.main_category || '—', row.sub_category ? el('div', { class: 'sub' }, row.sub_category) : null),
          el('td', {}, `${pics.length} photo(s)`),
          el('td', {}, problems.length ? el('span', { class: 'sub bad-text' }, problems.join('; ')) : el('span', { class: 'badge ok' }, 'ready'))));
      });
      const go = el('button', { class: 'btn', type: 'button', disabled: !ready }, `Add ${ready} piece(s) to the website`);
      go.addEventListener('click', () => addRows(go));
      const photoCount = [...photos.values()].reduce((n, g) => n + g.length, 0);
      area.replaceChildren(
        el('p', { class: 'muted' }, `${rows.length} piece(s) in the sheet · ${photoCount} photo(s) dropped. Pieces with a problem are left out; drop more photos or another sheet any time.`),
        el('div', { class: 'scroll-x' }, el('table', { class: 'table bulk' }, el('thead', {}, el('tr', {}, ['', '', 'Item', 'Name', 'Price', 'Category', 'Photos', ''].map(h => el('th', {}, h)))), table)),
        el('div', { class: 'row' }, go), el('div', { id: 'bulkStatus' }));
    }
    async function addRows(button) {
      button.disabled = true;
      const status = area.querySelector('#bulkStatus');
      const chosen = rows.filter(r => r.include && r.ok);
      const ready = [];
      const failed = [];
      let done = 0;
      const total = chosen.reduce((n, r) => n + photosFor(r).length, 0);
      for (const row of chosen) {
        try {
          const ids = [];
          for (const p of photosFor(row)) {
            status.replaceChildren(msg(`Sending photos… ${++done} of ${total} (${row.item_number})`));
            ids.push(await uploadPhoto(p.file));
          }
          const { sheet, include, ok, problems, photo_key, photos_named, ...fields } = row;
          ready.push({ ...fields, photos: ids });
        } catch (error) { failed.push(`${row.item_number}: ${error.message}`); }
      }
      let added = 0;
      for (let i = 0; i < ready.length; i += 20) {
        status.replaceChildren(msg(`Adding pieces to the website… ${Math.min(i + 20, ready.length)} of ${ready.length}`));
        try {
          const r = await A().api('admin/pieces/batch', { method: 'POST', body: { pieces: ready.slice(i, i + 20) } });
          added += r.added.length;
          r.added.forEach(a => onSite.add(keyOf(a.sku)));
          failed.push(...r.errors.map(e => `${e.item || 'row ' + e.row}: ${e.error}`));
        } catch (error) { failed.push(error.message); }
      }
      rows = rows.filter(r => !onSite.has(keyOf(r.item_number)));
      A().reloadPieces();
      render();
      area.querySelector('#bulkStatus').replaceChildren(msg(`${added} piece(s) added to the website.${added ? ' Each one can go on eBay from its row in Pieces & eBay.' : ''}`, added ? 'ok' : 'info'),
        ...(failed.length ? [el('details', { open: true }, el('summary', {}, `${failed.length} not added`), el('ul', {}, failed.map(f => el('li', {}, f))))] : []));
    }
    m.body.replaceChildren(
      el('p', { class: 'muted' }, 'Drop her spreadsheet and the photos — or the whole folder they are in. Photos are matched to rows by item number: T2261100a.jpg, T2261100b.jpg … (a is the main photo). Her old WooCommerce product sheets work as they are.'),
      el('div', { class: 'row' }, templateLink),
      dropZone('Drop the spreadsheet + photos here', take), area);
  }

  document.getElementById('addPiece')?.addEventListener('click', addPiece);
  document.getElementById('addSheet')?.addEventListener('click', bulkAdd);
  window.TKEbay = { list, end, addPiece, bulkAdd };
})();
