// ThomKat shared site header (2026-11-14; every page incl. home since 2026-11-15): dropdowns, phone menu, search, favorites, account and bag icons. Markup: tools/site_nav.py.
// One dropdown open at a time: hovering a menu opens it and closes any other; a click pins/unpins it.
(function () {
  'use strict';
  const head = document.querySelector('header.tk-site');
  if (!head) return;
  const links = head.querySelector('.sn-links');
  const dds = [...head.querySelectorAll('.sn-dd')];
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  const wide = window.matchMedia('(min-width: 961px)');
  let timer = null;

  // A pull-down opens centered under its item; near the screen edges it is nudged back inside (12 px margin).
  function fit(dd) {
    const panel = dd.querySelector('.sn-panel');
    if (!panel || !wide.matches) return;
    panel.style.setProperty('--sn-shift', '0px');
    const r = panel.getBoundingClientRect(), vw = document.documentElement.clientWidth;
    let shift = 0;
    if (r.right > vw - 12) shift = (vw - 12) - r.right;
    if (r.left + shift < 12) shift = 12 - r.left;
    panel.style.setProperty('--sn-shift', Math.round(shift) + 'px');
  }
  function set(dd, open) {
    dd.classList.toggle('open', open);
    const t = dd.querySelector('.sn-toggle');
    if (t) t.setAttribute('aria-expanded', String(open));
    if (open) fit(dd);
  }
  function only(dd) { dds.forEach(d => set(d, d === dd)); }
  function closeAll() { dds.forEach(d => set(d, false)); }

  dds.forEach(dd => {
    const toggle = dd.querySelector('.sn-toggle');
    toggle.addEventListener('click', event => {
      event.preventDefault();
      const open = !dd.classList.contains('open');
      if (open) only(dd); else set(dd, false);
    });
    dd.addEventListener('pointerenter', () => {
      if (!fine.matches || !wide.matches) return;
      clearTimeout(timer);
      only(dd);
    });
    dd.addEventListener('pointerleave', () => {
      if (!fine.matches || !wide.matches) return;
      clearTimeout(timer);
      timer = setTimeout(() => set(dd, false), 220);
    });
  });
  document.addEventListener('click', event => { if (!event.target.closest('header.tk-site .sn-dd')) closeAll(); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const open = dds.find(d => d.classList.contains('open'));
    closeAll();
    if (open) open.querySelector('.sn-toggle').focus();
    if (links.classList.contains('open')) toggleMenu(false);
  });

  // Phone/tablet menu
  const menuBtn = head.querySelector('.sn-menu');
  function toggleMenu(force) {
    const open = typeof force === 'boolean' ? force : !links.classList.contains('open');
    links.classList.toggle('open', open);
    if (menuBtn) { menuBtn.setAttribute('aria-expanded', String(open)); menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu'); }
    if (!open) closeAll();
  }
  if (menuBtn) menuBtn.addEventListener('click', () => toggleMenu());
  links.addEventListener('click', event => { if (event.target.closest('a')) toggleMenu(false); });
  wide.addEventListener('change', () => { toggleMenu(false); });
  window.addEventListener('resize', () => dds.filter(d => d.classList.contains('open')).forEach(fit));

  // Search: on the shop page, jump to its search box; elsewhere open the shop with the search box ready.
  const searchBtn = head.querySelector('.sn-search');
  const shopSearch = () => document.getElementById('search');
  if (searchBtn) searchBtn.addEventListener('click', event => {
    const box = shopSearch();
    if (!box) return;   // the link goes to index.html#search
    event.preventDefault();
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    box.focus({ preventScroll: true });
  });
  if (location.hash === '#search') window.addEventListener('load', () => { const box = shopSearch(); if (box) { box.scrollIntoView({ block: 'center' }); box.focus({ preventScroll: true }); } });

  // "Sell" opens the Sell-with-us form when the page has it (home.html); elsewhere the link goes to home.html#sell,
  // which opens it there. home.html#policy opens the Policy pull-down.
  const sellForm = () => typeof window.openModal === 'function' && document.getElementById('sellModal');
  head.addEventListener('click', event => {
    const a = event.target.closest('a[href="home.html#sell"]');
    if (!a || !sellForm()) return;
    event.preventDefault();
    closeAll();
    toggleMenu(false);
    window.openModal();
  });
  function openFromHash() {
    if (location.hash === '#sell' && sellForm()) { window.openModal(); return; }
    if (location.hash !== '#policy') return;
    const dd = document.getElementById('snPolicy')?.closest('.sn-dd');
    if (!dd) return;
    window.scrollTo(0, 0);
    if (!wide.matches) toggleMenu(true);
    only(dd);
  }
  if (location.hash === '#sell' || location.hash === '#policy') window.addEventListener('load', openFromHash);
  window.addEventListener('hashchange', openFromHash);   // same page, new #: no load event

  // Bag: the shop script (shop/shop.js) takes the button over where the pieces are; elsewhere it opens the bag on the shop.
  const bagBtn = head.querySelector('.sn-bag');
  const count = document.getElementById('cartCount');
  if (count && !window.ThomKatShop) {
    try { const bag = JSON.parse(localStorage.getItem('thomkat.bag.v1') || '[]'); count.textContent = String(Array.isArray(bag) ? bag.length : 0); } catch (e) { /* storage blocked: shows 0 */ }
  }
  if (bagBtn) bagBtn.addEventListener('click', event => {
    if (bagBtn.onclick) return;   // shop.js handles it on this page
    event.preventDefault();
    location.href = 'index.html#bag';
  });

  // Customer accounts: the heart (favorites) and account icons, and hearts that follow a signed-in customer (shop/account-client.js).
  if (!window.ThomKatAccount && !document.querySelector('script[data-tk-account]')) {
    const s = document.createElement('script');
    s.src = 'shop/account-client.js?v=20261116a';
    s.defer = true;
    s.dataset.tkAccount = '1';
    document.head.append(s);
  }
})();
