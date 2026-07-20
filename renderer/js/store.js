// Data layer: state shape, CRUD with account-balance effects, persistence.
(function () {
  'use strict';

  // ---------------- account type registry ----------------
  const ACCOUNT_TYPES = {
    checking:    { label: 'Checking',            kind: 'asset',     group: 'cash' },
    savings:     { label: 'Savings',             kind: 'asset',     group: 'cash' },
    cash:        { label: 'Cash',                kind: 'asset',     group: 'cash' },
    brokerage:   { label: 'Brokerage (taxable)', kind: 'asset',     group: 'investment', tax: 'taxable' },
    k401:        { label: '401(k) / 403(b)',     kind: 'asset',     group: 'retirement', tax: 'pretax' },
    roth401k:    { label: 'Roth 401(k)',         kind: 'asset',     group: 'retirement', tax: 'roth' },
    tradIra:     { label: 'Traditional IRA',     kind: 'asset',     group: 'retirement', tax: 'pretax' },
    rothIra:     { label: 'Roth IRA',            kind: 'asset',     group: 'retirement', tax: 'roth' },
    hsa:         { label: 'HSA',                 kind: 'asset',     group: 'retirement', tax: 'hsa' },
    plan529:     { label: '529 College Savings', kind: 'asset',     group: 'investment' },
    property:    { label: 'Real Estate',         kind: 'asset',     group: 'property' },
    vehicle:     { label: 'Vehicle',             kind: 'asset',     group: 'property' },
    otherAsset:  { label: 'Other Asset',         kind: 'asset',     group: 'property' },
    creditCard:  { label: 'Credit Card',         kind: 'liability', group: 'debt', hasApr: true },
    mortgage:    { label: 'Mortgage',            kind: 'liability', group: 'debt', hasApr: true },
    autoLoan:    { label: 'Auto Loan',           kind: 'liability', group: 'debt', hasApr: true },
    studentLoan: { label: 'Student Loan',        kind: 'liability', group: 'debt', hasApr: true },
    personalLoan:{ label: 'Personal Loan',       kind: 'liability', group: 'debt', hasApr: true },
    otherDebt:   { label: 'Other Debt',          kind: 'liability', group: 'debt', hasApr: true }
  };

  const ACCOUNT_GROUPS = [
    { id: 'cash',       label: 'Cash' },
    { id: 'investment', label: 'Investments' },
    { id: 'retirement', label: 'Retirement' },
    { id: 'property',   label: 'Property & Other' },
    { id: 'debt',       label: 'Debt' }
  ];

  const FREQUENCIES = {
    weekly:     { label: 'Weekly',        perYear: 52 },
    biweekly:   { label: 'Every 2 weeks', perYear: 26 },
    monthly:    { label: 'Monthly',       perYear: 12 },
    quarterly:  { label: 'Quarterly',     perYear: 4 },
    semiannual: { label: 'Every 6 months',perYear: 2 },
    annual:     { label: 'Yearly',        perYear: 1 }
  };

  // Category color = fixed categorical slot (1..8), assigned at creation.
  const DEFAULT_CATEGORIES = [
    // expense
    ['Housing', 'expense', 1], ['Utilities', 'expense', 5], ['Groceries', 'expense', 2],
    ['Dining Out', 'expense', 8], ['Transportation', 'expense', 3], ['Health & Fitness', 'expense', 4],
    ['Insurance', 'expense', 1], ['Entertainment', 'expense', 7], ['Shopping', 'expense', 6],
    ['Subscriptions', 'expense', 5], ['Travel', 'expense', 2], ['Personal Care', 'expense', 7],
    ['Kids & Family', 'expense', 3], ['Pets', 'expense', 8], ['Education', 'expense', 4],
    ['Gifts & Charity', 'expense', 6], ['Fees & Interest', 'expense', 1], ['Miscellaneous', 'expense', 3],
    // income
    ['Salary', 'income', 2], ['Bonus', 'income', 1], ['Interest & Dividends', 'income', 5],
    ['Side Income', 'income', 3], ['Other Income', 'income', 7]
  ];

  function defaultRetirement() {
    return {
      currentAge: 35,
      retireAge: 65,
      lifeExpectancy: 92,
      salary: 85000,
      salaryGrowth: 3.0,
      employeePct: 10,
      employerMatchPct: 50,       // % of employee contribution matched
      employerMatchCapPct: 6,     // ...up to this % of salary
      extraAnnual: 0,             // extra annual savings (IRA, HSA, taxable)
      currentSavingsOverride: null, // null = derive from accounts
      preReturn: 8.0,
      postReturn: 5.5,
      preVolatility: 15.0,
      postVolatility: 9.0,
      inflation: 2.5,
      retireSpending: 65000,      // annual, today's dollars
      ssMonthly: null,            // null = estimate from salary
      ssClaimAge: 67,
      pensionAnnual: 0,
      taxRatePretax: 15           // effective tax on pre-tax withdrawals
    };
  }

  function defaultState() {
    const cats = DEFAULT_CATEGORIES.map(([name, group, slot]) => ({
      id: U.uid(), name, group, colorSlot: slot
    }));
    return {
      version: 1,
      meta: { createdAt: U.todayStr(), onboarded: false },
      settings: { theme: 'dark' },
      categories: cats,
      accounts: [],
      transactions: [],
      budgets: {},
      recurring: [],
      goals: [],
      rules: [],                 // [{id, pattern (normalized substring), categoryId}]
      subscriptionIgnores: [],   // normalized payee keys hidden from the finder
      netWorthHistory: [],
      retirement: defaultRetirement()
    };
  }

  // ---------------- persistence backend ----------------
  const backend = window.api ? {
    load: () => window.api.loadData(),
    save: (data) => window.api.saveData(data)
  } : {
    // Browser fallback (dev/preview only)
    load: async () => {
      try { return JSON.parse(localStorage.getItem('nestegg-data')); } catch { return null; }
    },
    save: async (data) => {
      localStorage.setItem('nestegg-data', JSON.stringify(data));
      return { ok: true };
    }
  };

  // ---------------- store ----------------
  const listeners = new Set();

  const Store = {
    state: null,
    ACCOUNT_TYPES,
    ACCOUNT_GROUPS,
    FREQUENCIES,

    async init() {
      let data = null;
      try { data = await backend.load(); } catch (_) { data = null; }
      this.state = data ? this.migrate(data) : defaultState();
      this.snapshotNetWorth();
      return this.state;
    },

    migrate(data) {
      const base = defaultState();
      const s = Object.assign(base, data);
      s.retirement = Object.assign(defaultRetirement(), data.retirement || {});
      s.settings = Object.assign({ theme: 'dark' }, data.settings || {});
      s.meta = Object.assign({ createdAt: U.todayStr(), onboarded: true }, data.meta || {});
      // v1.2: ensure a Debt Payments category exists for loan interest/fees
      if (!s.categories.some(c => c.group === 'expense' && /^debt payments$/i.test(c.name))) {
        s.categories.push({ id: U.uid(), name: 'Debt Payments', group: 'expense', colorSlot: 6 });
      }
      s.version = 1;
      return s;
    },

    persist: U.debounce(function () {
      backend.save(Store.state);
    }, 250),

    saveNow() { return backend.save(this.state); },

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    emit() {
      this.snapshotNetWorth();
      this.persist();
      for (const fn of listeners) fn();
    },

    // ---------------- lookups ----------------
    account(id) { return this.state.accounts.find(a => a.id === id); },
    category(id) { return this.state.categories.find(c => c.id === id); },
    accountName(id) { const a = this.account(id); return a ? a.name : '(deleted account)'; },
    categoryName(id) { const c = this.category(id); return c ? c.name : 'Uncategorized'; },
    accountType(a) { return ACCOUNT_TYPES[a.type] || ACCOUNT_TYPES.otherAsset; },

    activeAccounts() { return this.state.accounts.filter(a => !a.archived); },
    expenseCategories() { return this.state.categories.filter(c => c.group === 'expense'); },
    incomeCategories() { return this.state.categories.filter(c => c.group === 'income'); },

    // ---------------- net worth ----------------
    netWorth() {
      let assets = 0, liabilities = 0;
      for (const a of this.activeAccounts()) {
        if (this.accountType(a).kind === 'asset') assets += a.balance;
        else liabilities += a.balance;
      }
      return { assets, liabilities, net: assets - liabilities };
    },

    snapshotNetWorth() {
      const mk = U.thisMonth();
      const { assets, liabilities, net } = this.netWorth();
      const hist = this.state.netWorthHistory;
      const existing = hist.find(h => h.month === mk);
      if (existing) {
        existing.assets = assets; existing.liabilities = liabilities; existing.net = net;
      } else {
        hist.push({ month: mk, assets, liabilities, net });
        hist.sort((a, b) => a.month < b.month ? -1 : 1);
      }
    },

    // ---------------- accounts ----------------
    addAccount(data) {
      const a = Object.assign({
        id: U.uid(), name: '', type: 'checking', balance: 0,
        apr: 0, minPayment: 0, archived: false, createdAt: U.todayStr()
      }, data);
      this.state.accounts.push(a);
      this.emit();
      return a;
    },

    updateAccount(id, data) {
      const a = this.account(id);
      if (!a) return;
      Object.assign(a, data);
      this.emit();
    },

    deleteAccount(id) {
      const hasTx = this.state.transactions.some(t => t.accountId === id || t.toAccountId === id);
      if (hasTx) return { ok: false, reason: 'has-transactions' };
      this.state.accounts = this.state.accounts.filter(a => a.id !== id);
      this.state.goals.forEach(g => { if (g.linkedAccountId === id) g.linkedAccountId = null; });
      this.state.recurring = this.state.recurring.filter(r => r.accountId !== id && r.toAccountId !== id);
      this.emit();
      return { ok: true };
    },

    // cash-flow delta applied to an account: assets go up with +, liabilities go down with +
    _applyDelta(accountId, delta) {
      const a = this.account(accountId);
      if (!a) return;
      if (this.accountType(a).kind === 'asset') a.balance = U.round2(a.balance + delta);
      else a.balance = U.round2(a.balance - delta);
    },

    _txEffects(t, sign) {
      // sign +1 to apply, -1 to revert
      if (t.type === 'income') this._applyDelta(t.accountId, sign * t.amount);
      else if (t.type === 'expense') this._applyDelta(t.accountId, -sign * t.amount);
      else if (t.type === 'transfer') {
        this._applyDelta(t.accountId, -sign * t.amount);
        if (t.toAccountId) this._applyDelta(t.toAccountId, sign * t.amount);
      }
    },

    // ---------------- transactions ----------------
    addTransaction(data) {
      const t = Object.assign({
        id: U.uid(), date: U.todayStr(), type: 'expense', amount: 0,
        accountId: null, toAccountId: null, categoryId: null, payee: '', notes: ''
      }, data);
      t.amount = Math.abs(U.round2(t.amount));
      this.state.transactions.push(t);
      this._txEffects(t, +1);
      this.emit();
      return t;
    },

    updateTransaction(id, data) {
      const t = this.state.transactions.find(x => x.id === id);
      if (!t) return;
      this._txEffects(t, -1);
      Object.assign(t, data);
      t.amount = Math.abs(U.round2(t.amount));
      this._txEffects(t, +1);
      this.emit();
    },

    deleteTransaction(id) {
      const t = this.state.transactions.find(x => x.id === id);
      if (!t) return;
      this._txEffects(t, -1);
      this.state.transactions = this.state.transactions.filter(x => x.id !== id);
      this.emit();
    },

    txForMonth(mk) {
      return this.state.transactions.filter(t => t.date.slice(0, 7) === mk);
    },

    // spending by category for a month → Map(categoryId → total)
    spendingByCategory(mk) {
      const m = new Map();
      for (const t of this.txForMonth(mk)) {
        if (t.type !== 'expense') continue;
        const k = t.categoryId || 'uncat';
        m.set(k, (m.get(k) || 0) + t.amount);
      }
      return m;
    },

    monthTotals(mk) {
      let income = 0, expenses = 0;
      for (const t of this.txForMonth(mk)) {
        if (t.type === 'income') income += t.amount;
        else if (t.type === 'expense') expenses += t.amount;
      }
      return { income, expenses, net: income - expenses };
    },

    // ---------------- categories ----------------
    addCategory(name, group) {
      const used = this.state.categories.filter(c => c.group === group).length;
      const c = { id: U.uid(), name, group, colorSlot: (used % 8) + 1 };
      this.state.categories.push(c);
      this.emit();
      return c;
    },

    updateCategory(id, data) {
      const c = this.category(id);
      if (!c) return;
      Object.assign(c, data);
      this.emit();
    },

    deleteCategory(id) {
      this.state.transactions.forEach(t => { if (t.categoryId === id) t.categoryId = null; });
      for (const mk of Object.keys(this.state.budgets)) delete this.state.budgets[mk][id];
      this.state.categories = this.state.categories.filter(c => c.id !== id);
      this.emit();
    },

    // ---------------- budgets ----------------
    budgetFor(mk) { return this.state.budgets[mk] || {}; },

    setBudget(mk, categoryId, amount) {
      if (!this.state.budgets[mk]) this.state.budgets[mk] = {};
      if (amount > 0) this.state.budgets[mk][categoryId] = U.round2(amount);
      else delete this.state.budgets[mk][categoryId];
      this.emit();
    },

    copyBudget(fromMk, toMk) {
      this.state.budgets[toMk] = Object.assign({}, this.state.budgets[fromMk] || {});
      this.emit();
    },

    // ---------------- recurring ----------------
    addRecurring(data) {
      const r = Object.assign({
        id: U.uid(), name: '', type: 'expense', amount: 0,
        accountId: null, toAccountId: null, categoryId: null,
        frequency: 'monthly', nextDate: U.todayStr(), autoPost: false, active: true
      }, data);
      this.state.recurring.push(r);
      this.emit();
      return r;
    },

    updateRecurring(id, data) {
      const r = this.state.recurring.find(x => x.id === id);
      if (!r) return;
      Object.assign(r, data);
      this.emit();
    },

    deleteRecurring(id) {
      this.state.recurring = this.state.recurring.filter(x => x.id !== id);
      this.emit();
    },

    advanceDate(dateStr, frequency) {
      switch (frequency) {
        case 'weekly': return U.addDays(dateStr, 7);
        case 'biweekly': return U.addDays(dateStr, 14);
        case 'monthly': return U.addMonthsToDate(dateStr, 1);
        case 'quarterly': return U.addMonthsToDate(dateStr, 3);
        case 'semiannual': return U.addMonthsToDate(dateStr, 6);
        case 'annual': return U.addMonthsToDate(dateStr, 12);
        default: return U.addMonthsToDate(dateStr, 1);
      }
    },

    postRecurring(id) {
      const r = this.state.recurring.find(x => x.id === id);
      if (!r) return null;
      const t = this.addTransaction({
        date: r.nextDate <= U.todayStr() ? r.nextDate : U.todayStr(),
        type: r.type, amount: r.amount, accountId: r.accountId,
        toAccountId: r.toAccountId, categoryId: r.categoryId,
        payee: r.name, notes: 'Recurring'
      });
      r.nextDate = this.advanceDate(r.nextDate, r.frequency);
      this.emit();
      return t;
    },

    skipRecurring(id) {
      const r = this.state.recurring.find(x => x.id === id);
      if (!r) return;
      r.nextDate = this.advanceDate(r.nextDate, r.frequency);
      this.emit();
    },

    // auto-post everything due; returns count posted
    processAutoPost() {
      const today = U.todayStr();
      let posted = 0;
      for (const r of this.state.recurring) {
        if (!r.active || !r.autoPost) continue;
        let guard = 0;
        while (r.nextDate <= today && guard++ < 60) {
          this.addTransaction({
            date: r.nextDate, type: r.type, amount: r.amount,
            accountId: r.accountId, toAccountId: r.toAccountId,
            categoryId: r.categoryId, payee: r.name, notes: 'Recurring (auto)'
          });
          r.nextDate = this.advanceDate(r.nextDate, r.frequency);
          posted++;
        }
      }
      if (posted) this.emit();
      return posted;
    },

    monthlyEquivalent(r) {
      return r.amount * (FREQUENCIES[r.frequency]?.perYear || 12) / 12;
    },

    // ---------------- categorization rules ----------------
    // Explicit rules beat learned history; longer (more specific) patterns beat shorter.
    upsertRule(pattern, categoryId) {
      pattern = U.normPayee(pattern);
      if (pattern.length < 3 || !this.category(categoryId)) return null;
      let rule = this.state.rules.find(r => r.pattern === pattern);
      if (rule) rule.categoryId = categoryId;
      else {
        rule = { id: U.uid(), pattern, categoryId, createdAt: U.todayStr() };
        this.state.rules.push(rule);
      }
      this.emit();
      return rule;
    },

    deleteRule(id) {
      this.state.rules = this.state.rules.filter(r => r.id !== id);
      this.emit();
    },

    // Suggest a category for a payee: explicit rules, then learned history.
    // `group` is 'expense' | 'income'; pass a prebuilt payeeMap when suggesting in bulk.
    suggestCategory(payee, group, payeeMap) {
      const key = U.normPayee(payee);
      if (!key) return null;
      const rules = U.sortBy(this.state.rules, r => -r.pattern.length);
      for (const r of rules) {
        if (!key.includes(r.pattern)) continue;
        const cat = this.category(r.categoryId);
        if (cat && cat.group === group) return { categoryId: r.categoryId, source: 'rule', ruleId: r.id };
      }
      const map = payeeMap || Engines.buildPayeeMap(this.state.transactions);
      const counts = map.get(key);
      if (counts) {
        let bestId = null, bestN = 0;
        for (const [catId, n] of counts) {
          const cat = this.category(catId);
          if (cat && cat.group === group && n > bestN) { bestN = n; bestId = catId; }
        }
        if (bestId) return { categoryId: bestId, source: 'learned' };
      }
      return null;
    },

    // ---------------- goals ----------------
    addGoal(data) {
      const g = Object.assign({
        id: U.uid(), name: '', targetAmount: 0, targetDate: null,
        linkedAccountId: null, manualSaved: 0,
        colorSlot: (this.state.goals.length % 8) + 1, createdAt: U.todayStr()
      }, data);
      this.state.goals.push(g);
      this.emit();
      return g;
    },

    updateGoal(id, data) {
      const g = this.state.goals.find(x => x.id === id);
      if (!g) return;
      Object.assign(g, data);
      this.emit();
    },

    deleteGoal(id) {
      this.state.goals = this.state.goals.filter(x => x.id !== id);
      this.emit();
    },

    goalSaved(g) {
      if (g.linkedAccountId) {
        const a = this.account(g.linkedAccountId);
        return a ? a.balance : 0;
      }
      return g.manualSaved || 0;
    },

    // ---------------- retirement helpers ----------------
    retirementSavings() {
      let total = 0;
      const buckets = { pretax: 0, roth: 0, taxable: 0, hsa: 0 };
      for (const a of this.activeAccounts()) {
        const ty = this.accountType(a);
        if (ty.group === 'retirement' || a.type === 'brokerage') {
          total += a.balance;
          buckets[ty.tax || 'taxable'] += a.balance;
        }
      }
      return { total, buckets };
    },

    // ---------------- bulk ----------------
    replaceState(newState) {
      this.state = this.migrate(newState);
      this.emit();
    },

    resetAll() {
      this.state = defaultState();
      this.state.meta.onboarded = true;
      this.emit();
    }
  };

  window.Store = Store;
})();
