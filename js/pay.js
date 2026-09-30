/* =============================================================
   Haazri — what a day is, and what a month is worth

   Pure arithmetic: no database, no screen, no clock except the one
   handed in. It is the part that decides somebody's wages, so it is
   the part the tests in test/ hold down.

   Ported from mirrorBill's payroll and kept to the same rules, because
   they were argued out at real counters:

     - a day nobody said anything about costs nobody anything, unless
       the shop has switched on "no scan means leave";
     - leave is spent from a paid allowance first, earliest days first,
       and only after that costs a day's pay;
     - a day is priced against the month it fell in — a day in
       February is worth more than a day in March;
     - every line is rounded before it is added, so the slip adds up
       to its own total exactly;
     - what was handed over is recorded, never recalculated.

   WHERE A DAY'S STATUS COMES FROM

   A scan writes the moment it happened (the server's clock, not the
   phone's — see firestore.rules) and nothing else. Whether that moment
   was on time is worked out HERE, from the shop's shift start and the
   minutes it lets go, every time the register is drawn. So a phone
   with its clock set back cannot make a late morning look early, and
   an owner who changes the shift time sees every day re-judged by the
   new rule rather than frozen under the old one.

   An owner's own marking (status on the record) always wins.
   ============================================================= */
(function (root) {
  'use strict';

  var STATUSES = ['present', 'half', 'absent', 'leave', 'off'];

  function pad(n) { return String(n).padStart(2, '0'); }

  function dateKey(d) {
    var x = d instanceof Date ? d : new Date(d);
    return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
  }

  function fromKey(k) { return new Date(k + 'T00:00:00'); }

  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

  /* Firestore Timestamps, ISO strings, Dates and epoch millis all come
     through here, because records written by different routes (a live
     scan, an approval, a test) arrive in different shapes. */
  function toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v.toDate === 'function') return v.toDate();
    if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function minutesOf(hhmm) {
    var m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  function hhmm(d) {
    return d ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : '';
  }

  /* How many minutes after the let-go time somebody arrived. Zero when
     on time; null when the shop has no shift start. */
  function minutesLate(at, settings) {
    var d = toDate(at);
    var start = minutesOf(settings && settings.shiftStart);
    if (!d || start == null) return null;
    var grace = Math.max(0, Number(settings.grace) || 0);
    var mins = d.getHours() * 60 + d.getMinutes();
    return Math.max(0, mins - (start + grace));
  }

  /* The day as it counts for pay. */
  function statusOf(rec, settings) {
    if (!rec) return null;
    if (rec.status && STATUSES.indexOf(rec.status) >= 0) return rec.status;
    var late = minutesLate(rec.at, settings);
    if (settings && settings.lateIsHalf && late > 0) return 'half';
    return 'present';
  }

  /* ---------------- pay cycles ----------------

     A cycle starts on the shop's pay day (or the person's own) and runs
     to the instant before the next one. A pay day of the 31st is the
     31st in January, the 28th in February — pulled back only as far as
     a short month forces, never allowed to slide into the next month. */
  function cycleDay(emp, settings) {
    var d = Number((emp && emp.payDay) || (settings && settings.payDay)) || 1;
    return Math.min(31, Math.max(1, Math.round(d)));
  }

  function onDay(y, m, day) {
    var norm = new Date(y, m, 1);
    var yy = norm.getFullYear(), mm = norm.getMonth();
    return new Date(yy, mm, Math.min(day, daysInMonth(yy, mm)));
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function payCycle(emp, settings, offset, when) {
    var startDay = cycleDay(emp, settings);
    var now = when ? new Date(when) : new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var y = now.getFullYear(), m = now.getMonth();
    var from = onDay(y, m, startDay);
    if (today < from) { m -= 1; from = onDay(y, m, startDay); }
    if (offset) { m += offset; from = onDay(y, m, startDay); }
    var next = onDay(y, m + 1, startDay);
    var to = new Date(next.getTime() - 86400000);
    var label = startDay === 1
      ? MONTHS[from.getMonth()] + ' ' + from.getFullYear()
      : from.getDate() + ' ' + MONTHS[from.getMonth()] + ' – ' +
        to.getDate() + ' ' + MONTHS[to.getMonth()] + ' ' + to.getFullYear();
    return { from: dateKey(from), to: dateKey(to), label: label, startDay: startDay };
  }

  function eachDay(fromK, toK, fn) {
    var d = fromKey(fromK), end = fromKey(toK), guard = 0;
    while (d <= end && guard++ < 400) {
      fn(dateKey(d), d);
      d.setDate(d.getDate() + 1);
    }
  }

  function daysBetween(fromK, toK) {
    return Math.round((fromKey(toK) - fromKey(fromK)) / 86400000) + 1;
  }

  function paidLeaveAllowance(emp, settings) {
    var own = emp && emp.paidLeave;
    if (own !== '' && own !== null && own !== undefined && isFinite(Number(own))) {
      return Math.max(0, Number(own));
    }
    var s = settings && settings.paidLeave;
    if (s !== '' && s !== null && s !== undefined && isFinite(Number(s))) {
      return Math.max(0, Number(s));
    }
    return 2;
  }

  /* ---------------- the register for one person ----------------

     Every day of the window, each with what it counts as and why.
     `days` is { 'YYYY-MM-DD': { r: { empId: rec } } } — the shop's day
     documents, as read. `today` is passed in so tests can stand on any
     date. */
  function register(emp, settings, days, fromK, toK, today) {
    settings = settings || {};
    var todayK = today ? dateKey(today) : dateKey(new Date());
    var weeklyOff = settings.weeklyOff || [];
    var joined = emp.joinedAt ? String(emp.joinedAt).slice(0, 10) : '';
    /* "No scan" only counts from the day after somebody could scan at
       all. The day their face was registered they were being set up. */
    var faceAt = emp.faceAt || (emp.face && emp.face.at);
    var faceFrom = faceAt ? dateKey(toDate(faceAt)) : '';
    var noScan = settings.noScan || 'leave';
    var out = [];

    eachDay(fromK, toK, function (k, d) {
      if (k > todayK) return;
      if (joined && k < joined) return;
      var doc = days[k];
      var rec = doc && doc.r && doc.r[emp.id];
      var row = { date: k, rec: rec || null, status: null, why: '' };
      if (rec) {
        row.status = statusOf(rec, settings);
        row.why = rec.status ? (rec.src === 'manual' || !rec.src ? 'marked' : 'changed') : (rec.src || 'scan');
        row.late = rec.status ? null : minutesLate(rec.at, settings);
      } else if (weeklyOff.indexOf(d.getDay()) >= 0) {
        row.status = 'off';
        row.why = 'weekly off';
      } else if (k < todayK && noScan !== 'ignore' && faceFrom && k > faceFrom &&
                 doc && doc.r && Object.keys(doc.r).length) {
        /* Only on a day the shop was clearly open — somebody else scanned
           in. A day with no scans at all is a holiday or a closed shop,
           and marking the whole team on leave for it would spend
           everybody's allowance on a festival. */
        row.status = noScan === 'absent' ? 'absent' : 'leave';
        row.why = 'no scan';
      }
      out.push(row);
    });
    return out;
  }

  /* ---------------- the payslip ---------------- */

  function ledgerBetween(emp, fromK, toK) {
    return (emp.ledger || []).filter(function (x) {
      var k = x.date || (x.at ? dateKey(toDate(x.at)) : '');
      return k >= fromK && k <= toK;
    });
  }

  function payslip(emp, settings, days, cycle, today) {
    settings = settings || {};
    var monthly = Math.max(0, Number(emp.salary) || 0);
    var fromK = cycle.from, toK = cycle.to;
    var full = daysBetween(fromK, toK);

    /* Joined part-way through: owed the part they were here for. */
    var lo = emp.joinedAt && String(emp.joinedAt).slice(0, 10) > fromK
      ? String(emp.joinedAt).slice(0, 10) : fromK;
    var salary = lo > toK ? 0 : monthly * Math.min(full, daysBetween(lo, toK)) / full;

    var rows = register(emp, settings, days, fromK, toK, today);
    var tally = { present: 0, half: 0, absent: 0, leave: 0, off: 0, unmarked: 0 };
    rows.forEach(function (r) {
      if (r.status) tally[r.status]++;
      else tally.unmarked++;
    });

    function dayRate(k) {
      var d = fromKey(k);
      return monthly / daysInMonth(d.getFullYear(), d.getMonth());
    }

    var allowed = paidLeaveAllowance(emp, settings);
    var leaveDays = rows.filter(function (r) { return r.status === 'leave'; })
      .map(function (r) { return r.date; }).sort();
    var leavePaid = Math.min(leaveDays.length, allowed);
    var away = 0;
    leaveDays.slice(allowed).forEach(function (k) { away += dayRate(k); });
    rows.forEach(function (r) {
      if (r.status === 'absent') away += dayRate(r.date);
      else if (r.status === 'half') away += dayRate(r.date) * 0.5;
    });

    var entries = ledgerBetween(emp, fromK, toK);
    function sum(type) {
      return entries.filter(function (x) { return x.type === type; })
        .reduce(function (n, x) { return n + (Number(x.amount) || 0); }, 0);
    }
    /* A payout names the cycle it settled, because "mark paid" is
       pressed whenever it is pressed — often a day after the cycle
       turned — and counted by its own date it would eat next month. */
    var paid = 0, settled = false;
    (emp.ledger || []).forEach(function (x) {
      if (x.type !== 'payout') return;
      var mine = x.period ? x.period === fromK
        : (function () { var k = x.date || dateKey(toDate(x.at)); return k >= fromK && k <= toK; })();
      if (!mine) return;
      paid += Number(x.amount) || 0;
      settled = true;
    });

    salary = Math.round(salary);
    var bonus = Math.round(sum('bonus'));
    var advances = Math.round(sum('advance'));
    var deductions = Math.round(sum('deduction'));
    var awayAmount = Math.round(away);
    paid = Math.round(paid);
    var gross = salary + bonus;

    return {
      cycle: cycle,
      monthly: monthly,
      salary: salary,
      bonus: bonus,
      gross: gross,
      advances: advances,
      deductions: deductions,
      absentDeduction: awayAmount,
      days: tally,
      leaveAllowed: allowed,
      leavePaid: leavePaid,
      leaveDocked: leaveDays.length - leavePaid,
      paid: paid,
      settled: settled,
      net: gross - advances - deductions - awayAmount - paid,
      rows: rows,
      entries: entries
    };
  }

  var Pay = {
    STATUSES: STATUSES,
    dateKey: dateKey, toDate: toDate, hhmm: hhmm, minutesLate: minutesLate,
    statusOf: statusOf, payCycle: payCycle, register: register,
    payslip: payslip, paidLeaveAllowance: paidLeaveAllowance,
    daysBetween: daysBetween, eachDay: eachDay
  };
  root.Pay = Pay;
  if (typeof module !== 'undefined' && module.exports) module.exports = Pay;
})(typeof window !== 'undefined' ? window : globalThis);
