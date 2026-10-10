/* =============================================================
   Haazri — the data, in Firestore

   WHAT IS STORED, AND WHY IN THIS SHAPE

   Everything is shaped to stay inside Firebase's free Spark plan with a
   couple of hundred shops on one project (see docs/COST.md). Reads are
   the scarce thing — 50,000 a day — so the layout is built around
   reading as few documents as possible:

     members/{uid}                  who a login is: { shopId, role, empId }
     logins/{SHOP-EMP}              public lookup for the staff sign-in:
                                    { shopId, v } — v is bumped when the
                                    owner resets a PIN (see resetPin)
     shops/{shopId}                 name, the perimeter, the rules
     shops/{shopId}/employees/{E01} one person: salary, face, ledger
     shops/{shopId}/days/{date}     ONE document per shop per day, with
                                    everybody's record inside it under
                                    r.{E01}. The owner's whole register
                                    for a day is one read, and a month
                                    of payroll for the whole team is at
                                    most 31 — not 31 x team size.
     shops/{shopId}/requests/{id}   a scan from outside the perimeter,
                                    waiting for the owner

   A scan writes the SERVER's time (serverTimestamp), and the rules
   refuse any other. Whether it was late is worked out from that time
   when the register is drawn — see js/pay.js.
   ============================================================= */
window.Store = (function () {
  'use strict';

  var cfg = window.HAAZRI_CONFIG || {};
  var app = null, auth = null, db = null;
  var FV = null;

  var state = {
    user: null,
    member: null,
    shop: null,
    employees: [],
    me: null,
    today: null,
    pending: []
  };
  var subs = [];
  var listeners = [];

  function configured() {
    return !!(cfg.firebase && cfg.firebase.apiKey && cfg.firebase.projectId && window.firebase);
  }

  function init() {
    if (!configured() || app) return !!app;
    app = firebase.initializeApp(cfg.firebase);
    auth = firebase.auth();
    db = firebase.firestore();
    FV = firebase.firestore.FieldValue;
    if (cfg.emulator) {
      auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
      db.useEmulator('127.0.0.1', 8080);
    }
    return true;
  }

  function emit() { subs.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } }); }
  function onChange(fn) { subs.push(fn); }

  function stopListening() {
    listeners.forEach(function (u) { try { u(); } catch (e) {} });
    listeners = [];
    clearInterval(dayTimer);
  }

  function shopRef(sid) { return db.collection('shops').doc(sid || state.member.shopId); }
  function empRef(id) { return shopRef().collection('employees').doc(id); }
  function dayRef(k) { return shopRef().collection('days').doc(k); }

  function pad(n) { return String(n).padStart(2, '0'); }
  function todayKey() { return Pay.dateKey(new Date()); }

  /* Shop codes and staff codes are read out loud and typed on phones.
     No 0/O, no 1/I/L. Random, never made from the shop's name — a name
     is guessable, and a guessable code is a list of shops to knock at. */
  var ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  function code(n) {
    var out = '', buf = new Uint32Array(n);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < n; i++) out += ALPHA[buf[i] % ALPHA.length];
    return out;
  }

  function staffEmail(shopId, empId, v) {
    return (empId + '.' + shopId + '.' + (v || 1) + '@' + (cfg.staffDomain || 'staff.haazri.app')).toLowerCase();
  }

  /* ---------------- small local caches ----------------

     Reads are the scarce thing on the free plan, and most of what a
     phone reads on opening has not changed since yesterday: who this
     login is, the shop's perimeter, the employee's own face samples.
     Those are kept on the phone and read again only when stale. The
     rules still decide everything on the server — a cache that is
     wrong just gets refused, and is then thrown away. */
  function cacheGet(k) {
    try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; }
  }
  function cacheSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }
  function cacheDrop(k) {
    try { localStorage.removeItem(k); } catch (e) {}
  }
  function plain(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------------- signing in ---------------- */

  function onAuth(cb) {
    if (!init()) { cb(null); return; }
    auth.onAuthStateChanged(function (user) {
      stopListening();
      state.user = user; state.member = null; state.shop = null;
      state.employees = []; state.me = null; state.today = null; state.pending = [];
      if (!user) { cb(null); return; }
      var mkey = 'hz_m_' + user.uid;
      var cached = cacheGet(mkey);
      (cached ? Promise.resolve(cached)
        : db.collection('members').doc(user.uid).get().then(function (snap) {
          return snap.exists ? snap.data() : null;
        })
      ).then(function (member) {
        if (!member) { cb({ user: user, member: null }); return; }
        cacheSet(mkey, member);
        state.member = member;
        return startListening().then(function () { cb(state); });
      }).catch(function (e) {
        /* A remembered membership the server no longer honours — the
           owner removed this person, or reset their PIN. Forget it. */
        console.error(e);
        cacheDrop(mkey);
        cacheDrop('hz_e_' + user.uid);
        cb({ user: user, member: null, error: e });
      });
    });
  }

  function startListening() {
    stopListening();
    return state.member.role === 'owner' ? startOwner() : startEmployee();
  }

  /* ---- the employee's phone: no listeners at all ----

     A phone that opens, scans and closes has no use for a live feed of
     every colleague's arrival — each of those would be a read. It reads
     today's day document when it opens, and the shop and its own card
     from the cache unless they are more than half a day old. */
  var EMP_STALE = 12 * 3600000;

  function startEmployee(force) {
    var ckey = 'hz_e_' + state.user.uid;
    var c = cacheGet(ckey);
    var fresh = !force && c && c.me && c.shop && Date.now() - c.at < EMP_STALE;
    var cards = fresh ? Promise.resolve(c) : Promise.all([
      shopRef().get(), empRef(state.member.empId).get()
    ]).then(function (both) {
      if (!both[1].exists) throw new Error('Your employee record was not found.');
      var v = {
        shop: plain(both[0].data()),
        me: plain(Object.assign({ id: both[1].id }, both[1].data())),
        at: Date.now()
      };
      cacheSet(ckey, v);
      return v;
    });
    return Promise.all([cards, loadToday()]).then(function (r) {
      state.shop = r[0].shop;
      state.me = r[0].me;
    });
  }

  function loadToday() {
    var k = todayKey();
    return dayRef(k).get().then(function (s) {
      state.today = s.exists ? s.data() : { r: {} };
      state.todayKey = k;
    });
  }

  /* The employee pulled to refresh, came back to the app on a new day,
     or scanned from outside: read the real thing again. */
  function refresh(all) {
    if (!state.member) return Promise.resolve();
    var p = state.member.role === 'owner' ? Promise.resolve()
      : all ? startEmployee(true) : loadToday();
    return p.then(emit);
  }

  /* ---- the owner: live, but only where it pays ----

     The shop, today's register and the approvals queue are live, so a
     scan at the door appears while the owner is looking. The team is
     NOT a listener: it is read once and kept, and the shop document
     carries empRev, a counter bumped by every change to anybody's card.
     Opening the app costs a handful of reads, not one per employee. */
  var expectRev = null;
  function bumpExpect() { expectRev = (Number(state.shop && state.shop.empRev) || 0) + 1; }

  function empCacheKey() { return 'hz_emps_' + state.member.shopId; }

  function loadEmployees() {
    return shopRef().collection('employees').get().then(function (s) {
      state.employees = s.docs.map(function (d) { return plain(Object.assign({ id: d.id }, d.data())); })
        .sort(function (a, b) { return a.id < b.id ? -1 : 1; });
      cacheSet(empCacheKey(), { rev: Number(state.shop && state.shop.empRev) || 0, list: state.employees });
    });
  }

  function startOwner() {
    var first = [];
    function live(ref, apply) {
      var done;
      first.push(new Promise(function (r) { done = r; }));
      listeners.push(ref.onSnapshot(function (s) {
        var p = apply(s);
        Promise.resolve(p).then(function () {
          if (done) { done(); done = null; } else emit();
        });
      }, function (e) { console.error(e); if (done) { done(); done = null; } }));
    }

    live(shopRef(), function (s) {
      state.shop = s.exists ? s.data() : null;
      var rev = Number(state.shop && state.shop.empRev) || 0;
      var cached = cacheGet(empCacheKey());
      if (cached && cached.rev === rev) {
        if (!state.employees.length) state.employees = cached.list;
        return null;
      }
      /* Our own write, already applied here — just remember the rev. */
      if (expectRev !== null && rev === expectRev) {
        cacheSet(empCacheKey(), { rev: rev, list: state.employees });
        return null;
      }
      return loadEmployees();
    });
    watchToday(live);
    live(shopRef().collection('requests').where('status', '==', 'pending'), function (s) {
      state.pending = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); })
        .sort(function (a, b) { return (a.date + a.id) < (b.date + b.id) ? 1 : -1; });
    });
    return Promise.all(first).then(function () { setTimeout(purgeOldRequests, 5000); });
  }

  /* Today's listener is for TODAY. An owner's phone left open overnight
     must move to the new day, or every scan the next morning lands on a
     document nobody is watching. */
  var todayUnsub = null, dayTimer = null;
  function watchToday(live) {
    var k = todayKey();
    state.todayKey = k;
    var before = listeners.length;
    live(dayRef(k), function (s) { state.today = s.exists ? s.data() : { r: {} }; });
    todayUnsub = listeners[before];
    clearInterval(dayTimer);
    dayTimer = setInterval(function () {
      if (todayKey() === state.todayKey || !todayUnsub) return;
      try { todayUnsub(); } catch (e) {}
      state.todayKey = todayKey();
      state.today = { r: {} };
      todayUnsub = dayRef(state.todayKey).onSnapshot(function (s) {
        state.today = s.exists ? s.data() : { r: {} };
        emit();
      });
      listeners.push(todayUnsub);
      emit();
    }, 60000);
  }

  /* Requests keep a small picture each, and a year of them is most of
     what the free storage would hold. Anything decided more than 90
     days ago is deleted — at most a small batch a day, once a day. */
  var KEEP_REQUESTS_DAYS = 90;
  function purgeOldRequests() {
    if (!state.member || state.member.role !== 'owner') return;
    var mark = 'hz_purged_' + state.member.shopId;
    if (cacheGet(mark) === todayKey()) return;
    cacheSet(mark, todayKey());
    var cutoff = Pay.dateKey(new Date(Date.now() - KEEP_REQUESTS_DAYS * 86400000));
    shopRef().collection('requests').where('date', '<', cutoff).limit(50).get().then(function (s) {
      if (s.empty) return;
      var b = db.batch();
      s.docs.forEach(function (d) { b.delete(d.ref); });
      return b.commit();
    }).catch(function (e) { console.warn('purge', e); });
  }

  function signInOwner(email, pass) {
    init();
    return auth.signInWithEmailAndPassword(String(email).trim(), pass);
  }

  function signInEmployee(shopCode, empCode, pin) {
    init();
    var sid = String(shopCode || '').trim().toUpperCase();
    var eid = String(empCode || '').trim().toUpperCase();
    return db.collection('logins').doc(sid + '-' + eid).get().then(function (snap) {
      if (!snap.exists) throw new Error('No employee ' + eid + ' at shop ' + sid + '. Check both codes with your owner.');
      return auth.signInWithEmailAndPassword(staffEmail(sid, eid, snap.data().v), String(pin));
    }).catch(function (e) {
      if (e && /wrong-password|invalid-credential|invalid-login/.test(e.code || '')) {
        throw new Error('That PIN is not right. Ask your owner to reset it if you have forgotten it.');
      }
      throw e;
    });
  }

  function signOut() { return auth ? auth.signOut() : Promise.resolve(); }

  var DEFAULT_SETTINGS = {
    shiftStart: '10:00',
    grace: 15,
    lateIsHalf: false,
    weeklyOff: [],
    paidLeave: 2,
    noScan: 'leave',
    payDay: 1,
    allowOutside: true,
    photoEveryScan: false
  };

  /* A new shop and its owner, in one batch, so there is never a shop
     with nobody who can open it or an owner pointing at nothing. The
     rules check the shop names this login as its owner before they
     accept the member document (getAfter). */
  function createShop(data) {
    init();
    return auth.createUserWithEmailAndPassword(String(data.email).trim(), data.pass).then(function (cred) {
      var uid = cred.user.uid;
      function attempt(n) {
        var sid = code(6);
        var batch = db.batch();
        batch.set(db.collection('shops').doc(sid), {
          name: String(data.shopName).trim().slice(0, 60),
          ownerName: String(data.ownerName || '').trim().slice(0, 60),
          ownerUid: uid,
          ownerEmail: cred.user.email,
          createdAt: FV.serverTimestamp(),
          site: null,
          settings: DEFAULT_SETTINGS,
          nextEmp: 1
        });
        batch.set(db.collection('members').doc(uid), { shopId: sid, role: 'owner' });
        return batch.commit().then(function () { return sid; }).catch(function (e) {
          if (n < 3) return attempt(n + 1);     // a code already taken; draw another
          throw e;
        });
      }
      return attempt(0);
    }).then(function (sid) {
      /* onAuthStateChanged fired before the member document existed and
         found nobody. Go round again now that it does. */
      return db.collection('members').doc(auth.currentUser.uid).get().then(function (snap) {
        state.member = snap.data();
        cacheSet('hz_m_' + auth.currentUser.uid, state.member);
        return startListening();
      }).then(function () { emit(); return sid; });
    });
  }

  /* ---------------- the shop ---------------- */

  function settings() {
    return Object.assign({}, DEFAULT_SETTINGS, (state.shop && state.shop.settings) || {});
  }

  function saveSettings(patch) {
    var next = Object.assign({}, settings(), patch);
    return shopRef().update({ settings: next });
  }

  function saveSite(site) {
    return shopRef().update({
      site: site ? {
        lat: Math.round(site.lat * 1e6) / 1e6,
        lng: Math.round(site.lng * 1e6) / 1e6,
        radius: Math.max(10, Math.min(5000, Math.round(Number(site.radius) || 100))),
        label: String(site.label || '').slice(0, 80)
      } : null
    });
  }

  function saveShopName(name) {
    return shopRef().update({ name: String(name || '').trim().slice(0, 60) });
  }

  /* ---------------- employees ---------------- */

  function employees(all) {
    return state.employees.filter(function (e) { return all || e.active !== false; });
  }
  function employee(id) {
    return state.employees.filter(function (e) { return e.id === id; })[0] || null;
  }

  /* A second, private copy of Firebase just for making staff logins.
     Creating a user signs that user in on whichever copy made it, and
     doing that on the main one would throw the owner out of their own
     app in the middle of adding somebody. */
  var maker = null;
  function makerAuth() {
    if (!maker) {
      maker = firebase.initializeApp(cfg.firebase, 'staff-maker');
      if (cfg.emulator) maker.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
    }
    return maker.auth();
  }

  function makeLogin(sid, eid, v, pin) {
    var a = makerAuth();
    return a.createUserWithEmailAndPassword(staffEmail(sid, eid, v), String(pin)).then(function (cred) {
      var uid = cred.user.uid;
      return a.signOut().then(function () { return uid; });
    });
  }

  function nextCode() {
    var n = Number(state.shop && state.shop.nextEmp) || 1;
    var used = {};
    state.employees.forEach(function (e) { used[e.id] = true; });
    while (used['E' + pad(n)]) n++;
    return { id: 'E' + pad(n), n: n };
  }

  function addEmployee(data, pin) {
    var sid = state.member.shopId;
    var c = nextCode();
    return makeLogin(sid, c.id, 1, pin).then(function (uid) {
      var batch = db.batch();
      batch.set(empRef(c.id), {
        name: String(data.name).trim().slice(0, 60),
        phone: String(data.phone || '').trim().slice(0, 20),
        role: String(data.role || '').trim().slice(0, 40),
        salary: Math.max(0, Number(data.salary) || 0),
        paidLeave: data.paidLeave === '' || data.paidLeave == null ? '' : Math.max(0, Number(data.paidLeave) || 0),
        joinedAt: data.joinedAt || '',
        payDay: Math.min(31, Math.max(0, Number(data.payDay) || 0)),
        active: true,
        uid: uid,
        loginV: 1,
        face: null,
        ledger: [],
        createdAt: FV.serverTimestamp()
      });
      batch.set(db.collection('members').doc(uid), { shopId: sid, role: 'employee', empId: c.id });
      batch.set(db.collection('logins').doc(sid + '-' + c.id), { shopId: sid, v: 1 });
      batch.update(shopRef(), { nextEmp: c.n + 1, empRev: FV.increment(1) });
      bumpExpect();
      return batch.commit().then(loadEmployees).then(function () { emit(); return c.id; });
    });
  }

  /* Every change to somebody's card also bumps the shop's empRev, so
     the owner's other devices (the door kiosk) know to read the team
     again — and this one, having made the change, does not. */
  function updateEmployee(id, patch) {
    var clean = {};
    Object.keys(patch || {}).forEach(function (k) {
      if (patch[k] !== undefined) clean[k] = patch[k];
    });
    if (clean.salary !== undefined) clean.salary = Math.max(0, Number(clean.salary) || 0);
    var batch = db.batch();
    batch.update(empRef(id), clean);
    batch.update(shopRef(), { empRev: FV.increment(1) });
    bumpExpect();
    state.employees = state.employees.map(function (e) {
      return e.id === id ? Object.assign({}, e, plain(clean)) : e;
    });
    emit();
    return batch.commit().catch(function (e) {
      return loadEmployees().then(function () { emit(); throw e; });
    });
  }

  /* Firebase will not let a web page change another user's password.
     So a PIN reset is a NEW login (v+1) for the same person, and the old
     one is cut off by deleting its member document — the rules open
     nothing to a login without one. The public lookup moves to the new
     version so the sign-in screen finds it. */
  function resetPin(id, pin) {
    var e = employee(id);
    if (!e) return Promise.reject(new Error('No such employee'));
    var sid = state.member.shopId;
    var v = (Number(e.loginV) || 1) + 1;
    return makeLogin(sid, id, v, pin).then(function (uid) {
      var batch = db.batch();
      if (e.uid) batch.delete(db.collection('members').doc(e.uid));
      batch.set(db.collection('members').doc(uid), { shopId: sid, role: 'employee', empId: id });
      batch.update(empRef(id), { uid: uid, loginV: v });
      batch.set(db.collection('logins').doc(sid + '-' + id), { shopId: sid, v: v });
      batch.update(shopRef(), { empRev: FV.increment(1) });
      bumpExpect();
      return batch.commit().then(loadEmployees).then(emit);
    });
  }

  /* Somebody leaves. Their login stops opening anything at once, their
     face is dropped, and their history stays for the payroll that is
     still owed. */
  function removeEmployee(id) {
    var e = employee(id);
    if (!e) return Promise.resolve();
    var sid = state.member.shopId;
    var batch = db.batch();
    if (e.uid) batch.delete(db.collection('members').doc(e.uid));
    batch.delete(db.collection('logins').doc(sid + '-' + id));
    batch.update(empRef(id), { active: false, face: null, uid: '' });
    batch.update(shopRef(), { empRev: FV.increment(1) });
    bumpExpect();
    return batch.commit().then(loadEmployees).then(emit);
  }

  /* 128 numbers per picture, rounded to 4 places — enough to match on,
     and a third the size. Wrapped in objects because Firestore will not
     store an array inside an array. */
  function setFace(id, samples) {
    var list = (samples || []).filter(function (d) { return d && d.length === 128; });
    return updateEmployee(id, {
      face: {
        samples: list.map(function (d) {
          return { v: Array.prototype.map.call(d, function (x) { return Math.round(x * 10000) / 10000; }) };
        }),
        at: new Date().toISOString()
      }
    });
  }

  function faceSamples(e) {
    var raw = (e && e.face && e.face.samples) || [];
    return raw.map(function (s) { return (s && s.v) ? s.v : s; })
      .filter(function (v) { return v && v.length === 128; });
  }
  function hasFace(e) { return faceSamples(e).length > 0; }
  function clearFace(id) { return updateEmployee(id, { face: null }); }

  function faceRoster() {
    return employees().filter(hasFace).map(function (e) {
      return { id: e.id, name: e.name, samples: faceSamples(e) };
    });
  }

  /* ---------------- the staff ledger ---------------- */

  function addLedger(id, entry) {
    var e = employee(id);
    if (!e) return Promise.reject(new Error('No such employee'));
    var n = Math.round(Number(entry.amount) || 0);
    if (n < 0 || (n === 0 && entry.type !== 'payout')) return Promise.reject(new Error('How much?'));
    var row = {
      id: 'L' + Date.now().toString(36) + code(3),
      type: entry.type,
      amount: n,
      note: String(entry.note || '').slice(0, 120),
      date: entry.date || todayKey(),
      at: new Date().toISOString()
    };
    if (entry.period) row.period = entry.period;
    return updateEmployee(id, { ledger: (e.ledger || []).concat([row]) });
  }

  function removeLedger(id, entryId) {
    var e = employee(id);
    if (!e) return Promise.resolve();
    return updateEmployee(id, {
      ledger: (e.ledger || []).filter(function (x) { return x.id !== entryId; })
    });
  }

  /* ---------------- days ---------------- */

  /* Past days barely change, so a range once read is kept for the
     session. Today is always live from the listener. */
  var dayCache = {};

  function days(fromK, toK, fresh) {
    var want = [];
    Pay.eachDay(fromK, toK, function (k) {
      if (k > todayKey()) return;
      if (k === todayKey() && state.today) { dayCache[k] = state.today; return; }
      if (fresh || !(k in dayCache)) want.push(k);
    });
    if (!want.length) return Promise.resolve(pick());
    /* One query for the range, not a get per day: documents that do not
       exist cost nothing, and a closed Sunday is not a read. */
    return shopRef().collection('days')
      .where(firebase.firestore.FieldPath.documentId(), '>=', want[0])
      .where(firebase.firestore.FieldPath.documentId(), '<=', want[want.length - 1])
      .get().then(function (s) {
        want.forEach(function (k) { dayCache[k] = null; });
        s.docs.forEach(function (d) { dayCache[d.id] = d.data(); });
        return pick();
      });
    function pick() {
      var out = {};
      Pay.eachDay(fromK, toK, function (k) { if (dayCache[k]) out[k] = dayCache[k]; });
      return out;
    }
  }

  function forgetDay(k) { delete dayCache[k]; }

  /* The employee's own scan. Only the fields the rules allow, and the
     time is the server's. */
  function markIn(info) {
    var e = state.member.empId;
    var rec = {
      at: FV.serverTimestamp(),
      src: 'phone',
      dist: Math.round(Number(info.dist) || 0),
      acc: Math.round(Number(info.acc) || 0),
      match: Math.round((Number(info.match) || 0) * 1000) / 1000
    };
    /* Only when the owner has asked for a picture of every scan. Off by
       default: at a few kilobytes a scan it is most of what the free
       storage would be spent on — see docs/COST.md. */
    if (info.photo) rec.photo = info.photo;
    var r = {}; r[e] = rec;
    return dayRef(todayKey()).set({ r: r }, { merge: true }).then(function () {
      /* Shown from what was written rather than read back — a read per
         scan is 3,000 reads a day across 200 shops. The next open shows
         the server's own time. */
      state.today = state.today || { r: {} };
      state.today.r = Object.assign({}, state.today.r);
      state.today.r[e] = Object.assign({}, rec, { at: new Date() });
      emit();
    });
  }

  function markOut(info) {
    var e = state.member.empId;
    var patch = {};
    patch['r.' + e + '.out'] = FV.serverTimestamp();
    patch['r.' + e + '.outDist'] = Math.round(Number(info.dist) || 0);
    return dayRef(todayKey()).update(patch).then(function () {
      var rec = state.today && state.today.r && state.today.r[e];
      if (rec) { rec.out = new Date(); rec.outDist = patch['r.' + e + '.outDist']; }
      emit();
    });
  }

  /* The kiosk: the owner's own device at the door. No location needed —
     the device lives in the shop. */
  function kioskMark(empId, match) {
    var r = {};
    r[empId] = { at: FV.serverTimestamp(), src: 'kiosk', match: Math.round((Number(match) || 0) * 1000) / 1000 };
    return dayRef(todayKey()).set({ r: r }, { merge: true });
  }

  function kioskOut(empId) {
    var patch = {};
    patch['r.' + empId + '.out'] = FV.serverTimestamp();
    return dayRef(todayKey()).update(patch);
  }

  /* The owner saying what a day was. Any change to a day that already
     had an answer is kept with who and when, the last twenty. */
  function setStatus(empId, k, status) {
    var doc = k === todayKey() ? state.today : dayCache[k];
    var old = doc && doc.r && doc.r[empId];
    var oldStatus = old ? Pay.statusOf(old, settings()) : null;
    var rec = Object.assign({}, old || { src: 'manual' }, { status: status });
    if (!old || !old.at) rec.at = FV.serverTimestamp();
    if (oldStatus && oldStatus !== status) {
      rec.history = ((old && old.history) || []).concat([{
        at: new Date().toISOString(), from: oldStatus, to: status,
        by: (state.user && state.user.email) || ''
      }]).slice(-20);
    }
    var r = {}; r[empId] = rec;
    forgetDay(k);
    return dayRef(k).set({ r: r }, { merge: true });
  }

  function clearDay(empId, k) {
    var patch = {};
    patch['r.' + empId] = FV.delete();
    forgetDay(k);
    return dayRef(k).update(patch);
  }

  /* ---------------- scans from outside ---------------- */

  function sendRequest(info) {
    var m = state.member;
    return shopRef().collection('requests').add({
      empId: m.empId,
      name: (state.me && state.me.name) || m.empId,
      date: todayKey(),
      kind: info.kind === 'out' ? 'out' : 'in',
      at: FV.serverTimestamp(),
      lat: Math.round(info.lat * 1e5) / 1e5,
      lng: Math.round(info.lng * 1e5) / 1e5,
      acc: Math.round(Number(info.acc) || 0),
      dist: Math.round(Number(info.dist) || 0),
      match: Math.round((Number(info.match) || 0) * 1000) / 1000,
      reason: String(info.reason || '').slice(0, 200),
      photo: info.photo || '',
      status: 'pending'
    });
  }

  function myRequests(limit) {
    return shopRef().collection('requests')
      .where('empId', '==', state.member.empId)
      .orderBy('at', 'desc').limit(limit || 10).get()
      .then(function (s) { return s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); });
  }

  /* Approving writes the day as a scan at the moment the request was
     sent, so the late rule judges it exactly as it would have judged a
     scan inside the shop. The request keeps its picture as the record
     of why. */
  function decide(req, approve, note) {
    var batch = db.batch();
    var reqRef = shopRef().collection('requests').doc(req.id);
    batch.update(reqRef, {
      status: approve ? 'approved' : 'rejected',
      decidedAt: FV.serverTimestamp(),
      note: String(note || '').slice(0, 200)
    });
    if (approve) {
      var dref = dayRef(req.date);
      if (req.kind === 'out') {
        var patch = {};
        patch['r.' + req.empId + '.out'] = req.at;
        patch['r.' + req.empId + '.outDist'] = req.dist || 0;
        batch.set(dref, { r: {} }, { merge: true });
        batch.update(dref, patch);
      } else {
        var r = {};
        r[req.empId] = { at: req.at, src: 'approved', dist: req.dist || 0, req: req.id };
        batch.set(dref, { r: r }, { merge: true });
      }
      forgetDay(req.date);
    }
    return batch.commit();
  }

  function recentRequests(limit) {
    return shopRef().collection('requests').orderBy('at', 'desc').limit(limit || 30).get()
      .then(function (s) { return s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); });
  }

  return {
    configured: configured, init: init, onChange: onChange, onAuth: onAuth, refresh: refresh,
    state: state, settings: settings, todayKey: todayKey,
    signInOwner: signInOwner, signInEmployee: signInEmployee, signOut: signOut,
    createShop: createShop, saveSettings: saveSettings, saveSite: saveSite, saveShopName: saveShopName,
    employees: employees, employee: employee, addEmployee: addEmployee, updateEmployee: updateEmployee,
    resetPin: resetPin, removeEmployee: removeEmployee,
    setFace: setFace, clearFace: clearFace, hasFace: hasFace, faceSamples: faceSamples, faceRoster: faceRoster,
    addLedger: addLedger, removeLedger: removeLedger,
    days: days, markIn: markIn, markOut: markOut, kioskMark: kioskMark, kioskOut: kioskOut,
    setStatus: setStatus, clearDay: clearDay,
    sendRequest: sendRequest, myRequests: myRequests, decide: decide, recentRequests: recentRequests,
    staffEmail: staffEmail
  };
})();
