/* =============================================================
   Haazri — the shop's settings

   The perimeter first, because nothing works without it: the owner
   stands in the shop, taps "Use where I am now", and picks how far
   from that point still counts as at work. No map service is called
   (nothing to pay for) — the phone's own location is the point.

   Then the rules a day is judged by: when the shift starts, how many
   minutes are let go, whether late is a half day, the weekly off, the
   paid leave, what a missing scan means, and pay day.
   ============================================================= */
window.OwnerSettings = (function () {
  'use strict';

  var el = UI.el;
  var root = null;
  /* The last thing the location buttons said. Kept outside the card,
     because saving the perimeter redraws the card and would otherwise
     wipe the answer the owner is waiting to read. */
  var note = '';

  var RADII = [25, 50, 100, 200, 500, 1000];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function save(p) {
    return p.then(function () { UI.toast('Saved'); }).catch(function (e) { UI.toast(e.message, 'warn'); });
  }

  function perimeterCard() {
    var site = Store.state.shop && Store.state.shop.site;
    var status = el('p', { class: 'muted small', text: note });
    function tell(t) { note = t; status.textContent = t; }
    var radius = el('select', { class: 'input' }, RADII.map(function (r) {
      return el('option', { value: r, text: r + ' m' + (r === 100 ? ' (recommended)' : ''), selected: site ? site.radius === r : r === 100 });
    }));
    if (site && RADII.indexOf(site.radius) < 0) {
      radius.appendChild(el('option', { value: site.radius, text: site.radius + ' m', selected: true }));
    }
    radius.addEventListener('change', function () {
      if (!site) return;
      save(Store.saveSite(Object.assign({}, site, { radius: Number(radius.value) })));
    });

    var useHere = el('button', {
      class: 'btn ' + (site ? 'ghost' : 'primary'), text: site ? 'Move the centre to where I am now' : 'Use where I am now',
      onclick: function () {
        useHere.disabled = true;
        tell('Finding where you are… stand inside the shop.');
        Geo.here().then(function (fix) {
          useHere.disabled = false;
          if (fix.accuracy > 100) {
            tell('The phone is only sure to ±' + Math.round(fix.accuracy) + ' m. Step near the door or a window and try again for a better centre.');
            if (fix.accuracy > Geo.WORST_ACCURACY) return;
          }
          var next = { lat: fix.lat, lng: fix.lng, radius: Number(radius.value) || 100, label: (site && site.label) || '' };
          save(Store.saveSite(next)).then(function () {
            tell('Set, to within ±' + Math.round(fix.accuracy) + ' m.');
          });
        }).catch(function (e) { useHere.disabled = false; tell(e.message); });
      }
    });

    var test = el('button', {
      class: 'btn ghost', text: 'Test: am I inside?', disabled: site ? null : 'disabled',
      onclick: function () {
        tell('Checking…');
        Geo.here().then(function (fix) {
          var probe = Geo.judge(fix, site);
          tell(probe.verdict === 'inside'
            ? '✓ Inside — ' + probe.distance + ' m from the centre (±' + probe.accuracy + ' m). A scan here would be marked.'
            : probe.verdict === 'poor' ? 'Location too rough right now (±' + probe.accuracy + ' m).'
              : '✗ ' + probe.distance + ' m from the centre (±' + probe.accuracy + ' m). A scan here would go to you for approval.');
        }).catch(function (e) { tell(e.message); });
      }
    });

    return el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('div', {}, [
        el('h3', { text: 'Shop location & perimeter' }),
        el('p', { class: 'muted small', text: 'Scans inside the circle are marked at once. Scans outside it come to you to approve.' })
      ])]),
      site
        ? el('p', { class: 'map-pin' }, [
          document.createTextNode(site.lat.toFixed(5) + ', ' + site.lng.toFixed(5) + ' · radius ' + site.radius + ' m  '),
          el('a', { href: Geo.mapLink(site.lat, site.lng), target: '_blank', rel: 'noopener', text: 'check on the map' })
        ])
        : el('div', { class: 'warn-box', text: 'Not set yet. Stand inside the shop and tap the button — staff cannot scan in until this is done.' }),
      el('div', { class: 'form-grid' }, [
        el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'How far still counts as at work' }), radius,
          el('span', { class: 'field-hint', text: 'Phones indoors are often 20–50 m off. Under 50 m, expect good staff to be sent for approval now and then.' })])
      ]),
      el('div', { class: 'btn-row', style: 'margin-top:12px' }, [useHere, test]),
      status
    ]);
  }

  function rulesCard() {
    var s = Store.settings();
    function input(key, type, attrs) {
      var i = el('input', Object.assign({ class: 'input', type: type, value: s[key] == null ? '' : s[key] }, attrs || {}));
      i.addEventListener('change', function () {
        var v = type === 'number' ? Math.max(0, Number(i.value) || 0) : i.value;
        var p = {}; p[key] = v;
        save(Store.saveSettings(p));
      });
      return i;
    }
    function check(key, label, hint) {
      var b = el('input', { type: 'checkbox' });
      b.checked = key === 'allowOutside' ? s[key] !== false : !!s[key];
      b.addEventListener('change', function () { var p = {}; p[key] = b.checked; save(Store.saveSettings(p)); });
      return el('label', { class: 'field field-check field-full' }, [b, el('span', { class: 'field-label', text: label }),
        hint ? el('span', { class: 'field-hint', text: hint }) : null]);
    }
    var noScan = el('select', { class: 'input' }, [
      el('option', { value: 'leave', text: 'Leave (paid allowance first, then a day’s pay)', selected: s.noScan === 'leave' }),
      el('option', { value: 'absent', text: 'Absent (a day’s pay)', selected: s.noScan === 'absent' }),
      el('option', { value: 'ignore', text: 'Nothing (costs nobody anything)', selected: s.noScan === 'ignore' })
    ]);
    noScan.addEventListener('change', function () { save(Store.saveSettings({ noScan: noScan.value })); });

    var offs = el('div', { class: 'seg' }, DOW.map(function (d, i) {
      var on = (s.weeklyOff || []).indexOf(i) >= 0;
      return el('button', {
        class: on ? 'on' : '', text: d,
        onclick: function () {
          var list = (Store.settings().weeklyOff || []).slice();
          var at = list.indexOf(i);
          if (at >= 0) list.splice(at, 1); else list.push(i);
          save(Store.saveSettings({ weeklyOff: list.sort() }));
        }
      });
    }));

    return el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h3', { text: 'How a day is judged' })]),
      el('div', { class: 'form-grid' }, [
        el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Shift starts at' }), input('shiftStart', 'time')]),
        el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Minutes let go' }), input('grace', 'number', { min: '0', max: '180' })]),
        check('lateIsHalf', 'Arriving after that is a half day', 'Off: everybody who scans in is present, and the time is still recorded.'),
        el('label', { class: 'field field-full' }, [el('span', { class: 'field-label', text: 'Weekly off (always paid)' }), offs]),
        el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Paid leave a month' }), input('paidLeave', 'number', { min: '0', max: '31' })]),
        el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Pay day (1–31)' }), input('payDay', 'number', { min: '1', max: '31' })]),
        el('label', { class: 'field field-full' }, [el('span', { class: 'field-label', text: 'No scan on a day the shop was open means' }), noScan,
          el('span', { class: 'field-hint', text: 'Only counted on days somebody else scanned in, so a holiday never costs anybody.' })]),
        check('allowOutside', 'Take scans from outside the perimeter, for my approval',
          'Off: a scan outside the shop is simply refused.'),
        check('photoEveryScan', 'Keep a small picture of every scan, not only outside ones',
          'Shows who scanned on the Today screen. Uses more free storage (about 2–3 KB a scan) — see the cost note in the README.')
      ])
    ]);
  }

  function shopCard() {
    var shop = Store.state.shop || {};
    var name = el('input', { class: 'input', value: shop.name || '', maxlength: '60' });
    name.addEventListener('change', function () { save(Store.saveShopName(name.value)); });
    return el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h3', { text: 'The shop' })]),
      el('div', { class: 'form-grid' }, [
        el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Shop name' }), name]),
        el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Shop code (staff sign in with it)' }),
          el('span', { class: 'kbd', style: 'font-size:18px;align-self:flex-start', text: Store.state.member.shopId })])
      ]),
      el('p', { class: 'note-line', text: 'Signed in as ' + (Store.state.user && Store.state.user.email) + '.' })
    ]);
  }

  function draw() {
    UI.clear(root);
    root.appendChild(el('div', { class: 'screen-head' }, [el('div', {}, [
      el('h1', { text: 'Settings' }),
      el('p', { class: 'sub', text: 'Perimeter, shift and pay rules' })
    ])]));
    root.appendChild(perimeterCard());
    root.appendChild(rulesCard());
    root.appendChild(shopCard());
  }

  /* Saved changes arrive back through the shop listener; redraw then so
     the screen shows what was stored — except while typing. */
  var redrawSoon = null;
  function refresh() {
    if (!root || !root.isConnected) return;
    var active = document.activeElement;
    if (active && root.contains(active) && /INPUT|SELECT|TEXTAREA/.test(active.tagName)) return;
    clearTimeout(redrawSoon);
    redrawSoon = setTimeout(draw, 150);
  }

  function mount(c) { root = c; draw(); }
  return { mount: mount, render: refresh };
})();
