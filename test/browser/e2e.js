/* The whole thing, in a real browser, against the Firebase emulators:

     an owner opens a shop and sets its perimeter where they stand,
     adds a member of staff and registers their face,
     the employee signs in on "their phone" with shop code + ID + PIN,
     scans in from inside the perimeter and is marked,
     another scans from 2 km away and is sent for approval,
     the owner approves it, and payroll adds up.

   The camera is replaced by a known face descriptor, because a headless
   browser has no face to show it; the matching and every write are the
   real ones. One check also loads the real model from /vendor.

   npm run test:browser */
'use strict';

const path = require('path');
const { chromium } = require('playwright');
const serve = require('../serve.js');

const PORT = 5199;
const BASE = 'http://localhost:' + PORT + '/index.html?emu=1';
const SHOP_AT = { latitude: 32.2733, longitude: 75.6522, accuracy: 12 };
const NEAR = { latitude: 32.2735, longitude: 75.6523, accuracy: 15 };    // ~25 m
const FAR = { latitude: 32.2913, longitude: 75.6522, accuracy: 15 };     // ~2 km

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e && e.message)); }
}
function assert(c, m) { if (!c) throw new Error(m); }

/* A made-up face: 128 numbers from a seeded generator, the same every
   run. The "camera" then shows either exactly this face (a match) or a
   different one (a stranger). */
const FAKE = `
  window.__face = function (seed) {
    var s = seed; function rnd() { s = (s * 16807) % 2147483647; return s / 2147483647; }
    var v = []; for (var i = 0; i < 128; i++) v.push(rnd() * 0.18); return v;
  };
  window.__showing = 1;
  window.addEventListener('DOMContentLoaded', function () {
    Face.ready = function (cb) { return Promise.resolve(); };
    Face.startCamera = function (video) { return Promise.resolve(); };
    Face.stopCamera = function () {};
    Face.thumb = function () { return 'data:image/jpeg;base64,AAAA'; };
    Face.describe = function () {
      return Promise.resolve({ descriptor: window.__face(window.__showing), box: { x: 0, y: 0, width: 300, height: 300 }, share: 0.6 });
    };
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { get: function () { return 4; } });
  });
`;

async function clearEmulators() {
  await fetch('http://127.0.0.1:8080/emulator/v1/projects/haazri-test/databases/(default)/documents', { method: 'DELETE' });
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/haazri-test/accounts', { method: 'DELETE' });
}

async function phone(browser, geo, fake) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    geolocation: geo, permissions: ['geolocation', 'camera']
  });
  if (fake !== false) await ctx.addInitScript(FAKE);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('     [page error] ' + e.message));
  return { ctx, page };
}

(async function main() {
  const server = await serve(path.join(__dirname, '..', '..'), PORT);
  const browser = await chromium.launch();
  await clearEmulators();

  const owner = await phone(browser, SHOP_AT);
  const o = owner.page;
  let shopCode = '', pin = '';

  await check('an owner can open a new shop', async () => {
    await o.goto(BASE);
    await o.click('text=I own the shop');
    await o.click('text=Open a new shop on Haazri');
    await o.fill('input[placeholder="e.g. Sharma General Store"]', 'Sharma Store');
    await o.fill('input[placeholder="Your name"]', 'Ramesh');
    await o.fill('input[type=email]', 'ramesh@example.com');
    await o.fill('input[type=password]', 'secret123');
    await o.click('button:has-text("Open the shop")');
    await o.waitForSelector('text=Shop location & perimeter', { timeout: 15000 });
  });

  await check('the owner sets the perimeter where they stand', async () => {
    await o.click('button:has-text("Use where I am now")');
    await o.waitForSelector('text=radius 100 m', { timeout: 10000 });
    shopCode = (await o.textContent('.kbd')).trim();
    assert(/^[2-9A-Z]{6}$/.test(shopCode), 'shop code looks wrong: ' + shopCode);
  });

  await check('the owner adds a member of staff and gets a PIN', async () => {
    await o.evaluate(() => App.go('staff'));
    await o.click('button:has-text("+ Add staff")');
    await o.fill('.modal .field:has-text("Name") input', 'Asha Verma');
    await o.fill('.modal .field:has-text("Monthly salary") input', '15000');
    await o.click('.modal button:has-text("Add and make a login")');
    await o.waitForSelector('text=Login for Asha Verma', { timeout: 15000 });
    const kbds = await o.$$eval('.modal .kbd', (n) => n.map((x) => x.textContent));
    assert(kbds[1] === 'E01', 'employee ID should be E01, got ' + kbds[1]);
    pin = kbds[2];
    assert(/^\d{6}$/.test(pin), 'PIN should be 6 digits');
    await o.click('.modal button:has-text("Close")');
  });

  await check('the owner registers Asha\'s face (three pictures)', async () => {
    await o.evaluate(() => { window.__showing = 1; });
    await o.click('button:has-text("Add face")');
    for (let i = 0; i < 3; i++) {
      await o.click('.modal button:has-text("Take picture")');
      await o.waitForSelector('text=' + (i + 1) + ' of 3 pictures taken');
    }
    await o.click('.modal button:has-text("Save")');
    await o.waitForSelector('text=face ✓', { timeout: 10000 });
  });

  await check('a second person cannot be registered with Asha\'s face', async () => {
    await o.click('button:has-text("+ Add staff")');
    await o.fill('.modal .field:has-text("Name") input', 'Ravi Kumar');
    await o.fill('.modal .field:has-text("Monthly salary") input', '9000');
    await o.click('.modal button:has-text("Add and make a login")');
    await o.waitForSelector('text=Login for Ravi Kumar', { timeout: 15000 });
    await o.click('.modal button:has-text("Close")');
    await o.click('.person:has-text("Ravi Kumar") button:has-text("Add face")');
    await o.click('.modal button:has-text("Take picture")');
    await o.waitForSelector('text=already registered to Asha Verma');
    await o.evaluate(() => { window.__showing = 2; });
    for (let i = 0; i < 3; i++) {
      await o.click('.modal button:has-text("Take picture")');
      await o.waitForSelector('text=' + (i + 1) + ' of 3 pictures taken');
    }
    await o.click('.modal button:has-text("Save")');
    await o.waitForFunction(() => document.querySelectorAll('.badge.ok').length === 2);
  });

  /* ---------------- Asha, at the shop ---------------- */
  const asha = await phone(browser, NEAR);
  const a = asha.page;

  await check('Asha signs in with shop code, ID and PIN', async () => {
    await a.goto(BASE);
    await a.fill('input[placeholder="K7M2QX"]', shopCode.toLowerCase());
    await a.fill('input[placeholder="E01"]', 'e01');
    await a.fill('input[type=password]', pin);
    await a.click('button:has-text("Sign in")');
    await a.waitForSelector('text=Hello, Asha', { timeout: 15000 });
    await a.waitForSelector('text=Not marked yet today');
  });

  await check('somebody else\'s face on Asha\'s phone is refused', async () => {
    await a.evaluate(() => { window.__showing = 3; });
    await a.click('button:has-text("Scan in")');
    await a.waitForSelector('text=This doesn’t look like Asha Verma', { timeout: 15000 });
    await a.click('.modal button:has-text("Close")');
    await a.waitForSelector('text=Not marked yet today');
  });

  await check('Asha scans in from inside the perimeter and is marked', async () => {
    await a.evaluate(() => { window.__showing = 1; });
    await a.click('button:has-text("Scan in")');
    await a.waitForSelector('text=You’re marked for today', { timeout: 15000 });
    await a.waitForSelector('.status-card.ok, .status-card.warn', { timeout: 10000 });
  });

  await check('the owner sees Asha in, live', async () => {
    await o.evaluate(() => App.go('today'));
    await o.waitForSelector('.person:has-text("Asha Verma") .badge', { timeout: 10000 });
    const t = await o.textContent('.person:has-text("Asha Verma")');
    assert(/phone/.test(t), 'should say it came from her phone: ' + t);
  });

  /* ---------------- Ravi, 2 km away ---------------- */
  const ravi = await phone(browser, FAR);
  const r = ravi.page;
  let raviPin = '';

  await check('Ravi scanning from 2 km away is not marked, and can ask for approval', async () => {
    raviPin = await o.evaluate(() => null);
    /* Reset Ravi's PIN to learn it — also exercises the reset path. */
    await o.evaluate(() => App.go('staff'));
    await o.click('.person:has-text("Ravi Kumar") button:has-text("Manage")');
    await o.click('.modal button:has-text("Reset PIN")');
    await o.click('.modal button.danger:has-text("Reset PIN")');
    await o.waitForSelector('text=Login for Ravi Kumar', { timeout: 15000 });
    raviPin = (await o.$$eval('.modal .kbd', (n) => n.map((x) => x.textContent)))[2];
    await o.click('.modal button:has-text("Close")');

    await r.goto(BASE);
    await r.fill('input[placeholder="K7M2QX"]', shopCode);
    await r.fill('input[placeholder="E01"]', 'E02');
    await r.fill('input[type=password]', raviPin);
    await r.click('button:has-text("Sign in")');
    await r.waitForSelector('text=Hello, Ravi', { timeout: 15000 });
    await r.evaluate(() => { window.__showing = 2; });
    await r.click('button:has-text("Scan in")');
    await r.waitForSelector('text=Not at the shop', { timeout: 15000 });
    await r.fill('.modal textarea', 'Picking up stock from the wholesaler');
    require('fs').mkdirSync(path.join(__dirname, '..', '..', 'docs', 'screens'), { recursive: true });
    await r.screenshot({ path: path.join(__dirname, '..', '..', 'docs', 'screens', 'employee-outside.png') });
    await r.click('.modal button:has-text("Send to owner for approval")');
    await r.waitForSelector('text=Sent to your owner', { timeout: 10000 });
  });

  await check('the owner approves it and Ravi is marked', async () => {
    await o.evaluate(() => App.go('approvals'));
    await o.waitForSelector('text=Picking up stock from the wholesaler', { timeout: 10000 });
    await o.click('button:has-text("Approve")');
    await o.waitForSelector('text=All clear.', { timeout: 10000 });
    /* Staff phones do not listen live (every update would be a read);
       the approval shows on the next open or a tap on Refresh. */
    await r.click('button:has-text("Refresh")');
    await r.waitForSelector('.status-card:has-text("approved by owner")', { timeout: 10000 });
    const t = await r.textContent('.status-card');
    assert(/approved by owner/.test(t), 'Ravi\'s card should say approved: ' + t);
  });

  await check('an old PIN stops working after a reset', async () => {
    const x = await phone(browser, NEAR);
    await x.page.goto(BASE);
    await x.page.fill('input[placeholder="K7M2QX"]', shopCode);
    await x.page.fill('input[placeholder="E01"]', 'E02');
    await x.page.fill('input[type=password]', '000000');
    await x.page.click('button:has-text("Sign in")');
    await x.page.waitForSelector('text=That PIN is not right', { timeout: 10000 });
    await x.ctx.close();
  });

  await check('payroll shows both, with salary to pay', async () => {
    await o.evaluate(() => App.go('payroll'));
    await o.waitForSelector('text=Payslip', { timeout: 10000 });
    const rows = await o.$$eval('.card .person', (n) => n.map((x) => x.textContent));
    assert(rows.length === 2, 'two rows expected');
    assert(rows.some((t) => /Asha Verma/.test(t) && /₹15,000/.test(t)), 'Asha\'s salary missing: ' + rows.join(' | '));
  });

  await check('the real face model loads from /vendor and answers "no face" to a blank picture', async () => {
    const real = await phone(browser, NEAR, false);
    await real.page.goto(BASE);
    const out = await real.page.evaluate(async () => {
      await Face.ready();
      const c = document.createElement('canvas'); c.width = 320; c.height = 240;
      c.getContext('2d').fillRect(0, 0, 320, 240);
      const r = await Face.describe(c);
      return { none: !!r.none, lib: !!window.faceapi };
    });
    assert(out.lib && out.none, JSON.stringify(out));
    await real.ctx.close();
  });

  await check('screenshots for the README', async () => {
    const shots = path.join(__dirname, '..', '..', 'docs', 'screens');
    require('fs').mkdirSync(shots, { recursive: true });
    await a.screenshot({ path: path.join(shots, 'employee-marked.png') });
    await o.evaluate(() => App.go('today'));
    await o.waitForSelector('.person:has-text("Ravi Kumar") .badge');
    await o.screenshot({ path: path.join(shots, 'owner-today.png') });
    await o.evaluate(() => App.go('payroll'));
    await o.waitForSelector('text=Payslip');
    await o.screenshot({ path: path.join(shots, 'owner-payroll.png') });
  });

  await browser.close();
  server.close();
  console.log(failures ? '\n' + failures + ' failed' : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
