/* =============================================================
   Haazri — where the phone is, and whether that is "at work"

   The browser's own location. No maps service is called, so there is
   nothing to pay for and no key to leak: the phone works out where it
   is (GPS, Wi-Fi, towers) and hands us a latitude, a longitude and how
   sure it is, in metres.

   A shop's perimeter is a point and a radius. Inside it, the scan
   marks the day. Outside it, the scan becomes a request the owner
   approves or turns down — people do go to the bank, a customer's
   house, the other branch.

   Accuracy matters as much as the position. A phone indoors can report
   a point 80 m off with an accuracy of 80 m, and it would be wrong to
   call that "outside" for a 50 m perimeter. So the answer has three
   values, not two:

     inside   — the reported point is within the radius
     outside  — the point is outside AND the phone is sure enough that
                even its whole error circle does not reach the shop
     unsure   — outside on the face of it, but the error circle
                overlaps the perimeter; ask to try again near a window,
                or send for approval

   Nothing is ever marked present on "unsure". A generous reading here
   is a free day for anybody sitting 200 m away with a poor signal.
   ============================================================= */
(function (root) {
  'use strict';

  var EARTH = 6371000; // metres

  function rad(d) { return d * Math.PI / 180; }

  /* Great-circle distance in metres. Haversine is exact enough at the
     scale of a shop — the error is millimetres over a kilometre. */
  function distance(a, b) {
    var dLat = rad(b.lat - a.lat);
    var dLng = rad(b.lng - a.lng);
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * EARTH * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }

  /* Accuracy worse than this is not a location, it is a guess at the
     town. The employee is told to try again rather than being sent for
     approval on a reading that says nothing. */
  var WORST_ACCURACY = 500;

  function judge(fix, site) {
    if (!site || !isFinite(site.lat) || !isFinite(site.lng)) {
      return { verdict: 'nosite', distance: null };
    }
    var d = distance(fix, site);
    var radius = Math.max(10, Number(site.radius) || 100);
    var acc = Math.max(0, Number(fix.accuracy) || 0);
    var out = { distance: Math.round(d), radius: radius, accuracy: Math.round(acc) };
    if (acc > WORST_ACCURACY) out.verdict = 'poor';
    else if (d <= radius) out.verdict = 'inside';
    else if (d - acc <= radius) out.verdict = 'unsure';
    else out.verdict = 'outside';
    return out;
  }

  /* One reading, as good as the phone can manage in a few seconds.
     maximumAge 0: a cached fix from the house this morning is exactly
     the reading that must never mark somebody present at the shop. */
  function here(opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      if (!root.navigator || !navigator.geolocation) {
        reject(new Error('This phone’s browser cannot tell where it is'));
        return;
      }
      navigator.geolocation.getCurrentPosition(function (p) {
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          at: p.timestamp || Date.now()
        });
      }, function (e) {
        var msg = e && e.code === 1
          ? 'Location was not allowed. Allow it for this site in the browser settings, then try again.'
          : e && e.code === 3
            ? 'Finding the location took too long. Step near a window or outside and try again.'
            : 'Could not find where this phone is. Switch location (GPS) on and try again.';
        var err = new Error(msg);
        err.code = e && e.code;
        reject(err);
      }, {
        enableHighAccuracy: true,
        timeout: opts.timeout || 20000,
        maximumAge: 0
      });
    });
  }

  function mapLink(lat, lng) {
    return 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lng + '#map=18/' + lat + '/' + lng;
  }

  var Geo = { distance: distance, judge: judge, here: here, mapLink: mapLink,
    WORST_ACCURACY: WORST_ACCURACY };
  root.Geo = Geo;
  if (typeof module !== 'undefined' && module.exports) module.exports = Geo;
})(typeof window !== 'undefined' ? window : globalThis);
