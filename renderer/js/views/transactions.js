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
  async function pickImportFileBytes() {
    if (window.api) {
      const res = await window.api.importAny({ filterName: 'Bank files (OFX, QFX, CSV, PDF)', filterExt: ['ofx', 'qfx', 'csv', 'txt', 'pdf'] });
      if (!res.ok) return null;
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.ofx,.qfx,.csv,.txt,.pdf';
      inp.onchange = () => {
        const f = inp.files[0];
        if (!f) return resolve(null);
        const r = new FileReader();
        r.onload = () => resolve(new Uint8Array(r.result));
        r.readAsArrayBuffer(f);
      };
      inp.click();
    });
  }

  async function startImport() {
    if (!Store.activeAccounts().length) { C.toast('Add an account first', 'error'); return; }
    const bytes = await pickImportFileBytes();
    if (!bytes) return;

    if (Engines.isPDF(bytes)) {
      C.toast('Reading PDF…');
      let parsed;
      try {
        const lines = await Engines.pdfToLines(bytes);
        if (Engines.isPaystub(lines)) {
          const stub = Engines.parsePaystub(lines);
          if (stub.gross == null && stub.net == null) {
            C.toast('This looks like a paystub, but I couldn’t read the amounts', 'error');
            return;
          }
          openPaystubReview(stub);
          return;
        }
        parsed = Engines.parseStatementText(lines);
      } catch (err) {
        C.toast('Couldn’t read that PDF: ' + err.message, 'error');
        return;
      }
      if (!parsed.transactions.length && !parsed.review.length) {
        C.toast('No transactions found — is this a scanned (image-only) statement?', 'error');
        return;
      }
      openImportPreview(parsed.transactions, { review: parsed.review, meta: parsed.meta });
      return;
    }

    const content = new TextDecoder('utf-8').decode(bytes);
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
  function openImportPreview(rows, extras = {}) {
    const accounts = Store.activeAccounts();
    const meta = extras.meta || null;
    const reviewLines = extras.review || [];
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
      <tr data-idx="${it.idx}" style="${it.dup || it.flag === 'card-payment' ? 'opacity:0.5' : ''}">
        <td><input type="checkbox" data-role="use" ${it.dup || it.flag === 'card-payment' ? '' : 'checked'}></td>
        <td class="nowrap muted">${U.dateLabelShort(it.date)}</td>
        <td title="${U.esc(it.memo)}">${U.esc(it.payee || '(no description)')}
          ${it.dup ? '<span class="pill">duplicate</span>' : ''}
          ${it.flag === 'card-payment' ? '<span class="pill" title="This looks like a card payment — usually recorded as a transfer from checking, so it stays unchecked to avoid double counting.">card payment?</span>' : ''}
          ${it.flag === 'credit' ? '<span class="pill status-good" title="Credit / refund — imported as money in.">credit</span>' : ''}
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
        ${meta && meta.newBalance != null ? `<div class="callout mb-14">
          Statement parsed — new balance <b>${U.money(meta.newBalance)}</b>${meta.minPayment != null ? `, minimum payment <b>${U.money(meta.minPayment)}</b>` : ''}${meta.apr != null ? `, purchase APR <b>${meta.apr}%</b>` : ''}.
          <label class="checkbox-row mt-8"><input type="checkbox" id="prev-syncmeta" checked>
          Update the selected account with these numbers after import</label>
        </div>` : ''}
        <div class="table-wrap" style="max-height:${reviewLines.length ? 34 : 46}vh;overflow-y:auto"><table class="data">
          <thead><tr><th style="width:30px"></th><th>Date</th><th>Payee</th><th class="num">Amount</th><th style="width:190px">Category</th></tr></thead>
          <tbody id="prev-rows">${rowsHtml()}</tbody>
        </table></div>
        ${reviewLines.length ? `<div class="mt-14">
          <div class="card-title">${C.icon('alert')} Needs a human — ${reviewLines.length} line${reviewLines.length > 1 ? 's' : ''} I couldn’t read confidently</div>
          <p class="muted small mb-8">Fix the details and tick the box to include them, or leave them unticked to skip.</p>
          <div style="max-height:20vh;overflow-y:auto">
          ${reviewLines.map((r, i) => `
            <div class="flex mb-8" data-review="${i}" style="flex-wrap:wrap">
              <input type="checkbox" data-role="rv-use">
              <input type="date" data-role="rv-date" style="width:140px">
              <input type="text" data-role="rv-payee" placeholder="payee" style="flex:1;min-width:120px">
              <input type="number" step="0.01" data-role="rv-amount" placeholder="amount" style="width:100px">
              <select data-role="rv-type" style="width:100px"><option value="expense">Expense</option><option value="income">Income</option></select>
              <div class="muted small" style="flex-basis:100%;padding-left:24px" title="${U.esc(r.raw)}">raw: ${U.esc(r.raw.length > 90 ? r.raw.slice(0, 90) + '…' : r.raw)}</div>
            </div>`).join('')}
          </div>
        </div>` : ''}`,
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
      const importedPayees = [];

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
        importedPayees.push({ payee: it.payee, amount: Math.abs(it.amount), date: it.date, expense: it.group === 'expense', accountId, categoryId: chosen });
        // user corrected (or set) the category → remember it as a rule
        if (chosen && chosen !== it.suggestedId && it.payee) {
          if (Store.upsertRule(it.payee, chosen)) learned++;
        }
      }

      // human-corrected lines from the needs-review bucket
      for (const row of m.body.querySelectorAll('[data-review]')) {
        if (!row.querySelector('[data-role="rv-use"]').checked) continue;
        const date = row.querySelector('[data-role="rv-date"]').value;
        const amount = U.parseAmount(row.querySelector('[data-role="rv-amount"]').value);
        const payee = row.querySelector('[data-role="rv-payee"]').value.trim();
        if (!date || !(Math.abs(amount) > 0)) continue;
        Store.addTransaction({
          date,
          type: row.querySelector('[data-role="rv-type"]').value,
          amount: Math.abs(amount),
          accountId,
          payee,
          notes: 'Imported (manual fix)'
        });
        imported++;
        importedPayees.push({ payee, amount: Math.abs(amount), date, expense: true, accountId, categoryId: null });
      }

      // sync statement metadata onto the account (balance reconcile, APR, min payment)
      if (meta && meta.newBalance != null && m.body.querySelector('#prev-syncmeta')?.checked) {
        const acc = Store.account(accountId);
        if (acc) {
          const patch = { balance: meta.newBalance };
          if (meta.apr != null && !acc.apr) patch.apr = meta.apr;
          if (meta.minPayment != null && !acc.minPayment) patch.minPayment = meta.minPayment;
          Store.updateAccount(accountId, patch);
        }
      }

      m.close();
      C.toast(`Imported ${imported} transactions${learned ? ` · learned ${learned} new rule${learned > 1 ? 's' : ''}` : ''}`);
      App.refresh();
      if (imported >= 3) offerCascade(importedPayees);
    });
  }

  // After a meaningful import, offer to track newly detected recurring charges.
  // Two tiers: confirmed patterns (2+ charges) and single charges from known
  // subscription merchants (cadence guessed monthly).
  function offerCascade(importedTxs) {
    const keys = new Set(importedTxs.map(t => U.normPayee(t.payee)).filter(k => k.length >= 3));
    const ignores = new Set(Store.state.subscriptionIgnores);
    const detected = Engines.detectSubscriptions(Store.state.transactions);
    const candidates = detected
      .filter(s => keys.has(s.key) && !ignores.has(s.key) && !s.inactive && !Views.subscriptions.isTracked(s));

    const detectedKeys = new Set(detected.map(s => s.key));
    const seen = new Set(candidates.map(s => s.key));
    for (const tx of importedTxs) {
      if (!tx.expense || !tx.payee) continue;
      const key = U.normPayee(tx.payee);
      if (key.length < 3 || seen.has(key) || detectedKeys.has(key) || ignores.has(key)) continue;
      if (!Engines.isKnownSubMerchant(key)) continue;
      const pseudo = {
        key,
        displayName: tx.payee,
        categoryId: tx.categoryId,
        accountId: tx.accountId,
        cadence: 'monthly',
        frequency: 'monthly',
        perYear: 12,
        amount: tx.amount,
        monthlyCost: tx.amount,
        chargeCount: 1,
        lastDate: tx.date,
        nextExpected: U.addMonthsToDate(tx.date, 1),
        inactive: false,
        priceChange: null,
        guessed: true
      };
      if (Views.subscriptions.isTracked(pseudo)) continue;
      seen.add(key);
      candidates.push(pseudo);
    }

    candidates.sort((a, b) => b.amount - a.amount);
    candidates.length = Math.min(candidates.length, 8);
    if (!candidates.length) return;

    const m = C.modal({
      title: 'Recurring charges spotted in this import',
      body: `
        <p class="muted small mb-14">These look like subscriptions or regular bills. Track them to get
        due-date reminders and cash-flow planning — they also appear automatically in the Subscriptions view.</p>
        ${candidates.map((s, i) => `
          <div class="flex-between mb-8" data-ci="${i}">
            <span><b>${U.esc(s.displayName)}</b>
              <span class="muted small">· ${s.guessed ? 'looks like a subscription (cadence guessed monthly)' : Store.FREQUENCIES[s.frequency]?.label || s.cadence} · ${U.money(s.amount)}${s.priceChange ? ` · <span style="color:var(--critical)">price changed ${U.money(s.priceChange.from)} → ${U.money(s.priceChange.to)}</span>` : ''}</span></span>
            <button class="btn sm" data-act="track">${C.icon('repeat')} Track</button>
          </div>`).join('')}`,
      footer: `<button class="btn ghost left" data-act="subs">Open Subscriptions</button>
               <button class="btn primary" data-act="done">Done</button>`
    });

    m.body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act="track"]');
      if (!btn) return;
      const row = btn.closest('[data-ci]');
      Views.subscriptions.trackAsRecurring(candidates[Number(row.dataset.ci)]);
      btn.replaceWith(Object.assign(document.createElement('span'), { className: 'pill status-good', textContent: 'tracked' }));
    });
    m.footer.querySelector('[data-act="subs"]').addEventListener('click', () => { m.close(); App.go('subscriptions'); });
    m.footer.querySelector('[data-act="done"]').addEventListener('click', m.close);
  }

  // ---------------- paystub review ----------------
  // Parsed paystub -> annual income + one-click setup of the paycheck flow.
  function openPaystubReview(stub) {
    const accounts = Store.activeAccounts().filter(a => Store.accountType(a).kind === 'asset');
    if (!accounts.length) { C.toast('Add a checking account first', 'error'); return; }
    const checking = accounts.find(a => a.type === 'checking') || accounts[0];
    const r = Store.state.retirement;
    const salaryCat = Store.incomeCategories().find(c => /salary/i.test(c.name));

    const payDate = stub.payDate || U.todayStr();
    const empKey = U.normPayee(stub.employer || 'paycheck');
    const existingRec = Store.state.recurring.find(x =>
      x.type === 'income' && U.normPayee(x.name) === empKey);
    const dupTx = Store.state.transactions.some(t =>
      t.type === 'income' && t.date === payDate && Math.abs(t.amount - (stub.net || 0)) < 0.01);

    const freqOptions = [
      { value: '52', label: 'Weekly (52/yr)' }, { value: '26', label: 'Every 2 weeks (26/yr)' },
      { value: '24', label: 'Twice a month (24/yr)' }, { value: '12', label: 'Monthly (12/yr)' }
    ];

    const m = C.modal({
      title: 'Paystub detected',
      wide: true,
      body: `
        <div class="flex-between mb-14" style="align-items:flex-start">
          <div>
            <div class="stat-label">Estimated annual gross income</div>
            <div class="hero-number" id="stub-annual"></div>
            <div class="muted small" id="stub-annual-sub"></div>
          </div>
          <div class="right muted small">
            ${stub.employer ? `<b style="color:var(--ink)">${U.esc(stub.employer)}</b><br>` : ''}
            pay date ${U.dateLabel(payDate)}${stub.periodBegin && stub.periodEnd ? `<br>period ${U.dateLabelShort(stub.periodBegin)} – ${U.dateLabelShort(stub.periodEnd)}` : ''}
            ${stub.grossYTD ? `<br>YTD gross ${U.money(stub.grossYTD)}` : ''}
          </div>
        </div>
        <div class="form-grid mb-14">
          ${C.input({ id: 'stub-gross', label: 'Gross pay per period', type: 'number', step: '0.01', value: stub.gross != null ? stub.gross.toFixed(2) : '' })}
          ${C.select({ id: 'stub-freq', label: 'Pay frequency', options: freqOptions, value: String(stub.periodsPerYear) })}
          ${C.input({ id: 'stub-net', label: 'Net pay (take-home)', type: 'number', step: '0.01', value: stub.net != null ? stub.net.toFixed(2) : '' })}
          ${C.select({ id: 'stub-account', label: 'Deposited into', options: accounts.map(a => ({ value: a.id, label: a.name })), value: checking.id })}
        </div>
        <div class="divider"></div>
        ${C.checkbox({ id: 'stub-do-tx', label: `Record this paycheck as income on ${U.dateLabel(payDate)}${dupTx ? ' — looks already recorded, so this is off' : ''}`, checked: !dupTx })}
        <div class="mt-8">${C.checkbox({ id: 'stub-do-rec', label: existingRec ? `Update recurring paycheck “${U.esc(existingRec.name)}” (amount & next date)` : 'Set up a recurring paycheck so future deposits are expected automatically', checked: true })}</div>
        <div class="mt-8"><label class="checkbox-row"><input type="checkbox" id="stub-do-salary" checked> <span id="stub-salary-label"></span></label></div>
        ${stub.contributionPct != null ? `<div class="mt-8">${C.checkbox({ id: 'stub-do-contrib', label: `Set retirement contribution to ${stub.contributionPct.toFixed(1)}% of salary (from the ${U.money(stub.retirementDeduction)} retirement deduction)`, checked: true })}</div>` : ''}
      `,
      footer: `<button class="btn ghost" data-act="cancel">Cancel</button>
               <button class="btn primary" data-act="apply">Apply</button>`
    });

    const $ = (id) => m.body.querySelector(id);
    const recompute = () => {
      const gross = U.parseAmount($('#stub-gross').value);
      const per = Number($('#stub-freq').value);
      const annual = gross * per;
      $('#stub-annual').textContent = annual > 0 ? U.money0(annual) : '—';
      $('#stub-annual-sub').textContent = [
        annual > 0 ? `${U.money(gross)} gross × ${per} pay periods` : '',
        stub.annualFromYTD ? `on pace for ${U.money0(stub.annualFromYTD)} this year incl. extras` : ''
      ].filter(Boolean).join(' · ');
      m.body.querySelector('#stub-salary-label').textContent =
        `Use ${U.money0(annual)} as your salary in the Retirement planner${r.salary ? ` (currently ${U.money0(r.salary)})` : ''}`;
    };
    $('#stub-gross').addEventListener('input', recompute);
    $('#stub-freq').addEventListener('change', recompute);
    recompute();

    m.footer.querySelector('[data-act="cancel"]').addEventListener('click', m.close);
    m.footer.querySelector('[data-act="apply"]').addEventListener('click', () => {
      const gross = U.parseAmount($('#stub-gross').value);
      const net = U.parseAmount($('#stub-net').value);
      const per = Number($('#stub-freq').value);
      const accountId = $('#stub-account').value;
      const name = stub.employer || 'Paycheck';
      const freq = per === 52 ? 'weekly' : per === 12 ? 'monthly' : 'biweekly';
      const done = [];

      if ($('#stub-do-tx').checked && net > 0) {
        Store.addTransaction({
          date: payDate, type: 'income', amount: net, accountId,
          categoryId: salaryCat ? salaryCat.id : null, payee: name, notes: 'From paystub'
        });
        done.push('paycheck recorded');
      }

      if ($('#stub-do-rec').checked && net > 0) {
        let nextDate = payDate, guard = 0;
        while (nextDate <= U.todayStr() && guard++ < 60) nextDate = Store.advanceDate(nextDate, freq);
        if (existingRec) {
          Store.updateRecurring(existingRec.id, { amount: net, frequency: freq, nextDate, accountId });
          done.push('recurring paycheck updated');
        } else {
          Store.addRecurring({
            name, type: 'income', amount: net, accountId,
            categoryId: salaryCat ? salaryCat.id : null, frequency: freq, nextDate, autoPost: false
          });
          done.push('recurring paycheck created');
        }
      }

      if ($('#stub-do-salary').checked && gross > 0) {
        r.salary = Math.round(gross * per);
        done.push(`retirement salary set to ${U.money0(r.salary)}`);
      }

      if ($('#stub-do-contrib')?.checked && stub.contributionPct != null) {
        r.employeePct = Math.round(stub.contributionPct * 10) / 10;
        done.push(`contribution ${r.employeePct}%`);
      }

      Store.persist();
      m.close();
      C.toast(done.length ? done.join(' · ') : 'Nothing selected');
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
    openPaystubReview,

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
