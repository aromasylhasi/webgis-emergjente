const CACHE = 'emergjenca-v12';
const ASSETS = [
  './', './index.html', './css/style.css',
  './js/app.js', './js/data.js'
];

self.addEventListener('install', e =>
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)))
);

self.addEventListener('fetch', e =>
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  )
);
