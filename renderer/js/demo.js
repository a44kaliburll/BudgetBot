// Sample dataset generator — realistic 12-month household finances.
(function () {
  'use strict';

  // deterministic RNG so the demo always looks the same
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const Demo = {
    build() {
      const rnd = mulberry32(20260709);
      const rand = (lo, hi) => lo + rnd() * (hi - lo);
      const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
      const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

      const s = Store.migrate({});
      s.meta.onboarded = true;
      const catId = (name) => s.categories.find(c => c.name === name).id;

      // ---- accounts (balances are "current"; history is synthesized) ----
      const acct = (name, type, balance, extra = {}) =>
        Object.assign({ id: U.uid(), name, type, balance, apr: 0, minPayment: 0, archived: false, createdAt: '2024-01-15' }, extra);

      const checking  = acct('Everyday Checking', 'checking', 4230.55);
      const savings   = acct('High-Yield Savings', 'savings', 18450.00);
      const brokerage = acct('Brokerage', 'brokerage', 31900.00);
      const k401      = acct('Employer 401(k)', 'k401', 98400.00);
      const roth      = acct('Roth IRA', 'rothIra', 41200.00);
      const hsa       = acct('Health Savings (HSA)', 'hsa', 8150.00);
      const home      = acct('Home', 'property', 385000.00);
      const cc        = acct('Rewards Credit Card', 'creditCard', 1840.22, { apr: 22.99, minPayment: 55 });
      const auto      = acct('Auto Loan', 'autoLoan', 14350.00, { apr: 6.4, minPayment: 385, originalPrincipal: 23500, termMonths: 60, firstPaymentDate: '2023-09-06' });
      const student   = acct('Student Loan', 'studentLoan', 21800.00, { apr: 5.2, minPayment: 250 });
      const mortgage  = acct('Mortgage', 'mortgage', 294500.00, { apr: 6.125, minPayment: 1848, originalPrincipal: 312000, termMonths: 360, firstPaymentDate: '2024-04-01' });
      s.accounts = [checking, savings, brokerage, k401, roth, hsa, home, cc, auto, student, mortgage];

      // ---- 12 months of transactions ----
      const tx = [];
      const add = (date, type, amount, accountId, categoryId, payee, toAccountId = null) =>
        tx.push({ id: U.uid(), date, type, amount: U.round2(amount), accountId, toAccountId, categoryId, payee, notes: '' });

      const today = U.todayStr();
      const months = U.lastMonths(12);

      for (const mk of months) {
        const [y, m] = mk.split('-').map(Number);
        const daysInMonth = new Date(y, m, 0).getDate();
        const D = (d) => `${mk}-${String(Math.min(d, daysInMonth)).padStart(2, '0')}`;
        const isCurrent = mk === U.thisMonth();
        const todayDay = Number(today.slice(8, 10));
        const has = (d) => !isCurrent || d <= todayDay;

        // paychecks (semi-monthly)
        if (has(1)) add(D(1), 'income', 2725, checking.id, catId('Salary'), 'Acme Corp Payroll');
        if (has(15)) add(D(15), 'income', 2725, checking.id, catId('Salary'), 'Acme Corp Payroll');

        // fixed bills
        if (has(1)) add(D(1), 'expense', 1848, checking.id, catId('Housing'), 'Mortgage Payment');
        if (has(5)) add(D(5), 'expense', U.round2(rand(140, 265)), checking.id, catId('Utilities'), pick(['City Power & Light', 'City Utilities']));
        if (has(8)) add(D(8), 'expense', U.round2(rand(55, 80)), checking.id, catId('Utilities'), 'Comcast Internet');
        if (has(12)) add(D(12), 'expense', 165, checking.id, catId('Insurance'), 'State Farm Insurance');
        if (has(3)) add(D(3), 'expense', 15.49, cc.id, catId('Subscriptions'), 'Netflix');
        if (has(7)) add(D(7), 'expense', 11.99, cc.id, catId('Subscriptions'), 'Spotify');
        if (has(10)) add(D(10), 'expense', 45, checking.id, catId('Health & Fitness'), 'City Gym');
        if (has(18)) add(D(18), 'expense', 2.99, cc.id, catId('Subscriptions'), 'iCloud Storage');

        // debt payments (transfers reduce loan balances)
        if (has(6)) add(D(6), 'transfer', 385, checking.id, null, 'Auto Loan Payment', auto.id);
        if (has(6)) add(D(6), 'transfer', 250, checking.id, null, 'Student Loan Payment', student.id);
        if (has(20)) add(D(20), 'transfer', U.round2(rand(550, 800)), checking.id, null, 'Credit Card Payment', cc.id);

        // savings & investing
        if (has(2)) add(D(2), 'transfer', 500, checking.id, null, 'Auto-save to HYS', savings.id);
        if (has(16)) add(D(16), 'transfer', 400, checking.id, null, 'Brokerage Deposit', brokerage.id);

        // groceries (weekly)
        for (const d of [4, 11, 18, 25]) {
          if (has(d)) add(D(d), 'expense', U.round2(rand(105, 185)), cc.id, catId('Groceries'), pick(['Kroger', 'Trader Joe\'s', 'Costco', 'Safeway']));
        }

        // gas
        for (const d of [5, 13, 21, 28]) {
          if (has(d) && rnd() > 0.2) add(D(d), 'expense', U.round2(rand(32, 58)), cc.id, catId('Transportation'), pick(['Shell', 'Chevron', 'Costco Gas']));
        }

        // dining out
        const dineCount = randInt(5, 9);
        for (let i = 0; i < dineCount; i++) {
          const d = randInt(1, 28);
          if (has(d)) add(D(d), 'expense', U.round2(rand(14, 68)), cc.id, catId('Dining Out'), pick(['Chipotle', 'Thai Basil', 'The Local Taphouse', 'Sushi Zen', 'Panera', 'Blue Bottle Coffee']));
        }

        // shopping
        const shopCount = randInt(2, 5);
        for (let i = 0; i < shopCount; i++) {
          const d = randInt(2, 27);
          if (has(d)) add(D(d), 'expense', U.round2(rand(22, 145)), cc.id, catId('Shopping'), pick(['Amazon', 'Target', 'Home Depot', 'REI', 'Best Buy']));
        }

        // entertainment
        const entCount = randInt(1, 3);
        for (let i = 0; i < entCount; i++) {
          const d = randInt(3, 27);
          if (has(d)) add(D(d), 'expense', U.round2(rand(18, 85)), cc.id, catId('Entertainment'), pick(['AMC Theatres', 'Steam', 'TopGolf', 'City Symphony']));
        }

        // occasional
        if (rnd() > 0.55) { const d = randInt(4, 26); if (has(d)) add(D(d), 'expense', U.round2(rand(40, 220)), cc.id, catId('Health & Fitness'), pick(['CVS Pharmacy', 'Dental Care Assoc.', 'Urgent Care'])); }
        if (rnd() > 0.6) { const d = randInt(4, 26); if (has(d)) add(D(d), 'expense', U.round2(rand(25, 90)), cc.id, catId('Personal Care'), pick(['Great Clips', 'Lush', 'Nail Studio'])); }
        if (rnd() > 0.7) { const d = randInt(4, 26); if (has(d)) add(D(d), 'expense', U.round2(rand(30, 150)), cc.id, catId('Gifts & Charity'), pick(['Red Cross', 'Local Food Bank', 'Birthday Gift'])); }
        if (rnd() > 0.75) { const d = randInt(2, 26); if (has(d)) add(D(d), 'income', U.round2(rand(150, 600)), checking.id, catId('Side Income'), 'Freelance Design'); }
        if (rnd() > 0.8) { const d = randInt(10, 26); if (has(d)) add(D(d), 'income', U.round2(rand(20, 95)), savings.id, catId('Interest & Dividends'), 'HYS Interest'); }
      }

      // annual events
      const bonusMonth = months[2];
      add(`${bonusMonth}-28`, 'income', 4500, checking.id, catId('Bonus'), 'Annual Bonus — Acme Corp');
      const travelMonth = months[5];
      add(`${travelMonth}-14`, 'expense', 1240, cc.id, catId('Travel'), 'Delta Airlines');
      add(`${travelMonth}-15`, 'expense', 685, cc.id, catId('Travel'), 'Marriott Resort');

      tx.sort((a, b) => a.date < b.date ? -1 : 1);
      s.transactions = tx;

      // ---- budgets: current + 5 previous months ----
      const budget = {
        'Housing': 1850, 'Utilities': 330, 'Groceries': 620, 'Dining Out': 320,
        'Transportation': 180, 'Health & Fitness': 160, 'Insurance': 165,
        'Entertainment': 120, 'Shopping': 350, 'Subscriptions': 35,
        'Personal Care': 60, 'Gifts & Charity': 80, 'Travel': 200, 'Miscellaneous': 100
      };
      for (const mk of U.lastMonths(6)) {
        s.budgets[mk] = {};
        for (const [name, amt] of Object.entries(budget)) s.budgets[mk][catId(name)] = amt;
      }

      // ---- recurring ----
      const nextMonthDay = (day) => {
        const t = U.todayStr();
        const mk = U.thisMonth();
        const candidate = `${mk}-${String(day).padStart(2, '0')}`;
        return candidate >= t ? candidate : U.addMonthsToDate(candidate, 1);
      };
      s.recurring = [
        { id: U.uid(), name: 'Acme Corp Payroll', type: 'income', amount: 2725, accountId: checking.id, toAccountId: null, categoryId: catId('Salary'), frequency: 'biweekly', nextDate: nextMonthDay(15), autoPost: false, active: true },
        { id: U.uid(), name: 'Mortgage Payment', type: 'expense', amount: 1848, accountId: checking.id, toAccountId: null, categoryId: catId('Housing'), frequency: 'monthly', nextDate: nextMonthDay(1), autoPost: false, active: true },
        { id: U.uid(), name: 'Auto-save to HYS', type: 'transfer', amount: 500, accountId: checking.id, toAccountId: savings.id, categoryId: null, frequency: 'monthly', nextDate: nextMonthDay(2), autoPost: false, active: true },
        { id: U.uid(), name: 'Netflix', type: 'expense', amount: 15.49, accountId: cc.id, toAccountId: null, categoryId: catId('Subscriptions'), frequency: 'monthly', nextDate: nextMonthDay(3), autoPost: false, active: true },
        { id: U.uid(), name: 'Spotify', type: 'expense', amount: 11.99, accountId: cc.id, toAccountId: null, categoryId: catId('Subscriptions'), frequency: 'monthly', nextDate: nextMonthDay(7), autoPost: false, active: true },
        { id: U.uid(), name: 'City Gym', type: 'expense', amount: 45, accountId: checking.id, toAccountId: null, categoryId: catId('Health & Fitness'), frequency: 'monthly', nextDate: nextMonthDay(10), autoPost: false, active: true },
        { id: U.uid(), name: 'State Farm Insurance', type: 'expense', amount: 165, accountId: checking.id, toAccountId: null, categoryId: catId('Insurance'), frequency: 'monthly', nextDate: nextMonthDay(12), autoPost: false, active: true }
      ];

      // ---- goals ----
      s.goals = [
        { id: U.uid(), name: 'Emergency Fund (6 months)', targetAmount: 25000, targetDate: null, linkedAccountId: savings.id, manualSaved: 0, colorSlot: 2, createdAt: '2024-06-01' },
        { id: U.uid(), name: 'Japan Trip 2027', targetAmount: 6000, targetDate: '2027-04-01', linkedAccountId: null, manualSaved: 2350, colorSlot: 5, createdAt: '2025-11-01' },
        { id: U.uid(), name: 'New Car Down Payment', targetAmount: 10000, targetDate: '2027-09-01', linkedAccountId: null, manualSaved: 4100, colorSlot: 3, createdAt: '2025-08-01' }
      ];

      // ---- synthesized net-worth history (rising trend) ----
      s.netWorthHistory = [];
      const nwMonths = U.lastMonths(12);
      const finalAssets = 4230.55 + 18450 + 31900 + 98400 + 41200 + 8150 + 385000;
      const finalLiab = 1840.22 + 14350 + 21800 + 294500;
      for (let i = 0; i < nwMonths.length; i++) {
        const back = nwMonths.length - 1 - i;
        const assets = finalAssets - back * 2350 - back * back * 14 + (mulberry32(i * 7 + 3)() - 0.5) * 2600;
        const liab = finalLiab + back * 690;
        s.netWorthHistory.push({ month: nwMonths[i], assets: U.round2(assets), liabilities: U.round2(liab), net: U.round2(assets - liab) });
      }

      // ---- retirement inputs ----
      s.retirement = Object.assign(s.retirement, {
        currentAge: 35, retireAge: 65, lifeExpectancy: 92,
        salary: 85000, salaryGrowth: 3, employeePct: 10,
        employerMatchPct: 50, employerMatchCapPct: 6,
        extraAnnual: 7000, retireSpending: 65000,
        ssClaimAge: 67, ssMonthly: null
      });

      return s;
    }
  };

  window.Demo = Demo;
})();
