// App bootstrap: navigation, theming, onboarding, first render.
(function () {
  'use strict';

  const NAV = [
    { section: 'Overview' },
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { section: 'Money' },
    { id: 'accounts', label: 'Accounts', icon: 'wallet' },
    { id: 'transactions', label: 'Transactions', icon: 'list' },
    { id: 'budget', label: 'Budget', icon: 'budget' },
    { id: 'recurring', label: 'Recurring', icon: 'repeat' },
    { id: 'goals', label: 'Goals', icon: 'target' },
    { section: 'Planning' },
    { id: 'debt', label: 'Debt payoff', icon: 'card' },
    { id: 'retirement', label: 'Retirement', icon: 'umbrella' },
    { id: 'reports', label: 'Reports', icon: 'chart' },
    { section: '' },
    { id: 'settings', label: 'Settings', icon: 'gear' }
  ];

  const App = {
    current: 'dashboard',

    go(id) {
      if (!Views[id]) return;
      this.current = id;
      document.querySelectorAll('.nav-item').forEach(b =>
        b.classList.toggle('active', b.dataset.view === id));
      this.refresh();
    },

    // Re-render current view into a FRESH container (prevents listener buildup)
    refresh() {
      const old = document.getElementById('view');
      const scroll = old.scrollTop;
      const fresh = document.createElement('div');
      fresh.id = 'view';
      fresh.tabIndex = -1;
      old.replaceWith(fresh);
      Views[this.current].render(fresh);
      fresh.scrollTop = scroll;
    },

    applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      const btn = document.getElementById('theme-toggle');
      btn.innerHTML = theme === 'dark'
        ? `${C.icon('sun')} Light`
        : `${C.icon('moon')} Dark`;
    },

    renderNav() {
      const nav = document.getElementById('nav');
      nav.innerHTML = NAV.map(item => {
        if (item.section !== undefined) {
          return item.section
            ? `<div class="nav-label">${item.section}</div>`
            : `<div class="nav-sep"></div>`;
        }
        return `<button class="nav-item${item.id === this.current ? ' active' : ''}" data-view="${item.id}">
          ${C.icon(item.icon)}<span>${item.label}</span>
        </button>`;
      }).join('');
      nav.addEventListener('click', (e) => {
        const btn = e.target.closest('.nav-item');
        if (btn) this.go(btn.dataset.view);
      });
    },

    showOnboarding() {
      const m = C.modal({
        title: 'Welcome to NestEgg',
        body: `
          <p style="color:var(--ink-2)">Your budget and retirement planner. Everything stays on this computer —
          private by design. How would you like to start?</p>
          <div class="onboard-choices">
            <button class="onboard-choice" data-choice="fresh">
              <b>${C.icon('plus')} Start fresh</b>
              <span>Begin with a clean slate. Add your accounts, then build your budget and retirement plan.</span>
            </button>
            <button class="onboard-choice" data-choice="demo">
              <b>${C.icon('sparkle')} Explore with sample data</b>
              <span>Tour every feature with a realistic example household — a year of transactions, budgets, debts and goals. Erase it anytime in Settings.</span>
            </button>
          </div>`,
        onClose: () => {
          Store.state.meta.onboarded = true;
          Store.persist();
        }
      });
      m.body.addEventListener('click', (e) => {
        const choice = e.target.closest('[data-choice]');
        if (!choice) return;
        if (choice.dataset.choice === 'demo') {
          Store.replaceState(Demo.build());
          C.toast('Sample data loaded — explore away!');
        } else {
          Store.state.meta.onboarded = true;
          Store.persist();
        }
        m.overlay.remove();
        App.refresh();
      });
    },

    async init() {
      await Store.init();

      this.applyTheme(Store.state.settings.theme || 'dark');
      document.getElementById('theme-toggle').addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        Store.state.settings.theme = next;
        Store.persist();
        this.applyTheme(next);
        this.refresh();
      });

      if (window.api) {
        window.api.appInfo().then(info => {
          document.getElementById('app-version').textContent = 'v' + info.version;
        });
      }

      this.renderNav();

      const posted = Store.processAutoPost();
      this.refresh();
      if (posted) C.toast(`${posted} recurring transaction${posted > 1 ? 's' : ''} posted automatically`);

      if (!Store.state.meta.onboarded) this.showOnboarding();

      // keyboard shortcut: Ctrl/Cmd+N → quick add transaction
      document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
          e.preventDefault();
          Views.transactions.openTxModal();
        }
      });
    }
  };

  window.App = App;
  window.addEventListener('DOMContentLoaded', () => App.init());
})();
