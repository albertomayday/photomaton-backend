const CACHE_NAME = 'media-style-transfer-v3';
const urlsToCache = [
  './',
  './index.html',
  './index.css',
  './index.js',
  './icon.svg',
  'https://esm.sh/@google/genai@1.0.0'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // Force new SW to take over immediately
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName); // Clear old caches
          }
        })
      );
    })
  );
  self.clients.claim(); // Control clients immediately
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});