/* Haazri — keeps the app and the 8 MB face model on the phone.

   The face model is the heavy part and never changes under the same
   name, so it is kept forever once fetched: every employee's phone
   downloads it once, not every morning. That is also what keeps the
   hosting bandwidth free (see docs/COST.md).

   The app's own files are network-first, so an update reaches phones
   on their next open, with the cached copy as the fallback. Firestore
   and sign-in traffic is never touched. */
'use strict';

var VERSION = 'haazri-v1';
var FOREVER = 'haazri-vendor-v1';

self.addEventListener('install', function (e) { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION && k !== FOREVER; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.indexOf('/vendor/') >= 0) {
    e.respondWith(caches.open(FOREVER).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          if (res.ok) c.put(req, res.clone());
          return res;
        });
      });
    }));
    return;
  }

  e.respondWith(fetch(req).then(function (res) {
    if (res.ok) {
      var copy = res.clone();
      caches.open(VERSION).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) { return hit || caches.match('./index.html'); });
  }));
});
