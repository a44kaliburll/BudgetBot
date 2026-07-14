// Reusable UI: icons, modals, toasts, confirms, form helpers.
(function () {
  'use strict';

  // width/height attributes are the fallback size; container CSS overrides them
  const stroke = (paths, extra = '') =>
    `<svg viewBox="0 0 24 24" width="15" height="15" style="vertical-align:-2px" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra} aria-hidden="true">${paths}</svg>`;

  const ICONS = {
    dashboard: stroke('<rect x="3" y="3" width="7.5" height="9" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5"/><rect x="13.5" y="12" width="7.5" height="9" rx="1.5"/><rect x="3" y="15.5" width="7.5" height="5.5" rx="1.5"/>'),
    wallet: stroke('<path d="M19 7V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H4"/><circle cx="16.5" cy="13.5" r="1.1" fill="currentColor" stroke="none"/>'),
    list: stroke('<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" stroke-width="2.4"/>'),
    budget: stroke('<path d="M4 21V14M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1.5 14h5M9.5 8h5M17.5 16h5"/>'),
    repeat: stroke('<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
    target: stroke('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>'),
    card: stroke('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/>'),
    umbrella: stroke('<path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9z"/><path d="M12 12v7a2 2 0 0 0 4 0"/><path d="M12 3v1"/>'),
    chart: stroke('<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 14l4-5 3.5 3L19 6"/>'),
    gear: stroke('<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
    plus: stroke('<path d="M12 5v14M5 12h14"/>'),
    x: stroke('<path d="M18 6L6 18M6 6l12 12"/>'),
    pencil: stroke('<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>'),
    trash: stroke('<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>'),
    chevronL: stroke('<path d="M15 18l-6-6 6-6"/>'),
    chevronR: stroke('<path d="M9 18l6-6-6-6"/>'),
    download: stroke('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>'),
    upload: stroke('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>'),
    check: stroke('<path d="M20 6L9 17l-5-5"/>'),
    alert: stroke('<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01" stroke-width="2.4"/>'),
    info: stroke('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01" stroke-width="2.4"/>'),
    search: stroke('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
    folder: stroke('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
    calendar: stroke('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
    sun: stroke('<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    moon: stroke('<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>'),
    arrowUp: stroke('<path d="M12 19V5M5 12l7-7 7 7"/>'),
    arrowDown: stroke('<path d="M12 5v14M19 12l-7 7-7-7"/>'),
    swap: stroke('<path d="M17 3l4 4-4 4"/><path d="M21 7H8"/><path d="M7 21l-4-4 4-4"/><path d="M3 17h13"/>'),
    egg: stroke('<path d="M12 3C8 3 5 9.5 5 14a7 7 0 0 0 14 0c0-4.5-3-11-7-11z"/>'),
    sparkle: stroke('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/>')
  };

  const C = {
    icon(name) { return ICONS[name] || ''; },

    slotColor(slot) { return `var(--s${U.clamp(slot || 1, 1, 8)})`; },

    catDot(cat) {
      const slot = cat ? cat.colorSlot : 0;
      const color = slot ? C.slotColor(slot) : 'var(--ink-3)';
      return `<span class="cat-dot" style="background:${color}"></span>`;
    },

    // budget ratio → status class
    progressClass(ratio) {
      if (ratio > 1) return 'critical';
      if (ratio > 0.9) return 'warning';
      return 'good';
    },

    // ---------------- modal ----------------
    modal({ title, body, footer, wide, onClose }) {
      const root = document.getElementById('modal-root');
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal${wide ? ' wide' : ''}" role="dialog" aria-label="${U.esc(title)}">
          <div class="modal-header">
            <h2>${U.esc(title)}</h2>
            <button class="icon-btn modal-close" title="Close">${ICONS.x}</button>
          </div>
          <div class="modal-body"></div>
          <div class="modal-footer"></div>
        </div>`;
      const bodyEl = overlay.querySelector('.modal-body');
      const footEl = overlay.querySelector('.modal-footer');
      if (typeof body === 'string') bodyEl.innerHTML = body;
      else if (body) bodyEl.appendChild(body);
      if (typeof footer === 'string') footEl.innerHTML = footer;
      else if (footer) footEl.appendChild(footer);
      else footEl.remove();

      const close = () => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        if (onClose) onClose();
      };
      const onKey = (e) => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', onKey);
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
      overlay.querySelector('.modal-close').addEventListener('click', close);
      root.appendChild(overlay);
      const firstInput = bodyEl.querySelector('input, select, textarea');
      if (firstInput) setTimeout(() => firstInput.focus(), 30);
      return { overlay, body: bodyEl, footer: footEl, close };
    },

    confirm({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', danger = false }) {
      return new Promise((resolve) => {
        const m = C.modal({
          title,
          body: `<p style="color:var(--ink-2)">${message}</p>`,
          footer: `
            <button class="btn ghost" data-act="cancel">Cancel</button>
            <button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok">${U.esc(confirmLabel)}</button>`,
          onClose: () => resolve(false)
        });
        m.footer.querySelector('[data-act="cancel"]').addEventListener('click', () => { m.close(); });
        m.footer.querySelector('[data-act="ok"]').addEventListener('click', () => {
          resolve(true);
          m.overlay.remove(); // bypass onClose(false)
        });
      });
    },

    // ---------------- toast ----------------
    toast(msg, type = 'success', ms = 2600) {
      const root = document.getElementById('toast-root');
      const el = document.createElement('div');
      el.className = `toast ${type}`;
      el.innerHTML = `${type === 'error' ? ICONS.alert : ICONS.check}<span>${U.esc(msg)}</span>`;
      root.appendChild(el);
      setTimeout(() => {
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.3s';
        setTimeout(() => el.remove(), 320);
      }, ms);
    },

    // ---------------- form helpers (HTML strings) ----------------
    input({ id, label, type = 'text', value = '', placeholder = '', step, min, max, sub, full }) {
      const v = value == null ? '' : value;
      return `<div class="field${full ? ' full' : ''}">
        <label for="${id}">${U.esc(label)}${sub ? ` <span class="sub">${U.esc(sub)}</span>` : ''}</label>
        <input id="${id}" type="${type}" value="${U.esc(v)}" placeholder="${U.esc(placeholder)}"
          ${step != null ? `step="${step}"` : ''} ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''}>
      </div>`;
    },

    select({ id, label, options, value, sub, full }) {
      const opts = options.map(o =>
        `<option value="${U.esc(o.value)}"${String(o.value) === String(value) ? ' selected' : ''}>${U.esc(o.label)}</option>`
      ).join('');
      return `<div class="field${full ? ' full' : ''}">
        <label for="${id}">${U.esc(label)}${sub ? ` <span class="sub">${U.esc(sub)}</span>` : ''}</label>
        <select id="${id}">${opts}</select>
      </div>`;
    },

    checkbox({ id, label, checked }) {
      return `<label class="checkbox-row"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}> ${U.esc(label)}</label>`;
    },

    segmented(id, options, active) {
      const btns = options.map(o =>
        `<button type="button" data-value="${U.esc(o.value)}" class="${o.value === active ? 'active' : ''}">${U.esc(o.label)}</button>`
      ).join('');
      return `<div class="segmented" id="${id}">${btns}</div>`;
    },

    wireSegmented(el, onChange) {
      el.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        el.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        onChange(btn.dataset.value);
      });
    },

    emptyState({ icon = 'sparkle', title, text, actionHtml = '' }) {
      return `<div class="empty-state">
        ${ICONS[icon] || ''}
        <h3>${U.esc(title)}</h3>
        <p>${U.esc(text)}</p>
        ${actionHtml}
      </div>`;
    },

    monthNav(id, mk) {
      return `<div class="month-nav" id="${id}">
        <button class="icon-btn" data-nav="-1" title="Previous month">${ICONS.chevronL}</button>
        <span class="label">${U.esc(U.monthLabel(mk))}</span>
        <button class="icon-btn" data-nav="1" title="Next month">${ICONS.chevronR}</button>
      </div>`;
    }
  };

  window.C = C;
})();
