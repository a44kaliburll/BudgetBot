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

    // suggest a category from rules/history once a payee is typed
    m.body.querySelector('#tx-payee').addEventListener('blur', (e) => {
      if (curType === 'transfer') return;
      const catSel = m.body.querySelector('#tx-category');
      if (!catSel || catSel.value) return;
      const sug = Store.suggestCategory(e.target.value, curType === 'income' ? 'income' : 'expense');
      if (sug) catSel.value = sug.categoryId;
    });

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

  // ---------------- import (OFX / QFX / CSV) ----------------
  async function pickImportFile() {
    if (window.api) {
      const res = await window.api.importFile({ filterName: 'Bank files (OFX, QFX, CSV)', filterExt: ['ofx', 'qfx', 'csv', 'txt'] });
      return res.ok ? res.content : null;
    }
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.ofx,.qfx,.csv,.txt';
      inp.onchange = () => {
        const f = inp.files[0];
        if (!f) return resolve(null);
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.readAsText(f);
      };
      inp.click();
    });
  }

  async function startImport() {
    if (!Store.activeAccounts().length) { C.toast('Add an account first', 'error'); return; }
    const content = await pickImportFile();
    if (!content) return;
    if (Engines.isOFX(content)) {
      const rows = Engines.parseOFX(content);
      if (!rows.length) { C.toast('No transactions found in that file', 'error'); return; }
      openImportPreview(rows);
    } else {
      mapCSVColumns(content);
    }
  }

  // CSV needs a column-mapping step first; OFX goes straight to preview.
  function mapCSVColumns(content) {
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
      title: 'Map CSV columns',
      body: `
        <p class="muted small mb-14">${dataRows.length} rows found. Negative amounts (or amounts in
        parentheses) become expenses; positive become income. You'll review everything next.</p>
        <div class="form-grid">
          ${C.select({ id: 'imp-date', label: 'Date column', options: colOptions, value: guess(['date', 'posted']) })}
          ${C.select({ id: 'imp-amount', label: 'Amount column', options: colOptions, value: guess(['amount', 'value']) })}
          ${C.select({ id: 'imp-payee', label: 'Description column', options: colOptionsNone, value: guess(['desc', 'payee', 'memo', 'name']), full: true })}
        </div>`,
      footer: `<button class="btn ghost" data-act="cancel">Cancel</button>
               <button class="btn primary" data-act="go">Review ${dataRows.length} rows</button>`
    });

    m.footer.querySelector('[data-act="cancel"]').addEventListener('click', m.close);
    m.footer.querySelector('[data-act="go"]').addEventListener('click', () => {
      const di = Number(m.body.querySelector('#imp-date').value);
      const ai = Number(m.body.querySelector('#imp-amount').value);
      const pi = Number(m.body.querySelector('#imp-payee').value);
      const parsed = [];
      for (const row of dataRows) {
        const rawDate = (row[di] || '').trim();
        const amount = U.parseAmount(row[ai]);
        const d = new Date(rawDate);
        if (!rawDate || isNaN(d.getTime()) || amount === 0) continue;
        parsed.push({
          date: U.dateToStr(d), amount,
          payee: pi >= 0 ? String(row[pi] || '').trim() : '',
          memo: '', fitId: null
        });
      }
      m.close();
      if (!parsed.length) { C.toast('No usable rows found', 'error'); return; }
      openImportPreview(parsed);
    });
  }

  // Review screen: account, duplicate flags, auto-suggested categories.
  // Changing a suggestion teaches NestEgg a rule for next time.
  function openImportPreview(rows) {
    const accounts = Store.activeAccounts();
    const LIMIT = 1000;
    const items = rows.slice(0, LIMIT).map((r, i) => ({ ...r, idx: i }));
    const payeeMap = Engines.buildPayeeMap(Store.state.transactions);
    const expenseCats = Store.expenseCategories();
    const incomeCats = Store.incomeCategories();

    for (const it of items) {
      it.group = it.amount < 0 ? 'expense' : 'income';
      const sug = it.payee ? Store.suggestCategory(it.payee, it.group, payeeMap) : null;
      it.suggestedId = sug ? sug.categoryId : '';
      it.suggestedFromRule = sug && sug.source === 'rule';
    }

    const markDuplicates = (accountId) => {
      const existing = Store.state.transactions.filter(t => t.accountId === accountId);
      const fitIds = new Set(existing.filter(t => t.fitId).map(t => t.fitId));
      const sigs = new Set(existing.map(t => `${t.date}|${t.amount.toFixed(2)}|${U.normPayee(t.payee)}`));
      for (const it of items) {
        it.dup = (it.fitId && fitIds.has(it.fitId)) ||
          sigs.has(`${it.date}|${Math.abs(it.amount).toFixed(2)}|${U.normPayee(it.payee)}`);
      }
    };
    markDuplicates(accounts[0].id);

    const catOptions = (it) => {
      const cats = it.group === 'income' ? incomeCats : expenseCats;
      return `<option value="">(uncategorized)</option>` + cats.map(c =>
        `<option value="${c.id}" ${c.id === it.suggestedId ? 'selected' : ''}>${U.esc(c.name)}</option>`).join('');
    };

    const rowsHtml = () => items.map(it => `
      <tr data-idx="${it.idx}" style="${it.dup ? 'opacity:0.5' : ''}">
        <td><input type="checkbox" data-role="use" ${it.dup ? '' : 'checked'}></td>
        <td class="nowrap muted">${U.dateLabelShort(it.date)}</td>
        <td title="${U.esc(it.memo)}">${U.esc(it.payee || '(no description)')}
          ${it.dup ? '<span class="pill">duplicate</span>' : ''}
          ${!it.dup && it.suggestedId ? `<span class="pill" title="${it.suggestedFromRule ? 'matched one of your rules' : 'learned from your history'}">auto</span>` : ''}</td>
        <td class="num amount ${it.amount < 0 ? 'neg' : 'pos'}">${it.amount < 0 ? '−' : '+'}${U.money(Math.abs(it.amount))}</td>
        <td><select data-role="cat" style="padding:4px 8px">${catOptions(it)}</select></td>
      </tr>`).join('');

    const m = C.modal({
      title: 'Review import',
      wide: true,
      body: `
        <div class="flex flex-wrap mb-14">
          ${C.select({ id: 'prev-account', label: 'Into account', options: accounts.map(a => ({ value: a.id, label: a.name })), value: accounts[0].id })}
          <div class="grow"></div>
          <span class="muted small">${rows.length > LIMIT ? `showing first ${LIMIT} of ${rows.length} · ` : ''}duplicates are unchecked automatically ·
          changing a category teaches NestEgg a rule</span>
        </div>
        <div class="table-wrap" style="max-height:46vh;overflow-y:auto"><table class="data">
          <thead><tr><th style="width:30px"></th><th>Date</th><th>Payee</th><th class="num">Amount</th><th style="width:190px">Category</th></tr></thead>
          <tbody id="prev-rows">${rowsHtml()}</tbody>
        </table></div>`,
      footer: `<button class="btn ghost" data-act="cancel">Cancel</button>
               <button class="btn primary" data-act="import">Import selected</button>`
    });

    m.body.querySelector('#prev-account').addEventListener('change', (e) => {
      markDuplicates(e.target.value);
      m.body.querySelector('#prev-rows').innerHTML = rowsHtml();
    });

    m.footer.querySelector('[data-act="cancel"]').addEventListener('click', m.close);
    m.footer.querySelector('[data-act="import"]').addEventListener('click', () => {
      const accountId = m.body.querySelector('#prev-account').value;
      let imported = 0, learned = 0;
      for (const tr of m.body.querySelectorAll('#prev-rows tr')) {
        if (!tr.querySelector('[data-role="use"]').checked) continue;
        const it = items[Number(tr.dataset.idx)];
        const chosen = tr.querySelector('[data-role="cat"]').value || null;
        Store.addTransaction({
          date: it.date,
          type: it.group,
          amount: Math.abs(it.amount),
          accountId,
          categoryId: chosen,
          payee: it.payee,
          notes: it.memo || 'Imported',
          fitId: it.fitId
        });
        imported++;
        // user corrected (or set) the category → remember it as a rule
        if (chosen && chosen !== it.suggestedId && it.payee) {
          if (Store.upsertRule(it.payee, chosen)) learned++;
        }
      }
      m.close();
      C.toast(`Imported ${imported} transactions${learned ? ` · learned ${learned} new rule${learned > 1 ? 's' : ''}` : ''}`);
      App.refresh();
    });
  }

  // ---------------- rules manager ----------------
  function openRulesManager() {
    const allCats = () => [...Store.expenseCategories(), ...Store.incomeCategories()];
    const listHtml = () => {
      const rules = U.sortBy(Store.state.rules, r => r.pattern);
      if (!rules.length) return `<p class="muted small mb-14">No rules yet. Rules are learned automatically
        when you correct categories during import — or add one below. When a payee contains the pattern,
        the category is applied automatically on import.</p>`;
      return rules.map(r => `
        <div class="flex mb-8" data-id="${r.id}">
          <input type="text" value="${U.esc(r.pattern)}" data-role="pattern" style="flex:1">
          <select data-role="cat" style="width:180px">${allCats().map(c =>
            `<option value="${c.id}" ${c.id === r.categoryId ? 'selected' : ''}>${U.esc(c.name)}</option>`).join('')}</select>
          <button class="icon-btn danger" data-role="del" title="Delete rule">${C.icon('trash')}</button>
        </div>`).join('');
    };

    const m = C.modal({
      title: 'Auto-categorization rules',
      wide: true,
      body: `<div id="rules-list">${listHtml()}</div>
        <div class="divider"></div>
        <div class="flex">
          <input type="text" id="rule-new-pattern" placeholder="payee contains… e.g. kroger" style="flex:1">
          <select id="rule-new-cat" style="width:180px">${allCats().map(c => `<option value="${c.id}">${U.esc(c.name)}</option>`).join('')}</select>
          <button class="btn sm" id="rule-add">${C.icon('plus')} Add rule</button>
        </div>`,
      footer: `<button class="btn primary" data-act="done">Done</button>`
    });

    const list = m.body.querySelector('#rules-list');
    list.addEventListener('change', (e) => {
      const row = e.target.closest('[data-id]');
      if (!row) return;
      const rule = Store.state.rules.find(r => r.id === row.dataset.id);
      if (!rule) return;
      if (e.target.dataset.role === 'pattern') {
        const p = U.normPayee(e.target.value);
        if (p.length >= 3) { rule.pattern = p; Store.persist(); e.target.value = p; }
        else e.target.value = rule.pattern;
      } else if (e.target.dataset.role === 'cat') {
        rule.categoryId = e.target.value;
        Store.persist();
      }
    });
    list.addEventListener('click', (e) => {
      const row = e.target.closest('[data-id]');
      if (row && e.target.closest('[data-role="del"]')) {
        Store.deleteRule(row.dataset.id);
        list.innerHTML = listHtml();
      }
    });
    m.body.querySelector('#rule-add').addEventListener('click', () => {
      const pattern = m.body.querySelector('#rule-new-pattern').value;
      const catId = m.body.querySelector('#rule-new-cat').value;
      if (Store.upsertRule(pattern, catId)) {
        m.body.querySelector('#rule-new-pattern').value = '';
        list.innerHTML = listHtml();
      } else {
        C.toast('Pattern needs at least 3 letters', 'error');
      }
    });
    m.footer.querySelector('[data-act="done"]').addEventListener('click', m.close);
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
    openImportPreview,

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
            <button class="btn" id="tx-rules">${C.icon('sparkle')} Rules</button>
            <button class="btn" id="tx-import">${C.icon('upload')} Import bank file</button>
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
      el.querySelector('#tx-import').addEventListener('click', startImport);
      el.querySelector('#tx-rules').addEventListener('click', openRulesManager);
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
