// Stand-in for Square's Web Payments SDK (window.Square.payments(appId, locationId).card()).
// Same calls checkout.js makes with the real SDK, but nothing leaves the browser and there is no key:
// tokenize() validates the card locally and returns a single-use "cnon:" token held in the demo token cache.
(function () {
  'use strict';
  const luhn = n => { let s = 0, d = false; for (let i = n.length - 1; i >= 0; i--) { let x = +n[i]; if (d) { x *= 2; if (x > 9) x -= 9; } s += x; d = !d; } return n.length > 0 && s % 10 === 0; };
  const brand = n => /^4/.test(n) ? 'VISA' : /^(5[1-5]|2[2-7])/.test(n) ? 'MASTERCARD' : /^3[47]/.test(n) ? 'AMERICAN_EXPRESS' : /^6/.test(n) ? 'DISCOVER' : 'CARD';

  function field(label, id, placeholder, mode, max) {
    const l = document.createElement('label');
    l.style.cssText = 'display:block;font-size:13px;color:#6b5b66;margin:0 0 10px';
    l.textContent = label;
    const i = document.createElement('input');
    i.id = id; i.placeholder = placeholder; i.inputMode = mode; i.maxLength = max; i.autocomplete = 'off';
    i.style.cssText = 'display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:12px;border:1px solid #171217;border-radius:12px;font:inherit;color:#171217;background:#fff';
    l.append(i);
    return [l, i];
  }

  window.Square = {
    payments() {
      return {
        async card() {
          let num, exp, cvv, zip;
          return {
            async attach(selector) {
              const host = document.querySelector(selector);
              const box = document.createElement('div');
              const note = document.createElement('p');
              note.style.cssText = 'font-size:12px;color:#8a7a85;margin:0 0 10px';
              note.textContent = 'Demo card form — no real payment. Try 4111 1111 1111 1111 (works) or 4000 0000 0000 0002 (declined).';
              let l;
              [l, num] = field('Card number', 'demoCardNumber', '4111 1111 1111 1111', 'numeric', 23);
              const a = l;
              [l, exp] = field('Expiry (MM/YY)', 'demoCardExp', '12/30', 'numeric', 5);
              const b = l;
              [l, cvv] = field('CVV', 'demoCardCvv', '111', 'numeric', 4);
              const c = l;
              [l, zip] = field('Billing ZIP', 'demoCardZip', '12345', 'numeric', 10);
              const d = l;
              num.addEventListener('input', () => { const v = num.value.replace(/\D/g, '').slice(0, 19); num.value = v.replace(/(.{4})/g, '$1 ').trim(); });
              exp.addEventListener('input', () => { const v = exp.value.replace(/\D/g, '').slice(0, 4); exp.value = v.length > 2 ? v.slice(0, 2) + '/' + v.slice(2) : v; });
              const row = document.createElement('div');
              row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px';
              row.append(b, c, d);
              box.append(note, a, row);
              host.replaceChildren(box);
            },
            async tokenize() {
              const n = num.value.replace(/\D/g, '');
              const errors = [];
              if (!luhn(n) || n.length < 13) errors.push({ message: 'Card number is not valid.' });
              const m = exp.value.match(/^(\d\d)\/(\d\d)$/);
              const now = new Date();
              if (!m || +m[1] < 1 || +m[1] > 12 || (2000 + +m[2]) * 12 + +m[1] < now.getFullYear() * 12 + now.getMonth() + 1) errors.push({ message: 'Expiry date is not valid.' });
              if (!/^\d{3,4}$/.test(cvv.value)) errors.push({ message: 'CVV is not valid.' });
              if (!/^\d{5}/.test(zip.value)) errors.push({ message: 'Billing ZIP is not valid.' });
              if (errors.length) return { status: 'INVALID', errors };
              const card = { brand: brand(n), last4: n.slice(-4) };
              const token = window.ThomKatDemo.issueToken(card, n === '4000000000000002');
              return { status: 'OK', token, details: { card, verificationToken: '' } };
            },
          };
        },
      };
    },
  };
})();
