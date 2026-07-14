// Savings goals: cards with progress, funding pace, add-funds.
(function () {
  'use strict';
  window.Views = window.Views || {};

  function openGoalModal(goal) {
    const isEdit = !!goal;
    const g = goal || { name: '', targetAmount: '', targetDate: '', linkedAccountId: '', manualSaved: 0 };
    const accounts = Store.activeAccounts().filter(a => Store.accountType(a).kind === 'asset');
    const accOptions = [{ value: '', label: 'Track manually' },
      ...accounts.map(a => ({ value: a.id, label: `Linked to ${a.name}` }))];

    const m = C.modal({
      title: isEdit ? 'Edit goal' : 'New savings goal',
      body: `<div class="form-grid">
        ${C.input({ id: 'goal-name', label: 'Goal name', value: g.name, placeholder: 'e.g. Emergency fund', full: true })}
        ${C.input({ id: 'goal-target', label: 'Target amount', type: 'number', step: '1', min: 0, value: g.targetAmount })}
        ${C.input({ id: 'goal-date', label: 'Target date', type: 'date', value: g.targetDate || '', sub: 'optional' })}
        ${C.select({ id: 'goal-linked', label: 'Progress source', options: accOptions, value: g.linkedAccountId || '', full: true, sub: 'linked goals track an account balance automatically' })}
        <div id="goal-manual-wrap" class="full">${C.input({ id: 'goal-saved', label: 'Saved so far', type: 'number', step: '0.01', min: 0, value: g.manualSaved })}</div>
      </div>`,
      footer: `<button class="btn ghost" data-act="cancel">Cancel</button>
               <button class="btn primary" data-act="save">${isEdit ? 'Save changes' : 'Create goal'}</button>`
    });

    const linkedSel = m.body.querySelector('#goal-linked');
    const manualWrap = m.body.querySelector('#goal-manual-wrap');
    const syncManual = () => { manualWrap.style.display = linkedSel.value ? 'none' : ''; };
    linkedSel.addEventListener('change', syncManual);
    syncManual();

    m.footer.querySelector('[data-act="cancel"]').addEventListener('click', m.close);
    m.footer.querySelector('[data-act="save"]').addEventListener('click', () => {
      const name = m.body.querySelector('#goal-name').value.trim();
      const targetAmount = U.parseAmount(m.body.querySelector('#goal-target').value);
      if (!name) { C.toast('Give the goal a name', 'error'); return; }
      if (!(targetAmount > 0)) { C.toast('Set a target amount', 'error'); return; }
      const data = {
        name, targetAmount,
        targetDate: m.body.querySelector('#goal-date').value || null,
        linkedAccountId: linkedSel.value || null,
        manualSaved: U.parseAmount(m.body.querySelector('#goal-saved').value)
      };
      if (isEdit) { Store.updateGoal(g.id, data); C.toast('Goal updated'); }
      else { Store.addGoal(data); C.toast('Goal created'); }
      m.close();
      App.refresh();
    });
  }

  function openAddFunds(g) {
    const m = C.modal({
      title: `Add funds — ${g.name}`,
      body: C.input({ id: 'fund-amount', label: 'Amount to add', type: 'number', step: '0.01', min: 0, value: '' }),
      footer: `<button class="btn ghost" data-act="cancel">Cancel</button>
               <button class="btn primary" data-act="save">Add funds</button>`
    });
    m.footer.querySelector('[data-act="cancel"]').addEventListener('click', m.close);
    m.footer.querySelector('[data-act="save"]').addEventListener('click', () => {
      const amt = U.parseAmount(m.body.querySelector('#fund-amount').value);
      if (!(amt > 0)) { C.toast('Enter an amount', 'error'); return; }
      Store.updateGoal(g.id, { manualSaved: U.round2((g.manualSaved || 0) + amt) });
      C.toast(`${U.money(amt)} added to ${g.name}`);
      m.close();
      App.refresh();
    });
  }

  window.Views.goals = {
    render(el) {
      const goals = Store.state.goals;

      el.innerHTML = `
        <div class="view-header">
          <div class="view-title"><h1>Goals</h1><p>Save with purpose — emergency fund, trips, big purchases</p></div>
          <div class="view-actions"><button class="btn primary" id="goal-add">${C.icon('plus')} New goal</button></div>
        </div>
        <div class="grid cols-3" id="goal-grid"></div>
      `;

      el.querySelector('#goal-add').addEventListener('click', () => openGoalModal());
      const grid = el.querySelector('#goal-grid');

      if (!goals.length) {
        grid.innerHTML = '';
        grid.insertAdjacentHTML('beforebegin', C.emptyState({
          icon: 'target', title: 'No goals yet',
          text: 'Create a goal, link it to a savings account or track it manually, and NestEgg shows the monthly pace you need to hit it.',
          actionHtml: `<button class="btn primary" id="goal-add-empty">${C.icon('plus')} Create your first goal</button>`
        }));
        el.querySelector('#goal-add-empty').addEventListener('click', () => openGoalModal());
        return;
      }

      grid.innerHTML = goals.map(g => {
        const saved = Store.goalSaved(g);
        const ratio = g.targetAmount > 0 ? saved / g.targetAmount : 0;
        const done = ratio >= 1;
        const color = C.slotColor(g.colorSlot);
        let pace = '';
        if (!done && g.targetDate) {
          const monthsLeft = Math.max(1, Math.round(U.daysBetween(U.todayStr(), g.targetDate) / 30.4));
          if (U.daysBetween(U.todayStr(), g.targetDate) <= 0) pace = `<span style="color:var(--critical)">target date passed</span>`;
          else pace = `save <b>${U.money0((g.targetAmount - saved) / monthsLeft)}/mo</b> to finish by ${U.dateLabel(g.targetDate)}`;
        } else if (!done) {
          pace = `${U.money0(g.targetAmount - saved)} to go`;
        }
        return `<div class="card goal-card" data-id="${g.id}">
          <div class="goal-head">
            <div>
              <div class="goal-name">${C.catDot({ colorSlot: g.colorSlot })}${U.esc(g.name)}</div>
              <div class="muted small">${g.linkedAccountId ? `linked to ${U.esc(Store.accountName(g.linkedAccountId))}` : 'tracked manually'}</div>
            </div>
            ${done ? `<span class="pill status-good">${C.icon('check')} done</span>` : `<span class="pill">${Math.round(ratio * 100)}%</span>`}
          </div>
          <div class="progress"><div class="fill" style="width:${U.clamp(ratio * 100, 2, 100)}%;background:${color}"></div></div>
          <div class="flex-between small">
            <span><b>${U.money0(saved)}</b> <span class="muted">of ${U.money0(g.targetAmount)}</span></span>
            <span class="muted">${pace}</span>
          </div>
          <div class="flex">
            ${!g.linkedAccountId ? `<button class="btn sm" data-act="fund">${C.icon('plus')} Add funds</button>` : ''}
            <div class="grow"></div>
            <button class="icon-btn" data-act="edit" title="Edit">${C.icon('pencil')}</button>
            <button class="icon-btn danger" data-act="delete" title="Delete">${C.icon('trash')}</button>
          </div>
        </div>`;
      }).join('');

      grid.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const id = btn.closest('[data-id]').dataset.id;
        const g = Store.state.goals.find(x => x.id === id);
        if (btn.dataset.act === 'fund') openAddFunds(g);
        else if (btn.dataset.act === 'edit') openGoalModal(g);
        else if (btn.dataset.act === 'delete') {
          const ok = await C.confirm({ title: `Delete “${g.name}”?`, message: 'Linked accounts and transactions are not affected.', confirmLabel: 'Delete goal', danger: true });
          if (ok) { Store.deleteGoal(id); App.refresh(); }
        }
      });
    }
  };
})();
