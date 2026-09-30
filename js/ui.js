/* =============================================================
   Haazri — small UI helpers (no framework, no build step)

   Ported from mirrorBill.
   ============================================================= */
window.UI = (function () {
  'use strict';

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'dataset') {
          Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        } else node.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  /* Emptying a node can blur a focused input, whose change handler may
     re-enter and redraw. replaceChildren() does it in one atomic step,
     so a nested redraw can never invalidate a half-finished loop. */
  function clear(node) {
    if (node.replaceChildren) node.replaceChildren();
    else {
      var c;
      while ((c = node.firstChild) && c.parentNode === node) node.removeChild(c);
    }
  }

  /* ---------- money ---------- */
  function money(n) {
    var v = Math.round((Number(n) || 0) * 100) / 100;
    var neg = v < 0;
    v = Math.abs(v);
    var s = v.toFixed(2);
    var parts = s.split('.');
    var int = parts[0];
    // Indian digit grouping: 12,34,567
    var last3 = int.slice(-3);
    var rest = int.slice(0, -3);
    if (rest) last3 = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
    var out = last3 + (parts[1] === '00' ? '' : '.' + parts[1]);
    return (neg ? '-' : '') + out;
  }
  function rupee(n) { return '₹' + money(Math.round(Number(n) || 0)); }

  /* ---------- dates ---------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateKey(d) {
    d = d ? new Date(d) : new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function prettyDate(d) {
    d = new Date(d);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return pad(d.getDate()) + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }
  function prettyTime(d) {
    d = new Date(d);
    var h = d.getHours(), m = pad(d.getMinutes());
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + m + ' ' + ap;
  }

  /* ---------- toast ---------- */
  var toastBox = null;
  /* The same message twice puts a number on the one already showing
     rather than stacking a second box, and only a few stand at once. */
  var MAX_TOASTS = 3;

  function toast(msg, kind, action) {
    if (!toastBox) {
      toastBox = el('div', { class: 'toast-box' });
      document.body.appendChild(toastBox);
    }

    /* Already saying this? Count it instead of saying it twice. */
    if (!action) {
      var same = [].slice.call(toastBox.children).filter(function (n) {
        return n.dataset && n.dataset.msg === msg && !n.classList.contains('out');
      })[0];
      if (same) {
        var n = (Number(same.dataset.count) || 1) + 1;
        same.dataset.count = n;
        var label = same.querySelector('.toast-msg');
        if (label) label.textContent = msg + '  ×' + n;
        clearTimeout(Number(same.dataset.fade));
        clearTimeout(Number(same.dataset.drop));
        arm(same, 2600);
        return;
      }
    }

    var t = el('div', { class: 'toast ' + (kind || 'ok') }, [
      el('span', { class: 'toast-msg', text: msg })
    ]);
    t.dataset.msg = msg;
    t.dataset.count = '1';

    var life = action ? 9000 : 2600;
    if (action && action.label) {
      t.appendChild(el('button', {
        class: 'toast-do', text: action.label,
        onclick: function () {
          if (t.parentNode) t.parentNode.removeChild(t);
          if (action.onClick) action.onClick();
        }
      }));
    }

    toastBox.appendChild(t);
    arm(t, life);

    var standing = [].slice.call(toastBox.children).filter(function (n) {
      return !n.classList.contains('out');
    });
    while (standing.length > MAX_TOASTS) {
      var oldest = standing.shift();
      if (oldest.parentNode) oldest.parentNode.removeChild(oldest);
    }
  }

  function arm(t, life) {
    t.dataset.fade = setTimeout(function () { t.classList.add('out'); }, life);
    t.dataset.drop = setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, life + 500);
  }


  /* ---------- modal ---------- */
  function modal(title, bodyNode, buttons, opts) {
    opts = opts || {};
    var overlay = el('div', { class: 'modal-overlay' });
    var box = el('div', { class: 'modal' + (opts.wide ? ' modal-wide' : '') }, [
      el('div', { class: 'modal-head' }, [
        el('h3', { text: title }),
        el('button', {
          class: 'icon-btn', title: 'Close', html: '&times;',
          onclick: function () { close(); }
        })
      ]),
      el('div', { class: 'modal-body' }, [bodyNode]),
      el('div', { class: 'modal-foot' }, (buttons || []).map(function (b) {
        return el('button', {
          class: 'btn ' + (b.kind || ''),
          text: b.label,
          onclick: function () {
            if (!b.onClick || b.onClick() !== false) close();
          }
        });
      }))
    ]);
    overlay.appendChild(box);
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) close();
    });
    function esc(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc);
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', esc);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      /* However it was dismissed — the cross, a tap outside, Escape, or a
         button — whoever opened it hears about it once. A modal holding
         the camera open must be able to put it down on every one of those
         routes, not only the one with a Cancel label on it. */
      if (typeof opts.onClose === 'function') {
        try { opts.onClose(); } catch (e) {}
      }
    }
    document.body.appendChild(overlay);
    var firstInput = box.querySelector('input, select, textarea');
    if (firstInput) firstInput.focus();
    return { close: close, box: box };
  }

  function confirm(title, message, onYes, yesLabel) {
    /* confirm(title, onYes) is allowed as a shorthand. */
    if (typeof message === 'function') {
      yesLabel = onYes;
      onYes = message;
      message = '';
    }
    modal(title, el('p', { class: 'modal-msg', text: message }), [
      { label: 'Cancel' },
      { label: yesLabel || 'Yes, continue', kind: 'danger', onClick: onYes }
    ]);
  }

  function prompt(title, fields, onSubmit, opts) {
    var wrap = el('div', { class: 'form-grid' });
    var inputs = {};
    /* A null field is one that does not apply here; dropped. */
    fields = (fields || []).filter(Boolean);
    fields.forEach(function (f) {
      var input;
      if (f.type === 'select') {
        input = el('select', { class: 'input' }, (f.options || []).map(function (o) {
          return el('option', {
            value: o.value,
            text: o.label,
            selected: String(o.value) === String(f.value)
          });
        }));
      } else if (f.type === 'textarea') {
        input = el('textarea', { class: 'input', rows: f.rows || 3 });
        input.value = f.value == null ? '' : f.value;
      } else if (f.type === 'checkbox') {
        input = el('input', { type: 'checkbox' });
        input.checked = !!f.value;
      } else {
        input = el('input', {
          class: 'input', type: f.type || 'text',
          placeholder: f.placeholder || '',
          step: f.step, min: f.min, max: f.max,
          inputmode: f.inputmode, maxlength: f.maxlength,
          autocomplete: f.autocomplete
        });
        input.value = f.value == null ? '' : f.value;
      }
      inputs[f.key] = input;
      wrap.appendChild(el('label', {
        class: 'field' + (f.type === 'checkbox' ? ' field-check' : '') +
          (f.full ? ' field-full' : '')
      }, [
        el('span', { class: 'field-label', text: f.label }),
        input,
        f.hint ? el('span', { class: 'field-hint', text: f.hint }) : null
      ]));
    });
    modal(opts && opts.title ? opts.title : title, wrap, [
      { label: 'Cancel' },
      {
        label: (opts && opts.submitLabel) || 'Save', kind: 'primary',
        onClick: function () {
          var out = {};
          Object.keys(inputs).forEach(function (k) {
            var i = inputs[k];
            out[k] = i.type === 'checkbox' ? i.checked : i.value.trim();
          });
          return onSubmit(out);
        }
      }
    ], opts);
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function csv(rows) {
    return rows.map(function (r) {
      return r.map(function (cell) {
        var s = cell == null ? '' : String(cell);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\n');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    el: el, $: $, $$: $$, clear: clear,
    money: money, rupee: rupee,
    dateKey: dateKey, prettyDate: prettyDate, prettyTime: prettyTime, pad: pad,
    toast: toast, modal: modal, confirm: confirm, prompt: prompt,
    download: download, csv: csv, escapeHtml: escapeHtml
  };
})();
