/* =============================================================
   Haazri — the team

   Each person gets an employee ID (E01, E02…) and a 6-digit PIN. With
   the shop code, that is their login on their own phone. The owner
   registers their face once, here, in person — never the employee
   themselves, or anybody could register a friend to scan for them.

   Money handed over during the month (advances), taken off (fines,
   breakages) or added (bonus) goes on the person's ledger and shows on
   the payslip.
   ============================================================= */
window.OwnerStaff = (function () {
  'use strict';

  var el = UI.el;
  var root = null;

  function randomPin() {
    var b = new Uint32Array(1);
    crypto.getRandomValues(b);
    return String(100000 + (b[0] % 900000));
  }

  function shopCode() { return Store.state.member.shopId; }

  /* The three things the person needs, ready to send on WhatsApp. A
     plain wa.me link: free, no WhatsApp API, it just opens the chat
     with the text filled in for the owner to send. */
  function loginCard(e, pin) {
    var url = location.origin + location.pathname;
    var text = 'Haazri attendance login for ' + e.name + '\n' +
      'Open: ' + url + '\n' +
      'Shop code: ' + shopCode() + '\n' +
      'Employee ID: ' + e.id + '\n' +
      (pin ? 'PIN: ' + pin + '\n' : '') +
      'Add it to your home screen. Scan in when you reach work.';
    var phone = String(e.phone || '').replace(/\D/g, '');
    if (phone.length === 10) phone = '91' + phone;
    var wa = 'https://wa.me/' + (phone || '') + '?text=' + encodeURIComponent(text);
    UI.modal('Login for ' + e.name, el('div', {}, [
      el('p', { class: 'modal-msg', text: pin
        ? 'Give these to ' + e.name + '. The PIN is shown only now — it is not stored anywhere you can see it again.'
        : 'Give these to ' + e.name + '. Forgotten PIN? Use “Reset PIN”.' }),
      el('div', { class: 'form-grid' }, [
        el('div', {}, [el('div', { class: 'field-label', text: 'Shop code' }), el('span', { class: 'kbd', text: shopCode() })]),
        el('div', {}, [el('div', { class: 'field-label', text: 'Employee ID' }), el('span', { class: 'kbd', text: e.id })]),
        pin ? el('div', {}, [el('div', { class: 'field-label', text: 'PIN' }), el('span', { class: 'kbd', text: pin })]) : null,
        el('div', {}, [el('div', { class: 'field-label', text: 'App address' }), el('span', { class: 'small', text: url })])
      ])
    ]), [
      { label: 'Close' },
      { label: 'Send on WhatsApp', kind: 'good', onClick: function () { window.open(wa, '_blank', 'noopener'); return false; } }
    ]);
  }

  function form(e, onSave) {
    var creating = !e;
    e = e || {};
    UI.prompt(creating ? 'Add a member of staff' : 'Edit ' + e.name, [
      { key: 'name', label: 'Name', value: e.name || '', full: true },
      { key: 'role', label: 'Work (optional)', value: e.role || '', placeholder: 'Cashier, helper…' },
      { key: 'phone', label: 'Phone (optional)', value: e.phone || '', type: 'tel', hint: 'To send them their login on WhatsApp.' },
      { key: 'salary', label: 'Monthly salary ₹', type: 'number', min: '0', value: e.salary || '' },
      { key: 'joinedAt', label: 'Joined on (only if part-way through this month)', type: 'date', value: e.joinedAt || '',
        hint: 'Leave blank for somebody already working here — they are paid the whole month.' },
      { key: 'paidLeave', label: 'Paid leave a month', type: 'number', min: '0', value: e.paidLeave === undefined ? '' : e.paidLeave,
        hint: 'Blank uses the shop’s setting (' + Pay.paidLeaveAllowance({}, Store.settings()) + ').' },
      { key: 'payDay', label: 'Own pay day (1–31)', type: 'number', min: '1', max: '31', value: e.payDay || '',
        hint: 'Blank uses the shop’s pay day.' }
    ], function (v) {
      if (!v.name) { UI.toast('Name, please', 'warn'); return false; }
      var data = {
        name: v.name, role: v.role, phone: v.phone, salary: v.salary, joinedAt: v.joinedAt,
        paidLeave: v.paidLeave === '' ? '' : Math.max(0, Number(v.paidLeave) || 0),
        payDay: v.payDay === '' ? 0 : Math.min(31, Math.max(1, Number(v.payDay) || 1))
      };
      onSave(data);
    }, { submitLabel: creating ? 'Add and make a login' : 'Save' });
  }

  function add() {
    form(null, function (data) {
      var pin = randomPin();
      UI.toast('Making ' + data.name + '’s login…');
      Store.addEmployee(data, pin).then(function (id) {
        var e = Object.assign({ id: id }, data);
        loginCard(e, pin);
      }).catch(function (err) { UI.toast(err.message || String(err), 'warn'); });
    });
  }

  function resetPin(e) {
    UI.confirm('Reset ' + e.name + '’s PIN?', 'Their old PIN stops working straight away, on every phone. ' +
      'You will be shown the new one to give them.', function () {
      var pin = randomPin();
      Store.resetPin(e.id, pin).then(function () { loginCard(e, pin); })
        .catch(function (err) { UI.toast(err.message || String(err), 'warn'); });
    }, 'Reset PIN');
  }

  function remove(e) {
    UI.confirm('Remove ' + e.name + '?', 'Their login stops working at once and their face is deleted. ' +
      'Their attendance and ledger are kept for the payroll still owed.', function () {
      Store.removeEmployee(e.id).then(function () { UI.toast(e.name + ' removed'); })
        .catch(function (err) { UI.toast(err.message || String(err), 'warn'); });
    }, 'Remove');
  }

  /* ---------------- money during the month ---------------- */

  var TYPES = {
    advance: 'Advance (money given early)',
    deduction: 'Deduction / fine',
    bonus: 'Bonus'
  };

  function ledger(e) {
    var list = (e.ledger || []).slice().reverse().slice(0, 40);
    var m = UI.modal('Advances, fines & bonus — ' + e.name, el('div', {}, [
      el('div', { class: 'btn-row', style: 'margin-bottom:12px' }, Object.keys(TYPES).map(function (t) {
        return el('button', { class: 'btn ghost tiny', text: '+ ' + TYPES[t].split(' (')[0], onclick: function () { m.close(); entry(e, t); } });
      })),
      list.length ? el('div', { class: 'table-wrap' }, [el('table', { class: 'data-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: 'Date' }), el('th', { text: 'What' }), el('th', { class: 'right', text: 'Amount' }), el('th', { text: '' })])]),
        el('tbody', {}, list.map(function (x) {
          return el('tr', {}, [
            el('td', { text: UI.prettyDate((x.date || String(x.at).slice(0, 10)) + 'T00:00:00') }),
            el('td', {}, [el('span', { class: 'badge ' + (x.type === 'bonus' ? 'ok' : x.type === 'payout' ? 'grey' : 'warn'), text: x.type === 'payout' ? 'paid' : x.type }),
              el('span', { class: 'muted small', text: x.note || (x.period ? 'for cycle from ' + x.period : '') })]),
            el('td', { class: 'right', text: UI.rupee(x.amount) }),
            el('td', { class: 'right' }, [el('button', { class: 'link-btn small', text: 'remove', onclick: function () {
              UI.confirm('Remove this entry?', function () { Store.removeLedger(e.id, x.id).then(function () { m.close(); }); }, 'Remove');
            } })])
          ]);
        }))
      ])]) : el('p', { class: 'empty', text: 'Nothing yet.' })
    ]), [{ label: 'Close' }], { wide: true });
  }

  function entry(e, type) {
    UI.prompt(TYPES[type] + ' — ' + e.name, [
      { key: 'amount', label: 'Amount ₹', type: 'number', min: '1' },
      { key: 'date', label: 'Date', type: 'date', value: Store.todayKey(), hint: 'It lands on the payslip of the month this date is in.' },
      { key: 'note', label: 'Note', full: true, placeholder: type === 'deduction' ? 'Late without telling, breakage…' : '' }
    ], function (v) {
      if (!(Number(v.amount) > 0)) { UI.toast('How much?', 'warn'); return false; }
      Store.addLedger(e.id, { type: type, amount: v.amount, date: v.date || Store.todayKey(), note: v.note })
        .then(function () { UI.toast(UI.rupee(v.amount) + ' ' + type + ' recorded'); })
        .catch(function (err) { UI.toast(err.message, 'warn'); });
    });
  }

  /* ---------------- registering a face ----------------

     Ported from mirrorBill. Three pictures, a slight turn of the head
     between them, each checked against the ones before (somebody
     stepped in front halfway through?) and against everybody else on
     the team (is this face already somebody else's?). */
  function faceEnrol(emp) {
    var NEED = 3;
    var samples = [];
    var video = el('video', { class: 'scan-video', autoplay: true, muted: true, playsinline: true });
    var status = el('p', { class: 'modal-msg', text: 'Getting the camera ready…' });
    var count = el('p', { class: 'muted small', text: '' });
    function tell(t) { status.textContent = t; }
    function tally() { count.textContent = samples.length + ' of ' + NEED + ' pictures taken'; }

    var takeBtn = el('button', {
      class: 'btn primary', text: 'Take picture', disabled: true,
      onclick: function () {
        takeBtn.disabled = true;
        Face.describe(video).then(function (r) {
          if (r.none) { tell('No face found. Look straight at the camera.'); return; }
          if (r.many) { tell('Only ' + emp.name + ' should be in the picture.'); return; }
          if (r.share < Face.CLOSE_TO_REGISTER) {
            tell('Come closer — ' + emp.name + '’s face should fill most of the picture.');
            return;
          }
          if (samples.length) {
            var d = Math.min.apply(null, samples.map(function (s) { return Face.distance(r.descriptor, s); }));
            if (d > Face.MATCH) {
              tell('That does not look like the same person as the first picture. Start again with only ' + emp.name + ' in front of the camera.');
              samples = []; tally();
              return;
            }
          }
          var nearest = null;
          Store.faceRoster().forEach(function (p) {
            if (p.id === emp.id) return;
            p.samples.forEach(function (s) {
              var dd = Face.distance(r.descriptor, s);
              if (!nearest || dd < nearest.d) nearest = { d: dd, name: p.name };
            });
          });
          if (nearest && nearest.d <= Face.DUPLICATE) {
            tell('This face is already registered to ' + nearest.name + '. If that is a mistake, remove it from ' + nearest.name + '’s card first.');
            return;
          }
          samples.push(r.descriptor);
          tally();
          tell(samples.length < NEED ? 'Got it. Turn the head slightly and take another.'
            : 'That is enough. Save it, and ' + emp.name + ' can scan in from their phone.');
        }).catch(function (e) {
          tell('Could not read the picture: ' + ((e && e.message) || e));
        }).then(function () { takeBtn.disabled = samples.length >= NEED; });
      }
    });

    var body = el('div', {}, [
      el('p', { class: 'muted small', text: 'Do this with ' + emp.name + ' in front of you, in good light. The picture never ' +
        'leaves this phone: what is kept is 128 numbers per picture — enough to recognise ' + emp.name + ', not enough to draw them.' }),
      el('div', { class: 'scan-stage small' }, [video]),
      status, count,
      el('div', { class: 'btn-row center' }, [takeBtn])
    ]);

    var buttons = [{ label: 'Cancel' }];
    if (Store.hasFace(emp)) {
      buttons.push({ label: 'Remove face', kind: 'danger-ghost', onClick: function () {
        Store.clearFace(emp.id).then(function () { UI.toast(emp.name + '’s face removed'); });
      } });
    }
    buttons.push({ label: 'Save', kind: 'primary', onClick: function () {
      if (samples.length < NEED) { tell('Take ' + (NEED - samples.length) + ' more first.'); return false; }
      Store.setFace(emp.id, samples).then(function () { UI.toast(emp.name + ' can now scan in'); })
        .catch(function (err) { UI.toast(err.message, 'warn'); });
    } });

    UI.modal('Face — ' + emp.name, body, buttons, { onClose: function () { Face.stopCamera(); } });

    if (!Face.supported()) { tell('This browser cannot open the camera. Use Chrome or Safari on a phone.'); return; }
    Face.ready(function (step) { tell(step); })
      .then(function () { return Face.startCamera(video); })
      .then(function () {
        tell('Look straight at the camera and take the first picture.');
        takeBtn.disabled = false; tally();
      })
      .catch(function (e) {
        tell(e && e.name === 'NotAllowedError'
          ? 'The camera was not allowed. Allow it in the browser settings for this site.'
          : 'Could not start the camera: ' + ((e && e.message) || e));
      });
  }

  /* ---------------- the screen ---------------- */

  function actions(e) {
    var m = UI.modal(e.name + ' · ' + e.id, el('div', { style: 'display:grid;gap:8px' }, [
      el('button', { class: 'btn ' + (Store.hasFace(e) ? 'ghost' : 'primary') + ' block', text: Store.hasFace(e) ? 'Register face again' : 'Register face',
        onclick: function () { m.close(); faceEnrol(e); } }),
      el('button', { class: 'btn ghost block', text: 'Advances, fines & bonus', onclick: function () { m.close(); ledger(e); } }),
      el('button', { class: 'btn ghost block', text: 'Edit details', onclick: function () {
        m.close();
        form(e, function (data) { Store.updateEmployee(e.id, data).then(function () { UI.toast('Saved'); }); });
      } }),
      el('button', { class: 'btn ghost block', text: 'Show login (shop code & ID)', onclick: function () { m.close(); loginCard(e); } }),
      el('button', { class: 'btn ghost block', text: 'Reset PIN', onclick: function () { m.close(); resetPin(e); } }),
      el('button', { class: 'btn danger-ghost block', text: 'Remove from the team', onclick: function () { m.close(); remove(e); } })
    ]), [{ label: 'Close' }]);
  }

  function render() {
    if (!root) return;
    UI.clear(root);
    var emps = Store.employees();
    var gone = Store.employees(true).filter(function (e) { return e.active === false; });
    root.appendChild(el('div', { class: 'screen-head' }, [
      el('div', {}, [
        el('h1', { text: 'Staff' }),
        el('p', { class: 'sub' }, [
          document.createTextNode(emps.length + ' on the team · shop code '),
          el('span', { class: 'kbd', text: shopCode() })
        ])
      ]),
      el('button', { class: 'btn primary', text: '+ Add staff', onclick: add })
    ]));

    root.appendChild(el('div', { class: 'card' }, emps.length ? emps.map(function (e) {
      return el('div', { class: 'person' }, [
        el('div', { class: 'avatar', text: OwnerToday.initials(e.name) }),
        el('div', { class: 'person-main' }, [
          el('strong', { text: e.name }),
          el('div', { class: 'muted', text: e.id + (e.role ? ' · ' + e.role : '') + ' · ' + UI.rupee(e.salary) + '/month' })
        ]),
        el('div', { class: 'person-side' }, [
          Store.hasFace(e)
            ? el('span', { class: 'badge ok', text: 'face ✓' })
            : el('button', { class: 'btn accent tiny', text: 'Add face', onclick: function () { faceEnrol(e); } }),
          el('button', { class: 'btn ghost tiny', text: 'Manage', onclick: function () { actions(e); } })
        ])
      ]);
    }) : [el('p', { class: 'empty', text: 'Nobody yet. Add your first member of staff — they get an ID and PIN to sign in on their own phone.' })]));

    if (gone.length) {
      root.appendChild(el('p', { class: 'note-line', text: 'Removed: ' + gone.map(function (e) { return e.name + ' (' + e.id + ')'; }).join(', ') +
        '. Their records stay for payroll.' }));
    }
  }

  function mount(c) { root = c; render(); }
  return { mount: mount, render: render, faceEnrol: faceEnrol };
})();
