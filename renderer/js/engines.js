// Financial engines: debt payoff simulation, Social Security estimate,
// deterministic retirement projection, Monte Carlo simulation.
(function () {
  'use strict';

  // deterministic RNG (Box-Muller over mulberry32) for reproducible simulations
  function makeRng(seed) {
    let a = seed | 0;
    const uniform = () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      uniform,
      normal(mean, sd) {
        let u = 0, v = 0;
        while (u === 0) u = uniform();
        while (v === 0) v = uniform();
        return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      }
    };
  }

  const Engines = {

    // ================= DEBT PAYOFF =================
    // debts: [{id, name, balance, apr (annual %), minPayment}]
    // strategy: 'snowball' | 'avalanche'
    debtPlan(debts, extraMonthly, strategy) {
      const list = debts
        .filter(d => d.balance > 0)
        .map(d => ({ ...d, bal: d.balance, interestPaid: 0, payoffMonth: null }));

      const order = strategy === 'avalanche'
        ? U.sortBy(list, d => -d.apr)
        : U.sortBy(list, d => d.bal);

      const totalStart = U.sum(list, d => d.bal);
      const series = [totalStart];
      let month = 0, totalInterest = 0;
      const MAX_MONTHS = 720;

      while (order.some(d => d.bal > 0.005) && month < MAX_MONTHS) {
        month++;
        // 1) accrue interest
        for (const d of order) {
          if (d.bal <= 0.005) continue;
          const interest = d.bal * (d.apr / 100 / 12);
          d.bal += interest;
          d.interestPaid += interest;
          totalInterest += interest;
        }
        // 2) minimum payments
        let freed = 0;
        for (const d of order) {
          if (d.bal <= 0.005) { freed += d.minPayment || 0; continue; }
          const pay = Math.min(d.minPayment || 0, d.bal);
          d.bal -= pay;
        }
        // 3) extra + freed-up minimums attack the target debt in order
        let attack = extraMonthly + freed;
        for (const d of order) {
          if (attack <= 0) break;
          if (d.bal <= 0.005) continue;
          const pay = Math.min(attack, d.bal);
          d.bal -= pay;
          attack -= pay;
        }
        // 4) record payoffs
        for (const d of order) {
          if (d.bal <= 0.005 && d.payoffMonth === null) { d.bal = 0; d.payoffMonth = month; }
        }
        series.push(U.sum(order, d => d.bal));
      }

      const stuck = month >= MAX_MONTHS && order.some(d => d.bal > 0.005);
      return {
        months: month,
        stuck,
        totalInterest,
        series,
        perDebt: order.map(d => ({
          id: d.id, name: d.name, apr: d.apr, startBalance: d.balance,
          payoffMonth: d.payoffMonth, interestPaid: d.interestPaid
        }))
      };
    },

    // ================= SOCIAL SECURITY (rough estimate) =================
    // Bend-point PIA formula (2025 bend points: $1,226 / $7,391), earnings
    // approximated as a 35-year career averaging ~82% of final salary.
    // Returns estimated monthly benefit in today's dollars.
    ssEstimate(salary, claimAge) {
      const WAGE_CAP_MONTHLY = 176100 / 12;      // 2025 SS wage base
      const careerAvgAnnual = Math.min(salary, 176100) * 0.82;
      const aime = Math.min(careerAvgAnnual / 12, WAGE_CAP_MONTHLY);
      const b1 = 1226, b2 = 7391;
      let pia = 0.9 * Math.min(aime, b1);
      if (aime > b1) pia += 0.32 * (Math.min(aime, b2) - b1);
      if (aime > b2) pia += 0.15 * (aime - b2);
      // claiming-age adjustment relative to FRA 67
      const adj = { 62: 0.70, 63: 0.75, 64: 0.80, 65: 0.867, 66: 0.933, 67: 1.0, 68: 1.08, 69: 1.16, 70: 1.24 };
      const age = U.clamp(Math.round(claimAge), 62, 70);
      return Math.round(pia * (adj[age] || 1.0));
    },

    // ================= RETIREMENT: shared year-step helpers =================
    _annualContribution(r, yearsFromNow) {
      const salary = r.salary * Math.pow(1 + r.salaryGrowth / 100, yearsFromNow);
      const empPct = r.employeePct / 100;
      const matchedPct = Math.min(empPct, r.employerMatchCapPct / 100);
      const employer = salary * matchedPct * (r.employerMatchPct / 100);
      const extra = r.extraAnnual * Math.pow(1 + r.inflation / 100, yearsFromNow);
      return salary * empPct + employer + extra;
    },

    _retirementIncome(r, age, yearsFromNow) {
      // Social Security + pension, in nominal dollars for that year
      const infl = Math.pow(1 + r.inflation / 100, yearsFromNow);
      let income = 0;
      const ssMonthly = r.ssMonthly != null && r.ssMonthly !== ''
        ? Number(r.ssMonthly)
        : this.ssEstimate(r.salary, r.ssClaimAge);
      if (age >= r.ssClaimAge) income += ssMonthly * 12 * infl;   // SS is COLA-adjusted
      if (r.pensionAnnual > 0) income += r.pensionAnnual;          // pension held nominal
      return income;
    },

    _netWithdrawal(r, need) {
      // gross-up by blended effective tax rate on withdrawals
      const t = U.clamp(r.taxRatePretax / 100, 0, 0.6);
      return need / (1 - t);
    },

    // ================= DETERMINISTIC PROJECTION =================
    retirementProject(r, startBalance) {
      const years = [];
      let bal = startBalance;
      let depletionAge = null;
      let nestEggNominal = 0;

      for (let age = r.currentAge; age <= r.lifeExpectancy; age++) {
        const yearsFromNow = age - r.currentAge;
        const inflFactor = Math.pow(1 + r.inflation / 100, yearsFromNow);

        if (age < r.retireAge) {
          bal = bal * (1 + r.preReturn / 100) + this._annualContribution(r, yearsFromNow);
        } else {
          if (age === r.retireAge) nestEggNominal = bal;
          const spending = r.retireSpending * inflFactor;
          const income = this._retirementIncome(r, age, yearsFromNow);
          const need = Math.max(0, spending - income);
          const gross = this._netWithdrawal(r, need);
          bal = bal * (1 + r.postReturn / 100) - gross;
          if (bal < 0) {
            if (depletionAge === null) depletionAge = age;
            bal = 0;
          }
        }
        years.push({
          age,
          balance: Math.max(0, bal),
          balanceReal: Math.max(0, bal) / inflFactor,
          phase: age < r.retireAge ? 'accumulate' : 'drawdown'
        });
      }

      if (nestEggNominal === 0 && r.retireAge > r.lifeExpectancy) nestEggNominal = bal;
      const inflAtRetire = Math.pow(1 + r.inflation / 100, Math.max(0, r.retireAge - r.currentAge));
      const firstYearSpending = r.retireSpending * inflAtRetire;
      const firstYearIncome = this._retirementIncome(r, r.retireAge, r.retireAge - r.currentAge);

      return {
        years,
        nestEggNominal,
        nestEggReal: nestEggNominal / inflAtRetire,
        depletionAge,
        firstYearSpending,
        firstYearNeed: Math.max(0, firstYearSpending - firstYearIncome),
        swr4: nestEggNominal * 0.04
      };
    },

    // ================= MONTE CARLO =================
    retirementMonteCarlo(r, startBalance, runs = 1000, seed = 42) {
      const rng = makeRng(seed);
      const horizon = r.lifeExpectancy - r.currentAge + 1;
      // per-year balances across runs, for percentile bands
      const yearBalances = Array.from({ length: horizon }, () => []);
      let successes = 0;

      for (let run = 0; run < runs; run++) {
        let bal = startBalance;
        let failed = false;
        for (let i = 0; i < horizon; i++) {
          const age = r.currentAge + i;
          const yearsFromNow = i;
          const pre = age < r.retireAge;
          const ret = rng.normal(
            (pre ? r.preReturn : r.postReturn) / 100,
            (pre ? r.preVolatility : r.postVolatility) / 100
          );
          if (pre) {
            bal = bal * (1 + ret) + this._annualContribution(r, yearsFromNow);
          } else {
            const inflFactor = Math.pow(1 + r.inflation / 100, yearsFromNow);
            const spending = r.retireSpending * inflFactor;
            const income = this._retirementIncome(r, age, yearsFromNow);
            const gross = this._netWithdrawal(r, Math.max(0, spending - income));
            bal = bal * (1 + ret) - gross;
            if (bal <= 0) { bal = 0; failed = true; }
          }
          yearBalances[i].push(bal);
        }
        if (!failed) successes++;
      }

      const bands = { p10: [], p25: [], p50: [], p75: [], p90: [] };
      for (const balances of yearBalances) {
        balances.sort((a, b) => a - b);
        bands.p10.push(U.percentile(balances, 0.10));
        bands.p25.push(U.percentile(balances, 0.25));
        bands.p50.push(U.percentile(balances, 0.50));
        bands.p75.push(U.percentile(balances, 0.75));
        bands.p90.push(U.percentile(balances, 0.90));
      }

      return {
        successRate: successes / runs,
        bands,
        ages: Array.from({ length: horizon }, (_, i) => r.currentAge + i)
      };
    },

    // Highest sustainable annual spending (today's $) at the target success rate
    safeSpending(r, startBalance, target = 0.9) {
      let lo = 0, hi = Math.max(r.retireSpending * 3, 40000);
      // expand hi until it fails, so the search brackets the answer
      for (let i = 0; i < 6; i++) {
        const test = { ...r, retireSpending: hi };
        if (this.retirementMonteCarlo(test, startBalance, 300, 7).successRate < target) break;
        hi *= 1.6;
      }
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        const test = { ...r, retireSpending: mid };
        const sr = this.retirementMonteCarlo(test, startBalance, 300, 7).successRate;
        if (sr >= target) lo = mid; else hi = mid;
      }
      return Math.round(lo / 100) * 100;
    }
  };

  window.Engines = Engines;
})();
