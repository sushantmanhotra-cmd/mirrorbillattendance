/* Every door in firestore.rules, tried from the right side and the wrong
   one. Runs against the Firestore emulator: npm run test:rules */
'use strict';

const { test, before, after, beforeEach } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
  initializeTestEnvironment, assertSucceeds, assertFails
} = require('@firebase/rules-unit-testing');
const {
  doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp,
  collection, query, where, getDocs, Timestamp, deleteField
} = require('firebase/firestore');

let env;

const SHOP = 'K7M2QX';
const OTHER = 'P9R4TW';

function pad(n) { return String(n).padStart(2, '0'); }
function utcKey(d) {
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}
const TODAY = utcKey(new Date());
const LAST_WEEK = utcKey(new Date(Date.now() - 7 * 86400000));

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'haazri-test',
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8'),
      host: '127.0.0.1', port: 8080
    }
  });
});
after(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [sid, owner] of [[SHOP, 'owner1'], [OTHER, 'owner2']]) {
      await setDoc(doc(db, 'shops', sid), {
        name: sid, ownerName: '', ownerUid: owner, ownerEmail: owner + '@x.in',
        createdAt: Timestamp.now(), nextEmp: 2,
        site: { lat: 32.27, lng: 75.65, radius: 100, label: '' },
        settings: { allowOutside: true }
      });
      await setDoc(doc(db, 'members', owner), { shopId: sid, role: 'owner' });
    }
    await setDoc(doc(db, 'shops', SHOP, 'employees', 'E01'), { name: 'Asha', uid: 'emp1', salary: 12000, ledger: [] });
    await setDoc(doc(db, 'shops', SHOP, 'employees', 'E02'), { name: 'Ravi', uid: 'emp2', salary: 9000, ledger: [] });
    await setDoc(doc(db, 'members', 'emp1'), { shopId: SHOP, role: 'employee', empId: 'E01' });
    await setDoc(doc(db, 'members', 'emp2'), { shopId: SHOP, role: 'employee', empId: 'E02' });
    await setDoc(doc(db, 'shops', OTHER, 'employees', 'E01'), { name: 'Other', uid: 'emp9' });
    await setDoc(doc(db, 'members', 'emp9'), { shopId: OTHER, role: 'employee', empId: 'E01' });
  });
});

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const scan = (extra) => Object.assign({ at: serverTimestamp(), src: 'phone', dist: 40, acc: 12, match: 0.21 }, extra || {});

/* ---------------- founding a shop ---------------- */

test('a new login can found a new shop and become its owner', async () => {
  const db = as('newbie');
  const b = writeBatch(db);
  b.set(doc(db, 'shops', 'ABCDEF'), {
    name: 'New', ownerName: 'N', ownerUid: 'newbie', ownerEmail: 'n@x.in',
    createdAt: serverTimestamp(), site: null, settings: {}, nextEmp: 1
  });
  b.set(doc(db, 'members', 'newbie'), { shopId: 'ABCDEF', role: 'owner' });
  await assertSucceeds(b.commit());
});

test('nobody can make themselves owner of an existing shop', async () => {
  const db = as('stranger');
  await assertFails(setDoc(doc(db, 'members', 'stranger'), { shopId: SHOP, role: 'owner' }));
  const b = writeBatch(db);
  b.set(doc(db, 'members', 'stranger'), { shopId: SHOP, role: 'owner' });
  b.update(doc(db, 'shops', SHOP), { ownerUid: 'stranger' });
  await assertFails(b.commit());
});

test('nobody can make themselves an employee', async () => {
  await assertFails(setDoc(doc(as('stranger'), 'members', 'stranger'),
    { shopId: SHOP, role: 'employee', empId: 'E01' }));
});

test('an owner already running a shop cannot found a second', async () => {
  const db = as('owner1');
  await assertFails(setDoc(doc(db, 'shops', 'ZZZZZZ'), {
    name: 'Two', ownerName: '', ownerUid: 'owner1', ownerEmail: 'o@x.in',
    createdAt: serverTimestamp(), site: null, settings: {}, nextEmp: 1
  }));
});

/* ---------------- adding staff ---------------- */

test('an owner can add an employee login tied to the employee record', async () => {
  const db = as('owner1');
  const b = writeBatch(db);
  b.set(doc(db, 'shops', SHOP, 'employees', 'E03'), { name: 'New', uid: 'emp3' });
  b.set(doc(db, 'members', 'emp3'), { shopId: SHOP, role: 'employee', empId: 'E03' });
  b.set(doc(db, 'logins', SHOP + '-E03'), { shopId: SHOP, v: 1 });
  await assertSucceeds(b.commit());
});

test('an owner cannot add a member to another shop, or as owner', async () => {
  const db = as('owner1');
  await assertFails(setDoc(doc(db, 'members', 'x1'), { shopId: OTHER, role: 'employee', empId: 'E01' }));
  await assertFails(setDoc(doc(db, 'members', 'x2'), { shopId: SHOP, role: 'owner' }));
  /* a member doc whose employee record points at somebody else */
  await assertFails(setDoc(doc(db, 'members', 'x3'), { shopId: SHOP, role: 'employee', empId: 'E01' }));
});

test('an owner cannot overwrite somebody else\'s membership', async () => {
  const db = as('owner1');
  const b = writeBatch(db);
  b.set(doc(db, 'shops', SHOP, 'employees', 'E09'), { name: 'Hijack', uid: 'owner2' });
  b.set(doc(db, 'members', 'owner2'), { shopId: SHOP, role: 'employee', empId: 'E09' });
  await assertFails(b.commit());
});

test('an owner cannot write another shop\'s sign-in lookup', async () => {
  await assertFails(setDoc(doc(as('owner1'), 'logins', OTHER + '-E01'), { shopId: SHOP, v: 2 }));
  await assertFails(setDoc(doc(as('owner1'), 'logins', OTHER + '-E01'), { shopId: OTHER, v: 2 }));
});

test('the sign-in lookup can be read by anybody but never listed', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'logins', SHOP + '-E01'), { shopId: SHOP, v: 1 });
  });
  await assertSucceeds(getDoc(doc(anon(), 'logins', SHOP + '-E01')));
  await assertFails(getDocs(collection(anon(), 'logins')));
});

/* ---------------- isolation ---------------- */

test('shops cannot see each other', async () => {
  await assertFails(getDoc(doc(as('owner1'), 'shops', OTHER)));
  await assertFails(getDocs(collection(as('owner1'), 'shops', OTHER, 'employees')));
  await assertFails(getDoc(doc(as('emp9'), 'shops', SHOP)));
  await assertFails(getDoc(doc(as('emp9'), 'shops', SHOP, 'days', TODAY)));
});

test('an employee reads their own card and nobody else\'s, and writes none', async () => {
  await assertSucceeds(getDoc(doc(as('emp1'), 'shops', SHOP, 'employees', 'E01')));
  await assertFails(getDoc(doc(as('emp1'), 'shops', SHOP, 'employees', 'E02')));
  await assertFails(getDocs(collection(as('emp1'), 'shops', SHOP, 'employees')));
  await assertFails(updateDoc(doc(as('emp1'), 'shops', SHOP, 'employees', 'E01'), { face: null }));
  await assertFails(updateDoc(doc(as('emp1'), 'shops', SHOP), { name: 'mine' }));
});

/* ---------------- scanning in ---------------- */

test('an employee inside the perimeter can mark today, once', async () => {
  const db = as('emp1');
  const ref = doc(db, 'shops', SHOP, 'days', TODAY);
  await assertSucceeds(setDoc(ref, { r: { E01: scan() } }, { merge: true }));
  /* a second scan-in may not replace the first */
  await assertFails(setDoc(ref, { r: { E01: scan() } }, { merge: true }));
});

test('a second employee can add themselves to a day already begun', async () => {
  await assertSucceeds(setDoc(doc(as('emp1'), 'shops', SHOP, 'days', TODAY), { r: { E01: scan() } }, { merge: true }));
  await assertSucceeds(setDoc(doc(as('emp2'), 'shops', SHOP, 'days', TODAY), { r: { E02: scan() } }, { merge: true }));
});

test('an employee cannot choose their own time', async () => {
  const early = Timestamp.fromDate(new Date(Date.now() - 3 * 3600000));
  await assertFails(setDoc(doc(as('emp1'), 'shops', SHOP, 'days', TODAY),
    { r: { E01: scan({ at: early }) } }, { merge: true }));
});

test('an employee cannot mark a colleague, or give themselves a status', async () => {
  await assertFails(setDoc(doc(as('emp1'), 'shops', SHOP, 'days', TODAY),
    { r: { E02: scan() } }, { merge: true }));
  await assertFails(setDoc(doc(as('emp1'), 'shops', SHOP, 'days', TODAY),
    { r: { E01: scan({ status: 'present' }) } }, { merge: true }));
  await assertFails(setDoc(doc(as('emp1'), 'shops', SHOP, 'days', TODAY),
    { r: { E01: scan({ src: 'kiosk' }) } }, { merge: true }));
});

test('an employee cannot backfill last week', async () => {
  await assertFails(setDoc(doc(as('emp1'), 'shops', SHOP, 'days', LAST_WEEK),
    { r: { E01: scan() } }, { merge: true }));
});

test('an employee cannot remove or change a colleague\'s scan', async () => {
  await assertSucceeds(setDoc(doc(as('emp2'), 'shops', SHOP, 'days', TODAY), { r: { E02: scan() } }, { merge: true }));
  const ref = doc(as('emp1'), 'shops', SHOP, 'days', TODAY);
  await assertFails(updateDoc(ref, { 'r.E02': deleteField() }));
  await assertFails(updateDoc(ref, { 'r.E02.dist': 1 }));
});

test('scanning out adds the leaving time once, and nothing else', async () => {
  const ref = doc(as('emp1'), 'shops', SHOP, 'days', TODAY);
  await assertSucceeds(setDoc(ref, { r: { E01: scan() } }, { merge: true }));
  await assertFails(updateDoc(ref, { 'r.E01.out': serverTimestamp(), 'r.E01.outDist': 30, 'r.E01.dist': 0 }));
  await assertFails(updateDoc(ref, { 'r.E01.out': Timestamp.now(), 'r.E01.outDist': 30 }));
  await assertSucceeds(updateDoc(ref, { 'r.E01.out': serverTimestamp(), 'r.E01.outDist': 30 }));
  await assertFails(updateDoc(ref, { 'r.E01.out': serverTimestamp(), 'r.E01.outDist': 30 }));
});

test('the owner can mark, change and clear any day', async () => {
  const ref = doc(as('owner1'), 'shops', SHOP, 'days', LAST_WEEK);
  await assertSucceeds(setDoc(ref, { r: { E01: { status: 'absent', src: 'manual' } } }, { merge: true }));
  await assertSucceeds(updateDoc(ref, { 'r.E01': deleteField() }));
});

/* ---------------- requests from outside ---------------- */

function request(extra) {
  return Object.assign({
    empId: 'E01', name: 'Asha', date: TODAY, kind: 'in', at: serverTimestamp(),
    lat: 32.3, lng: 75.7, acc: 20, dist: 850, match: 0.22,
    reason: 'At the bank for the shop', photo: 'data:image/jpeg;base64,xx', status: 'pending'
  }, extra || {});
}

test('an employee can send their own request, and not somebody else\'s', async () => {
  const col = collection(as('emp1'), 'shops', SHOP, 'requests');
  await assertSucceeds(setDoc(doc(col, 'r1'), request()));
  await assertFails(setDoc(doc(col, 'r2'), request({ empId: 'E02' })));
  await assertFails(setDoc(doc(col, 'r3'), request({ status: 'approved' })));
  await assertFails(setDoc(doc(col, 'r4'), request({ at: Timestamp.now() })));
});

test('an employee sees only their own requests and cannot approve them', async () => {
  await assertSucceeds(setDoc(doc(as('emp1'), 'shops', SHOP, 'requests', 'r1'), request()));
  await assertSucceeds(getDocs(query(collection(as('emp1'), 'shops', SHOP, 'requests'), where('empId', '==', 'E01'))));
  await assertFails(getDocs(collection(as('emp2'), 'shops', SHOP, 'requests')));
  await assertFails(getDoc(doc(as('emp2'), 'shops', SHOP, 'requests', 'r1')));
  await assertFails(updateDoc(doc(as('emp1'), 'shops', SHOP, 'requests', 'r1'), { status: 'approved' }));
});

test('the owner approves; the request itself cannot be rewritten', async () => {
  await assertSucceeds(setDoc(doc(as('emp1'), 'shops', SHOP, 'requests', 'r1'), request()));
  const ref = doc(as('owner1'), 'shops', SHOP, 'requests', 'r1');
  await assertFails(updateDoc(ref, { dist: 10 }));
  await assertSucceeds(updateDoc(ref, { status: 'approved', decidedAt: serverTimestamp(), note: '' }));
  await assertFails(updateDoc(doc(as('owner2'), 'shops', SHOP, 'requests', 'r1'), { status: 'rejected' }));
});

test('requests are refused when the shop has switched them off', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), 'shops', SHOP), { 'settings.allowOutside': false });
  });
  await assertFails(setDoc(doc(as('emp1'), 'shops', SHOP, 'requests', 'r1'), request()));
});

test('a removed employee opens nothing', async () => {
  await assertSucceeds(deleteDoc(doc(as('owner1'), 'members', 'emp1')));
  await assertFails(getDoc(doc(as('emp1'), 'shops', SHOP)));
  await assertFails(setDoc(doc(as('emp1'), 'shops', SHOP, 'days', TODAY), { r: { E01: scan() } }, { merge: true }));
});

test('an owner cannot remove another shop\'s staff or owner', async () => {
  await assertFails(deleteDoc(doc(as('owner1'), 'members', 'emp9')));
  await assertFails(deleteDoc(doc(as('owner1'), 'members', 'owner2')));
});
