// Debt payoff planner: snowball vs avalanche with interest comparison.
(function () {
  'use strict';
  window.Views = window.Views || {};

  let extra = 200;
  let strategy = 'avalanche';

  window.Views.debt = {
    render(el) {
      const debts = Store.activeAccounts()
        .filter(a => Store.accountType(a).kind === 'liability' && a.balance > 0)
        .map(a => ({ id: a.id, name: a.name, balance: a.balance, apr: a.apr || 0, minPayment: a.minPayment || 0 }));

      el.innerHTML = `
        <div class="view-header">
          <div class="view-title"><h1>Debt payoff</h1><p>Snowball vs avalanche — find your debt-free date</p></div>
        </div>
        <div id="debt-body"></div>
      `;
      const body = el.querySelector('#debt-body');

      if (!debts.length) {
        body.innerHTML = C.emptyState({
          icon: 'card', title: 'No debts to plan — nice!',
          text: 'Add credit cards, loans or a mortgage in Accounts (with APR and minimum payment) and NestEgg will build your fastest payoff plan.',
          actionHtml: `<button class="btn primary" id="debt-goto-acc">Open Accounts</button>`
        });
        body.querySelector('#debt-goto-acc').addEventListener('click', () => App.go('accounts'));
        return;
      }

      const missingMin = debts.filter(d => !d.minPayment);
      const totalDebt = U.sum(debts, d => d.balance);
      const totalMin = U.sum(debts, d => d.minPayment);

      const planMin = Engines.debtPlan(debts, 0, strategy);
      const planSnow = Engines.debtPlan(debts, extra, 'snowball');
      const planAval = Engines.debtPlan(debts, extra, 'avalanche');
      const chosen = strategy === 'avalanche' ? planAval : planSnow;
      const other = strategy === 'avalanche' ? planSnow : planAval;

      const debtFreeDate = (months) => {
        const d = new Date();
        d.setMonth(d.getMonth() + months);
        return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      };

      body.innerHTML = `
        ${missingMin.length ? `<div class="callout warn mb-14">
          ${C.icon('alert')} <b>${missingMin.map(d => U.esc(d.name)).join(', ')}</b> ${missingMin.length > 1 ? 'have' : 'has'} no minimum payment set — edit ${missingMin.length > 1 ? 'them' : 'it'} in Accounts for an accurate plan.
        </div>` : ''}

        <div class="card mb-14">
          <div class="flex flex-wrap">
            <div class="field" style="max-width:220px">
              <label>Extra payment per month <span class="sub">on top of ${U.money0(totalMin)} minimums</span></label>
              <input type="number" id="debt-extra" min="0" step="25" value="${extra}">
            </div>
            <div class="field">
              <label>Strategy</label>
              ${C.segmented('debt-strategy', [
                { value: 'avalanche', label: 'Avalanche (highest APR first)' },
                { value: 'snowball', label: 'Snowball (smallest balance first)' }
              ], strategy)}
            </div>
          </div>
        </div>

        <div class="grid cols-4 mb-14">
          <div class="stat-tile"><div class="stat-label">Total debt</div><div class="stat-value sm">${U.money0(totalDebt)}</div></div>
          <div class="stat-tile"><div class="stat-label">Debt-free</div><div class="stat-value sm">${chosen.stuck ? 'never' : debtFreeDate(chosen.months)}</div>
            <div class="stat-delta">${chosen.stuck ? 'payments don’t cover interest' : `${chosen.months} months (${(chosen.months / 12).toFixed(1)} yrs)`}</div></div>
          <div class="stat-tile"><div class="stat-label">Total interest</div><div class="stat-value sm">${U.money0(chosen.totalInterest)}</div>
            <div class="stat-delta">${!planMin.stuck && !chosen.stuck ? `<span class="up">${U.money0(planMin.totalInterest - chosen.totalInterest)} saved</span> vs minimums only` : ''}</div></div>
          <div class="stat-tile"><div class="stat-label">${strategy === 'avalanche' ? 'vs snowball' : 'vs avalanche'}</div>
            <div class="stat-value sm">${chosen.stuck || other.stuck ? '—' : U.moneySigned(other.totalInterest - chosen.totalInterest)}</div>
            <div class="stat-delta">${chosen.stuck || other.stuck ? '' : (other.totalInterest >= chosen.totalInterest ? 'interest saved by this strategy' : 'more interest with this strategy')}</div></div>
        </div>

        <div class="grid cols-2 mb-14">
          <div class="card">
            <div class="card-title">Balance over time</div>
            <div class="chart-box" style="height:240px"><canvas id="debt-chart"></canvas></div>
            <div id="debt-legend"></div>
          </div>
          <div class="card">
            <div class="card-title">Payoff order — ${strategy}</div>
            <div class="table-wrap"><table class="data">
              <thead><tr><th>#</th><th>Debt</th><th class="num">APR</th><th class="num">Balance</th><th class="num">Paid off</th><th class="num">Interest paid</th></tr></thead>
              <tbody>${U.sortBy(chosen.perDebt, d => d.payoffMonth == null ? 9999 : d.payoffMonth).map((d, i) => `
                <tr>
                  <td class="muted">${i + 1}</td>
                  <td><b>${U.esc(d.name)}</b></td>
                  <td class="num">${d.apr.toFixed(2)}%</td>
                  <td class="num">${U.money0(d.startBalance)}</td>
                  <td class="num">${d.payoffMonth == null ? '—' : debtFreeDate(d.payoffMonth)}</td>
                  <td class="num">${U.money0(d.interestPaid)}</td>
                </tr>`).join('')}</tbody>
            </table></div>
            <p class="muted small mt-8">Freed-up minimum payments roll into the next debt automatically.</p>
          </div>
        </div>
      `;

      // controls
      body.querySelector('#debt-extra').addEventListener('change', (e) => {
        extra = Math.max(0, U.parseAmount(e.target.value));
        App.refresh();
      });
      C.wireSegmented(body.querySelector('#debt-strategy'), (v) => { strategy = v; App.refresh(); });

      // chart: emphasis on chosen strategy; alternative + minimums-only as context
      const col = ChartKit.colors();
      const horizon = Math.max(planSnow.series.length, planAval.series.length, Math.min(planMin.series.length, 361));
      const labels = [], step = horizon > 120 ? 6 : horizon > 48 ? 3 : 1;
      const pad = (arr) => Array.from({ length: horizon }, (_, i) => i < arr.length ? arr[i] : 0);
      for (let i = 0; i < horizon; i++) {
        const d = new Date(); d.setMonth(d.getMonth() + i);
        labels.push(d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).replace(' ', " '"));
      }
      const chosenSeries = strategy === 'avalanche' ? planAval : planSnow;
      const otherSeries = strategy === 'avalanche' ? planSnow : planAval;
      ChartKit.line(body.querySelector('#debt-chart'), {
        labels,
        yZero: true,
        series: [
          { label: strategy === 'avalanche' ? 'Avalanche' : 'Snowball', data: pad(chosenSeries.series), color: col.s[0], fill: true },
          { label: strategy === 'avalanche' ? 'Snowball' : 'Avalanche', data: pad(otherSeries.series), color: col.ink3, width: 1.5 },
          { label: 'Minimums only', data: planMin.series.slice(0, horizon), color: col.ink3, dashed: true, width: 1.5 }
        ]
      });
      ChartKit.legend(body.querySelector('#debt-legend'), [
        { label: strategy === 'avalanche' ? 'Avalanche (chosen)' : 'Snowball (chosen)', color: col.s[0] },
        { label: strategy === 'avalanche' ? 'Snowball' : 'Avalanche', color: col.ink3 },
        { label: 'Minimums only', color: col.ink3 }
      ]);
    }
  };
})();
