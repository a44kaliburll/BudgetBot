// Budget: monthly plan vs actual per category, with category manager.
(function () {
  'use strict';
  window.Views = window.Views || {};

  let month = U.thisMonth();

  function openCategoryManager() {
    const renderList = () => {
      const groups = [['expense', 'Expense categories'], ['income', 'Income categories']];
      return groups.map(([g, label]) => `
        <div class="card-title mt-14">${label}</div>
        ${Store.state.categories.filter(c => c.group === g).map(c => `
          <div class="flex mb-8" data-id="${c.id}">
            ${C.catDot(c)}
            <input type="text" value="${U.esc(c.name)}" data-role="name" style="flex:1">
            <button class="icon-btn danger" data-role="del" title="Delete category">${C.icon('trash')}</button>
          </div>`).join('')}
        <div class="flex mb-8">
          <input type="text" placeholder="New ${g} category…" data-role="new-${g}">
          <button class="btn sm" data-role="add-${g}">${C.icon('plus')} Add</button>
        </div>`).join('');
    };

    const m = C.modal({
      title: 'Manage categories',
      body: `<div id="cat-mgr">${renderList()}</div>`,
      footer: `<button class="btn primary" data-act="done">Done</button>`
    });
    const body = m.body.querySelector('#cat-mgr');

    body.addEventListener('change', (e) => {
      const row = e.target.closest('[data-id]');
      if (row && e.target.dataset.role === 'name') {
        const name = e.target.value.trim();
        if (name) Store.updateCategory(row.dataset.id, { name });
      }
    });
    body.addEventListener('click', async (e) => {
      const row = e.target.closest('[data-id]');
      if (row && e.target.closest('[data-role="del"]')) {
        const c = Store.category(row.dataset.id);
        const ok = await C.confirm({
          title: `Delete “${c.name}”?`,
          message: 'Transactions in this category become uncategorized and its budgets are removed.',
          confirmLabel: 'Delete category', danger: true
        });
        if (ok) { Store.deleteCategory(row.dataset.id); body.innerHTML = renderList(); }
        return;
      }
      for (const g of ['expense', 'income']) {
        if (e.target.closest(`[data-role="add-${g}"]`)) {
          const inp = body.querySelector(`[data-role="new-${g}"]`);
          const name = inp.value.trim();
          if (name) { Store.addCategory(name, g); body.innerHTML = renderList(); }
        }
      }
    });

    m.footer.querySelector('[data-act="done"]').addEventListener('click', () => { m.close(); App.refresh(); });
  }

  window.Views.budget = {
    render(el) {
      const budget = Store.budgetFor(month);
      const spend = Store.spendingByCategory(month);
      const totals = Store.monthTotals(month);
      const cats = Store.expenseCategories();

      const totalBudget = U.sum(Object.values(budget));
      const totalSpentBudgeted = U.sum(cats.filter(c => budget[c.id]), c => spend.get(c.id) || 0);
      const unbudgeted = cats.filter(c => !budget[c.id] && (spend.get(c.id) || 0) > 0);
      const unbudgetedSpend = U.sum(unbudgeted, c => spend.get(c.id) || 0) + (spend.get('uncat') || 0);

      const prevMonth = U.monthAdd(month, -1);
      const hasPrev = Object.keys(Store.budgetFor(prevMonth)).length > 0;

      el.innerHTML = `
        <div class="view-header">
          <div class="view-title"><h1>Budget</h1><p>Plan your spending, then watch it hold</p></div>
          <div class="view-actions">
            ${C.monthNav('bud-month', month)}
            <button class="btn" id="bud-cats">${C.icon('pencil')} Categories</button>
            ${hasPrev ? `<button class="btn" id="bud-copy">${C.icon('repeat')} Copy last month</button>` : ''}
            <button class="btn" id="bud-auto">${C.icon('sparkle')} Auto-fill from history</button>
          </div>
        </div>

        <div class="grid cols-4 mb-14">
          <div class="stat-tile"><div class="stat-label">Income · ${U.monthLabelShort(month)}</div><div class="stat-value sm">${U.money0(totals.income)}</div></div>
          <div class="stat-tile"><div class="stat-label">Total budgeted</div><div class="stat-value sm">${U.money0(totalBudget)}</div>
            <div class="stat-delta">${totals.income > 0 ? U.pct(totalBudget / totals.income) + ' of income' : ''}</div></div>
          <div class="stat-tile"><div class="stat-label">Spent so far</div><div class="stat-value sm">${U.money0(totals.expenses)}</div>
            <div class="stat-delta">${totalBudget > 0 ? U.pct(totalSpentBudgeted / totalBudget) + ' of budget used' : ''}</div></div>
          <div class="stat-tile"><div class="stat-label">Left to spend</div>
            <div class="stat-value sm amount ${totalBudget - totalSpentBudgeted >= 0 ? '' : 'neg'}">${U.money0(totalBudget - totalSpentBudgeted)}</div></div>
        </div>

        <div class="card">
          <div class="card-title">Spending plan · ${U.monthLabel(month)}</div>
          <div class="table-wrap"><table class="data" id="bud-table">
            <thead><tr>
              <th>Category</th><th class="num" style="width:140px">Budget</th>
              <th style="width:34%">Progress</th>
              <th class="num">Spent</th><th class="num">Remaining</th>
            </tr></thead>
            <tbody>
              ${cats.map(c => {
                const b = budget[c.id] || 0;
                const sp = spend.get(c.id) || 0;
                if (!b && !sp) {
                  return `<tr data-id="${c.id}" class="bud-zero">
                    <td>${C.catDot(c)}${U.esc(c.name)}</td>
                    <td class="num"><input type="number" step="1" min="0" data-role="amt" value="" placeholder="—" style="text-align:right;padding:4px 8px"></td>
                    <td></td><td class="num muted">—</td><td class="num muted">—</td></tr>`;
                }
                const ratio = b > 0 ? sp / b : (sp > 0 ? 1.01 : 0);
                const rem = b - sp;
                return `<tr data-id="${c.id}">
                  <td>${C.catDot(c)}<b>${U.esc(c.name)}</b></td>
                  <td class="num"><input type="number" step="1" min="0" data-role="amt" value="${b || ''}" placeholder="—" style="text-align:right;padding:4px 8px"></td>
                  <td><div class="progress"><div class="fill ${C.progressClass(ratio)}" style="width:${U.clamp(ratio * 100, 2, 100)}%"></div></div>
                    ${ratio > 1 ? `<span class="small" style="color:var(--critical)">over by ${U.money0(sp - b)}</span>` : ''}</td>
                  <td class="num">${U.money(sp)}</td>
                  <td class="num amount ${rem >= 0 ? '' : 'neg'}">${U.money(rem)}</td>
                </tr>`;
              }).join('')}
            </tbody>
            <tbody>
              <tr style="border-top:2px solid var(--baseline)">
                <td><b>Total</b></td>
                <td class="num"><b>${U.money0(totalBudget)}</b></td>
                <td></td>
                <td class="num"><b>${U.money0(totalSpentBudgeted)}</b></td>
                <td class="num"><b>${U.money0(totalBudget - totalSpentBudgeted)}</b></td>
              </tr>
            </tbody>
          </table></div>
          ${unbudgetedSpend > 0 ? `<div class="callout warn mt-14">
            <b>${U.money0(unbudgetedSpend)}</b> spent outside the budget${unbudgeted.length ? ` (${unbudgeted.map(c => U.esc(c.name)).join(', ')}${spend.get('uncat') ? ', uncategorized' : ''})` : ' (uncategorized)'} — set budgets above or recategorize.
          </div>` : ''}
        </div>
      `;

      el.querySelector('#bud-month').addEventListener('click', (e) => {
        const b = e.target.closest('[data-nav]');
        if (!b) return;
        month = U.monthAdd(month, Number(b.dataset.nav));
        App.refresh();
      });

      el.querySelector('#bud-cats').addEventListener('click', openCategoryManager);

      el.querySelector('#bud-copy')?.addEventListener('click', () => {
        Store.copyBudget(prevMonth, month);
        C.toast(`Copied budget from ${U.monthLabel(prevMonth)}`);
        App.refresh();
      });

      el.querySelector('#bud-auto').addEventListener('click', async () => {
        const ok = await C.confirm({
          title: 'Auto-fill budget?',
          message: 'Sets each category’s budget to its average spending over the past 3 months (rounded up to the nearest $10). Existing values are overwritten.',
          confirmLabel: 'Auto-fill'
        });
        if (!ok) return;
        const past = [1, 2, 3].map(i => Store.spendingByCategory(U.monthAdd(month, -i)));
        for (const c of cats) {
          const avg = U.sum(past, m => m.get(c.id) || 0) / 3;
          if (avg > 0) Store.setBudget(month, c.id, Math.ceil(avg / 10) * 10);
        }
        C.toast('Budget filled from 3-month averages');
        App.refresh();
      });

      el.querySelector('#bud-table').addEventListener('change', (e) => {
        if (e.target.dataset.role !== 'amt') return;
        const catId = e.target.closest('tr').dataset.id;
        Store.setBudget(month, catId, U.parseAmount(e.target.value));
        App.refresh();
      });
    }
  };
})();
