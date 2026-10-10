// 離線用：App 本身和內建資料先存起來；手寫辨識、tesseract 這些外面的網址不經過這裡
const CACHE = 'starwords-v2';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/logic.js', 'js/ui.js', 'js/vendor/perfect-freehand.js', 'js/ink.js', 'js/widgets.js', 'js/game.js', 'js/penalty.js', 'js/grammar.js',
  'js/toeic.js', 'js/writing.js', 'js/words.js', 'js/home.js', 'js/app.js',
  'data/builtin.json', 'data/lexicon.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // 先拿網路上新的，連不上再用存著的
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
