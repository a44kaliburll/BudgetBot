// Subscription finder: detects recurring charges in transaction history,
// flags price changes, and converts findings into tracked Recurring items.
(function () {
  'use strict';
  window.Views = window.Views || {};

  let showIgnored = false;

  function isTracked(sub) {
    return Store.state.recurring.some(r => {
      const k = U.normPayee(r.name);
      return k && (k === sub.key || k.includes(sub.key) || sub.key.includes(k));
    });
  }

  function trackAsRecurring(sub) {
    let nextDate = sub.nextExpected;
    let guard = 0;
    while (nextDate < U.todayStr() && guard++ < 60) nextDate = Store.advanceDate(nextDate, sub.frequency);
    Store.addRecurring({
      name: sub.displayName,
      type: 'expense',
      amount: sub.amount,
      accountId: sub.accountId || (Store.activeAccounts()[0] && Store.activeAccounts()[0].id),
      categoryId: sub.categoryId,
      frequency: sub.frequency,
      nextDate,
      autoPost: false
    });
    C.toast(`${sub.displayName} is now tracked in Recurring`);
    App.refresh();
  }

  window.Views.subscriptions = {
    render(el) {
      const ignores = new Set(Store.state.subscriptionIgnores);
      const all = Engines.detectSubscriptions(Store.state.transactions);
      const subs = all.filter(s => !ignores.has(s.key));
      const ignored = all.filter(s => ignores.has(s.key));
      const active = subs.filter(s => !s.inactive);

      const totalMonthly = U.sum(active, s => s.monthlyCost);
      const priceHikes = subs.filter(s => s.priceChange && s.priceChange.to > s.priceChange.from);

      el.innerHTML = `
        <div class="view-header">
          <div class="view-title"><h1>Subscriptions</h1>
            <p>Recurring charges found automatically in your transaction history</p></div>
        </div>

        <div class="grid cols-4 mb-14">
          <div class="stat-tile"><div class="stat-label">Recurring charges found</div><div class="stat-value">${active.length}</div></div>
          <div class="stat-tile"><div class="stat-label">Monthly cost</div><div class="stat-value">${U.money0(totalMonthly)}</div></div>
          <div class="stat-tile"><div class="stat-label">Yearly cost</div><div class="stat-value">${U.money0(totalMonthly * 12)}</div></div>
          <div class="stat-tile"><div class="stat-label">Price increases</div>
            <div class="stat-value" style="${priceHikes.length ? 'color:var(--critical)' : ''}">${priceHikes.length}</div></div>
        </div>

        ${priceHikes.length ? `<div class="callout crit mb-14">
          ${C.icon('alert')} Price increase${priceHikes.length > 1 ? 's' : ''} detected:
          ${priceHikes.map(s => `<b>${U.esc(s.displayName)}</b> ${U.money(s.priceChange.from)} → ${U.money(s.priceChange.to)}`).join(' · ')}
        </div>` : ''}

        <div class="card">
          ${subs.length ? `<div class="table-wrap"><table class="data">
            <thead><tr>
              <th>Merchant</th><th>Repeats</th><th class="num">Amount</th><th class="num">≈ Monthly</th>
              <th>Last charged</th><th>Next expected</th><th>Confidence</th><th style="width:180px"></th>
            </tr></thead>
            <tbody>${subs.map(s => {
              const cat = Store.category(s.categoryId);
              const freqLabel = Store.FREQUENCIES[s.frequency] ? Store.FREQUENCIES[s.frequency].label : s.cadence;
              const confPill = s.confidence >= 0.8
                ? '<span class="pill status-good">high</span>'
                : '<span class="pill">medium</span>';
              return `<tr data-key="${U.esc(s.key)}" style="${s.inactive ? 'opacity:0.55' : ''}">
                <td><b>${U.esc(s.displayName)}</b>
                  ${cat ? `<br><span class="muted small">${C.catDot(cat)}${U.esc(cat.name)}</span>` : ''}
                  ${s.inactive ? ' <span class="pill">not seen recently</span>' : ''}
                  ${s.priceChange ? `<span class="pill ${s.priceChange.to > s.priceChange.from ? 'status-critical' : 'status-good'}">${U.money(s.priceChange.from)} → ${U.money(s.priceChange.to)}</span>` : ''}</td>
                <td class="muted">${freqLabel}<br><span class="small">${s.chargeCount} charges</span></td>
                <td class="num"><b>${U.money(s.amount)}</b></td>
                <td class="num">${U.money0(s.monthlyCost)}</td>
                <td class="nowrap muted">${U.dateLabelShort(s.lastDate)}</td>
                <td class="nowrap muted">${s.inactive ? '—' : U.dateLabelShort(s.nextExpected)}</td>
                <td>${confPill}</td>
                <td><div class="flex" style="justify-content:flex-end">
                  ${isTracked(s)
                    ? `<span class="pill status-good">${C.icon('check')} tracked</span>`
                    : `<button class="btn sm" data-act="track">${C.icon('repeat')} Track</button>`}
                  <button class="btn sm ghost" data-act="ignore">Ignore</button>
                </div></td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>
          <p class="muted small mt-8">Detected from charge patterns (regular timing + stable amounts). “Track” adds it to
          Recurring so it shows in Coming&nbsp;up and cash-flow planning. The more history you import, the better this gets.</p>`
          : C.emptyState({
              icon: 'search', title: 'No recurring charges detected yet',
              text: 'NestEgg needs a few months of transactions to spot patterns. Import your bank history (Transactions → Import bank file — OFX, QFX or CSV) and check back.',
              actionHtml: `<button class="btn primary" id="subs-goto-tx">Open Transactions</button>`
            })}
        </div>

        ${ignored.length ? `<div class="mt-14">
          <button class="btn ghost sm" id="subs-toggle-ignored">${showIgnored ? 'Hide' : 'Show'} ${ignored.length} ignored</button>
          ${showIgnored ? `<div class="card mt-8">${ignored.map(s => `
            <div class="flex-between mb-8" data-key="${U.esc(s.key)}">
              <span class="muted">${U.esc(s.displayName)} · ${U.money(s.amount)}</span>
              <button class="btn sm ghost" data-act="restore">Restore</button>
            </div>`).join('')}</div>` : ''}
        </div>` : ''}
      `;

      el.querySelector('#subs-goto-tx')?.addEventListener('click', () => App.go('transactions'));
      el.querySelector('#subs-toggle-ignored')?.addEventListener('click', () => { showIgnored = !showIgnored; App.refresh(); });

      el.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const key = btn.closest('[data-key]')?.dataset.key;
        if (!key) return;
        const sub = all.find(s => s.key === key);
        if (btn.dataset.act === 'track') trackAsRecurring(sub);
        else if (btn.dataset.act === 'ignore') {
          Store.state.subscriptionIgnores.push(key);
          Store.persist();
          App.refresh();
        } else if (btn.dataset.act === 'restore') {
          Store.state.subscriptionIgnores = Store.state.subscriptionIgnores.filter(k => k !== key);
          Store.persist();
          App.refresh();
        }
      });
    }
  };
})();
