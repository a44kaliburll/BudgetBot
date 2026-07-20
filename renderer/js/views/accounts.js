// Accounts: grouped balances, add/edit/archive/delete.
(function () {
  'use strict';
  window.Views = window.Views || {};

  function openAccountModal(account) {
    const isEdit = !!account;
    const a = account || { name: '', type: 'checking', balance: 0, apr: 0, minPayment: 0 };
    const typeOptions = Object.entries(Store.ACCOUNT_TYPES).map(([value, t]) => ({ value, label: t.label }));
    const isLoanType = (type) => ['autoLoan', 'studentLoan', 'personalLoan', 'mortgage'].includes(type);

    const m = C.modal({
      title: isEdit ? 'Edit account' : 'Add account',
      body: `<div class="form-grid">
        ${C.input({ id: 'acc-name', label: 'Account name', value: a.name, placeholder: 'e.g. Everyday Checking', full: true })}
        ${C.select({ id: 'acc-type', label: 'Type', options: typeOptions, value: a.type })}
        ${C.input({ id: 'acc-balance', label: isEdit ? 'Current balance' : 'Starting balance', type: 'number', step: '0.01', value: a.balance, sub: 'debts: amount owed' })}
        <div id="acc-debt-fields" class="full form-grid" style="display:none;padding:0">
          ${C.input({ id: 'acc-apr', label: 'Interest rate (APR %)', type: 'number', step: '0.01', min: 0, value: a.apr || '' })}
          ${C.input({ id: 'acc-min', label: 'Minimum monthly payment', type: 'number', step: '0.01', min: 0, value: a.minPayment || '' })}
        </div>
        <div id="acc-loan-fields" class="full" style="display:none">
          <div class="divider"></div>
          <div class="card-title">Loan terms <span class="hint">optional — from your loan contract</span></div>
          <div class="form-grid">
            ${C.input({ id: 'acc-principal', label: 'Amount financed ($)', type: 'number', step: '0.01', min: 0, value: a.originalPrincipal || '' })}
            ${C.input({ id: 'acc-term', label: 'Loan term (months)', type: 'number', step: '1', min: 1, value: a.termMonths || '', placeholder: 'e.g. 84' })}
            ${C.input({ id: 'acc-firstpay', label: 'First payment date', type: 'date', value: a.firstPaymentDate || '' })}
            <div class="field"><label>&nbsp;</label>
              <button class="btn sm" type="button" id="acc-estimate" title="Fill the balance from the amortization schedule: amount financed, APR, payment and payments made so far">${C.icon('sparkle')} Estimate current balance</button>
            </div>
          </div>
          <p class="muted small mt-8" id="acc-loan-summary"></p>
        </div>
      </div>`,
      footer: `<button class="btn ghost" data-act="cancel">Cancel</button>
               <button class="btn primary" data-act="save">${isEdit ? 'Save changes' : 'Add account'}</button>`
    });

    const typeSel = m.body.querySelector('#acc-type');
    const debtFields = m.body.querySelector('#acc-debt-fields');
    const loanFields = m.body.querySelector('#acc-loan-fields');
    const $ = (id) => m.body.querySelector(id);

    const loanSummary = () => {
      const term = Math.round(U.parseAmount($('#acc-term').value));
      const first = $('#acc-firstpay').value;
      const out = $('#acc-loan-summary');
      if (term > 0 && first) {
        const stats = Engines.loanStats({ termMonths: term, firstPaymentDate: first });
        out.textContent = `Payment ${stats.paymentsMade} of ${term} · ${stats.paymentsLeft} to go · scheduled payoff ${U.dateLabel(stats.scheduledPayoff)}`;
      } else out.textContent = '';
    };

    const syncDebt = () => {
      const t = Store.ACCOUNT_TYPES[typeSel.value];
      debtFields.style.display = t.kind === 'liability' ? 'grid' : 'none';
      loanFields.style.display = isLoanType(typeSel.value) ? 'block' : 'none';
      loanSummary();
    };
    typeSel.addEventListener('change', syncDebt);
    $('#acc-term').addEventListener('input', loanSummary);
    $('#acc-firstpay').addEventListener('input', loanSummary);
    syncDebt();

    $('#acc-estimate').addEventListener('click', () => {
      const principal = U.parseAmount($('#acc-principal').value);
      const apr = U.parseAmount($('#acc-apr').value);
      const payment = U.parseAmount($('#acc-min').value);
      const term = Math.round(U.parseAmount($('#acc-term').value));
      const first = $('#acc-firstpay').value;
      if (!(principal > 0) || !(payment > 0) || !(term > 0) || !first) {
        C.toast('Fill amount financed, APR, monthly payment, term and first payment date first', 'error');
        return;
      }
      const stats = Engines.loanStats({ termMonths: term, firstPaymentDate: first });
      const est = Engines.loanBalanceEstimate(principal, apr, payment, stats.paymentsMade);
      $('#acc-balance').value = est.toFixed(2);
      C.toast(`Estimated after ${stats.paymentsMade} payments: ${U.money(est)}`);
    });

    m.footer.querySelector('[data-act="cancel"]').addEventListener('click', m.close);
    m.footer.querySelector('[data-act="save"]').addEventListener('click', () => {
      const name = $('#acc-name').value.trim();
      if (!name) { C.toast('Give the account a name', 'error'); return; }
      const data = {
        name,
        type: typeSel.value,
        balance: U.parseAmount($('#acc-balance').value),
        apr: U.parseAmount($('#acc-apr').value),
        minPayment: U.parseAmount($('#acc-min').value),
        originalPrincipal: U.parseAmount($('#acc-principal').value) || null,
        termMonths: Math.round(U.parseAmount($('#acc-term').value)) || null,
        firstPaymentDate: $('#acc-firstpay').value || null
      };
      if (isEdit) { Store.updateAccount(a.id, data); C.toast('Account updated'); }
      else { Store.addAccount(data); C.toast('Account added'); }
      m.close();
      App.refresh();
    });
  }

  window.Views.accounts = {
    openAccountModal,

    render(el) {
      const { assets, liabilities, net } = Store.netWorth();
      const accounts = Store.state.accounts;

      el.innerHTML = `
        <div class="view-header">
          <div class="view-title"><h1>Accounts</h1><p>Everything you own and owe</p></div>
          <div class="view-actions">
            <button class="btn primary" id="acc-add">${C.icon('plus')} Add account</button>
          </div>
        </div>

        <div class="grid cols-3 mb-20">
          <div class="stat-tile"><div class="stat-label">Total assets</div><div class="stat-value">${U.money(assets, { cents: false })}</div></div>
          <div class="stat-tile"><div class="stat-label">Total debt</div><div class="stat-value">${U.money(liabilities, { cents: false })}</div></div>
          <div class="stat-tile"><div class="stat-label">Net worth</div><div class="stat-value">${U.money(net, { cents: false })}</div></div>
        </div>

        <div id="acc-groups"></div>
      `;

      el.querySelector('#acc-add').addEventListener('click', () => openAccountModal());

      const groupsEl = el.querySelector('#acc-groups');
      if (!accounts.length) {
        groupsEl.innerHTML = C.emptyState({
          icon: 'wallet', title: 'No accounts yet',
          text: 'Add your checking, savings, investment, retirement and debt accounts to see your full financial picture.',
          actionHtml: `<button class="btn primary" id="acc-add-empty">${C.icon('plus')} Add your first account</button>`
        });
        groupsEl.querySelector('#acc-add-empty').addEventListener('click', () => openAccountModal());
        return;
      }

      groupsEl.innerHTML = Store.ACCOUNT_GROUPS.map(g => {
        const list = accounts.filter(a => Store.accountType(a).group === g.id && !a.archived);
        const archived = accounts.filter(a => Store.accountType(a).group === g.id && a.archived);
        if (!list.length && !archived.length) return '';
        const isDebt = g.id === 'debt';
        const subtotal = U.sum(list, a => a.balance);
        return `<div class="card mb-14">
          <div class="card-title">${g.label}<span class="hint">${U.money0(subtotal)}</span></div>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Account</th><th>Type</th>${isDebt ? '<th class="num">APR</th><th class="num">Min payment</th>' : ''}<th class="num">Balance</th><th style="width:80px"></th></tr></thead>
            <tbody>
              ${list.map(a => rowHtml(a, isDebt)).join('')}
              ${archived.map(a => rowHtml(a, isDebt, true)).join('')}
            </tbody>
          </table></div>
        </div>`;
      }).join('');

      function rowHtml(a, isDebt, isArchived = false) {
        const t = Store.accountType(a);
        const stats = isDebt ? Engines.loanStats(a) : null;
        const loanLine = stats
          ? `<br><span class="muted small">payment ${stats.paymentsMade} of ${a.termMonths} · scheduled payoff ${U.monthLabel(stats.scheduledPayoff.slice(0, 7))}</span>`
          : '';
        return `<tr data-id="${a.id}" style="${isArchived ? 'opacity:0.45' : ''}">
          <td><b>${U.esc(a.name)}</b>${isArchived ? ' <span class="pill">archived</span>' : ''}${loanLine}</td>
          <td class="muted">${t.label}</td>
          ${isDebt ? `<td class="num">${a.apr ? a.apr.toFixed(2) + '%' : '—'}</td><td class="num">${a.minPayment ? U.money(a.minPayment) : '—'}</td>` : ''}
          <td class="num"><b>${U.money(a.balance)}</b></td>
          <td><div class="row-actions">
            ${isDebt && !isArchived ? `<button class="icon-btn" data-act="schedule" title="Schedule the monthly payment as a recurring transfer">${C.icon('calendar')}</button>` : ''}
            <button class="icon-btn" data-act="edit" title="Edit">${C.icon('pencil')}</button>
            <button class="icon-btn" data-act="archive" title="${isArchived ? 'Unarchive' : 'Archive'}">${C.icon(isArchived ? 'upload' : 'folder')}</button>
            <button class="icon-btn danger" data-act="delete" title="Delete">${C.icon('trash')}</button>
          </div></td>
        </tr>`;
      }

      groupsEl.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const id = btn.closest('tr').dataset.id;
        const a = Store.account(id);
        if (btn.dataset.act === 'schedule') {
          const cash = Store.activeAccounts().find(x => Store.accountType(x).group === 'cash');
          if (!cash) { C.toast('Add a checking or savings account first', 'error'); return; }
          // next payment date: keep the loan's day-of-month if we know it
          let nextDate = U.todayStr();
          if (a.firstPaymentDate) {
            nextDate = a.firstPaymentDate;
            let guard = 0;
            while (nextDate < U.todayStr() && guard++ < 600) nextDate = U.addMonthsToDate(nextDate, 1);
          }
          Views.recurring.openRecurringModal({
            name: `${a.name} Payment`, type: 'transfer', amount: a.minPayment || '',
            accountId: cash.id, toAccountId: a.id, categoryId: null,
            frequency: 'monthly', nextDate, autoPost: false, active: true
          }, true);
        }
        else if (btn.dataset.act === 'edit') openAccountModal(a);
        else if (btn.dataset.act === 'archive') {
          Store.updateAccount(id, { archived: !a.archived });
          App.refresh();
        } else if (btn.dataset.act === 'delete') {
          const ok = await C.confirm({
            title: `Delete ${a.name}?`,
            message: 'This can’t be undone. Accounts with transactions can’t be deleted — archive them instead.',
            confirmLabel: 'Delete account', danger: true
          });
          if (!ok) return;
          const res = Store.deleteAccount(id);
          if (!res.ok) C.toast('This account has transactions — archive it instead', 'error');
          else { C.toast('Account deleted'); }
          App.refresh();
        }
      });
    }
  };
})();
