/* =============================================================
   Haazri — scans from outside the shop

   Somebody scanned their face somewhere other than the shop — the
   bank, a customer's house, the market for stock. Their face matched
   on their own phone; the only question left is whether the owner
   agrees they were working. The picture taken at the moment, where
   they were, how far away and the reason they gave are all here to
   answer it.

   Approving marks the day at the moment the request was SENT, so it is
   judged late or on time exactly as a scan inside the shop would be.
   ============================================================= */
window.OwnerApprovals = (function () {
  'use strict';

  var el = UI.el;
  var root = null;
  var history = null;       // recent decided requests, loaded on demand

  function row(r, pending) {
    var when = Pay.toDate(r.at);
    return el('div', { class: 'req' }, [
      r.photo ? el('img', { class: 'req-photo', src: r.photo, alt: 'Picture taken at the scan' }) : el('div', { class: 'req-photo' }),
      el('div', { class: 'req-main' }, [
        el('strong', { text: r.name + ' · ' + (r.kind === 'out' ? 'scan out' : 'scan in') }),
        el('div', { class: 'muted', text: UI.prettyDate(r.date + 'T00:00:00') + (when ? ' at ' + UI.prettyTime(when) : '') +
          ' · ' + r.dist + ' m from the shop (±' + r.acc + ' m)' }),
        el('div', { text: '“' + (r.reason || 'no reason given') + '”' }),
        el('div', { class: 'small' }, [
          el('a', { href: Geo.mapLink(r.lat, r.lng), target: '_blank', rel: 'noopener', text: 'See where on the map' }),
          /* The distance the face model measured against their own
             registration: 0 is identical, and 0.40 is the most the
             phone accepts at all. */
          document.createTextNode(' · face matched' + (r.match != null ? ' (' + r.match.toFixed(2) + ')' : ''))
        ]),
        pending
          ? el('div', { class: 'req-acts' }, [
            el('button', { class: 'btn good tiny', text: 'Approve', onclick: function () { decide(r, true); } }),
            el('button', { class: 'btn danger-ghost tiny', text: 'Turn down', onclick: function () { decide(r, false); } })
          ])
          : el('div', {}, [el('span', {
            class: 'badge ' + (r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'bad' : 'warn'),
            text: r.status
          }), r.note ? el('span', { class: 'muted small', text: r.note }) : null])
      ])
    ]);
  }

  function decide(r, approve) {
    if (approve) {
      Store.decide(r, true).then(function () {
        UI.toast(r.name + ' marked for ' + UI.prettyDate(r.date + 'T00:00:00'));
        history = null;
      }).catch(function (e) { UI.toast(e.message, 'warn'); });
      return;
    }
    UI.prompt('Turn down — ' + r.name, [
      { key: 'note', label: 'Tell them why (optional)', full: true, placeholder: 'e.g. Not on shop work' }
    ], function (v) {
      Store.decide(r, false, v.note).then(function () {
        UI.toast('Turned down. The day stays unmarked.');
        history = null;
      }).catch(function (e) { UI.toast(e.message, 'warn'); });
    }, { submitLabel: 'Turn down' });
  }

  function render() {
    if (!root) return;
    UI.clear(root);
    var pend = Store.state.pending;
    root.appendChild(el('div', { class: 'screen-head' }, [
      el('div', {}, [
        el('h1', { text: 'Approvals' }),
        el('p', { class: 'sub', text: pend.length
          ? pend.length + ' waiting · scans from outside the shop perimeter'
          : 'Nothing waiting. Scans from outside the shop perimeter land here.' })
      ])
    ]));

    root.appendChild(el('div', { class: 'card' }, pend.length
      ? pend.map(function (r) { return row(r, true); })
      : [el('p', { class: 'empty', text: 'All clear.' })]));

    var hist = el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h3', { text: 'Decided recently' }),
        history ? null : el('button', { class: 'btn ghost tiny', text: 'Show', onclick: function () {
          Store.recentRequests(30).then(function (list) {
            history = list.filter(function (r) { return r.status !== 'pending'; });
            render();
          }).catch(function (e) { UI.toast(e.message, 'warn'); });
        } })
      ])
    ]);
    if (history) {
      if (!history.length) hist.appendChild(el('p', { class: 'empty', text: 'None yet.' }));
      history.forEach(function (r) { hist.appendChild(row(r, false)); });
    }
    root.appendChild(hist);
  }

  function mount(c) { root = c; history = null; render(); }
  return { mount: mount, render: render };
})();
