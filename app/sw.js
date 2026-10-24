/* 蓝虎听歌 Service Worker —— 离线可用（界面外壳缓存；在线音乐播放仍需网络） */
const CACHE = 'bluetiger-music-v1.4.0';
const OFFLINE_URL = './index.html';
const PRECACHE = [
  OFFLINE_URL,
  './manifest.webmanifest',
  './css/style.css',
  './js/version.js',
  './js/music-utils.js',
  './js/audio-fx.js',
  './js/app.js',
  './assets/logo/logo-64.png'
];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE).then(function(cache){
      return cache.addAll(PRECACHE);
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event){
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           /* 跨域（在线音乐源等）走网络，不缓存 */

  /* 导航：网络优先，离线回退到 index.html */
  if (req.mode === 'navigate'){
    event.respondWith(
      fetch(req).then(function(res){
        const copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put(OFFLINE_URL, copy); });
        return res;
      }).catch(function(){ return caches.match(OFFLINE_URL); })
    );
    return;
  }

  /* 同源静态资源：缓存优先，后台更新（stale-while-revalidate） */
  event.respondWith(
    caches.match(req).then(function(cached){
      const network = fetch(req).then(function(res){
        if (res && res.status === 200){
          const copy = res.clone();
          caches.open(CACHE).then(function(c){ c.put(req, copy); });
        }
        return res;
      }).catch(function(){ return cached; });
      return cached || network;
    })
  );
});
