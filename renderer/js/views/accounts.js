// Accounts: grouped balances, add/edit/archive/delete.
(function () {
  'use strict';
  window.Views = window.Views || {};

  function openAccountModal(account) {
    const isEdit = !!account;
    const a = account || { name: '', type: 'checking', balance: 0, apr: 0, minPayment: 0 };
    const typeOptions = Object.entries(Store.ACCOUNT_TYPES).map(([value, t]) => ({ value, label: t.label }));

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
      </div>`,
      footer: `<button class="btn ghost" data-act="cancel">Cancel</button>
               <button class="btn primary" data-act="save">${isEdit ? 'Save changes' : 'Add account'}</button>`
    });

    const typeSel = m.body.querySelector('#acc-type');
    const debtFields = m.body.querySelector('#acc-debt-fields');
    const syncDebt = () => {
      const t = Store.ACCOUNT_TYPES[typeSel.value];
      debtFields.style.display = t.kind === 'liability' ? 'grid' : 'none';
    };
    typeSel.addEventListener('change', syncDebt);
    syncDebt();

    m.footer.querySelector('[data-act="cancel"]').addEventListener('click', m.close);
    m.footer.querySelector('[data-act="save"]').addEventListener('click', () => {
      const name = m.body.querySelector('#acc-name').value.trim();
      if (!name) { C.toast('Give the account a name', 'error'); return; }
      const data = {
        name,
        type: typeSel.value,
        balance: U.parseAmount(m.body.querySelector('#acc-balance').value),
        apr: U.parseAmount(m.body.querySelector('#acc-apr').value),
        minPayment: U.parseAmount(m.body.querySelector('#acc-min').value)
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
        return `<tr data-id="${a.id}" style="${isArchived ? 'opacity:0.45' : ''}">
          <td><b>${U.esc(a.name)}</b>${isArchived ? ' <span class="pill">archived</span>' : ''}</td>
          <td class="muted">${t.label}</td>
          ${isDebt ? `<td class="num">${a.apr ? a.apr.toFixed(2) + '%' : '—'}</td><td class="num">${a.minPayment ? U.money(a.minPayment) : '—'}</td>` : ''}
          <td class="num"><b>${U.money(a.balance)}</b></td>
          <td><div class="row-actions">
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
        if (btn.dataset.act === 'edit') openAccountModal(a);
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
