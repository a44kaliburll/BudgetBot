// Dashboard: KPI row, net worth trend, cash flow, budget glance, upcoming bills.
(function () {
  'use strict';
  window.Views = window.Views || {};

  function kpiTile(label, value, deltaHtml = '') {
    return `<div class="stat-tile">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
      ${deltaHtml ? `<div class="stat-delta">${deltaHtml}</div>` : ''}
    </div>`;
  }

  window.Views.dashboard = {
    render(el) {
      const s = Store.state;
      const mk = U.thisMonth();
      const { assets, liabilities, net } = Store.netWorth();
      const totals = Store.monthTotals(mk);
      const budget = Store.budgetFor(mk);
      const budgetTotal = U.sum(Object.values(budget));
      const spendByCat = Store.spendingByCategory(mk);
      const budgetSpent = U.sum([...spendByCat.entries()].filter(([k]) => budget[k] != null), ([, v]) => v);

      // net worth delta vs previous month snapshot
      const hist = s.netWorthHistory;
      const prev = hist.length >= 2 ? hist[hist.length - 2] : null;
      let nwDelta = '';
      if (prev) {
        const d = net - prev.net;
        const cls = d >= 0 ? 'up' : 'down';
        nwDelta = `<span class="${cls}">${U.moneySigned(d)}</span> vs ${U.monthLabelShort(prev.month)}`;
      }

      const savingsRate = totals.income > 0 ? Math.max(0, totals.net) / totals.income : null;

      const hasData = s.accounts.length > 0 || s.transactions.length > 0;

      el.innerHTML = `
        <div class="view-header">
          <div class="view-title">
            <h1>Dashboard</h1>
            <p>${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
          </div>
          <div class="view-actions">
            <button class="btn primary" id="dash-add-tx">${C.icon('plus')} Add transaction</button>
          </div>
        </div>

        ${!hasData ? C.emptyState({
          icon: 'egg',
          title: 'Welcome to NestEgg',
          text: 'Add your first account to start tracking your money, or load the sample dataset to explore every feature.',
          actionHtml: `<div class="flex" style="justify-content:center"><button class="btn primary" id="dash-add-account">${C.icon('plus')} Add account</button><button class="btn" id="dash-load-demo">${C.icon('sparkle')} Load sample data</button></div>`
        }) : `
        <div class="grid cols-4 mb-14">
          ${kpiTile('Net worth', U.money(net, { cents: false }), nwDelta)}
          ${kpiTile('Income · ' + U.monthLabelShort(mk), U.money(totals.income, { cents: false }))}
          ${kpiTile('Spending · ' + U.monthLabelShort(mk), U.money(totals.expenses, { cents: false }),
            budgetTotal > 0 ? `${U.pct(budgetSpent / budgetTotal)} of ${U.money0(budgetTotal)} budget` : '')}
          ${kpiTile('Savings rate', savingsRate == null ? '—' : U.pct(savingsRate),
            savingsRate == null ? 'no income recorded yet' : U.money(totals.net, { cents: false }) + ' kept this month')}
        </div>

        <div class="grid cols-2 mb-14">
          <div class="card">
            <div class="card-title">Net worth trend <span class="hint">assets ${U.money0(assets)} · debts ${U.money0(liabilities)}</span></div>
            <div class="chart-box" style="height:220px"><canvas id="dash-nw"></canvas></div>
          </div>
          <div class="card">
            <div class="card-title">Cash flow <span class="hint">last 6 months</span></div>
            <div class="chart-box" style="height:220px"><canvas id="dash-flow"></canvas></div>
            <div id="dash-flow-legend"></div>
          </div>
        </div>

        <div class="grid cols-3">
          <div class="card">
            <div class="card-title">Top spending · ${U.monthLabelShort(mk)}</div>
            <div id="dash-topspend"></div>
          </div>
          <div class="card">
            <div class="card-title">Budget at a glance
              <button class="btn ghost sm" data-goto="budget">View all</button>
            </div>
            <div id="dash-budget"></div>
          </div>
          <div class="card">
            <div class="card-title">Coming up <span class="hint">next 14 days</span></div>
            <div id="dash-upcoming"></div>
            <div class="divider"></div>
            <div class="card-title">Retirement outlook
              <button class="btn ghost sm" data-goto="retirement">Open planner</button>
            </div>
            <div id="dash-retire"></div>
          </div>
        </div>`}
      `;

      el.querySelector('#dash-add-tx')?.addEventListener('click', () => Views.transactions.openTxModal());
      el.querySelector('#dash-add-account')?.addEventListener('click', () => { App.go('accounts'); setTimeout(() => Views.accounts.openAccountModal(), 60); });
      el.querySelector('#dash-load-demo')?.addEventListener('click', () => {
        Store.replaceState(Demo.build());
        C.toast('Sample data loaded');
        App.refresh();
      });
      el.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => App.go(b.dataset.goto)));

      if (!hasData) return;

      // ---- net worth chart ----
      const col = ChartKit.colors();
      const nwData = hist.slice(-12);
      if (nwData.length >= 2) {
        ChartKit.line(el.querySelector('#dash-nw'), {
          labels: nwData.map(h => U.monthLabelShort(h.month)),
          series: [{ label: 'Net worth', data: nwData.map(h => h.net), color: col.s[0], fill: true }]
        });
      } else {
        el.querySelector('#dash-nw').closest('.chart-box').innerHTML =
          `<p class="muted small" style="padding:20px">Net worth snapshots build up automatically each month you use NestEgg.</p>`;
      }

      // ---- cash flow chart ----
      const months = U.lastMonths(6);
      const flows = months.map(m => Store.monthTotals(m));
      ChartKit.bars(el.querySelector('#dash-flow'), {
        labels: months.map(U.monthLabelShort),
        series: [
          { label: 'Income', data: flows.map(f => f.income), color: col.s[1] },
          { label: 'Spending', data: flows.map(f => f.expenses), color: col.s[5] }
        ]
      });
      ChartKit.legend(el.querySelector('#dash-flow-legend'), [
        { label: 'Income', color: col.s[1] }, { label: 'Spending', color: col.s[5] }
      ]);

      // ---- top spending hbar list ----
      const top = U.sortBy([...spendByCat.entries()], ([, v]) => v, true).slice(0, 6);
      const maxV = top.length ? top[0][1] : 1;
      el.querySelector('#dash-topspend').innerHTML = top.length ? `<div class="hbar-list">${
        top.map(([catId, v]) => {
          const cat = Store.category(catId);
          const color = cat ? C.slotColor(cat.colorSlot) : 'var(--ink-3)';
          return `<div class="hbar-row">
            <span class="name">${U.esc(cat ? cat.name : 'Uncategorized')}</span>
            <span class="track"><span class="bar" style="width:${Math.max(2, v / maxV * 100)}%;background:${color}"></span></span>
            <span class="val">${U.money0(v)}</span>
          </div>`;
        }).join('')}</div>`
        : `<p class="muted small">No spending recorded this month yet.</p>`;

      // ---- budget glance ----
      const bItems = Object.entries(budget)
        .map(([catId, amt]) => ({ cat: Store.category(catId), amt, spent: spendByCat.get(catId) || 0 }))
        .filter(x => x.cat)
        .sort((a, b) => (b.spent / b.amt) - (a.spent / a.amt))
        .slice(0, 5);
      el.querySelector('#dash-budget').innerHTML = bItems.length ? bItems.map(x => {
        const ratio = x.spent / x.amt;
        return `<div class="mb-8">
          <div class="flex-between small"><span>${C.catDot(x.cat)}${U.esc(x.cat.name)}</span>
            <span class="muted">${U.money0(x.spent)} / ${U.money0(x.amt)}</span></div>
          <div class="progress mt-8"><div class="fill ${C.progressClass(ratio)}" style="width:${U.clamp(ratio * 100, 2, 100)}%"></div></div>
        </div>`;
      }).join('')
        : `<p class="muted small">No budget set for this month. <br>Head to Budget to plan your spending.</p>`;

      // ---- upcoming recurring ----
      const horizon = U.addDays(U.todayStr(), 14);
      const upcoming = U.sortBy(s.recurring.filter(r => r.active && r.nextDate <= horizon), r => r.nextDate).slice(0, 5);
      el.querySelector('#dash-upcoming').innerHTML = upcoming.length ? upcoming.map(r => {
        const overdue = r.nextDate < U.todayStr();
        return `<div class="flex-between small mb-8">
          <span>${U.esc(r.name)}<br><span class="muted">${U.dateLabelShort(r.nextDate)}${overdue ? ' · overdue' : ''}</span></span>
          <span class="amount ${r.type === 'income' ? 'pos' : ''}">${r.type === 'income' ? '+' : '−'}${U.money(r.amount)}</span>
        </div>`;
      }).join('')
        : `<p class="muted small">Nothing due in the next two weeks.</p>`;

      // ---- retirement snippet (quick Monte Carlo) ----
      const retireEl = el.querySelector('#dash-retire');
      const r = s.retirement;
      if (r.currentAge < r.retireAge) {
        const start = r.currentSavingsOverride != null ? r.currentSavingsOverride : Store.retirementSavings().total;
        const mc = Engines.retirementMonteCarlo(r, start, 400, 42);
        const proj = Engines.retirementProject(r, start);
        const pctCls = mc.successRate >= 0.85 ? 'status-good' : mc.successRate >= 0.65 ? 'status-warning' : 'status-critical';
        retireEl.innerHTML = `
          <div class="flex-between">
            <div>
              <div class="stat-value sm">${U.money0(proj.nestEggNominal)}</div>
              <div class="muted small">projected at age ${r.retireAge}</div>
            </div>
            <span class="pill ${pctCls}">${Math.round(mc.successRate * 100)}% success</span>
          </div>`;
      } else {
        retireEl.innerHTML = `<p class="muted small">Set your ages in the Retirement planner.</p>`;
      }
    }
  };
})();
