// Service Worker: HoneyCut auch ohne Netz öffnen und die Seite „isoliert“ ausliefern
// (Cross-Origin-Isolation erlaubt mehrere Rechenkerne für die Spracherkennung).
const V = 'ts-__VERSION__';
const SHELL = __SHELL__;
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).catch(() => {})); });
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== V && k.startsWith('ts-')) await caches.delete(k);
  await self.clients.claim();
})()));
function isolate(res){
  if (!res || res.status === 0 || res.type === 'opaque') return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  return new Response(res.body, {status: res.status, statusText: res.statusText, headers: h});
}
self.addEventListener('fetch', e => {
  const r = e.request, url = new URL(r.url);
  if (r.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(V);
    const big = url.pathname.includes('/vendor/');
    if (big){ const hit = await cache.match(r); if (hit) return isolate(hit); }
    try {
      const res = await fetch(r);
      if (res.ok && !url.search && (big || SHELL.some(p => url.pathname.endsWith('/' + p.replace(/^\.\//, '')) || (p === './' && url.pathname.endsWith('/'))))) cache.put(r, res.clone()).catch(() => {});
      return isolate(res);
    } catch(err){
      const hit = await cache.match(r, {ignoreSearch: true}) || (r.mode === 'navigate' ? await cache.match('./') : null);
      if (hit) return isolate(hit);
      throw err;
    }
  })());
});
