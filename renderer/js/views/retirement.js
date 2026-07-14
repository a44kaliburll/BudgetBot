// Retirement planner: live deterministic + Monte Carlo projections.
(function () {
  'use strict';
  window.Views = window.Views || {};

  const FIELD_GROUPS = [
    ['About you', [
      ['currentAge', 'Current age', { min: 16, max: 90 }],
      ['retireAge', 'Retirement age', { min: 30, max: 80 }],
      ['lifeExpectancy', 'Plan to age', { min: 60, max: 110, sub: 'life expectancy' }]
    ]],
    ['Income & contributions', [
      ['salary', 'Annual salary ($)', { min: 0, step: 1000 }],
      ['salaryGrowth', 'Salary growth (%/yr)', { min: 0, max: 15, step: 0.1 }],
      ['employeePct', 'You contribute (% of salary)', { min: 0, max: 90, step: 0.5 }],
      ['employerMatchPct', 'Employer match (%)', { min: 0, max: 200, step: 5, sub: 'of your contribution' }],
      ['employerMatchCapPct', 'Match limit (% of salary)', { min: 0, max: 25, step: 0.5 }],
      ['extraAnnual', 'Extra savings ($/yr)', { min: 0, step: 500, sub: 'IRA, HSA, brokerage' }],
      ['currentSavingsOverride', 'Current savings ($)', { min: 0, step: 1000, placeholderDerived: true, sub: 'blank = from your accounts' }]
    ]],
    ['Market assumptions', [
      ['preReturn', 'Return before retirement (%/yr)', { min: 0, max: 15, step: 0.1 }],
      ['preVolatility', 'Volatility before (%)', { min: 0, max: 30, step: 0.5 }],
      ['postReturn', 'Return in retirement (%/yr)', { min: 0, max: 15, step: 0.1 }],
      ['postVolatility', 'Volatility in retirement (%)', { min: 0, max: 30, step: 0.5 }],
      ['inflation', 'Inflation (%/yr)', { min: 0, max: 10, step: 0.1 }]
    ]],
    ['Retirement income & spending', [
      ['retireSpending', 'Annual spending ($, today’s dollars)', { min: 0, step: 1000 }],
      ['ssMonthly', 'Social Security ($/mo, today’s $)', { min: 0, step: 50, placeholderSS: true, sub: 'blank = auto-estimate' }],
      ['ssClaimAge', 'SS claiming age', { min: 62, max: 70 }],
      ['pensionAnnual', 'Pension ($/yr)', { min: 0, step: 500 }],
      ['taxRatePretax', 'Effective tax on withdrawals (%)', { min: 0, max: 50, step: 1 }]
    ]]
  ];

  function normalized() {
    const r = { ...Store.state.retirement };
    r.retireAge = Math.max(r.retireAge, r.currentAge + 1);
    r.lifeExpectancy = Math.max(r.lifeExpectancy, r.retireAge + 1);
    return r;
  }

  function startBalance(r) {
    return (r.currentSavingsOverride != null && r.currentSavingsOverride !== '')
      ? Number(r.currentSavingsOverride)
      : Store.retirementSavings().total;
  }

  function successPill(rate) {
    const cls = rate >= 0.85 ? 'status-good' : rate >= 0.65 ? 'status-warning' : 'status-critical';
    const word = rate >= 0.85 ? 'on track' : rate >= 0.65 ? 'needs attention' : 'at risk';
    return `<span class="pill ${cls}">${word}</span>`;
  }

  function renderResults(panel) {
    const r = normalized();
    const start = startBalance(r);
    const proj = Engines.retirementProject(r, start);
    const mc = Engines.retirementMonteCarlo(r, start, 1000, 42);
    const safe = Engines.safeSpending(r, start, 0.9);
    const ssUsed = (r.ssMonthly != null && r.ssMonthly !== '') ? Number(r.ssMonthly) : Engines.ssEstimate(r.salary, r.ssClaimAge);

    const whatIfs = [
      { label: `Retire at ${r.retireAge + 2}`, patch: { retireAge: r.retireAge + 2, lifeExpectancy: Math.max(r.lifeExpectancy, r.retireAge + 3) } },
      { label: `Retire at ${Math.max(r.currentAge + 1, r.retireAge - 2)}`, patch: { retireAge: Math.max(r.currentAge + 1, r.retireAge - 2) } },
      { label: 'Contribute +2%', patch: { employeePct: r.employeePct + 2 } },
      { label: 'Spend 10% less', patch: { retireSpending: r.retireSpending * 0.9 } }
    ].map(w => {
      const sr = Engines.retirementMonteCarlo({ ...r, ...w.patch }, start, 300, 7).successRate;
      return { ...w, rate: sr };
    });

    const lastsLabel = proj.depletionAge == null
      ? `beyond ${r.lifeExpectancy}`
      : `age ${proj.depletionAge}`;

    panel.innerHTML = `
      <div class="grid cols-4 mb-14">
        <div class="stat-tile">
          <div class="stat-label">Plan success rate</div>
          <div class="stat-value">${Math.round(mc.successRate * 100)}%</div>
          <div class="stat-delta">${successPill(mc.successRate)}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Nest egg at ${r.retireAge}</div>
          <div class="stat-value">${ChartKit.moneyCompact(proj.nestEggNominal)}</div>
          <div class="stat-delta">${ChartKit.moneyCompact(proj.nestEggReal)} in today’s dollars</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Money lasts until</div>
          <div class="stat-value">${proj.depletionAge == null ? `${r.lifeExpectancy}+` : proj.depletionAge}</div>
          <div class="stat-delta">${proj.depletionAge == null ? `expected path lasts ${lastsLabel}` : `<span class="down">runs out at ${lastsLabel}</span> on the expected path`}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Safe spending (90% success)</div>
          <div class="stat-value">${ChartKit.moneyCompact(safe)}</div>
          <div class="stat-delta">per year, today’s dollars</div>
        </div>
      </div>

      <div class="card mb-14">
        <div class="card-title">Portfolio projection <span class="hint">1,000 simulated market histories</span></div>
        <div class="chart-box" style="height:280px"><canvas id="ret-chart"></canvas></div>
        <div id="ret-legend"></div>
      </div>

      <div class="grid cols-2 mb-14">
        <div class="card">
          <div class="card-title">What moves the needle</div>
          <div class="chip-row">
            ${whatIfs.map(w => `<div class="what-if-chip">
              <span class="wf-label">${U.esc(w.label)}</span>
              <span class="wf-value" style="color:${w.rate >= 0.85 ? 'var(--delta-good)' : w.rate >= 0.65 ? 'var(--warning)' : 'var(--critical)'}">${Math.round(w.rate * 100)}%</span>
            </div>`).join('')}
          </div>
          <div class="callout mt-14">
            First-year spending gap: <b>${U.money0(proj.firstYearNeed)}</b> after
            ${U.money0(ssUsed * 12)}/yr Social Security${r.pensionAnnual > 0 ? ` and ${U.money0(r.pensionAnnual)}/yr pension` : ''}
            ${r.ssMonthly == null || r.ssMonthly === '' ? `<br><span class="muted small">SS auto-estimated at ${U.money0(ssUsed)}/mo (claiming at ${r.ssClaimAge}) — check your real number at ssa.gov</span>` : ''}
          </div>
        </div>
        <div class="card">
          <div class="card-title">2026 contribution limits <span class="hint">IRS reference</span></div>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Account</th><th class="num">Limit</th><th class="num">Catch-up 50+</th></tr></thead>
            <tbody>
              <tr><td>401(k) / 403(b) employee deferral</td><td class="num">$24,500</td><td class="num">$8,000</td></tr>
              <tr><td>IRA (Traditional + Roth combined)</td><td class="num">$7,500</td><td class="num">$1,100</td></tr>
              <tr><td>HSA — self / family</td><td class="num">$4,400 / $8,750</td><td class="num">$1,000 (55+)</td></tr>
            </tbody>
          </table></div>
          <p class="muted small mt-8">Ages 60–63 get a higher 401(k) catch-up of $11,250. Verify current-year limits at irs.gov.</p>
        </div>
      </div>

      <p class="muted small">Projections are estimates based on your assumptions, not guarantees or financial advice. Monte Carlo draws annual returns from a normal distribution; real markets can behave differently.</p>
    `;

    // ---- bands chart ----
    const col = ChartKit.colors();
    const blue = col.s[0];
    const detData = proj.years.map(y => y.balance);
    const canvas = panel.querySelector('#ret-chart');
    const retireIdx = r.retireAge - r.currentAge;

    const mkDs = (data, opts) => Object.assign({
      data, pointRadius: 0, pointHoverRadius: 0, tension: 0.25, borderWidth: 0,
      borderColor: 'transparent', fill: false, label: ''
    }, opts);

    if (canvas._chart) canvas._chart.destroy();
    canvas._chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: mc.ages,
        datasets: [
          mkDs(mc.bands.p90, { label: '90th percentile' }),
          mkDs(mc.bands.p10, { label: '10–90% range', fill: '-1', backgroundColor: ChartKit.alpha(blue, 0.10) }),
          mkDs(mc.bands.p75, { label: '75th percentile' }),
          mkDs(mc.bands.p25, { label: '25–75% range', fill: '-1', backgroundColor: ChartKit.alpha(blue, 0.16) }),
          mkDs(mc.bands.p50, { label: 'Median outcome', borderColor: blue, borderWidth: 2, pointHoverRadius: 4, pointHoverBackgroundColor: blue }),
          mkDs(detData, { label: 'Expected path', borderColor: col.ink2, borderWidth: 1.5, borderDash: [5, 4], pointHoverRadius: 4, pointHoverBackgroundColor: col.ink2 })
        ]
      },
      options: (() => {
        const o = ChartKit._base(true);
        o.plugins.tooltip.filter = (item) => ['Median outcome', 'Expected path'].includes(item.dataset.label);
        o.plugins.tooltip.callbacks.title = (items) => items.length ? `Age ${items[0].label}${Number(items[0].label) >= r.retireAge ? ' · retired' : ' · working'}` : '';
        o.scales.y.beginAtZero = true;
        return o;
      })()
    });

    ChartKit.legend(panel.querySelector('#ret-legend'), [
      { label: 'Median outcome', color: blue },
      { label: '25–75% of outcomes', color: ChartKit.alpha(blue, 0.45) },
      { label: '10–90% of outcomes', color: ChartKit.alpha(blue, 0.22) },
      { label: 'Expected path (no volatility)', color: col.ink2 },
      { label: `Retirement at ${r.retireAge}`, color: 'transparent' }
    ]);
  }

  window.Views.retirement = {
    render(el) {
      const r = Store.state.retirement;
      const derived = Store.retirementSavings();

      el.innerHTML = `
        <div class="view-header">
          <div class="view-title"><h1>Retirement planner</h1>
            <p>US-modeled: 401(k) match, Social Security, inflation and market volatility</p></div>
        </div>
        <div style="display:grid;grid-template-columns:minmax(300px,360px) 1fr;gap:14px;align-items:start" id="ret-layout">
          <div id="ret-form"></div>
          <div id="ret-results"></div>
        </div>
      `;
      if (window.innerWidth < 1100) el.querySelector('#ret-layout').style.gridTemplateColumns = '1fr';

      // ---- form ----
      const form = el.querySelector('#ret-form');
      form.innerHTML = FIELD_GROUPS.map(([title, fields]) => `
        <div class="card mb-14">
          <div class="card-title">${title}</div>
          <div class="form-grid">
            ${fields.map(([key, label, opts]) => {
              let value = r[key];
              let placeholder = '';
              if (opts.placeholderDerived) {
                placeholder = U.money0(derived.total) + ' from accounts';
                if (value == null || value === '') value = '';
              }
              if (opts.placeholderSS) {
                placeholder = U.money0(Engines.ssEstimate(r.salary, r.ssClaimAge)) + ' est.';
                if (value == null || value === '') value = '';
              }
              return C.input({
                id: 'ret-' + key, label, type: 'number', value,
                step: opts.step != null ? opts.step : 1, min: opts.min, max: opts.max,
                sub: opts.sub, placeholder
              });
            }).join('')}
          </div>
        </div>`).join('');

      const results = el.querySelector('#ret-results');
      const recompute = U.debounce(() => renderResults(results), 350);

      form.addEventListener('input', (e) => {
        const key = e.target.id.replace('ret-', '');
        if (!(key in r)) return;
        const raw = e.target.value;
        if (key === 'currentSavingsOverride' || key === 'ssMonthly') {
          r[key] = raw === '' ? null : U.parseAmount(raw);
        } else {
          const n = U.parseAmount(raw);
          r[key] = isNaN(n) ? r[key] : n;
        }
        Store.persist();
        recompute();
      });

      renderResults(results);
    }
  };
})();
