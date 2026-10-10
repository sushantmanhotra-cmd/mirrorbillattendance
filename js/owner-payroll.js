/* =============================================================
   Haazri — payroll

   Everybody's packet for their own pay cycle: the salary, what the
   register takes off (absent, half days, leave past the allowance),
   advances and fines already on the ledger, any bonus — and what is
   left to hand over. "Mark paid" records what was actually handed
   over; next month never recomputes this one.

   Reads: the day documents of the cycle, once — at most 31 for the
   whole team, however many people are on it.
   ============================================================= */
window.OwnerPayroll = (function () {
  'use strict';

  var el = UI.el;
  var root = null;
  var offset = 0;
  var days = null;
  var range = null;

  function cycles() {
    var st = Store.settings();
    return Store.employees().map(function (e) { return { e: e, c: Pay.payCycle(e, st, offset) }; });
  }

  function load(fresh) {
    var cs = cycles();
    if (!cs.length) { days = {}; render(); return; }
    var from = cs.reduce(function (m, x) { return x.c.from < m ? x.c.from : m; }, cs[0].c.from);
    var to = cs.reduce(function (m, x) { return x.c.to > m ? x.c.to : m; }, cs[0].c.to);
    range = { from: from, to: to };
    days = null;
    render();
    Store.days(from, to, fresh).then(function (d) { days = d; render(); })
      .catch(function (err) { UI.toast(err.message, 'warn'); });
  }

  function line(label, amount, minus, hint) {
    return el('div', { class: 'slip-line' }, [
      el('span', {}, [document.createTextNode(label), hint ? el('span', { class: 'muted small', text: '  ' + hint }) : null]),
      el('span', { class: minus && amount ? 'minus' : '', text: (minus && amount ? '− ' : '') + UI.rupee(amount) })
    ]);
  }

  function slipView(e, p) {
    var d = p.days;
    return el('div', {}, [
      el('p', { class: 'modal-msg', text: p.cycle.label + ' · ' + d.present + ' present, ' + d.half + ' half, ' +
        d.absent + ' absent, ' + d.leave + ' leave (' + p.leavePaid + ' of ' + p.leaveAllowed + ' paid), ' + d.off + ' off' +
        (d.unmarked ? ', ' + d.unmarked + ' unmarked (paid)' : '') }),
      line('Salary', p.salary, false, p.salary !== p.monthly ? 'of ' + UI.rupee(p.monthly) + ' — joined part-way' : ''),
      p.bonus ? line('Bonus', p.bonus) : null,
      line('Days away', p.absentDeduction, true, d.absent + ' absent, ' + d.half + ' half' + (p.leaveDocked ? ', ' + p.leaveDocked + ' unpaid leave' : '')),
      p.advances ? line('Advances', p.advances, true) : null,
      p.deductions ? line('Deductions & fines', p.deductions, true) : null,
      p.paid ? line('Already paid', p.paid, true) : null,
      el('div', { class: 'slip-line total' }, [el('span', { text: 'To pay' }), el('span', { text: UI.rupee(p.net) })])
    ].filter(Boolean));
  }

  function openSlip(e, p) {
    var st = Store.state.shop || {};
    var buttons = [{ label: 'Close' }];
    buttons.push({
      label: 'Share on WhatsApp', kind: 'ghost', onClick: function () {
        var d = p.days;
        var text = (st.name || 'Payslip') + ' — ' + e.name + ' (' + e.id + ')\n' + p.cycle.label + '\n' +
          'Present ' + d.present + ', half ' + d.half + ', absent ' + d.absent + ', leave ' + d.leave + '\n' +
          'Salary ' + UI.rupee(p.salary) + (p.bonus ? '\nBonus ' + UI.rupee(p.bonus) : '') +
          (p.absentDeduction ? '\nDays away −' + UI.rupee(p.absentDeduction) : '') +
          (p.advances ? '\nAdvances −' + UI.rupee(p.advances) : '') +
          (p.deductions ? '\nDeductions −' + UI.rupee(p.deductions) : '') +
          (p.paid ? '\nAlready paid −' + UI.rupee(p.paid) : '') +
          '\nTo pay: ' + UI.rupee(p.net);
        var phone = String(e.phone || '').replace(/\D/g, '');
        if (phone.length === 10) phone = '91' + phone;
        window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(text), '_blank', 'noopener');
        return false;
      }
    });
    if (!p.settled) {
      buttons.push({
        label: 'Mark paid', kind: 'primary', onClick: function () {
          UI.prompt('Mark paid — ' + e.name, [
            { key: 'amount', label: 'Amount handed over ₹', type: 'number', min: '0', value: Math.max(0, p.net) },
            { key: 'note', label: 'Note', placeholder: 'Cash / UPI…' }
          ], function (v) {
            Store.addLedger(e.id, { type: 'payout', amount: Math.max(0, Number(v.amount) || 0), period: p.cycle.from, note: v.note })
              .then(function () { UI.toast(e.name + ' marked paid for ' + p.cycle.label); load(); })
              .catch(function (err) { UI.toast(err.message, 'warn'); });
          }, { submitLabel: 'Mark paid' });
        }
      });
    }
    UI.modal('Payslip — ' + e.name, slipView(e, p), buttons);
  }

  function exportCsv(list) {
    var rows = [['ID', 'Name', 'Cycle', 'Present', 'Half', 'Absent', 'Leave', 'Salary', 'Bonus', 'Days away',
      'Advances', 'Deductions', 'Paid', 'To pay']];
    list.forEach(function (x) {
      var p = x.p, d = p.days;
      rows.push([x.e.id, x.e.name, p.cycle.label, d.present, d.half, d.absent, d.leave, p.salary, p.bonus,
        p.absentDeduction, p.advances, p.deductions, p.paid, p.net]);
    });
    UI.download('payroll-' + (range ? range.from : '') + '.csv', UI.csv(rows), 'text/csv');
  }

  function render() {
    if (!root) return;
    UI.clear(root);
    var st = Store.settings();
    var cs = cycles();
    var head = cs.length ? cs[0].c.label : '';

    root.appendChild(el('div', { class: 'screen-head' }, [
      el('div', {}, [
        el('h1', { text: 'Payroll' }),
        el('p', { class: 'sub', text: (offset === 0 ? 'This cycle' : offset === -1 ? 'Last cycle' : Math.abs(offset) + ' cycles back') +
          (head ? ' · ' + head : '') })
      ]),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn ghost tiny', text: '‹ Earlier', onclick: function () { offset--; load(); } }),
        offset < 0 ? el('button', { class: 'btn ghost tiny', text: 'Later ›', onclick: function () { offset++; load(); } }) : null
      ])
    ]));

    if (!cs.length) { root.appendChild(el('div', { class: 'card' }, [el('p', { class: 'empty', text: 'No staff yet.' })])); return; }
    if (!days) { root.appendChild(el('p', { class: 'empty', text: 'Working it out…' })); return; }

    var list = cs.map(function (x) { return { e: x.e, p: Pay.payslip(x.e, st, days, x.c) }; });
    var total = list.reduce(function (n, x) { return n + Math.max(0, x.p.net); }, 0);

    root.appendChild(el('div', { class: 'stats' }, [
      el('div', { class: 'stat' }, [el('div', { class: 'n', text: UI.rupee(total) }), el('div', { class: 'l', text: 'still to pay' })]),
      el('div', { class: 'stat ok' }, [el('div', { class: 'n', text: String(list.filter(function (x) { return x.p.settled; }).length) }), el('div', { class: 'l', text: 'paid' })]),
      el('div', { class: 'stat bad' }, [el('div', { class: 'n', text: UI.rupee(list.reduce(function (n, x) { return n + x.p.absentDeduction; }, 0)) }), el('div', { class: 'l', text: 'off for days away' })]),
      el('div', { class: 'stat warn' }, [el('div', { class: 'n', text: UI.rupee(list.reduce(function (n, x) { return n + x.p.advances; }, 0)) }), el('div', { class: 'l', text: 'advances' })])
    ]));

    /* A list, not a table: this is read on the owner's phone far more
       often than on a computer, and six columns do not fit on one. */
    root.appendChild(el('div', { class: 'card' }, [
      el('div', {}, list.map(function (x) {
        var p = x.p, d = p.days;
        var off = p.absentDeduction + p.advances + p.deductions;
        return el('div', { class: 'person' }, [
          el('div', { class: 'avatar', text: OwnerToday.initials(x.e.name) }),
          el('div', { class: 'person-main' }, [
            el('strong', {}, [document.createTextNode(x.e.name + ' '), p.settled ? el('span', { class: 'badge ok', text: 'paid' }) : null]),
            el('div', { class: 'muted', text: d.present + ' present · ' + d.half + ' half · ' + d.absent + ' absent · ' + d.leave + ' leave' }),
            el('div', { class: 'muted', text: 'Salary ' + UI.rupee(p.salary + p.bonus) + (off ? ' · −' + UI.rupee(off) : '') })
          ]),
          el('div', { class: 'pay-side' }, [
            el('strong', { class: 'pay-net', text: UI.rupee(p.net) }),
            el('button', { class: 'btn ghost tiny', text: 'Payslip', onclick: function () { openSlip(x.e, p); } })
          ])
        ]);
      })),
      el('div', { class: 'btn-row', style: 'margin-top:12px' }, [
        el('button', { class: 'btn ghost tiny', text: 'Download CSV', onclick: function () { exportCsv(list); } }),
        el('button', { class: 'btn ghost tiny', text: 'Refresh', onclick: function () { load(true); } })
      ])
    ]));
    root.appendChild(el('p', { class: 'note-line', text:
      'A day is priced as the salary ÷ the days in that month. Leave is free up to the allowance, earliest days first. ' +
      'Advances and fines come from each person’s ledger (Staff → Manage).' }));
  }

  /* The ledger lives on the employee document, so a payout or an
     advance arrives through the staff listener — redraw from what is
     already loaded rather than read the month again. */
  function mount(c) { root = c; offset = 0; load(); }
  return { mount: mount, render: render };
})();
