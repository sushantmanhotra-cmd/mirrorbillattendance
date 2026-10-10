'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Pay = require('../../js/pay.js');
const Geo = require('../../js/geo.js');

function at(k, hhmm) { return new Date(k + 'T' + hhmm + ':00'); }
const S = { shiftStart: '10:00', grace: 15, lateIsHalf: true, paidLeave: 2, noScan: 'leave', weeklyOff: [] };

/* ---------------- a day ---------------- */

test('on time within the grace is present; after it is a half day', () => {
  assert.equal(Pay.statusOf({ at: at('2026-09-01', '10:14') }, S), 'present');
  assert.equal(Pay.statusOf({ at: at('2026-09-01', '10:15') }, S), 'present');
  assert.equal(Pay.statusOf({ at: at('2026-09-01', '10:16') }, S), 'half');
  assert.equal(Pay.minutesLate(at('2026-09-01', '10:46'), S), 31);
});

test('late is only a half day when the shop says so', () => {
  assert.equal(Pay.statusOf({ at: at('2026-09-01', '12:00') }, Object.assign({}, S, { lateIsHalf: false })), 'present');
});

test('the owner\'s marking always wins over the scan', () => {
  assert.equal(Pay.statusOf({ at: at('2026-09-01', '12:00'), status: 'present' }, S), 'present');
  assert.equal(Pay.statusOf({ at: at('2026-09-01', '09:00'), status: 'absent' }, S), 'absent');
});

test('Firestore timestamps are read the same as dates', () => {
  const d = at('2026-09-01', '10:30');
  assert.equal(Pay.statusOf({ at: { seconds: d.getTime() / 1000 } }, S), 'half');
  assert.equal(Pay.statusOf({ at: { toDate: () => d } }, S), 'half');
});

/* ---------------- cycles ---------------- */

test('a pay day of the 1st is the calendar month', () => {
  const c = Pay.payCycle({}, { payDay: 1 }, 0, new Date(2026, 8, 17));
  assert.deepEqual([c.from, c.to, c.label], ['2026-09-01', '2026-09-30', 'Sep 2026']);
});

test('a pay day of the 31st is pulled back in a short month, never pushed into the next', () => {
  const c = Pay.payCycle({}, { payDay: 31 }, 0, new Date(2026, 1, 10));
  assert.equal(c.from, '2026-01-31');
  assert.equal(c.to, '2026-02-27');
  const d = Pay.payCycle({}, { payDay: 31 }, 0, new Date(2026, 1, 28));
  assert.equal(d.from, '2026-02-28');
  assert.equal(d.to, '2026-03-30');
});

test('the person\'s own pay day wins over the shop\'s', () => {
  const c = Pay.payCycle({ payDay: 15 }, { payDay: 1 }, 0, new Date(2026, 8, 3));
  assert.deepEqual([c.from, c.to], ['2026-08-15', '2026-09-14']);
  const prev = Pay.payCycle({ payDay: 15 }, { payDay: 1 }, -1, new Date(2026, 8, 3));
  assert.deepEqual([prev.from, prev.to], ['2026-07-15', '2026-08-14']);
});

/* ---------------- the payslip ---------------- */

function month(recs) {
  const days = {};
  Object.keys(recs).forEach((k) => {
    days[k] = { r: recs[k] };
  });
  return days;
}
const SEPT = { from: '2026-09-01', to: '2026-09-30', label: 'Sep 2026' };
const AFTER = new Date(2026, 9, 5);

test('a full month with nothing against it is the full salary', () => {
  const emp = { id: 'E01', salary: 15000, ledger: [] };
  const p = Pay.payslip(emp, S, {}, SEPT, AFTER);
  assert.equal(p.salary, 15000);
  assert.equal(p.net, 15000);
  assert.equal(p.days.unmarked, 30);
});

test('absent and half days are priced from the month\'s own length', () => {
  const emp = { id: 'E01', salary: 15000, ledger: [] };
  const days = month({
    '2026-09-02': { E01: { status: 'absent' } },
    '2026-09-03': { E01: { at: at('2026-09-03', '11:00') } }
  });
  const p = Pay.payslip(emp, S, days, SEPT, AFTER);
  // 500 a day in a 30-day month: one absent (500) + one half (250)
  assert.equal(p.absentDeduction, 750);
  assert.equal(p.net, 14250);
  assert.equal(p.days.absent, 1);
  assert.equal(p.days.half, 1);
});

test('leave is free up to the allowance, earliest first, then costs a day', () => {
  const emp = { id: 'E01', salary: 15000, ledger: [] };
  const days = month({
    '2026-09-05': { E01: { status: 'leave' } },
    '2026-09-06': { E01: { status: 'leave' } },
    '2026-09-20': { E01: { status: 'leave' } }
  });
  const p = Pay.payslip(emp, S, days, SEPT, AFTER);
  assert.equal(p.leavePaid, 2);
  assert.equal(p.leaveDocked, 1);
  assert.equal(p.absentDeduction, 500);
  const none = Pay.payslip(Object.assign({}, emp, { paidLeave: 0 }), S, days, SEPT, AFTER);
  assert.equal(none.absentDeduction, 1500, 'a person set to 0 paid leave really gets 0');
});

test('no scan on a day the shop was open counts as leave; a shut day counts as nothing', () => {
  const emp = { id: 'E01', salary: 15000, ledger: [], face: { at: '2026-08-20T10:00:00Z' } };
  const days = month({
    '2026-09-02': { E02: { at: at('2026-09-02', '09:55') } },   // shop open, E01 missing
    '2026-09-03': { E02: { at: at('2026-09-03', '09:55') } },
    '2026-09-04': { E02: { at: at('2026-09-04', '09:55') } }
  });
  const p = Pay.payslip(emp, S, days, SEPT, AFTER);
  assert.equal(p.days.leave, 3);
  assert.equal(p.leaveDocked, 1);
  assert.equal(p.absentDeduction, 500);
  const off = Pay.payslip(emp, Object.assign({}, S, { noScan: 'ignore' }), days, SEPT, AFTER);
  assert.equal(off.absentDeduction, 0);
});

test('no scan never counts before somebody\'s face was registered', () => {
  const emp = { id: 'E01', salary: 15000, ledger: [], face: { at: '2026-09-03T10:00:00' } };
  const days = month({
    '2026-09-02': { E02: { at: at('2026-09-02', '09:55') } },
    '2026-09-03': { E02: { at: at('2026-09-03', '09:55') } }
  });
  assert.equal(Pay.payslip(emp, S, days, SEPT, AFTER).days.leave, 0);
});

test('weekly off is a paid day and never a no-scan', () => {
  const emp = { id: 'E01', salary: 15000, ledger: [], face: { at: '2026-08-01T10:00:00' } };
  // 2026-09-06 is a Sunday
  const days = month({ '2026-09-06': { E02: { at: at('2026-09-06', '09:55') } } });
  const p = Pay.payslip(emp, Object.assign({}, S, { weeklyOff: [0] }), days, SEPT, AFTER);
  assert.equal(p.days.leave, 0);
  assert.equal(p.days.off, 4);
});

test('joining part-way is paid for the part', () => {
  const emp = { id: 'E01', salary: 15000, ledger: [], joinedAt: '2026-09-16' };
  const p = Pay.payslip(emp, S, {}, SEPT, AFTER);
  assert.equal(p.salary, 7500);
});

test('advances, deductions and bonus land on the slip and it adds up', () => {
  const emp = {
    id: 'E01', salary: 10000, ledger: [
      { type: 'advance', amount: 2000, date: '2026-09-10' },
      { type: 'deduction', amount: 300, date: '2026-09-11' },
      { type: 'bonus', amount: 1000, date: '2026-09-12' },
      { type: 'advance', amount: 999, date: '2026-10-01' }        // next cycle
    ]
  };
  const p = Pay.payslip(emp, S, {}, SEPT, AFTER);
  assert.equal(p.gross, 11000);
  assert.equal(p.net, 11000 - 2000 - 300);
});

test('a payout settles the cycle it names, whenever it was pressed', () => {
  const emp = {
    id: 'E01', salary: 10000, ledger: [
      { type: 'payout', amount: 10000, period: '2026-09-01', date: '2026-10-02' }
    ]
  };
  const p = Pay.payslip(emp, S, {}, SEPT, AFTER);
  assert.equal(p.settled, true);
  assert.equal(p.net, 0);
  const oct = Pay.payslip(emp, S, {}, { from: '2026-10-01', to: '2026-10-31' }, new Date(2026, 10, 2));
  assert.equal(oct.paid, 0, 'September\'s payout does not eat October');
});

test('the future is never counted', () => {
  const emp = { id: 'E01', salary: 15000, ledger: [] };
  const p = Pay.payslip(emp, S, {}, SEPT, new Date(2026, 8, 10));
  assert.equal(p.rows.length, 10);
});

/* ---------------- the perimeter ---------------- */

const SHOP = { lat: 32.2733, lng: 75.6522, radius: 100 };

test('distance is right to within a metre over a short hop', () => {
  // 0.001 deg latitude is ~111.2 m
  const d = Geo.distance({ lat: 32.2733, lng: 75.6522 }, { lat: 32.2743, lng: 75.6522 });
  assert.ok(Math.abs(d - 111.2) < 1, String(d));
});

test('inside, outside and unsure', () => {
  assert.equal(Geo.judge({ lat: 32.2735, lng: 75.6522, accuracy: 15 }, SHOP).verdict, 'inside');
  assert.equal(Geo.judge({ lat: 32.2753, lng: 75.6522, accuracy: 15 }, SHOP).verdict, 'outside');
  // ~220 m away but only sure to 150 m: the circle reaches the shop
  assert.equal(Geo.judge({ lat: 32.2753, lng: 75.6522, accuracy: 150 }, SHOP).verdict, 'unsure');
  assert.equal(Geo.judge({ lat: 32.2735, lng: 75.6522, accuracy: 900 }, SHOP).verdict, 'poor');
  assert.equal(Geo.judge({ lat: 1, lng: 1, accuracy: 5 }, null).verdict, 'nosite');
});
