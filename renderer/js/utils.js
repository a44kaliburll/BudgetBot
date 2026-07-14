// Shared utilities: formatting, dates, ids. Attached to a single global `U`.
(function () {
  'use strict';

  const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const currencyFmt0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const numFmt = new Intl.NumberFormat('en-US');

  const U = {
    uid() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
    },

    money(n, opts = {}) {
      if (n == null || isNaN(n)) n = 0;
      const fmt = opts.cents === false || Math.abs(n) >= 100000 ? currencyFmt0 : currencyFmt;
      return fmt.format(n);
    },

    money0(n) {
      if (n == null || isNaN(n)) n = 0;
      return currencyFmt0.format(n);
    },

    // Signed money with explicit + for positives
    moneySigned(n) {
      const s = U.money(Math.abs(n));
      return (n >= 0 ? '+' : '−') + s;
    },

    num(n) { return numFmt.format(n); },

    pct(n, dp = 0) { return (n * 100).toFixed(dp) + '%'; },

    clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); },

    round2(n) { return Math.round(n * 100) / 100; },

    parseAmount(str) {
      if (typeof str === 'number') return str;
      const cleaned = String(str || '').replace(/[$,\s]/g, '').replace(/\((.*)\)/, '-$1');
      const n = parseFloat(cleaned);
      return isNaN(n) ? 0 : n;
    },

    // ---- dates (all local, YYYY-MM-DD strings) ----
    todayStr() {
      const d = new Date();
      return U.dateToStr(d);
    },

    dateToStr(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    },

    strToDate(s) {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, m - 1, d || 1);
    },

    monthKey(dateStr) { return dateStr.slice(0, 7); },

    thisMonth() { return U.todayStr().slice(0, 7); },

    monthAdd(mk, delta) {
      let [y, m] = mk.split('-').map(Number);
      m += delta;
      while (m > 12) { m -= 12; y++; }
      while (m < 1) { m += 12; y--; }
      return `${y}-${String(m).padStart(2, '0')}`;
    },

    monthLabel(mk) {
      const [y, m] = mk.split('-').map(Number);
      return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    },

    monthLabelShort(mk) {
      const [y, m] = mk.split('-').map(Number);
      return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).replace(' ', " '");
    },

    dateLabel(dateStr) {
      return U.strToDate(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },

    dateLabelShort(dateStr) {
      return U.strToDate(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },

    daysBetween(aStr, bStr) {
      return Math.round((U.strToDate(bStr) - U.strToDate(aStr)) / 86400000);
    },

    addDays(dateStr, n) {
      const d = U.strToDate(dateStr);
      d.setDate(d.getDate() + n);
      return U.dateToStr(d);
    },

    addMonthsToDate(dateStr, n) {
      const d = U.strToDate(dateStr);
      const targetDay = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + n);
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(targetDay, lastDay));
      return U.dateToStr(d);
    },

    // list of month keys, most recent last
    lastMonths(n, endMk) {
      const end = endMk || U.thisMonth();
      const out = [];
      for (let i = n - 1; i >= 0; i--) out.push(U.monthAdd(end, -i));
      return out;
    },

    // ---- misc ----
    esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    debounce(fn, ms) {
      let t = null;
      return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), ms);
      };
    },

    sum(arr, fn) {
      let s = 0;
      for (const x of arr) s += fn ? fn(x) : x;
      return s;
    },

    groupBy(arr, fn) {
      const m = new Map();
      for (const x of arr) {
        const k = fn(x);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(x);
      }
      return m;
    },

    sortBy(arr, fn, desc = false) {
      return [...arr].sort((a, b) => {
        const va = fn(a), vb = fn(b);
        if (va < vb) return desc ? 1 : -1;
        if (va > vb) return desc ? -1 : 1;
        return 0;
      });
    },

    percentile(sortedArr, p) {
      if (!sortedArr.length) return 0;
      const idx = (sortedArr.length - 1) * p;
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      if (lo === hi) return sortedArr[lo];
      return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
    },

    csvEscape(v) {
      const s = String(v == null ? '' : v);
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    },

    // Simple CSV parser handling quoted fields
    parseCSV(text) {
      const rows = [];
      let row = [], field = '', inQuotes = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
          if (c === '"') {
            if (text[i + 1] === '"') { field += '"'; i++; }
            else inQuotes = false;
          } else field += c;
        } else if (c === '"') {
          inQuotes = true;
        } else if (c === ',') {
          row.push(field); field = '';
        } else if (c === '\n' || c === '\r') {
          if (c === '\r' && text[i + 1] === '\n') i++;
          row.push(field); field = '';
          if (row.length > 1 || row[0] !== '') rows.push(row);
          row = [];
        } else field += c;
      }
      if (field !== '' || row.length) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
      return rows;
    }
  };

  window.U = U;
})();
