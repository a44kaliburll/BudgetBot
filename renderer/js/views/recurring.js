// Recurring: scheduled bills, income, and transfers with due-processing.
(function () {
  'use strict';
  window.Views = window.Views || {};

  function openRecurringModal(rec) {
    const isEdit = !!rec;
    const accounts = Store.activeAccounts();
    if (!accounts.length) { C.toast('Add an account first', 'error'); return; }
    const r = rec || {
      name: '', type: 'expense', amount: '', accountId: accounts[0].id, toAccountId: '',
      categoryId: '', frequency: 'monthly', nextDate: U.todayStr(), autoPost: false, active: true
    };
    let curType = r.type;
    const accOptions = accounts.map(a => ({ value: a.id, label: a.name }));
    const freqOptions = Object.entries(Store.FREQUENCIES).map(([value, f]) => ({ value, label: f.label }));

    const m = C.modal({
      title: isEdit ? 'Edit recurring item' : 'Add recurring item',
      body: `
        <div class="mb-14">${C.segmented('rec-type', [
          { value: 'expense', label: 'Bill / expense' },
          { value: 'income', label: 'Income' },
          { value: 'transfer', label: 'Transfer' }
        ], curType)}</div>
        <div class="form-grid">
          ${C.input({ id: 'rec-name', label: 'Name', value: r.name, placeholder: 'e.g. Rent, Netflix, Payroll', full: true })}
          ${C.input({ id: 'rec-amount', label: 'Amount', type: 'number', step: '0.01', min: 0, value: r.amount })}
          ${C.select({ id: 'rec-freq', label: 'Repeats', options: freqOptions, value: r.frequency })}
          <div id="rec-acc-wrap">${C.select({ id: 'rec-account', label: 'Account', options: accOptions, value: r.accountId })}</div>
          <div id="rec-cat-wrap"></div>
          ${C.input({ id: 'rec-next', label: 'Next due date', type: 'date', value: r.nextDate })}
          <div class="field"><label>&nbsp;</label>${C.checkbox({ id: 'rec-autopost', label: 'Post automatically when due', checked: r.autoPost })}</div>
        </div>`,
      footer: `<button class="btn ghost" data-act="cancel">Cancel</button>
               <button class="btn primary" data-act="save">${isEdit ? 'Save changes' : 'Add recurring'}</button>`
    });

    function renderCatOrTarget() {
      const wrap = m.body.querySelector('#rec-cat-wrap');
      const accLabel = m.body.querySelector('#rec-acc-wrap label');
      if (curType === 'transfer') {
        accLabel.textContent = 'From account';
        wrap.innerHTML = C.select({ id: 'rec-toaccount', label: 'To account', options: accOptions, value: r.toAccountId || accOptions[0].value });
      } else {
        accLabel.textContent = 'Account';
        const cats = (curType === 'income' ? Store.incomeCategories() : Store.expenseCategories())
          .map(c => ({ value: c.id, label: c.name }));
        cats.unshift({ value: '', label: '(uncategorized)' });
        wrap.innerHTML = C.select({ id: 'rec-category', label: 'Category', options: cats, value: r.categoryId || '' });
      }
    }
    renderCatOrTarget();
    C.wireSegmented(m.body.querySelector('#rec-type'), v => { curType = v; renderCatOrTarget(); });

    m.footer.querySelector('[data-act="cancel"]').addEventListener('click', m.close);
    m.footer.querySelector('[data-act="save"]').addEventListener('click', () => {
      const name = m.body.querySelector('#rec-name').value.trim();
      const amount = U.parseAmount(m.body.querySelector('#rec-amount').value);
      if (!name) { C.toast('Give it a name', 'error'); return; }
      if (!(amount > 0)) { C.toast('Enter an amount', 'error'); return; }
      const data = {
        name, amount, type: curType,
        accountId: m.body.querySelector('#rec-account').value,
        toAccountId: curType === 'transfer' ? m.body.querySelector('#rec-toaccount').value : null,
        categoryId: curType !== 'transfer' ? (m.body.querySelector('#rec-category').value || null) : null,
        frequency: m.body.querySelector('#rec-freq').value,
        nextDate: m.body.querySelector('#rec-next').value || U.todayStr(),
        autoPost: m.body.querySelector('#rec-autopost').checked
      };
      if (data.type === 'transfer' && data.toAccountId === data.accountId) { C.toast('Pick two different accounts', 'error'); return; }
      if (isEdit) { Store.updateRecurring(r.id, data); C.toast('Recurring item updated'); }
      else { Store.addRecurring(data); C.toast('Recurring item added'); }
      m.close();
      App.refresh();
    });
  }

  window.Views.recurring = {
    render(el) {
      const recs = Store.state.recurring;
      const today = U.todayStr();
      const due = recs.filter(r => r.active && r.nextDate <= today);
      const monthlyBills = U.sum(recs.filter(r => r.active && r.type === 'expense'), r => Store.monthlyEquivalent(r));
      const monthlyIncome = U.sum(recs.filter(r => r.active && r.type === 'income'), r => Store.monthlyEquivalent(r));
      const monthlyTransfers = U.sum(recs.filter(r => r.active && r.type === 'transfer'), r => Store.monthlyEquivalent(r));

      el.innerHTML = `
        <div class="view-header">
          <div class="view-title"><h1>Recurring</h1><p>Bills, subscriptions, paychecks and automatic savings</p></div>
          <div class="view-actions"><button class="btn primary" id="rec-add">${C.icon('plus')} Add recurring</button></div>
        </div>

        <div class="grid cols-3 mb-14">
          <div class="stat-tile"><div class="stat-label">Recurring income</div><div class="stat-value sm">${U.money0(monthlyIncome)}<span class="muted small"> /mo</span></div></div>
          <div class="stat-tile"><div class="stat-label">Recurring bills</div><div class="stat-value sm">${U.money0(monthlyBills)}<span class="muted small"> /mo</span></div></div>
          <div class="stat-tile"><div class="stat-label">Auto transfers &amp; savings</div><div class="stat-value sm">${U.money0(monthlyTransfers)}<span class="muted small"> /mo</span></div></div>
        </div>

        ${due.length ? `<div class="card mb-14" style="border-color:var(--warning)">
          <div class="card-title">${C.icon('alert')} Due now</div>
          ${due.map(r => `<div class="flex-between mb-8" data-id="${r.id}">
            <span><b>${U.esc(r.name)}</b> <span class="muted small">· ${U.dateLabelShort(r.nextDate)} · ${U.money(r.amount)}</span></span>
            <span class="flex">
              <button class="btn sm primary" data-act="post">Post now</button>
              <button class="btn sm ghost" data-act="skip">Skip</button>
            </span>
          </div>`).join('')}
        </div>` : ''}

        <div class="card">
          ${recs.length ? `<div class="table-wrap"><table class="data">
            <thead><tr><th>Name</th><th>Repeats</th><th>Next due</th><th>Account</th><th class="num">Amount</th><th class="num">≈ Monthly</th><th style="width:90px"></th></tr></thead>
            <tbody>${U.sortBy(recs, r => r.nextDate).map(r => {
              const freq = Store.FREQUENCIES[r.frequency]?.label || r.frequency;
              const accCell = r.type === 'transfer'
                ? `${U.esc(Store.accountName(r.accountId))} → ${U.esc(Store.accountName(r.toAccountId))}`
                : U.esc(Store.accountName(r.accountId));
              return `<tr data-id="${r.id}" style="${r.active ? '' : 'opacity:0.45'}">
                <td><b>${U.esc(r.name)}</b> ${r.autoPost ? '<span class="pill">auto</span>' : ''}${r.active ? '' : ' <span class="pill">paused</span>'}</td>
                <td class="muted">${freq}</td>
                <td class="nowrap">${U.dateLabelShort(r.nextDate)}</td>
                <td class="muted">${accCell}</td>
                <td class="num amount ${r.type === 'income' ? 'pos' : r.type === 'expense' ? 'neg' : ''}">${r.type === 'income' ? '+' : r.type === 'expense' ? '−' : ''}${U.money(r.amount)}</td>
                <td class="num muted">${U.money0(Store.monthlyEquivalent(r))}</td>
                <td><div class="row-actions">
                  <button class="icon-btn" data-act="toggle" title="${r.active ? 'Pause' : 'Resume'}">${C.icon(r.active ? 'x' : 'check')}</button>
                  <button class="icon-btn" data-act="edit" title="Edit">${C.icon('pencil')}</button>
                  <button class="icon-btn danger" data-act="delete" title="Delete">${C.icon('trash')}</button>
                </div></td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>`
          : C.emptyState({
              icon: 'repeat', title: 'No recurring items',
              text: 'Add rent, subscriptions, paychecks and automatic savings — NestEgg will remind you when they’re due and can post them automatically.',
              actionHtml: `<button class="btn primary" id="rec-add-empty">${C.icon('plus')} Add recurring item</button>`
            })}
        </div>
      `;

      el.querySelector('#rec-add').addEventListener('click', () => openRecurringModal());
      el.querySelector('#rec-add-empty')?.addEventListener('click', () => openRecurringModal());

      el.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const id = btn.closest('[data-id]')?.dataset.id;
        if (!id) return;
        const r = Store.state.recurring.find(x => x.id === id);
        switch (btn.dataset.act) {
          case 'post':
            Store.postRecurring(id);
            C.toast(`Posted ${r.name}`);
            App.refresh();
            break;
          case 'skip':
            Store.skipRecurring(id);
            App.refresh();
            break;
          case 'toggle':
            Store.updateRecurring(id, { active: !r.active });
            App.refresh();
            break;
          case 'edit':
            openRecurringModal(r);
            break;
          case 'delete': {
            const ok = await C.confirm({ title: `Delete “${r.name}”?`, message: 'Already-posted transactions are kept.', confirmLabel: 'Delete', danger: true });
            if (ok) { Store.deleteRecurring(id); App.refresh(); }
            break;
          }
        }
      });
    }
  };
})();
