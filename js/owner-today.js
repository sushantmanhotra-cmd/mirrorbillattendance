/* =============================================================
   Haazri — the owner's today

   Who is in, who is late, who has not come, and what is waiting to
   be approved. Live: a scan at the door shows up here while the owner
   is looking, from the one day document the whole shop writes into.
   ============================================================= */
window.OwnerToday = (function () {
  'use strict';

  var el = UI.el;
  var root = null;

  var MARKS = [
    { id: 'present', label: 'Present', cls: 'ok' },
    { id: 'half', label: 'Half', cls: 'warn' },
    { id: 'leave', label: 'Leave', cls: '' },
    { id: 'absent', label: 'Absent', cls: 'bad' }
  ];

  function label(status) {
    return { present: 'Present', half: 'Half day', absent: 'Absent', leave: 'Leave', off: 'Off' }[status] || '—';
  }
  function badgeCls(status) {
    return status === 'present' ? 'ok' : status === 'half' ? 'warn' : status === 'absent' ? 'bad' : 'grey';
  }
  function how(rec) {
    return rec.src === 'phone' ? 'phone' : rec.src === 'kiosk' ? 'kiosk' : rec.src === 'approved' ? 'approved' : 'by you';
  }

  function initials(name) {
    return String(name || '?').split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
  }

  /* The steps a new shop has to take before a scan can work, shown
     until they are done — an owner who opened the app and added
     nobody needs to be told what is next, not shown an empty table. */
  function setupSteps() {
    var s = Store.state.shop || {};
    var emps = Store.employees();
    var faces = emps.filter(Store.hasFace).length;
    var steps = [
      { done: !!s.site, text: 'Set the shop’s location and perimeter', go: 'settings' },
      { done: emps.length > 0, text: 'Add your staff — each gets an ID and a PIN', go: 'staff' },
      { done: emps.length > 0 && faces === emps.length, text: 'Register each person’s face (' + faces + ' of ' + emps.length + ')', go: 'staff' }
    ];
    if (steps.every(function (x) { return x.done; })) return null;
    return el('div', { class: 'info-box' }, [
      el('strong', { text: 'Getting started' }),
      el('div', { style: 'margin-top:6px;display:grid;gap:6px' }, steps.map(function (x) {
        return el('div', {}, [
          document.createTextNode((x.done ? '✅ ' : '⬜ ') + x.text + ' '),
          x.done ? null : el('button', { class: 'link-btn', text: 'Do it', onclick: function () { App.go(x.go); } })
        ]);
      }))
    ]);
  }

  function render() {
    if (!root) return;
    UI.clear(root);
    var st = Store.settings();
    var today = Store.state.today || { r: {} };
    var emps = Store.employees();
    var k = Store.todayKey();
    var weeklyOff = (st.weeklyOff || []).indexOf(new Date().getDay()) >= 0;

    var counts = { in: 0, late: 0, out: 0, missing: 0 };
    emps.forEach(function (e) {
      var rec = today.r && today.r[e.id];
      if (!rec) { counts.missing++; return; }
      var s = Pay.statusOf(rec, st);
      if (s === 'present') counts.in++;
      else if (s === 'half') counts.late++;
      else counts.out++;
    });

    root.appendChild(el('div', { class: 'screen-head' }, [
      el('div', {}, [
        el('h1', { text: 'Today' }),
        el('p', { class: 'sub', text: UI.prettyDate(new Date()) + (weeklyOff ? ' · weekly off' : '') +
          ' · shift ' + st.shiftStart + (st.grace ? ' +' + st.grace + ' min' : '') })
      ])
    ]));

    var steps = setupSteps();
    if (steps) root.appendChild(steps);

    var pend = Store.state.pending;
    if (pend.length) {
      root.appendChild(el('div', { class: 'warn-box' }, [
        el('strong', { text: pend.length + ' scan' + (pend.length === 1 ? '' : 's') + ' from outside the shop waiting for you' }),
        el('p', { text: pend.slice(0, 3).map(function (r) { return r.name + ' (' + r.dist + ' m away)'; }).join(', ') +
          (pend.length > 3 ? '…' : '') }),
        el('button', { class: 'btn accent', text: 'Review them', onclick: function () { App.go('approvals'); } })
      ]));
    }

    root.appendChild(el('div', { class: 'stats' }, [
      el('div', { class: 'stat ok' }, [el('div', { class: 'n', text: String(counts.in) }), el('div', { class: 'l', text: 'on time' })]),
      el('div', { class: 'stat warn' }, [el('div', { class: 'n', text: String(counts.late) }), el('div', { class: 'l', text: st.lateIsHalf ? 'late (half day)' : 'half day' })]),
      el('div', { class: 'stat' }, [el('div', { class: 'n', text: String(counts.missing) }), el('div', { class: 'l', text: 'not in yet' })]),
      el('div', { class: 'stat bad' }, [el('div', { class: 'n', text: String(counts.out) }), el('div', { class: 'l', text: 'absent / leave' })])
    ]));

    if (!emps.length) {
      root.appendChild(el('div', { class: 'card' }, [el('p', { class: 'empty', text: 'No staff yet. Add them from Staff.' })]));
      return;
    }

    root.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h3', { text: 'The team today' })]),
      el('div', {}, emps.map(function (e) {
        var rec = today.r && today.r[e.id];
        var status = rec ? Pay.statusOf(rec, st) : null;
        var late = rec && !rec.status ? Pay.minutesLate(rec.at, st) : null;
        var sub = [];
        if (rec && rec.at && rec.src !== 'manual') sub.push('in ' + UI.prettyTime(Pay.toDate(rec.at)) + ' · ' + how(rec));
        if (rec && rec.src === 'phone' && rec.dist != null) sub.push(rec.dist + ' m');
        if (late > 0) sub.push(late + ' min late');
        if (rec && rec.out) sub.push('out ' + UI.prettyTime(Pay.toDate(rec.out)));
        if (!rec) sub.push(Store.hasFace(e) ? 'no scan yet' : 'face not registered');
        return el('div', { class: 'person' }, [
          el('div', { class: 'avatar' }, [rec && rec.photo ? el('img', { src: rec.photo, alt: '' }) : document.createTextNode(initials(e.name))]),
          el('div', { class: 'person-main' }, [
            el('strong', {}, [document.createTextNode(e.name + ' '), status ? el('span', { class: 'badge ' + badgeCls(status), text: label(status) }) : null]),
            el('div', { class: 'muted', text: e.id + ' · ' + sub.join(' · ') })
          ]),
          el('div', { class: 'person-side' }, [
            el('div', { class: 'seg' }, MARKS.map(function (mk) {
              return el('button', {
                class: (status === mk.id ? 'on ' : '') + mk.cls, text: mk.label,
                title: 'Mark ' + mk.label.toLowerCase(),
                onclick: function () {
                  if (status === mk.id) return;
                  Store.setStatus(e.id, k, mk.id).catch(function (err) { UI.toast(err.message, 'warn'); });
                }
              });
            }))
          ])
        ]);
      }))
    ]));
    root.appendChild(el('p', { class: 'note-line', text:
      'Scans are judged by the shift time in Settings. Tapping a mark overrides the scan for that day; ' +
      'every change is kept with who made it — see Register.' }));
  }

  function mount(c) { root = c; render(); }
  return { mount: mount, render: render, label: label, badgeCls: badgeCls, how: how, initials: initials };
})();
