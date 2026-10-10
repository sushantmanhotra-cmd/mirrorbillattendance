/* =============================================================
   Haazri — the door kiosk

   Ported from mirrorBill's face kiosk: a phone or tablet by the door
   with its camera on. Somebody walks up, looks at it, and they are
   marked for today. For shops where not everybody has a smartphone,
   or the owner would rather have one device at the door than trust
   fifteen phones. Both work side by side — a day is a day, whichever
   route marked it.

   It runs on the owner's login, so it can recognise everybody. That is
   also why it LOCKS: a device left at the door must not open payroll
   to whoever picks it up. Leaving kiosk mode asks for the owner's
   password again.

   What it will not do is guess. A face it does not know, one it cannot
   tell from a colleague's, or two faces in the frame, and it marks
   nobody. A wrong guess here is one person paid for a day another
   person worked.
   ============================================================= */
window.OwnerKiosk = (function () {
  'use strict';

  var el = UI.el;
  var root = null;
  var DEVICE_KEY = 'hz_kiosk_device';
  var SCAN_EVERY = 700;
  var SHOW_FOR = 3500;
  var REST_AFTER = 60000;

  var video = null, banner = null;
  var state = 'idle';
  var loop = null, busy = false, seen = {}, unknownRun = 0;
  var locked = false;

  function isThisDevice() {
    try { return localStorage.getItem(DEVICE_KEY) === '1'; } catch (e) { return false; }
  }
  function setThisDevice(on) {
    try { if (on) localStorage.setItem(DEVICE_KEY, '1'); else localStorage.removeItem(DEVICE_KEY); } catch (e) {}
  }

  function show(kind, title, line, photo) {
    if (!banner) return;
    banner.className = 'scan-banner ' + kind;
    UI.clear(banner);
    if (photo) banner.appendChild(el('img', { src: photo, alt: '' }));
    banner.appendChild(el('div', {}, [el('strong', { text: title }), line ? el('span', { text: line }) : null]));
  }
  function idle() { show('', 'Look at the screen', 'You will be marked as soon as we see you'); }

  function pause() {
    state = 'showing';
    setTimeout(function () { if (state === 'showing') { state = 'ready'; idle(); } }, SHOW_FOR);
  }

  function partOfDay() {
    var h = new Date().getHours();
    return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  }

  function scanOnce(manual) {
    if (busy || state !== 'ready' || !video || video.readyState < 2) return;
    busy = true;
    Face.describe(video).then(function (r) {
      if (r.none) { unknownRun = 0; if (manual) show('warn', 'No face in the picture', 'Come a little closer'); return; }
      if (r.many) { show('warn', 'One at a time, please', r.many + ' faces in the picture'); return; }
      if (r.share < Face.CLOSE_TO_SCAN) { unknownRun = 0; show('warn', 'Come a little closer', 'Your face should fill most of the picture'); return; }
      var who = Face.match(r.descriptor, Store.faceRoster());
      if (who.ambiguous) {
        show('warn', 'Not sure who this is', 'Looks like ' + who.between[0].name + ' or ' + who.between[1].name + ' — ask the owner to mark it');
        pause(); return;
      }
      if (who.unknown) {
        unknownRun += 1;
        if (unknownRun >= 2 || manual) {
          show('bad', 'We don’t recognise you', 'Look straight at the screen and try again, or ask the owner to register your face again.');
          unknownRun = 0; pause();
        }
        return;
      }
      unknownRun = 0;
      if (!manual && Date.now() - (seen[who.id] || 0) < REST_AFTER) return;
      seen[who.id] = Date.now();

      var photo = Face.thumb(video, r.box);
      var today = Store.state.today || { r: {} };
      var rec = today.r && today.r[who.id];
      var st = Store.settings();
      if (rec && !rec.out && rec.at && Date.now() - Pay.toDate(rec.at).getTime() > 2 * 3600000) {
        /* Second visit, hours after arriving: that is leaving. */
        Store.kioskOut(who.id).then(function () {
          show('ok', 'Bye ' + who.name, 'Out at ' + UI.prettyTime(new Date()), photo);
        });
      } else if (rec) {
        var s = Pay.statusOf(rec, st);
        show('ok', 'Hello ' + who.name, 'Already marked today' + (rec.at ? ' at ' + UI.prettyTime(Pay.toDate(rec.at)) : '') + ' — ' + OwnerToday.label(s).toLowerCase(), photo);
      } else {
        var late = Pay.minutesLate(new Date(), st);
        Store.kioskMark(who.id, who.distance).then(function () {
          show(st.lateIsHalf && late > 0 ? 'warn' : 'ok', 'Good ' + partOfDay() + ', ' + who.name,
            'Marked at ' + UI.prettyTime(new Date()) + (late > 0 ? ' — ' + late + ' min late' : ''), photo);
        }).catch(function (e) { show('bad', 'Could not mark that', e.message); });
      }
      pause();
    }).catch(function (e) {
      show('bad', 'Something went wrong', (e && e.message) || String(e));
    }).then(function () { busy = false; });
  }

  function begin() {
    if (!Face.supported()) { state = 'error'; show('bad', 'No camera here', 'Use a phone or tablet with Chrome or Safari.'); return; }
    if (!Store.faceRoster().length) show('warn', 'Nobody registered yet', 'Register faces from Staff first');
    state = 'loading';
    show('', 'Getting ready…', 'The first time takes a minute on a slow connection');
    Face.ready(function (step) { if (state === 'loading') show('', step, ''); })
      .then(function () { return Face.startCamera(video); })
      .then(function () {
        state = 'ready';
        if (Store.faceRoster().length) idle();
        loop = setInterval(function () {
          if (!root || !root.isConnected) { unmount(); return; }
          if (document.hidden) return;
          scanOnce(false);
        }, SCAN_EVERY);
      })
      .catch(function (e) {
        state = 'error';
        show('bad', 'Could not start the camera', e && e.name === 'NotAllowedError'
          ? 'The camera was not allowed. Allow it in the browser settings, then reload.' : ((e && e.message) || String(e)));
      });
  }

  /* Leaving kiosk mode on a device at the door: the owner's password. */
  function unlock() {
    UI.prompt('Leave kiosk mode', [
      { key: 'pass', label: 'Owner password', type: 'password', full: true }
    ], function (v) {
      var user = Store.state.user;
      var cred = firebase.auth.EmailAuthProvider.credential(user.email, v.pass);
      user.reauthenticateWithCredential(cred).then(function () {
        locked = false;
        setThisDevice(false);
        unmount();
        App.go('today');
      }).catch(function () { UI.toast('That password is not right', 'warn'); });
    }, { submitLabel: 'Unlock' });
  }

  function build() {
    UI.clear(root);
    video = el('video', { class: 'scan-video', autoplay: true, muted: true, playsinline: true });
    banner = el('div', { class: 'scan-banner' });
    var device = el('input', { type: 'checkbox' });
    device.checked = isThisDevice();
    device.addEventListener('change', function () {
      setThisDevice(device.checked);
      locked = device.checked;
      UI.toast(device.checked ? 'This device now opens straight to the kiosk, locked' : 'Kiosk mode off on this device');
      build();
    });
    locked = isThisDevice();
    document.body.classList.toggle('kiosk-locked', locked);

    root.appendChild(el('div', { class: 'screen-head' }, [
      el('div', {}, [
        el('h1', { text: 'Door kiosk' }),
        el('p', { class: 'sub', text: 'Look at the camera and you are marked for today. For staff without a smartphone.' })
      ]),
      locked ? el('button', { class: 'btn ghost', text: 'Unlock', onclick: unlock }) : null
    ]));
    root.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'scan-stage' }, [video, banner]),
      el('div', { class: 'btn-row center', style: 'margin-top:12px' }, [
        el('button', { class: 'btn primary big', text: 'Scan now', onclick: function () { scanOnce(true); } })
      ]),
      el('p', { class: 'muted small center', text: 'Recognised on this device. No picture is sent anywhere to be matched.' })
    ]));
    if (!locked) {
      root.appendChild(el('div', { class: 'card' }, [
        el('label', { class: 'field field-check' }, [
          device,
          el('span', { class: 'field-label', text: 'This device stays at the door as the kiosk' }),
          el('span', { class: 'field-hint', text: 'Opens straight to the camera every time, and hides everything else until you unlock it with your password.' })
        ])
      ]));
    }
    stopLoop();
    begin();
  }

  function stopLoop() { if (loop) { clearInterval(loop); loop = null; } }

  function unmount() {
    stopLoop();
    Face.stopCamera();
    state = 'idle'; busy = false; unknownRun = 0;
    document.body.classList.remove('kiosk-locked');
  }

  /* The camera is built once; a data change must not tear it down in
     the middle of saying good morning to the person who caused it. */
  function render() {}

  function mount(c) { root = c; build(); }
  return { mount: mount, render: render, unmount: unmount, isThisDevice: isThisDevice };
})();
