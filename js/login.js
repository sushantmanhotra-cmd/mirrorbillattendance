/* =============================================================
   Haazri — signing in

   Two doors on one card.

   STAFF sign in with three short things the owner gives them: the
   shop code, their employee ID and a 6-digit PIN. No email, no
   password to forget, nothing to verify — most people working a
   shop counter do not use an email address for anything.

   OWNERS sign in with an email and password, or open a new shop.
   ============================================================= */
window.Login = (function () {
  'use strict';

  var el = UI.el;
  var mode = 'staff';       // staff | owner | create
  var working = false;
  var host = null;

  function busy() { return working; }

  function remembered() {
    try { return JSON.parse(localStorage.getItem('hz_staff') || '{}'); } catch (e) { return {}; }
  }
  function remember(v) {
    try { localStorage.setItem('hz_staff', JSON.stringify(v)); } catch (e) {}
  }

  function field(label, input, hint) {
    return el('label', { class: 'field' }, [
      el('span', { class: 'field-label', text: label }), input,
      hint ? el('span', { class: 'field-hint', text: hint }) : null
    ]);
  }

  function show(root) {
    host = root || host;
    UI.clear(host);
    var err = el('p', { class: 'login-err' });
    function fail(e) {
      working = false;
      var msg = (e && e.message) || String(e);
      if (/email-already-in-use/.test(msg)) msg = 'That email already has an account. Sign in instead.';
      else if (/weak-password/.test(msg)) msg = 'Use a password of at least 6 characters.';
      else if (/invalid-email/.test(msg)) msg = 'That email address does not look right.';
      else if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(msg)) msg = 'Email or password is not right.';
      else if (/network/.test(msg)) msg = 'No internet connection. Try again when you are online.';
      err.textContent = msg;
      UI.$$('button', host).forEach(function (b) { b.disabled = false; });
    }
    function lock() {
      working = true;
      err.textContent = '';
      UI.$$('button', host).forEach(function (b) { b.disabled = true; });
    }

    var body;
    if (mode === 'staff') {
      var mem = remembered();
      var shop = el('input', { class: 'input code-input', maxlength: '6', autocomplete: 'off', placeholder: 'K7M2QX', value: mem.shop || '' });
      var emp = el('input', { class: 'input code-input', maxlength: '5', autocomplete: 'username', placeholder: 'E01', value: mem.emp || '' });
      var pin = el('input', { class: 'input pin-input', type: 'password', inputmode: 'numeric', maxlength: '6', autocomplete: 'current-password', placeholder: '••••••' });
      body = el('form', {
        onsubmit: function (e) {
          e.preventDefault();
          if (!shop.value.trim() || !emp.value.trim() || pin.value.length !== 6) {
            err.textContent = 'Fill in the shop code, your ID and your 6-digit PIN.';
            return;
          }
          lock();
          remember({ shop: shop.value.trim().toUpperCase(), emp: emp.value.trim().toUpperCase() });
          Store.signInEmployee(shop.value, emp.value, pin.value).then(function () { working = false; }).catch(fail);
        }
      }, [
        el('h2', { text: 'Staff sign in' }),
        el('p', { class: 'muted small', text: 'Your owner gives you these three.' }),
        el('div', { style: 'height:10px' }),
        field('Shop code', shop),
        field('Employee ID', emp),
        field('PIN', pin),
        err,
        el('button', { class: 'btn primary big block', type: 'submit', text: 'Sign in' })
      ]);
    } else if (mode === 'owner') {
      var email = el('input', { class: 'input', type: 'email', autocomplete: 'email', placeholder: 'you@example.com' });
      var pass = el('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
      body = el('form', {
        onsubmit: function (e) {
          e.preventDefault();
          lock();
          Store.signInOwner(email.value, pass.value).then(function () { working = false; }).catch(fail);
        }
      }, [
        el('h2', { text: 'Owner sign in' }),
        el('div', { style: 'height:10px' }),
        field('Email', email),
        field('Password', pass),
        err,
        el('button', { class: 'btn primary big block', type: 'submit', text: 'Sign in' }),
        el('p', { class: 'center small', style: 'margin-top:14px' }, [
          el('button', { class: 'link-btn', type: 'button', text: 'Open a new shop on Haazri', onclick: function () { mode = 'create'; show(); } })
        ])
      ]);
    } else {
      var shopName = el('input', { class: 'input', placeholder: 'e.g. Sharma General Store', maxlength: '60' });
      var owner = el('input', { class: 'input', placeholder: 'Your name', maxlength: '60' });
      var em = el('input', { class: 'input', type: 'email', autocomplete: 'email' });
      var pw = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
      body = el('form', {
        onsubmit: function (e) {
          e.preventDefault();
          if (!shopName.value.trim()) { err.textContent = 'What is the shop called?'; return; }
          if (pw.value.length < 6) { err.textContent = 'Use a password of at least 6 characters.'; return; }
          lock();
          Store.createShop({ shopName: shopName.value, ownerName: owner.value, email: em.value, pass: pw.value })
            .then(function () {
              working = false;
              UI.toast('Shop opened. Next: set its location.');
              App.go('settings');
            }).catch(fail);
        }
      }, [
        el('h2', { text: 'Open a new shop' }),
        el('p', { class: 'muted small', text: 'You will be the owner. Add your staff after this.' }),
        el('div', { style: 'height:10px' }),
        field('Shop name', shopName),
        field('Your name', owner),
        field('Email', em, 'You sign in with this. Staff never need one.'),
        field('Password', pw),
        err,
        el('button', { class: 'btn primary big block', type: 'submit', text: 'Open the shop' }),
        el('p', { class: 'center small', style: 'margin-top:14px' }, [
          el('button', { class: 'link-btn', type: 'button', text: 'I already have a shop — sign in', onclick: function () { mode = 'owner'; show(); } })
        ])
      ]);
    }

    host.appendChild(el('div', { class: 'login-wrap' }, [
      el('div', { class: 'login-card' }, [
        App.brand(),
        el('div', { class: 'login-tabs' }, [
          el('button', { class: mode === 'staff' ? 'on' : '', text: 'I work here', onclick: function () { mode = 'staff'; show(); } }),
          el('button', { class: mode !== 'staff' ? 'on' : '', text: 'I own the shop', onclick: function () { mode = 'owner'; show(); } })
        ]),
        body
      ])
    ]));
  }

  return { show: show, busy: busy };
})();
