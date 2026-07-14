// Settings: appearance, data backup/restore, danger zone, about.
(function () {
  'use strict';
  window.Views = window.Views || {};

  window.Views.settings = {
    render(el) {
      const theme = Store.state.settings.theme || 'dark';

      el.innerHTML = `
        <div class="view-header">
          <div class="view-title"><h1>Settings</h1><p>Appearance, data and backups</p></div>
        </div>

        <div class="grid cols-2">
          <div>
            <div class="card mb-14">
              <div class="card-title">Appearance</div>
              <div class="field"><label>Theme</label>
                ${C.segmented('set-theme', [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }], theme)}
              </div>
            </div>

            <div class="card mb-14">
              <div class="card-title">Your data</div>
              <p class="muted small mb-14">Everything is stored locally on this computer — nothing is sent anywhere.
                <span id="set-datapath"></span></p>
              <div class="flex flex-wrap">
                ${window.api ? `<button class="btn" id="set-showfolder">${C.icon('folder')} Show data folder</button>` : ''}
                <button class="btn" id="set-export">${C.icon('download')} Export backup (JSON)</button>
                <button class="btn" id="set-import">${C.icon('upload')} Restore backup</button>
              </div>
              <p class="muted small mt-8">A rotating daily backup (last 14 days) is also kept automatically next to your data file.</p>
            </div>

            <div class="card mb-14" style="border-color:rgba(208,59,59,0.4)">
              <div class="card-title">Danger zone</div>
              <div class="flex flex-wrap">
                <button class="btn" id="set-demo">${C.icon('sparkle')} Load sample data</button>
                <button class="btn danger" id="set-wipe">${C.icon('trash')} Erase all data</button>
              </div>
            </div>
          </div>

          <div>
            <div class="card mb-14">
              <div class="card-title">About NestEgg</div>
              <p style="color:var(--ink-2)">NestEgg <span id="set-version"></span> — a private, local-first budget and retirement planner.
              Track accounts and spending, plan monthly budgets, pay off debt faster, and stress-test your
              retirement with Monte Carlo simulation.</p>
              <div class="divider"></div>
              <div class="callout warn">
                NestEgg is a planning tool, not financial advice. Projections use your assumptions and
                simplified tax treatment; consult a fiduciary advisor for decisions, and verify Social
                Security estimates at ssa.gov.
              </div>
            </div>
            <div class="card">
              <div class="card-title">Tips</div>
              <ul style="color:var(--ink-2);padding-left:18px;line-height:1.9;font-size:13px">
                <li>Set <b>APR and minimum payment</b> on debt accounts to unlock the payoff planner.</li>
                <li>Use <b>transfers</b> (not expenses) for credit-card payments and savings moves so income/spending stay accurate.</li>
                <li>Link your <b>emergency fund goal</b> to a savings account — progress updates itself.</li>
                <li>Turn on <b>auto-post</b> for fixed bills; NestEgg records them the day they're due.</li>
                <li>Budget → <b>Auto-fill from history</b> builds a starting budget from your real spending.</li>
              </ul>
            </div>
          </div>
        </div>
      `;

      if (window.api) {
        window.api.appInfo().then(info => {
          el.querySelector('#set-datapath').textContent = `Data file: ${info.dataPath}`;
          el.querySelector('#set-version').textContent = 'v' + info.version;
        });
        el.querySelector('#set-showfolder').addEventListener('click', () => window.api.showDataFolder());
      } else {
        el.querySelector('#set-version').textContent = '(browser preview)';
      }

      C.wireSegmented(el.querySelector('#set-theme'), (v) => {
        Store.state.settings.theme = v;
        Store.persist();
        App.applyTheme(v);
        App.refresh();
      });

      el.querySelector('#set-export').addEventListener('click', async () => {
        const json = JSON.stringify(Store.state, null, 2);
        if (window.api) {
          const res = await window.api.exportFile({
            defaultName: `nestegg-backup-${U.todayStr()}.json`,
            content: json, filterName: 'JSON backup', filterExt: 'json'
          });
          if (res.ok) C.toast('Backup exported');
        } else {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
          a.download = `nestegg-backup-${U.todayStr()}.json`;
          a.click();
        }
      });

      el.querySelector('#set-import').addEventListener('click', async () => {
        let content = null;
        if (window.api) {
          const res = await window.api.importFile({ filterName: 'JSON backup', filterExt: ['json'] });
          if (!res.ok) return;
          content = res.content;
        } else {
          content = await new Promise((resolve) => {
            const inp = document.createElement('input');
            inp.type = 'file'; inp.accept = '.json';
            inp.onchange = () => {
              const f = inp.files[0];
              if (!f) return resolve(null);
              const r = new FileReader();
              r.onload = () => resolve(r.result);
              r.readAsText(f);
            };
            inp.click();
          });
          if (!content) return;
        }
        let data;
        try {
          data = JSON.parse(content);
          if (!data || typeof data !== 'object' || !Array.isArray(data.accounts)) throw new Error('bad');
        } catch {
          C.toast('That file doesn’t look like a NestEgg backup', 'error');
          return;
        }
        const ok = await C.confirm({
          title: 'Restore this backup?',
          message: `It contains ${data.accounts.length} accounts and ${(data.transactions || []).length} transactions. Your current data will be replaced.`,
          confirmLabel: 'Restore backup', danger: true
        });
        if (!ok) return;
        Store.replaceState(data);
        C.toast('Backup restored');
        App.refresh();
      });

      el.querySelector('#set-demo').addEventListener('click', async () => {
        const ok = await C.confirm({
          title: 'Load sample data?',
          message: 'This replaces your current data with a full example household (accounts, a year of transactions, budgets, goals). Export a backup first if you have real data here.',
          confirmLabel: 'Load sample data', danger: true
        });
        if (!ok) return;
        Store.replaceState(Demo.build());
        C.toast('Sample data loaded');
        App.refresh();
      });

      el.querySelector('#set-wipe').addEventListener('click', async () => {
        const ok = await C.confirm({
          title: 'Erase all data?',
          message: 'Accounts, transactions, budgets, goals and settings will be permanently deleted from this computer.',
          confirmLabel: 'Erase everything', danger: true
        });
        if (!ok) return;
        Store.resetAll();
        C.toast('All data erased');
        App.refresh();
      });
    }
  };
})();
