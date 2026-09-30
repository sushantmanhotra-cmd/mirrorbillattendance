/* =============================================================
   Haazri — the shell

   One page, two apps. Who signs in decides which:

     an EMPLOYEE gets one screen — their day, and a button to scan in;
     the OWNER gets the shop — today, approvals, staff, the register,
     payroll, the door kiosk and the settings.
   ============================================================= */
window.App = (function () {
  'use strict';

  var el = UI.el;
  var rootEl = document.getElementById('root');
  var current = null;
  var screenEl = null;
  var mounted = null;

  var ICONS = {
    today: '<path d="M4 5h16v15H4z"/><path d="M4 9h16M9 3v4M15 3v4"/>',
    approvals: '<path d="M5 12l4 4 10-10"/><path d="M4 20h16"/>',
    staff: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.6 3-5.5 6-5.5s5.4 1.9 6 5.5"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 14.5c2.4.2 4 1.8 4.5 4.5"/>',
    register: '<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    payroll: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9v.01M18 15v.01"/>',
    kiosk: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><circle cx="12" cy="10" r="3"/><path d="M9 16.5h6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'
  };
  function icon(name) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', '20'); s.setAttribute('height', '20');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.innerHTML = ICONS[name] || '';
    return s;
  }

  var OWNER_SCREENS = [
    { id: 'today', label: 'Today', mod: function () { return window.OwnerToday; } },
    { id: 'approvals', label: 'Approvals', mod: function () { return window.OwnerApprovals; } },
    { id: 'staff', label: 'Staff', mod: function () { return window.OwnerStaff; } },
    { id: 'register', label: 'Register', mod: function () { return window.OwnerRegister; } },
    { id: 'payroll', label: 'Payroll', mod: function () { return window.OwnerPayroll; } },
    { id: 'kiosk', label: 'Door kiosk', mod: function () { return window.OwnerKiosk; } },
    { id: 'settings', label: 'Settings', mod: function () { return window.OwnerSettings; } }
  ];
  var PHONE_TABS = ['today', 'approvals', 'staff', 'register', 'payroll'];

  function brand(shopName) {
    return el('div', { class: 'brand' }, [
      el('div', { class: 'brand-mark', text: 'H' }),
      el('div', {}, [
        el('div', { class: 'brand-name', text: 'Haazri' }),
        shopName ? el('div', { class: 'brand-shop', text: shopName }) : null
      ])
    ]);
  }

  function pendingCount() { return Store.state.pending.length; }

  function go(id) {
    if (mounted && mounted.unmount) { try { mounted.unmount(); } catch (e) {} }
    current = id;
    try { sessionStorage.setItem('hz_screen', id); } catch (e) {}
    drawOwner();
  }

  function drawOwner() {
    var st = Store.state;
    var shopName = st.shop && st.shop.name;
    UI.clear(rootEl);
    var count = pendingCount();

    var side = el('aside', { class: 'sidebar' }, [
      brand(shopName),
      el('nav', { class: 'nav' }, OWNER_SCREENS.map(function (s) {
        return el('button', {
          class: 'nav-item' + (s.id === current ? ' active' : ''),
          onclick: function () { go(s.id); }
        }, [icon(s.id), el('span', { text: s.label }),
          s.id === 'approvals' && count ? el('span', { class: 'count', text: String(count) }) : null]);
      })),
      el('div', { class: 'side-foot' }, [
        el('div', { class: 'who-chip' }, [el('strong', { text: 'Owner' }), document.createTextNode(st.user ? st.user.email : '')]),
        el('button', { class: 'sign-out', text: 'Sign out', onclick: signOut })
      ])
    ]);

    var top = el('header', { class: 'topbar' }, [
      brand(shopName),
      el('div', { class: 'btn-row' }, [
        el('button', { text: 'Kiosk', onclick: function () { go('kiosk'); } }),
        el('button', { text: 'More', onclick: moreMenu })
      ])
    ]);

    var tabs = el('nav', { class: 'tabbar' }, PHONE_TABS.map(function (id) {
      var s = OWNER_SCREENS.filter(function (x) { return x.id === id; })[0];
      return el('button', {
        class: 'tab' + (id === current ? ' active' : ''),
        onclick: function () { go(id); }
      }, [el('span', { class: 'ti' }, [icon(id)]), el('span', { text: s.label }),
        id === 'approvals' && count ? el('span', { class: 'count', text: String(count) }) : null]);
    }));

    screenEl = el('section', { id: 'screen' });
    rootEl.appendChild(el('div', { class: 'app' }, [
      side,
      el('main', { class: 'main' }, [top, screenEl])
    ]));
    rootEl.appendChild(tabs);

    var s = OWNER_SCREENS.filter(function (x) { return x.id === current; })[0] || OWNER_SCREENS[0];
    mounted = s.mod();
    if (mounted) mounted.mount(screenEl);
  }

  function moreMenu() {
    var m = UI.modal('More', el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost block', text: 'Door kiosk', onclick: function () { m.close(); go('kiosk'); } }),
      el('button', { class: 'btn ghost block', text: 'Settings & perimeter', onclick: function () { m.close(); go('settings'); } }),
      el('button', { class: 'btn danger-ghost block', text: 'Sign out', onclick: function () { m.close(); signOut(); } })
    ]), []);
  }

  function signOut() {
    if (mounted && mounted.unmount) { try { mounted.unmount(); } catch (e) {} }
    mounted = null;
    Store.signOut();
  }

  /* Data changed: redraw whatever is showing, the cheap way. The nav
     counts update too, so a new approval shows up on the tab at once. */
  function refresh() {
    var role = Store.state.member && Store.state.member.role;
    if (role === 'owner') {
      if (!screenEl || !screenEl.isConnected) return;
      var count = pendingCount();
      UI.$$('.nav-item .count, .tab .count').forEach(function (n) { n.parentNode.removeChild(n); });
      if (count) {
        UI.$$('.nav-item, .tab').forEach(function (b) {
          if (b.textContent.indexOf('Approvals') >= 0) b.appendChild(el('span', { class: 'count', text: String(count) }));
        });
      }
      if (mounted && mounted.render) mounted.render();
    } else if (role === 'employee' && window.Employee) {
      Employee.render();
    }
  }

  var started = false;
  function start() {
    if (started) return;
    started = true;
    if (!Store.configured()) {
      UI.clear(rootEl);
      rootEl.appendChild(el('div', { class: 'login-wrap' }, [
        el('div', { class: 'login-card' }, [
          brand(),
          el('h2', { text: 'Not connected yet' }),
          el('p', { class: 'modal-msg', text: 'This copy of Haazri has no Firebase project set. Paste your ' +
            'project\'s web config into js/config.js — see README.md, "Setting up".' })
        ])
      ]));
      return;
    }
    Store.onChange(refresh);
    Store.onAuth(function (st) {
      if (!st || !st.user) { Login.show(rootEl); return; }
      if (!st.member) {
        /* Signed in but not a member of anything — a staff login whose
           owner removed them, or a sign-up that did not finish. */
        if (Login.busy()) return;
        UI.clear(rootEl);
        rootEl.appendChild(el('div', { class: 'login-wrap' }, [
          el('div', { class: 'login-card' }, [
            brand(),
            el('h2', { text: 'This login is not part of a shop' }),
            el('p', { class: 'modal-msg', text: 'If you work at a shop, your owner may have removed you or ' +
              'reset your PIN. Ask them for your codes and PIN, and sign in again.' }),
            el('button', { class: 'btn primary block', text: 'Back to sign in', onclick: function () { Store.signOut(); } })
          ])
        ]));
        return;
      }
      if (st.member.role === 'owner') {
        var saved = null;
        try { saved = sessionStorage.getItem('hz_screen'); } catch (e) {}
        if (window.OwnerKiosk && OwnerKiosk.isThisDevice()) saved = 'kiosk';
        current = saved || (st.shop && !st.shop.site ? 'settings' : 'today');
        drawOwner();
      } else {
        Employee.mount(rootEl);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', start);
  if (document.readyState !== 'loading') setTimeout(start, 0);

  return { go: go, icon: icon, brand: brand };
})();
