// Reports: trends across months — income vs spending, categories, net worth.
(function () {
  'use strict';
  window.Views = window.Views || {};

  let range = '12m';

  function monthsForRange() {
    const now = U.thisMonth();
    if (range === '6m') return U.lastMonths(6);
    if (range === '12m') return U.lastMonths(12);
    if (range === 'ytd') {
      const jan = now.slice(0, 4) + '-01';
      const n = Number(now.slice(5, 7));
      return U.lastMonths(n, now).filter(mk => mk >= jan);
    }
    // all: from first transaction month
    const tx = Store.state.transactions;
    if (!tx.length) return U.lastMonths(6);
    const first = tx.reduce((min, t) => t.date < min ? t.date : min, tx[0].date).slice(0, 7);
    const out = [];
    let mk = first;
    while (mk <= now && out.length < 120) { out.push(mk); mk = U.monthAdd(mk, 1); }
    return out;
  }

  window.Views.reports = {
    render(el) {
      const months = monthsForRange();
      const flows = months.map(mk => ({ mk, ...Store.monthTotals(mk) }));
      const totalIncome = U.sum(flows, f => f.income);
      const totalSpend = U.sum(flows, f => f.expenses);
      const monthsWithIncome = flows.filter(f => f.income > 0);
      const avgRate = monthsWithIncome.length
        ? U.sum(monthsWithIncome, f => Math.max(0, f.net) / f.income) / monthsWithIncome.length : null;

      // category totals across range
      const catTotals = new Map();
      for (const mk of months) {
        for (const [catId, v] of Store.spendingByCategory(mk)) {
          catTotals.set(catId, (catTotals.get(catId) || 0) + v);
        }
      }
      const catSorted = U.sortBy([...catTotals.entries()], ([, v]) => v, true);

      el.innerHTML = `
        <div class="view-header">
          <div class="view-title"><h1>Reports</h1><p>Where your money has been going</p></div>
          <div class="view-actions">${C.segmented('rep-range', [
            { value: '6m', label: '6 months' }, { value: '12m', label: '12 months' },
            { value: 'ytd', label: 'Year to date' }, { value: 'all', label: 'All time' }
          ], range)}</div>
        </div>

        <div class="grid cols-4 mb-14">
          <div class="stat-tile"><div class="stat-label">Income</div><div class="stat-value sm">${U.money0(totalIncome)}</div></div>
          <div class="stat-tile"><div class="stat-label">Spending</div><div class="stat-value sm">${U.money0(totalSpend)}</div></div>
          <div class="stat-tile"><div class="stat-label">Net saved</div><div class="stat-value sm amount ${totalIncome - totalSpend >= 0 ? 'pos' : 'neg'}">${U.moneySigned(totalIncome - totalSpend)}</div></div>
          <div class="stat-tile"><div class="stat-label">Avg savings rate</div><div class="stat-value sm">${avgRate == null ? '—' : U.pct(avgRate)}</div></div>
        </div>

        <div class="grid cols-2 mb-14">
          <div class="card">
            <div class="card-title">Income vs spending</div>
            <div class="chart-box" style="height:230px"><canvas id="rep-flow"></canvas></div>
            <div id="rep-flow-legend"></div>
          </div>
          <div class="card">
            <div class="card-title">Net worth</div>
            <div class="chart-box" style="height:230px"><canvas id="rep-nw"></canvas></div>
          </div>
        </div>

        <div class="grid cols-2 mb-14">
          <div class="card">
            <div class="card-title">Spending by category <span class="hint">top 5 + other</span></div>
            <div class="chart-box" style="height:250px"><canvas id="rep-cats"></canvas></div>
            <div id="rep-cats-legend"></div>
          </div>
          <div class="card">
            <div class="card-title">Category totals</div>
            <div class="table-wrap" style="max-height:290px;overflow-y:auto"><table class="data">
              <thead><tr><th>Category</th><th class="num">Total</th><th class="num">Avg / month</th><th class="num">Share</th></tr></thead>
              <tbody>${catSorted.map(([catId, v]) => {
                const cat = Store.category(catId);
                return `<tr>
                  <td>${C.catDot(cat)}${U.esc(cat ? cat.name : 'Uncategorized')}</td>
                  <td class="num"><b>${U.money0(v)}</b></td>
                  <td class="num">${U.money0(v / months.length)}</td>
                  <td class="num muted">${totalSpend > 0 ? U.pct(v / totalSpend) : '—'}</td>
                </tr>`;
              }).join('') || '<tr><td colspan="4" class="muted">No spending in this range.</td></tr>'}</tbody>
            </table></div>
          </div>
        </div>
      `;

      C.wireSegmented(el.querySelector('#rep-range'), (v) => { range = v; App.refresh(); });

      const col = ChartKit.colors();
      const labels = months.map(U.monthLabelShort);

      ChartKit.line(el.querySelector('#rep-flow'), {
        labels, yZero: true,
        series: [
          { label: 'Income', data: flows.map(f => f.income), color: col.s[1] },
          { label: 'Spending', data: flows.map(f => f.expenses), color: col.s[5] }
        ]
      });
      ChartKit.legend(el.querySelector('#rep-flow-legend'), [
        { label: 'Income', color: col.s[1] }, { label: 'Spending', color: col.s[5] }
      ]);

      // net worth within range window
      const nwAll = Store.state.netWorthHistory;
      const nw = nwAll.filter(h => months.includes(h.month));
      const nwSource = nw.length >= 2 ? nw : nwAll.slice(-12);
      if (nwSource.length >= 2) {
        ChartKit.line(el.querySelector('#rep-nw'), {
          labels: nwSource.map(h => U.monthLabelShort(h.month)),
          series: [{ label: 'Net worth', data: nwSource.map(h => h.net), color: col.s[0], fill: true }]
        });
      } else {
        el.querySelector('#rep-nw').closest('.chart-box').innerHTML =
          '<p class="muted small" style="padding:20px">Net worth history builds up month by month as you use NestEgg.</p>';
      }

      // stacked category bars: top 5 + Other (fixed slot per category, "Other" in muted)
      const top5 = catSorted.slice(0, 5).map(([id]) => id);
      const perMonthCat = months.map(mk => Store.spendingByCategory(mk));
      const series = top5.map((catId) => {
        const cat = Store.category(catId);
        return {
          label: cat ? cat.name : 'Uncategorized',
          data: perMonthCat.map(m => m.get(catId) || 0),
          color: cat ? ChartKit.slot(cat.colorSlot) : col.ink3
        };
      });
      const otherData = perMonthCat.map(m => {
        let s = 0;
        for (const [catId, v] of m) if (!top5.includes(catId)) s += v;
        return s;
      });
      if (otherData.some(v => v > 0)) series.push({ label: 'Other', data: otherData, color: col.ink3 });

      if (series.length) {
        ChartKit.bars(el.querySelector('#rep-cats'), { labels, series, stacked: true });
        ChartKit.legend(el.querySelector('#rep-cats-legend'), series.map(s => ({ label: s.label, color: s.color })));
      } else {
        el.querySelector('#rep-cats').closest('.chart-box').innerHTML =
          '<p class="muted small" style="padding:20px">No categorized spending in this range yet.</p>';
      }
    }
  };
})();
