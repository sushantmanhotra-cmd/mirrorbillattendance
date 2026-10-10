/* =============================================================
   Haazri — the register

   Any day, everybody, and what it counts as. The owner can change any
   day — a phone that died, a forgotten scan, a real leave — and every
   change to a day that already had an answer is kept with who made it
   and what it was before (ported from mirrorBill, where the gap
   between reception marking and the owner paying is exactly where the
   arguments lived).

   Also: one person's month as a calendar, and a CSV of the month for
   an accountant.
   ============================================================= */
window.OwnerRegister = (function () {
  'use strict';

  var el = UI.el;
  var root = null;
  var day = null;
  var doc = null;          // the day document for `day`
  var loading = false;

  var MARKS = [
    { id: 'present', label: 'Present', cls: 'ok' },
    { id: 'half', label: 'Half', cls: 'warn' },
    { id: 'leave', label: 'Leave', cls: '' },
    { id: 'absent', label: 'Absent', cls: 'bad' }
  ];

  function load(fresh) {
    if (day === Store.todayKey()) { doc = Store.state.today; render(); return; }
    loading = true;
    Store.days(day, day, fresh).then(function (m) {
      doc = m[day] || { r: {} };
      loading = false;
      render();
    }).catch(function (e) { loading = false; UI.toast(e.message, 'warn'); });
  }

  function shift(n) {
    var d = new Date(day + 'T00:00:00');
    d.setDate(d.getDate() + n);
    var k = Pay.dateKey(d);
    if (k > Store.todayKey()) return;
    day = k; doc = null; load();
  }

  function history(e, rec) {
    var rows = (rec.history || []).slice().reverse();
    UI.modal('Changes — ' + e.name + ', ' + UI.prettyDate(day + 'T00:00:00'), rows.length ? el('table', { class: 'data-table' }, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'When' }), el('th', { text: 'From' }), el('th', { text: 'To' }), el('th', { text: 'By' })])]),
      el('tbody', {}, rows.map(function (h) {
        return el('tr', {}, [
          el('td', { class: 'muted', text: UI.prettyDate(h.at) + ' ' + UI.prettyTime(h.at) }),
          el('td', { text: OwnerToday.label(h.from) }),
          el('td', { text: OwnerToday.label(h.to) }),
          el('td', { class: 'muted small', text: h.by || '' })
        ]);
      }))
    ]) : el('p', { class: 'empty', text: 'No changes.' }), [{ label: 'Close' }], { wide: true });
  }

  function month(e) {
    var st = Store.settings();
    var c = Pay.payCycle(e, st, 0, new Date(day + 'T00:00:00'));
    Store.days(c.from, c.to).then(function (days) {
      var slip = Pay.payslip(e, st, days, c);
      var byDay = {};
      slip.rows.forEach(function (r) { byDay[r.date] = r; });
      var first = new Date(c.from + 'T00:00:00');
      var cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (d) { return el('div', { class: 'dow', text: d }); });
      for (var i = 0; i < first.getDay(); i++) cells.push(el('div', {}));
      Pay.eachDay(c.from, c.to, function (k, d) {
        var r = byDay[k];
        var t = r && r.rec && r.rec.at && r.rec.src !== 'manual' ? Pay.hhmm(Pay.toDate(r.rec.at)) : '';
        cells.push(el('div', { class: 'd ' + ((r && r.status) || ''), title: r ? (OwnerToday.label(r.status) + ' · ' + r.why + (t ? ' · ' + t : '')) : '' }, [
          document.createTextNode(String(d.getDate())),
          r && r.status ? el('small', { text: t || (r.why === 'no scan' ? 'no scan' : OwnerToday.label(r.status)) }) : null
        ]));
      });
      UI.modal(e.name + ' — ' + c.label, el('div', {}, [
        el('p', { class: 'modal-msg' }, [
          el('strong', { text: slip.days.present + ' present' }),
          document.createTextNode(' · ' + slip.days.half + ' half · ' + slip.days.absent + ' absent · ' +
            slip.days.leave + ' leave (' + slip.leavePaid + ' paid) · ' + slip.days.off + ' off · ' + slip.days.unmarked + ' unmarked')
        ]),
        el('div', { class: 'cal' }, cells)
      ]), [{ label: 'Close' }], { wide: true });
    }).catch(function (err) { UI.toast(err.message, 'warn'); });
  }

  /* The whole shop's month as a spreadsheet: one row a person, one
     column a day, and the totals. */
  function exportMonth() {
    var st = Store.settings();
    var d = new Date(day + 'T00:00:00');
    var from = Pay.dateKey(new Date(d.getFullYear(), d.getMonth(), 1));
    var to = Pay.dateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    Store.days(from, to).then(function (days) {
      var keys = [];
      Pay.eachDay(from, to, function (k) { keys.push(k); });
      var head = ['ID', 'Name'].concat(keys.map(function (k) { return k.slice(8); }))
        .concat(['Present', 'Half', 'Absent', 'Leave', 'Off']);
      var SHORT = { present: 'P', half: 'H', absent: 'A', leave: 'L', off: 'O' };
      var rows = Store.employees(true).map(function (e) {
        var slip = Pay.payslip(e, st, days, { from: from, to: to });
        var by = {};
        slip.rows.forEach(function (r) { by[r.date] = r; });
        return [e.id, e.name].concat(keys.map(function (k) { return by[k] && by[k].status ? SHORT[by[k].status] : ''; }))
          .concat([slip.days.present, slip.days.half, slip.days.absent, slip.days.leave, slip.days.off]);
      });
      UI.download('attendance-' + from.slice(0, 7) + '.csv', UI.csv([head].concat(rows)), 'text/csv');
    }).catch(function (err) { UI.toast(err.message, 'warn'); });
  }

  function render() {
    if (!root) return;
    if (day === Store.todayKey()) doc = Store.state.today;
    UI.clear(root);
    var st = Store.settings();
    var today = Store.todayKey();
    root.appendChild(el('div', { class: 'screen-head' }, [
      el('div', {}, [
        el('h1', { text: 'Register' }),
        el('p', { class: 'sub', text: UI.prettyDate(day + 'T00:00:00') + (day === today ? ' (today)' : '') })
      ]),
      el('button', { class: 'btn ghost', text: 'Download month (CSV)', onclick: exportMonth })
    ]));

    var picker = el('input', { class: 'input', type: 'date', value: day, max: today });
    picker.addEventListener('change', function () {
      if (picker.value && picker.value <= today) { day = picker.value; doc = null; load(); }
    });
    root.appendChild(el('div', { class: 'day-jump' }, [
      el('button', { class: 'btn ghost tiny', text: '‹ Previous', onclick: function () { shift(-1); } }),
      picker,
      el('button', { class: 'btn ghost tiny', text: 'Next ›', disabled: day >= today ? 'disabled' : null, onclick: function () { shift(1); } }),
      day !== today ? el('button', { class: 'btn ghost tiny', text: 'Today', onclick: function () { day = today; load(); } }) : null
    ]));

    if (!doc || loading) { root.appendChild(el('p', { class: 'empty', text: 'Loading…' })); return; }

    var emps = Store.employees();
    var anyScan = doc.r && Object.keys(doc.r).length > 0;
    root.appendChild(el('div', { class: 'card' }, emps.length ? emps.map(function (e) {
      var rec = doc.r && doc.r[e.id];
      var rows = Pay.register(e, st, (function () { var o = {}; o[day] = doc; return o; })(), day, day);
      var row = rows[0] || {};
      var status = row.status;
      var sub = [];
      if (rec && rec.at && rec.src !== 'manual') sub.push('in ' + UI.prettyTime(Pay.toDate(rec.at)) + ' · ' + OwnerToday.how(rec));
      if (rec && rec.out) sub.push('out ' + UI.prettyTime(Pay.toDate(rec.out)));
      if (row.late > 0) sub.push(row.late + ' min late');
      if (!rec && row.why) sub.push(row.why);
      if (!rec && !row.why) sub.push(day < today && anyScan ? 'nothing' : 'not marked');
      return el('div', { class: 'person' }, [
        el('div', { class: 'person-main' }, [
          el('strong', {}, [document.createTextNode(e.name + ' '),
            status ? el('span', { class: 'badge ' + OwnerToday.badgeCls(status), text: OwnerToday.label(status) }) : null,
            rec && rec.history && rec.history.length
              ? el('button', { class: 'badge grey', style: 'border:0;cursor:pointer', text: 'changed ' + rec.history.length + '×',
                onclick: function () { history(e, rec); } })
              : null
          ]),
          el('div', { class: 'muted', text: sub.join(' · ') })
        ]),
        el('div', { class: 'person-side' }, [
          el('div', { class: 'seg' }, MARKS.map(function (mk) {
            return el('button', {
              class: (rec && status === mk.id ? 'on ' : '') + mk.cls, text: mk.label,
              onclick: function () {
                Store.setStatus(e.id, day, mk.id).then(function () { load(true); })
                  .catch(function (err) { UI.toast(err.message, 'warn'); });
              }
            });
          })),
          rec ? el('button', { class: 'btn ghost tiny', text: 'Clear', onclick: function () {
            UI.confirm('Clear ' + e.name + '’s ' + UI.prettyDate(day + 'T00:00:00') + '?',
              'Removes the scan and any marking for this day.', function () {
                Store.clearDay(e.id, day).then(function () { load(true); });
              }, 'Clear');
          } }) : null,
          el('button', { class: 'btn ghost tiny', text: 'Month', onclick: function () { month(e); } })
        ])
      ]);
    }) : [el('p', { class: 'empty', text: 'No staff yet.' })]));

    root.appendChild(el('p', { class: 'note-line', text:
      'A day with no scan costs nothing — unless “no scan means leave” is on in Settings and the shop was open ' +
      '(somebody else scanned). Weekly off days are always paid.' }));
  }

  function mount(c) { root = c; day = day || Store.todayKey(); doc = null; load(); }
  return { mount: mount, render: render };
})();
