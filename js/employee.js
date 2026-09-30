/* =============================================================
   Haazri — the employee's phone

   One screen. Come to work, open it, tap Scan in, look at the phone.

   Two things are checked at the same time, and both must pass:

     IS IT YOU — the face in front of the camera is compared with the
     samples the owner registered for THIS login, on the phone itself.
     Nothing is sent anywhere to be matched and nothing is paid per
     scan (see js/face.js).

     ARE YOU AT WORK — the phone's location against the shop's
     perimeter (see js/geo.js).

   Inside the perimeter, the day is marked there and then, at the
   server's time. Outside it, nothing is marked: the employee can send
   the scan to the owner with a line saying why ("at the bank for the
   shop"), and a small picture of the moment so the owner can see it
   really was them. The owner approves or turns it down.
   ============================================================= */
window.Employee = (function () {
  'use strict';

  var el = UI.el;
  var root = null;
  var body = null;
  var flow = null;          // the scan in progress, if any

  function me() { return Store.state.me; }
  function shop() { return Store.state.shop; }
  function myRec() {
    var t = Store.state.today;
    var m = Store.state.member;
    return (t && t.r && m && t.r[m.empId]) || null;
  }

  function pendingToday() {
    try {
      var p = JSON.parse(localStorage.getItem('hz_req') || 'null');
      if (p && p.date === Store.todayKey()) return p;
    } catch (e) {}
    return null;
  }
  function notePending(kind) {
    try { localStorage.setItem('hz_req', JSON.stringify({ date: Store.todayKey(), kind: kind, at: Date.now() })); } catch (e) {}
  }

  function timeOf(v) {
    var d = Pay.toDate(v);
    return d ? UI.prettyTime(d) : '';
  }

  /* ---------------- the card at the top ---------------- */

  function statusCard() {
    var e = me(), s = shop();
    var st = Store.settings();
    if (!e) return card('bad', '⚠️', 'Your record was not found', 'Ask your owner to check your employee ID.');
    if (!Store.hasFace(e)) {
      return card('warn', '🙂', 'Your face is not registered yet',
        'Your owner registers it once, from their phone: Staff → your name → Face. After that you can scan in here.');
    }
    if (!s || !s.site) {
      return card('warn', '📍', 'The shop’s location is not set yet',
        'Your owner sets it once in Settings, standing in the shop.');
    }
    var rec = myRec();
    if (!rec) {
      var p = pendingToday();
      if (p && p.kind === 'in') {
        return card('warn', '⏳', 'Sent for approval',
          'Your scan from outside the shop is waiting for your owner. It will show here once they approve it.',
          [scanButton('in', 'Scan again')]);
      }
      return card('', '👋', 'Not marked yet today',
        'Be inside the shop, tap the button and look at your phone.',
        [scanButton('in', 'Scan in')]);
    }

    var status = Pay.statusOf(rec, st);
    var late = rec.status ? null : Pay.minutesLate(rec.at, st);
    var title = status === 'present' ? 'Present' : status === 'half' ? 'Half day'
      : status === 'absent' ? 'Marked absent' : status === 'leave' ? 'On leave' : 'Day off';
    var line = [];
    if (rec.at && rec.src !== 'manual') line.push('In at ' + timeOf(rec.at));
    if (late > 0) line.push(late + ' min late');
    if (rec.src === 'approved') line.push('approved by owner');
    if (rec.src === 'kiosk') line.push('at the door kiosk');
    if (rec.status && rec.src !== 'manual') line.push('set by owner');
    if (rec.out) line.push('Out at ' + timeOf(rec.out));

    var acts = [];
    var p2 = pendingToday();
    if (!rec.out && (status === 'present' || status === 'half')) {
      if (p2 && p2.kind === 'out') line.push('leaving scan sent for approval');
      acts.push(scanButton('out', 'Scan out', 'ghost'));
    }
    return card(status === 'present' ? 'ok' : status === 'half' ? 'warn' : 'bad',
      status === 'present' ? '✅' : status === 'half' ? '🕒' : '📝', title, line.join(' · '), acts);
  }

  function card(kind, iconText, title, text, actions) {
    return el('div', { class: 'card status-card ' + kind }, [
      el('div', { class: 'big-icon', text: iconText }),
      el('h2', { text: title }),
      el('p', { text: text }),
      actions && actions.length ? el('div', { class: 'btn-row center', style: 'margin-top:16px' }, actions) : null
    ]);
  }

  function scanButton(kind, label, style) {
    return el('button', {
      class: 'btn ' + (style || 'primary') + ' big' + (style ? '' : ' block'),
      text: label,
      onclick: function () { startScan(kind); }
    });
  }

  /* ---------------- the scan ---------------- */

  function startScan(kind) {
    if (flow) return;
    if (!navigator.onLine) { UI.toast('You are offline. Connect to the internet to scan.', 'warn'); return; }

    var e = me(), s = shop(), st = Store.settings();
    var samples = Store.faceSamples(e);
    var video = el('video', { class: 'scan-video', autoplay: true, muted: true, playsinline: true });
    var banner = el('div', { class: 'scan-banner' });
    var stepFace = el('div', { class: 'step now', text: '○ Checking it’s you' });
    var stepGeo = el('div', { class: 'step now', text: '○ Finding where you are' });
    var extra = el('div', {});

    flow = { kind: kind, fix: null, geoErr: null, who: null, photo: '', done: false, loop: null, tries: 0 };

    function say(cls, title, line, photo) {
      banner.className = 'scan-banner ' + (cls || '');
      UI.clear(banner);
      if (photo) banner.appendChild(el('img', { src: photo, alt: '' }));
      banner.appendChild(el('div', {}, [el('strong', { text: title }), line ? el('span', { text: line }) : null]));
    }

    var m = UI.modal(kind === 'out' ? 'Scan out' : 'Scan in', el('div', {}, [
      el('div', { class: 'scan-stage' }, [video, el('div', { class: 'scan-ring' }), banner]),
      el('div', { class: 'steps' }, [stepFace, stepGeo]),
      extra
    ]), [{ label: 'Close' }], { onClose: stop });

    function stop() {
      if (flow && flow.loop) clearInterval(flow.loop);
      Face.stopCamera();
      flow = null;
      render();
    }

    function stepSet(node, cls, text) { node.className = 'step ' + cls; node.textContent = text; }

    /* Location first and in parallel — it can take a few seconds to
       settle, and there is no reason to make the face wait for it. */
    function locate() {
      stepSet(stepGeo, 'now', '○ Finding where you are…');
      flow && (flow.fix = null, flow.geoErr = null);
      Geo.here().then(function (fix) {
        if (!flow) return;
        flow.fix = fix;
        flow.verdict = Geo.judge(fix, s.site);
        var v = flow.verdict;
        if (v.verdict === 'inside') stepSet(stepGeo, 'done', '✓ At the shop (' + v.distance + ' m from the centre)');
        else if (v.verdict === 'poor') stepSet(stepGeo, 'fail', '✗ Location too rough (±' + v.accuracy + ' m)');
        else stepSet(stepGeo, 'fail', '✗ ' + v.distance + ' m from the shop (allowed ' + v.radius + ' m)');
        decide();
      }).catch(function (err) {
        if (!flow) return;
        flow.geoErr = err;
        stepSet(stepGeo, 'fail', '✗ ' + err.message);
        decide();
      });
    }

    say('', 'Getting the camera ready…', 'The first time takes a minute on a slow connection');
    locate();
    Face.ready(function (step) { if (flow) say('', step, ''); })
      .then(function () { return flow && Face.startCamera(video); })
      .then(function () {
        if (!flow) return;
        say('', 'Look at the screen', 'Hold the phone at arm’s length, face inside the circle');
        flow.loop = setInterval(look, 700);
      })
      .catch(function (err) {
        if (!flow) return;
        var msg = err && err.name === 'NotAllowedError'
          ? 'The camera was not allowed. Allow it for this site in the browser settings, then try again.'
          : (err && err.message) || String(err);
        say('bad', 'Could not start the camera', msg);
        stepSet(stepFace, 'fail', '✗ Camera not available');
      });

    var busy = false;
    function look() {
      if (!flow || flow.who || busy || video.readyState < 2) return;
      busy = true;
      Face.describe(video).then(function (r) {
        if (!flow || flow.who) return;
        if (r.none) { say('', 'Look at the screen', 'No face in the picture yet'); return; }
        if (r.many) { say('warn', 'Only you, please', r.many + ' faces in the picture'); return; }
        if (r.share < Face.CLOSE_TO_SCAN) { say('warn', 'Come a little closer', 'Your face should fill the circle'); return; }
        var v = Face.verify(r.descriptor, samples);
        if (!v.ok) {
          flow.tries += 1;
          if (flow.tries >= 6) {
            clearInterval(flow.loop);
            say('bad', 'This doesn’t look like ' + e.name,
              'Try again in better light, looking straight at the phone. Still not working? Ask your owner to register your face again.');
            stepSet(stepFace, 'fail', '✗ Face did not match');
            Face.stopCamera();
          }
          return;
        }
        clearInterval(flow.loop);
        flow.who = v;
        flow.photo = Face.thumb(video, r.box);
        Face.stopCamera();
        stepSet(stepFace, 'done', '✓ It’s you, ' + e.name.split(' ')[0]);
        say('ok', 'Face matched', flow.fix ? '' : 'Waiting for your location…', flow.photo);
        decide();
      }).catch(function (err) {
        say('bad', 'Something went wrong', (err && err.message) || String(err));
      }).then(function () { busy = false; });
    }

    /* Both answers in: mark, or offer to send for approval. */
    function decide() {
      if (!flow || !flow.who || flow.done) return;
      if (!flow.fix && !flow.geoErr) return;
      UI.clear(extra);
      var v = flow.verdict;
      if (v && v.verdict === 'inside') {
        flow.done = true;
        say('ok', 'Saving…', '', flow.photo);
        var info = { dist: v.distance, acc: v.accuracy, match: flow.who.distance };
        if (st.photoEveryScan && kind === 'in') info.photo = flow.photo;
        (kind === 'out' ? Store.markOut(info) : Store.markIn(info)).then(function () {
          say('ok', kind === 'out' ? 'Scanned out' : 'You’re marked for today',
            (kind === 'out' ? 'Left at ' : 'In at ') + UI.prettyTime(new Date()), flow && flow.photo);
          setTimeout(function () { m.close(); }, 1800);
        }).catch(function (err) {
          flow && (flow.done = false);
          var msg = /permission/i.test(String(err && (err.code || err.message)))
            ? (kind === 'out' ? 'Already scanned out, or not scanned in today.' : 'Already marked today.')
            : (err && err.message) || String(err);
          say('bad', 'Could not save', msg);
        });
        return;
      }

      /* Not inside — but first make sure it is the shop's CURRENT
         perimeter we are judging by. The phone keeps the shop's details
         for half a day to save reads, and the owner may have moved the
         centre or widened the circle this morning. */
      if (flow.fix && !flow.rechecked) {
        flow.rechecked = true;
        say('ok', 'Checking the shop’s latest location…', '', flow.photo);
        Store.refresh(true).then(function () {
          if (!flow) return;
          s = shop(); st = Store.settings();
          flow.verdict = Geo.judge(flow.fix, s.site);
          decide();
        }).catch(function () { decide(); });
        return;
      }

      /* Not inside. Say where they are and what they can do. */
      var why = flow.geoErr ? flow.geoErr.message
        : v.verdict === 'poor' ? 'The phone could only place you to within ' + v.accuracy + ' m.'
        : v.verdict === 'unsure' ? 'You seem to be ' + v.distance + ' m from the shop, but the phone is only sure to ±' + v.accuracy + ' m.'
        : 'You are ' + v.distance + ' m from the shop. Attendance marks only within ' + v.radius + ' m.';
      say('warn', 'Not at the shop', why, flow.photo);

      var retry = el('button', { class: 'btn ghost', text: 'Try location again', onclick: function () { UI.clear(extra); locate(); } });
      if (st.allowOutside === false || !flow.fix) {
        extra.appendChild(el('div', { class: 'btn-row center', style: 'margin-top:12px' }, [retry]));
        if (st.allowOutside === false) extra.appendChild(el('p', { class: 'muted small center', text: 'Your shop does not take scans from outside. Come to the shop and scan again.' }));
        return;
      }
      var reason = el('textarea', { class: 'input', rows: 2, maxlength: '200', placeholder: 'Why are you outside? e.g. Went to the bank for the shop' });
      var send = el('button', {
        class: 'btn accent', text: 'Send to owner for approval',
        onclick: function () {
          if (!reason.value.trim()) { UI.toast('Say why — your owner will ask', 'warn'); reason.focus(); return; }
          send.disabled = true;
          flow.done = true;
          Store.sendRequest({
            kind: kind, lat: flow.fix.lat, lng: flow.fix.lng, acc: v.accuracy, dist: v.distance,
            match: flow.who.distance, reason: reason.value.trim(), photo: flow.photo
          }).then(function () {
            notePending(kind);
            say('ok', 'Sent to your owner', 'You will be marked once they approve it.', flow && flow.photo);
            UI.clear(extra);
            setTimeout(function () { m.close(); }, 2000);
          }).catch(function (err) {
            send.disabled = false;
            flow && (flow.done = false);
            say('bad', 'Could not send', (err && err.message) || String(err));
          });
        }
      });
      extra.appendChild(el('div', { style: 'margin-top:12px' }, [
        el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Working outside? Tell your owner why' }), reason]),
        el('div', { class: 'btn-row center', style: 'margin-top:10px' }, [send, retry])
      ]));
    }
  }

  /* ---------------- my month, my requests ---------------- */

  function showMonth() {
    var e = me();
    var st = Store.settings();
    var c = Pay.payCycle(e, st, 0);
    Store.days(c.from, c.to).then(function (days) {
      var slip = Pay.payslip(Object.assign({ id: Store.state.member.empId }, e), st, days, c);
      var byDay = {};
      slip.rows.forEach(function (r) { byDay[r.date] = r; });
      var first = new Date(c.from + 'T00:00:00');
      var cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (d) { return el('div', { class: 'dow', text: d }); });
      for (var i = 0; i < first.getDay(); i++) cells.push(el('div', {}));
      Pay.eachDay(c.from, c.to, function (k, d) {
        var r = byDay[k];
        cells.push(el('div', { class: 'd ' + ((r && r.status) || '') }, [
          document.createTextNode(String(d.getDate())),
          r && r.status ? el('small', { text: r.status === 'present' ? 'P' : r.status === 'half' ? '½' : r.status === 'absent' ? 'A' : r.status === 'leave' ? 'L' : 'off' }) : null
        ]));
      });
      UI.modal('My attendance — ' + c.label, el('div', {}, [
        el('p', { class: 'modal-msg' }, [
          el('strong', { text: slip.days.present + ' present' }),
          document.createTextNode(' · ' + slip.days.half + ' half · ' + slip.days.absent + ' absent · ' +
            slip.days.leave + ' leave (' + slip.leavePaid + ' of ' + slip.leaveAllowed + ' paid)')
        ]),
        el('div', { class: 'cal' }, cells),
        el('div', { class: 'legend' }, [
          el('span', { class: 'badge ok', text: 'P present' }), el('span', { class: 'badge warn', text: '½ half day' }),
          el('span', { class: 'badge bad', text: 'A absent' }), el('span', { class: 'badge', text: 'L leave' })
        ])
      ]), [{ label: 'Close' }]);
    }).catch(function (err) { UI.toast((err && err.message) || 'Could not load', 'warn'); });
  }

  function showRequests() {
    Store.myRequests(10).then(function (list) {
      UI.modal('My requests', list.length ? el('div', {}, list.map(function (r) {
        return el('div', { class: 'req' }, [
          r.photo ? el('img', { class: 'req-photo', src: r.photo, alt: '' }) : null,
          el('div', { class: 'req-main' }, [
            el('strong', { text: UI.prettyDate(r.date + 'T00:00:00') + ' · ' + (r.kind === 'out' ? 'scan out' : 'scan in') }),
            el('div', { class: 'muted', text: r.dist + ' m away · ' + (r.reason || '') }),
            el('div', {}, [el('span', {
              class: 'badge ' + (r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'bad' : 'warn'),
              text: r.status === 'pending' ? 'waiting' : r.status
            }), r.note ? el('span', { class: 'muted small', text: r.note }) : null])
          ])
        ]);
      })) : el('p', { class: 'empty', text: 'No requests yet.' }), [{ label: 'Close' }]);
    }).catch(function (err) { UI.toast((err && err.message) || 'Could not load', 'warn'); });
  }

  /* ---------------- the screen ---------------- */

  function render() {
    if (!body || flow) return;
    UI.clear(body);
    var e = me(), s = shop();
    body.appendChild(el('div', { class: 'hello' }, [
      el('p', { class: 'sub', text: (s ? s.name : '') + ' · ' + UI.prettyDate(new Date()) }),
      el('h1', { text: 'Hello, ' + (e ? e.name.split(' ')[0] : '') })
    ]));
    body.appendChild(statusCard());
    if (e && Store.hasFace(e)) {
      body.appendChild(el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn ghost', text: 'My month', onclick: showMonth }),
        el('button', { class: 'btn ghost', text: 'My requests', onclick: showRequests }),
        el('button', { class: 'btn ghost', text: 'Refresh', title: 'See an approval or a change your owner just made',
          onclick: function () {
            loadedAt = Date.now();
            Store.refresh(true).catch(function (err) { UI.toast(err.message, 'warn'); });
          } })
      ]));
    }
    var st = Store.settings();
    body.appendChild(el('p', { class: 'note-line', text:
      'Shift starts ' + st.shiftStart + (st.grace ? ' (' + st.grace + ' min allowed)' : '') +
      (st.lateIsHalf ? ' · arriving later counts as a half day' : '') +
      '. Your face is checked on this phone and never sent anywhere to be matched.' }));
  }

  /* Back to the app after a while, or on a new day: read today again.
     Not on every switch back — each is a read. */
  var loadedAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !body || !body.isConnected || flow) return;
    if (Store.state.todayKey !== Store.todayKey() || Date.now() - loadedAt > 10 * 60000) {
      loadedAt = Date.now();
      Store.refresh(Store.state.todayKey !== Store.todayKey());
    }
  });

  function mount(host) {
    loadedAt = Date.now();
    root = host;
    UI.clear(root);
    var s = shop();
    body = el('section', { id: 'screen', style: 'max-width:520px;margin:0 auto' });
    root.appendChild(el('header', { class: 'topbar always' }, [
      App.brand(s && s.name),
      el('button', { text: 'Sign out', onclick: function () { Store.signOut(); } })
    ]));
    root.appendChild(body);
    render();
  }

  return { mount: mount, render: render };
})();
