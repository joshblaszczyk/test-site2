// ThomKat demo: serves the photos added in the demo admin (kept in this browser's Cache) so the shop, the admin and the
// consignor page can show them like any other picture. No network, no server: it only answers /products/img/demo-<id>-<size>.jpg.
const CACHE = 'thomkat-demo-photos';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!/\/products\/img\/demo-[a-f0-9]+-(lg|card|thumb)\.jpg$/.test(url.pathname)) return;
  event.respondWith(caches.open(CACHE).then(cache => cache.match(url.origin + url.pathname)).then(hit => hit || new Response('', { status: 404 })));
});
