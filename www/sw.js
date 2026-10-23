const CACHE_NAME = 'mkr-pulse-v1';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json'
];

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        ))
    );
});

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request))
    );
});
