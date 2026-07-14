// Transactions: filterable ledger, add/edit modal, CSV import/export.
(function () {
  'use strict';
  window.Views = window.Views || {};

  const filters = {
    month: U.thisMonth(),   // 'all' or YYYY-MM
    search: '',
    accountId: '',
    categoryId: '',
    type: ''
  };

  // ---------------- add / edit modal ----------------
  function openTxModal(tx) {
    const isEdit = !!tx;
    const accounts = Store.activeAccounts();
    if (!accounts.length) { C.toast('Add an account first', 'error'); return; }

    const t = tx || {
      type: 'expense', amount: '', date: U.todayStr(),
      accountId: accounts[0].id, toAccountId: '', categoryId: '', payee: '', notes: ''
    };
    let curType = t.type;

    const accOptions = accounts.map(a => ({ value: a.id, label: a.name }));

    const m = C.modal({
      title: isEdit ? 'Edit transaction' : 'Add transaction',
      body: `
        <div class="mb-14">${C.segmented('tx-type', [
          { value: 'expense', label: 'Expense' },
          { value: 'income', label: 'Income' },
          { value: 'transfer', label: 'Transfer' }
        ], curType)}</div>
        <div class="form-grid">
          ${C.input({ id: 'tx-amount', label: 'Amount', type: 'number', step: '0.01', min: 0, value: t.amount, placeholder: '0.00' })}
          ${C.input({ id: 'tx-date', label: 'Date', type: 'date', value: t.date })}
          <div id="tx-acc-wrap">${C.select({ id: 'tx-account', label: 'Account', options: accOptions, value: t.accountId })}</div>
          <div id="tx-cat-wrap"></div>
          ${C.input({ id: 'tx-payee', label: 'Payee / description', value: t.payee, placeholder: 'e.g. Kroger', full: true })}
          ${C.input({ id: 'tx-notes', label: 'Notes', value: t.notes, placeholder: 'optional', full: true })}
        </div>`,
      footer: `<button class="btn ghost" data-act="cancel">Cancel</button>
               <button class="btn primary" data-act="save">${isEdit ? 'Save changes' : 'Add transaction'}</button>`
    });

    function renderCatOrTarget() {
      const wrap = m.body.querySelector('#tx-cat-wrap');
      const accWrap = m.body.querySelector('#tx-acc-wrap').querySelector('label');
      if (curType === 'transfer') {
        accWrap.textContent = 'From account';
        wrap.innerHTML = C.select({
          id: 'tx-toaccount', label: 'To account',
          options: accOptions, value: t.toAccountId || (accOptions[1] ? accOptions[1].value : accOptions[0].value)
        });
      } else {
        accWrap.textContent = 'Account';
        const cats = (curType === 'income' ? Store.incomeCategories() : Store.expenseCategories())
          .map(c => ({ value: c.id, label: c.name }));
        cats.unshift({ value: '', label: '(uncategorized)' });
        wrap.innerHTML = C.select({ id: 'tx-category', label: 'Category', options: cats, value: t.categoryId || '' });
      }
    }
    renderCatOrTarget();
    C.wireSegmented(m.body.querySelector('#tx-type'), v => { curType = v; renderCatOrTarget(); });

    m.footer.querySelector('[data-act="cancel"]').addEventListener('click', m.close);
    m.footer.querySelector('[data-act="save"]').addEventListener('click', () => {
      const amount = U.parseAmount(m.body.querySelector('#tx-amount').value);
      if (!(amount > 0)) { C.toast('Enter an amount', 'error'); return; }
      const date = m.body.querySelector('#tx-date').value || U.todayStr();
      const accountId = m.body.querySelector('#tx-account').value;
      const data = {
        type: curType, amount, date, accountId,
        payee: m.body.querySelector('#tx-payee').value.trim(),
        notes: m.body.querySelector('#tx-notes').value.trim(),
        toAccountId: null, categoryId: null
      };
      if (curType === 'transfer') {
        data.toAccountId = m.body.querySelector('#tx-toaccount').value;
        if (data.toAccountId === accountId) { C.toast('Pick two different accounts', 'error'); return; }
      } else {
        data.categoryId = m.body.querySelector('#tx-category').value || null;
      }
      if (isEdit) { Store.updateTransaction(tx.id, data); C.toast('Transaction updated'); }
      else { Store.addTransaction(data); C.toast('Transaction added'); }
      m.close();
      App.refresh();
    });
  }

  // ---------------- CSV import ----------------
  async function importCSV() {
    const accounts = Store.activeAccounts();
    if (!accounts.length) { C.toast('Add an account first', 'error'); return; }

    let content = null;
    if (window.api) {
      const res = await window.api.importFile({ filterName: 'CSV files', filterExt: ['csv', 'txt'] });
      if (!res.ok) return;
      content = res.content;
    } else {
      content = await new Promise((resolve) => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.csv,.txt';
        inp.onchange = () => {
          const f = inp.files[0];
          if (!f) return resolve(null);
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.readAsText(f);
        };
        inp.click();
      });
      if (!content) return;
    }

    const rows = U.parseCSV(content);
    if (rows.length < 2) { C.toast('That file looks empty', 'error'); return; }
    const header = rows[0].map(h => h.trim().toLowerCase());
    const dataRows = rows.slice(1);

    const guess = (names) => {
      const i = header.findIndex(h => names.some(n => h.includes(n)));
      return i >= 0 ? i : 0;
    };
    const colOptions = header.map((h, i) => ({ value: i, label: `${i + 1}: ${h || '(blank)'}` }));
    const colOptionsNone = [{ value: -1, label: '(none)' }, ...colOptions];

    const m = C.modal({
      title: 'Import transactions from CSV',
      body: `
        <p class="muted small mb-14">${dataRows.length} rows found. Map the columns, pick the account, and import.
        Negative amounts (or amounts in parentheses) become expenses; positive become income.</p>
        <div class="form-grid">
          ${C.select({ id: 'imp-date', label: 'Date column', options: colOptions, value: guess(['date', 'posted']) })}
          ${C.select({ id: 'imp-amount', label: 'Amount column', options: colOptions, value: guess(['amount', 'value']) })}
          ${C.select({ id: 'imp-payee', label: 'Description column', options: colOptionsNone, value: guess(['desc', 'payee', 'memo', 'name']) })}
          ${C.select({ id: 'imp-account', label: 'Into account', options: accounts.map(a => ({ value: a.id, label: a.name })), value: accounts[0].id })}
        </div>`,
      footer: `<button class="btn ghost" data-act="cancel">Cancel</button>
               <button class="btn primary" data-act="go">Import ${dataRows.length} rows</button>`
    });

    m.footer.querySelector('[data-act="cancel"]').addEventListener('click', m.close);
    m.footer.querySelector('[data-act="go"]').addEventListener('click', () => {
      const di = Number(m.body.querySelector('#imp-date').value);
      const ai = Number(m.body.querySelector('#imp-amount').value);
      const pi = Number(m.body.querySelector('#imp-payee').value);
      const accountId = m.body.querySelector('#imp-account').value;
      let ok = 0, skipped = 0;
      for (const row of dataRows) {
        const rawDate = (row[di] || '').trim();
        const amount = U.parseAmount(row[ai]);
        const d = new Date(rawDate);
        if (!rawDate || isNaN(d.getTime()) || amount === 0) { skipped++; continue; }
        Store.addTransaction({
          date: U.dateToStr(d),
          type: amount < 0 ? 'expense' : 'income',
          amount: Math.abs(amount),
          accountId,
          payee: pi >= 0 ? String(row[pi] || '').trim() : '',
          notes: 'Imported'
        });
        ok++;
      }
      m.close();
      C.toast(`Imported ${ok} transactions${skipped ? `, skipped ${skipped}` : ''}`);
      App.refresh();
    });
  }

  async function exportCSV(list) {
    const head = 'Date,Type,Payee,Category,Account,To Account,Amount,Notes';
    const lines = list.map(t => [
      t.date, t.type, t.payee, t.categoryId ? Store.categoryName(t.categoryId) : '',
      Store.accountName(t.accountId), t.toAccountId ? Store.accountName(t.toAccountId) : '',
      (t.type === 'expense' ? -t.amount : t.amount).toFixed(2), t.notes
    ].map(U.csvEscape).join(','));
    const csv = [head, ...lines].join('\n');
    if (window.api) {
      const res = await window.api.exportFile({
        defaultName: `nestegg-transactions-${U.todayStr()}.csv`,
        content: csv, filterName: 'CSV file', filterExt: 'csv'
      });
      if (res.ok) C.toast('Exported ' + list.length + ' transactions');
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `nestegg-transactions-${U.todayStr()}.csv`;
      a.click();
    }
  }

  // ---------------- view ----------------
  window.Views.transactions = {
    openTxModal,

    filtered() {
      let list = Store.state.transactions;
      if (filters.month !== 'all') list = list.filter(t => t.date.slice(0, 7) === filters.month);
      if (filters.accountId) list = list.filter(t => t.accountId === filters.accountId || t.toAccountId === filters.accountId);
      if (filters.categoryId) list = list.filter(t => t.categoryId === filters.categoryId);
      if (filters.type) list = list.filter(t => t.type === filters.type);
      if (filters.search) {
        const q = filters.search.toLowerCase();
        list = list.filter(t =>
          (t.payee || '').toLowerCase().includes(q) ||
          (t.notes || '').toLowerCase().includes(q) ||
          Store.categoryName(t.categoryId).toLowerCase().includes(q));
      }
      return U.sortBy(list, t => t.date, true);
    },

    render(el) {
      const accounts = Store.activeAccounts();
      const cats = [...Store.expenseCategories(), ...Store.incomeCategories()];
      const list = this.filtered();
      const income = U.sum(list.filter(t => t.type === 'income'), t => t.amount);
      const expenses = U.sum(list.filter(t => t.type === 'expense'), t => t.amount);
      const LIMIT = 500;
      const shown = list.slice(0, LIMIT);

      el.innerHTML = `
        <div class="view-header">
          <div class="view-title"><h1>Transactions</h1><p>${list.length} shown · income ${U.money0(income)} · spending ${U.money0(expenses)} · net <span class="amount ${income - expenses >= 0 ? 'pos' : 'neg'}">${U.moneySigned(income - expenses)}</span></p></div>
          <div class="view-actions">
            <button class="btn" id="tx-import">${C.icon('upload')} Import CSV</button>
            <button class="btn" id="tx-export">${C.icon('download')} Export CSV</button>
            <button class="btn primary" id="tx-add">${C.icon('plus')} Add transaction</button>
          </div>
        </div>

        <div class="card mb-14">
          <div class="flex flex-wrap">
            ${filters.month === 'all'
              ? `<button class="btn sm" id="tx-back-month">${C.icon('calendar')} Back to monthly</button>`
              : C.monthNav('tx-month', filters.month) + `<button class="btn ghost sm" id="tx-all-months">All months</button>`}
            <div class="grow"></div>
            <div style="position:relative;min-width:200px">
              <input type="text" id="tx-search" placeholder="Search payee, notes, category…" value="${U.esc(filters.search)}">
            </div>
            <select id="tx-f-account" style="width:auto">
              <option value="">All accounts</option>
              ${accounts.map(a => `<option value="${a.id}" ${filters.accountId === a.id ? 'selected' : ''}>${U.esc(a.name)}</option>`).join('')}
            </select>
            <select id="tx-f-category" style="width:auto">
              <option value="">All categories</option>
              ${cats.map(c => `<option value="${c.id}" ${filters.categoryId === c.id ? 'selected' : ''}>${U.esc(c.name)}</option>`).join('')}
            </select>
            <select id="tx-f-type" style="width:auto">
              <option value="">All types</option>
              <option value="expense" ${filters.type === 'expense' ? 'selected' : ''}>Expenses</option>
              <option value="income" ${filters.type === 'income' ? 'selected' : ''}>Income</option>
              <option value="transfer" ${filters.type === 'transfer' ? 'selected' : ''}>Transfers</option>
            </select>
          </div>
        </div>

        <div class="card">
          ${shown.length ? `<div class="table-wrap"><table class="data">
            <thead><tr><th>Date</th><th>Payee</th><th>Category</th><th>Account</th><th class="num">Amount</th><th style="width:64px"></th></tr></thead>
            <tbody>${shown.map(t => {
              const cat = Store.category(t.categoryId);
              const catCell = t.type === 'transfer'
                ? `<span class="pill">${C.icon('swap')} transfer</span>`
                : `${C.catDot(cat)}${U.esc(cat ? cat.name : 'Uncategorized')}`;
              const accCell = t.type === 'transfer'
                ? `${U.esc(Store.accountName(t.accountId))} → ${U.esc(Store.accountName(t.toAccountId))}`
                : U.esc(Store.accountName(t.accountId));
              const amtCls = t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg' : '';
              const amtStr = t.type === 'income' ? '+' + U.money(t.amount) : t.type === 'expense' ? '−' + U.money(t.amount) : U.money(t.amount);
              return `<tr data-id="${t.id}" class="clickable">
                <td class="nowrap muted">${U.dateLabelShort(t.date)}</td>
                <td><b>${U.esc(t.payee || '(no payee)')}</b>${t.notes ? `<br><span class="muted small">${U.esc(t.notes)}</span>` : ''}</td>
                <td>${catCell}</td>
                <td class="muted">${accCell}</td>
                <td class="num amount ${amtCls}"><b>${amtStr}</b></td>
                <td><div class="row-actions">
                  <button class="icon-btn" data-act="edit" title="Edit">${C.icon('pencil')}</button>
                  <button class="icon-btn danger" data-act="delete" title="Delete">${C.icon('trash')}</button>
                </div></td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>
          ${list.length > LIMIT ? `<p class="muted small mt-8">Showing first ${LIMIT} of ${list.length} — narrow the filters to see more.</p>` : ''}`
          : C.emptyState({
              icon: 'list', title: 'No transactions here',
              text: filters.month === 'all' ? 'Add your first transaction to start tracking where your money goes.' : `Nothing recorded for ${U.monthLabel(filters.month)} with these filters.`,
              actionHtml: `<button class="btn primary" id="tx-add-empty">${C.icon('plus')} Add transaction</button>`
            })}
        </div>
      `;

      // wire filters
      const monthNav = el.querySelector('#tx-month');
      if (monthNav) monthNav.addEventListener('click', (e) => {
        const b = e.target.closest('[data-nav]');
        if (!b) return;
        filters.month = U.monthAdd(filters.month, Number(b.dataset.nav));
        App.refresh();
      });
      el.querySelector('#tx-all-months')?.addEventListener('click', () => { filters.month = 'all'; App.refresh(); });
      el.querySelector('#tx-back-month')?.addEventListener('click', () => { filters.month = U.thisMonth(); App.refresh(); });

      const searchInput = el.querySelector('#tx-search');
      searchInput.addEventListener('input', U.debounce(() => {
        filters.search = searchInput.value;
        const pos = searchInput.selectionStart;
        App.refresh();
        const again = document.getElementById('tx-search');
        if (again) { again.focus(); again.setSelectionRange(pos, pos); }
      }, 250));

      el.querySelector('#tx-f-account').addEventListener('change', (e) => { filters.accountId = e.target.value; App.refresh(); });
      el.querySelector('#tx-f-category').addEventListener('change', (e) => { filters.categoryId = e.target.value; App.refresh(); });
      el.querySelector('#tx-f-type').addEventListener('change', (e) => { filters.type = e.target.value; App.refresh(); });

      el.querySelector('#tx-add').addEventListener('click', () => openTxModal());
      el.querySelector('#tx-add-empty')?.addEventListener('click', () => openTxModal());
      el.querySelector('#tx-import').addEventListener('click', importCSV);
      el.querySelector('#tx-export').addEventListener('click', () => exportCSV(list));

      // row actions
      el.querySelector('tbody')?.addEventListener('click', async (e) => {
        const tr = e.target.closest('tr[data-id]');
        if (!tr) return;
        const tx = Store.state.transactions.find(t => t.id === tr.dataset.id);
        const btn = e.target.closest('[data-act]');
        if (btn?.dataset.act === 'delete') {
          const ok = await C.confirm({ title: 'Delete transaction?', message: `${U.esc(tx.payee || 'This transaction')} — ${U.money(tx.amount)}. Account balances will be adjusted back.`, confirmLabel: 'Delete', danger: true });
          if (ok) { Store.deleteTransaction(tx.id); C.toast('Transaction deleted'); App.refresh(); }
        } else {
          openTxModal(tx);
        }
      });
    }
  };
})();
