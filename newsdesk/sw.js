const C='newsdesk-v1',SHELL=['./','index.html','manifest.webmanifest','icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x))))));
// Daten: network-first (frisch), Shell: cache-first. Offline liest man den letzten Stand.
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const data=new URL(e.request.url).pathname.includes('/data/');
  e.respondWith(data
    ?fetch(e.request).then(r=>{const c=r.clone();caches.open(C).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request))
    :caches.match(e.request).then(r=>r||fetch(e.request)));
});
