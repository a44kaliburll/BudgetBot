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

    // ================= OFX / QFX PARSING =================
    // Handles OFX 1.x (SGML, unclosed leaf tags) and 2.x (XML).
    // Returns [{date, amount, payee, memo, fitId, trnType}] — amount signed
    // (negative = money out), per the OFX convention.
    parseOFX(text) {
      const out = [];
      const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
      const field = (block, tag) => {
        const m = block.match(new RegExp('<' + tag + '>([^<\\r\\n]*)', 'i'));
        return m ? m[1].trim() : '';
      };
      for (const block of blocks) {
        const rawDate = field(block, 'DTPOSTED');
        const rawAmt = field(block, 'TRNAMT').replace(/,/g, '.');
        const amount = parseFloat(rawAmt);
        if (!/^\d{8}/.test(rawDate) || isNaN(amount) || amount === 0) continue;
        const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
        const name = field(block, 'NAME');
        const memo = field(block, 'MEMO');
        out.push({
          date,
          amount,
          payee: name || memo || '(no description)',
          memo: memo && memo !== name ? memo : '',
          fitId: field(block, 'FITID') || null,
          trnType: field(block, 'TRNTYPE').toUpperCase()
        });
      }
      return out;
    },

    isOFX(text) {
      return /OFXHEADER|<OFX>|<\?OFX/i.test(text.slice(0, 2000));
    },

    // ================= PDF STATEMENT IMPORT =================
    isPDF(bytes) {
      return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
    },

    // Extract text lines from a PDF using pdf.js: group text items by y, sort by x.
    async pdfToLines(bytes) {
      const pdfjs = window.pdfjsLib;
      pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
      const lines = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        const rows = new Map(); // rounded y -> [{x, str}]
        for (const item of content.items) {
          if (!item.str || !item.str.trim()) continue;
          const y = Math.round(item.transform[5] / 2) * 2; // 2px tolerance
          if (!rows.has(y)) rows.set(y, []);
          rows.get(y).push({ x: item.transform[4], str: item.str });
        }
        const ys = [...rows.keys()].sort((a, b) => b - a); // top of page first
        for (const y of ys) {
          const line = rows.get(y).sort((a, b) => a.x - b.x).map(i => i.str).join(' ')
            .replace(/\s+/g, ' ').trim();
          if (line) lines.push(line);
        }
        lines.push(''); // page break
      }
      doc.destroy();
      return lines;
    },

    // Bold overprint doubles every letter ("AACCCCOOUUNNTT") — collapse runs to compare
    _collapseDoubles(s) {
      return s.replace(/(.)\1+/g, '$1').toUpperCase();
    },

    // Parse credit-card statement lines (Chase-style: "MM/DD DESCRIPTION AMOUNT").
    // Returns { transactions, review, meta }. Transaction amounts use NestEgg's
    // convention: negative = money out. Card purchases are therefore flipped.
    parseStatementText(lines) {
      const TX_RE = /^(\d{2})\/(\d{2})\s+(.+?)\s+(-?)\$?((?:\d{1,3}(?:,\d{3})*)?\.\d{2})$/;
      const meta = { newBalance: null, minPayment: null, apr: null, closeMonth: null, closeYear: null };
      const transactions = [];
      const review = [];

      // ---- metadata pass ----
      for (const raw of lines) {
        const line = raw.replace(/\s+/g, ' ').trim();
        let m;
        if (meta.newBalance == null && (m = line.match(/New Balance:?\s*\$?([\d,]+\.\d{2})/i))) {
          meta.newBalance = U.parseAmount(m[1]);
        }
        if (meta.minPayment == null && (m = line.match(/Minimum Payment Due:?\s*\$?([\d,]+\.\d{2})/i))) {
          meta.minPayment = U.parseAmount(m[1]);
        }
        if (meta.closeYear == null && (m = line.match(/Opening\/Closing Date\s+\d{2}\/\d{2}\/(\d{2,4})\s*-\s*(\d{2})\/\d{2}\/(\d{2,4})/i))) {
          meta.closeMonth = Number(m[2]);
          meta.closeYear = Number(m[3].length === 2 ? '20' + m[3] : m[3]);
        }
        if (meta.closeYear == null && (m = line.match(/Statement Date:?\s*(\d{2})\/\d{2}\/(\d{2,4})/i))) {
          meta.closeMonth = Number(m[1]);
          meta.closeYear = Number(m[2].length === 2 ? '20' + m[2] : m[2]);
        }
        if (meta.apr == null && (m = this._collapseDoubles(line).match(/PURCHASES? ([\d.]+)%/))) {
          meta.apr = parseFloat(m[1]);
        }
      }
      if (meta.closeYear == null) {
        meta.closeYear = Number(U.todayStr().slice(0, 4));
        meta.closeMonth = Number(U.todayStr().slice(5, 7));
      }

      const yearFor = (month) => month > meta.closeMonth ? meta.closeYear - 1 : meta.closeYear;

      // ---- transaction pass, section-aware ----
      let inActivity = false;
      let sawActivity = false;
      let creditSection = false;

      for (const raw of lines) {
        const line = raw.replace(/\s+/g, ' ').trim();
        if (!line) continue;
        const collapsed = this._collapseDoubles(line);

        // "AACCCCOOUUNNTT AACCTTIIVVIITTYY" collapses to "ACOUNT ACTIVITY"
        if (/ACOUNT ACTIVITY/.test(collapsed)) { inActivity = true; sawActivity = true; continue; }
        if (/PAYMENTS AND OTHER CREDITS/.test(collapsed)) { creditSection = true; continue; }
        if (/^PURCHASES?\b/.test(collapsed)) { creditSection = false; continue; }
        if (/TOTALS YEAR-TO-DATE|INTEREST CHARGE/.test(collapsed)) { inActivity = false; continue; }

        const m = line.match(TX_RE);
        if (!m) {
          // brute-force bucket: starts like a transaction but didn't parse cleanly
          if (inActivity && /^\d{2}\/\d{2}\s+\S/.test(line) && !/Page \d+ of \d+/i.test(line)) {
            review.push({ raw: line });
          }
          continue;
        }
        if (!inActivity && sawActivity) continue;   // trailing pages after activity ended
        if (!sawActivity && !inActivity) {
          // no ACCOUNT ACTIVITY marker seen yet — generic statements still parse,
          // but skip obvious non-activity contexts (payment coupons etc.)
          if (/due date|balance|minimum/i.test(line)) continue;
        }

        const month = Number(m[1]), day = Number(m[2]);
        if (month < 1 || month > 12 || day < 1 || day > 31) continue;
        const desc = m[3].trim();
        let amount = U.parseAmount((m[4] || '') + m[5]);
        // card convention: positive = charge (money out), negative = credit
        amount = -amount;
        const isCardPayment = amount > 0 && /payment|autopay|thank you/i.test(desc);
        transactions.push({
          date: `${yearFor(month)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          amount,
          payee: desc,
          memo: '',
          fitId: null,
          flag: isCardPayment ? 'card-payment' : (creditSection && amount > 0 ? 'credit' : null)
        });
      }

      return { transactions, review, meta };
    },

    // ================= PAYSTUB PARSING =================
    isPaystub(lines) {
      const t = lines.join('\n');
      return /Earnings Statement/i.test(t) ||
        (/Gross Pay/i.test(t) && /Net Pay/i.test(t) && /Pay Date/i.test(t));
    },

    // Money tokens from a paystub line. Handles standard "$1,234.56" and the
    // ADP space-grouped format "2 947 07" (last group = cents), incl. -/* marks.
    _stubAmounts(line) {
      const std = line.match(/-?\$?\d[\d,]*\.\d{2}/g);
      if (std) return std.map(s => U.parseAmount(s));
      const out = [];
      const re = /(-?)\$?(\d+(?: \d{3})* \d{2})(?=\*|\s|$)/g;
      let m;
      while ((m = re.exec(line))) {
        const parts = m[2].split(' ');
        const cents = parts.pop();
        out.push(parseFloat(parts.join('') + '.' + cents) * (m[1] === '-' ? -1 : 1));
      }
      return out;
    },

    _stubDate(lines, label) {
      for (const line of lines) {
        const m = line.match(new RegExp(label + '\\s*:?\\s*(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2,4})', 'i'));
        if (m) {
          const y = m[3].length === 2 ? '20' + m[3] : m[3];
          return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
        }
      }
      return null;
    },

    parsePaystub(lines) {
      const clean = lines.map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
      const out = {
        employer: '', payDate: null, periodBegin: null, periodEnd: null,
        gross: null, grossYTD: null, net: null, retirementDeduction: null,
        frequency: 'biweekly', periodsPerYear: 26
      };

      out.payDate = this._stubDate(clean, 'Pay Date');
      out.periodBegin = this._stubDate(clean, 'Period Beginning');
      out.periodEnd = this._stubDate(clean, 'Period Ending');

      for (const line of clean) {
        if (!out.employer && /Period Beginning/i.test(line)) {
          const prefix = line.split(/Period Beginning/i)[0].replace(/[^\w&.,' -]/g, ' ').replace(/\s+/g, ' ').trim();
          if (prefix.length >= 3) out.employer = prefix;
        }
        if (out.gross == null && /Gross Pay/i.test(line)) {
          const amts = this._stubAmounts(line).filter(a => a > 0);
          if (amts.length) {
            out.gross = amts[0];
            if (amts.length > 1 && amts[amts.length - 1] > amts[0]) out.grossYTD = amts[amts.length - 1];
          }
        }
        if (out.net == null && /Net Pay/i.test(line)) {
          const amts = this._stubAmounts(line).filter(a => a > 0);
          if (amts.length) out.net = amts[0];
        }
        if (out.retirementDeduction == null && /(401|403|retirement|pension|tsp|\bers\b)/i.test(line)) {
          const amts = this._stubAmounts(line);
          if (amts.length && amts[0] < 0) out.retirementDeduction = Math.abs(amts[0]);
        }
      }

      // pay frequency from the period length
      if (out.periodBegin && out.periodEnd) {
        const days = U.daysBetween(out.periodBegin, out.periodEnd);
        if (days <= 7) { out.frequency = 'weekly'; out.periodsPerYear = 52; }
        else if (days <= 13) { out.frequency = 'biweekly'; out.periodsPerYear = 26; }
        else if (days <= 16) { out.frequency = 'semimonthly'; out.periodsPerYear = 24; }
        else { out.frequency = 'monthly'; out.periodsPerYear = 12; }
      }

      out.annualGross = out.gross != null ? out.gross * out.periodsPerYear : null;
      // on-pace estimate from YTD (includes bonuses/extras)
      if (out.grossYTD && out.payDate) {
        const d = U.strToDate(out.payDate);
        const dayOfYear = Math.max(1, Math.round((d - new Date(d.getFullYear(), 0, 1)) / 86400000) + 1);
        out.annualFromYTD = out.grossYTD / dayOfYear * 365;
      }
      if (out.gross != null && out.retirementDeduction != null) {
        out.contributionPct = out.retirementDeduction / out.gross * 100;
      }
      return out;
    },

    // ================= LOAN MATH =================
    // Progress and schedule for an installment loan from its contract terms.
    loanStats(acc) {
      if (!acc.termMonths || !acc.firstPaymentDate) return null;
      const today = U.todayStr();
      const first = acc.firstPaymentDate;
      let made = 0;
      if (today >= first) {
        const [fy, fm, fd] = first.split('-').map(Number);
        const [ty, tm, td] = today.split('-').map(Number);
        made = (ty - fy) * 12 + (tm - fm) + (td >= fd ? 1 : 0);
      }
      made = U.clamp(made, 0, acc.termMonths);
      return {
        paymentsMade: made,
        paymentsLeft: acc.termMonths - made,
        scheduledPayoff: U.addMonthsToDate(first, acc.termMonths - 1),
        pctDone: made / acc.termMonths
      };
    },

    // Remaining balance implied by the amortization schedule after n payments.
    loanBalanceEstimate(principal, apr, monthlyPayment, paymentsMade) {
      const r = apr / 100 / 12;
      if (r === 0) return Math.max(0, principal - monthlyPayment * paymentsMade);
      const g = Math.pow(1 + r, paymentsMade);
      return Math.max(0, principal * g - monthlyPayment * (g - 1) / r);
    },

    // ================= AUTO-CATEGORIZATION =================
    // Learn payee -> category from history: Map(normPayee -> Map(categoryId -> count))
    buildPayeeMap(transactions) {
      const map = new Map();
      for (const t of transactions) {
        if (!t.categoryId || !t.payee || t.type === 'transfer') continue;
        const key = U.normPayee(t.payee);
        if (key.length < 3) continue;
        if (!map.has(key)) map.set(key, new Map());
        const counts = map.get(key);
        counts.set(t.categoryId, (counts.get(t.categoryId) || 0) + 1);
      }
      return map;
    },

    // ================= SUBSCRIPTION DETECTION =================
    KNOWN_SUBS: [
      'netflix', 'spotify', 'hulu', 'disney', 'youtube', 'icloud', 'apple', 'audible',
      'amazon prime', 'prime video', 'adobe', 'microsoft', 'office', 'xbox', 'playstation',
      'nintendo', 'dropbox', 'onedrive', 'paramount', 'peacock', 'hbo', 'crunchyroll',
      'patreon', 'substack', 'nyt', 'new york times', 'wall street journal', 'gym', 'fitness',
      'peloton', 'chatgpt', 'openai', 'claude', 'anthropic', 'norton', 'mcafee', 'nordvpn',
      'expressvpn', 'ring', 'adt', 'sirius', 'pandora', 'tidal', 'kindle', 'chewy',
      'dollar shave', 'hellofresh', 'blue apron', 'insurance', 'geico', 'state farm',
      'progressive', 'allstate', 'verizon', 't mobile', 'at&t', 'comcast', 'xfinity',
      'spectrum', 'internet', 'storage', 'membership', 'discord', 'nitro', 'google one',
      'google fi', 'twitch', 'realms'
    ],

    // Word-boundary match so "ring" doesn't fire on "springs"
    isKnownSubMerchant(key) {
      return this.KNOWN_SUBS.some(k =>
        new RegExp('(^|\\s)' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|\\s)').test(key) ||
        (k.length >= 6 && key.includes(k)));
    },

    SUB_CADENCES: [
      { id: 'weekly',     days: 7,     tol: 2,  freq: 'weekly',     perYear: 52 },
      { id: 'biweekly',   days: 14,    tol: 3,  freq: 'biweekly',   perYear: 26 },
      { id: 'monthly',    days: 30.4,  tol: 5,  freq: 'monthly',    perYear: 12 },
      { id: 'quarterly',  days: 91,    tol: 10, freq: 'quarterly',  perYear: 4 },
      { id: 'semiannual', days: 182,   tol: 15, freq: 'semiannual', perYear: 2 },
      { id: 'annual',     days: 365,   tol: 21, freq: 'annual',     perYear: 1 }
    ],

    // Find recurring charges in expense history. Pure function of transactions.
    detectSubscriptions(transactions) {
      const groups = new Map();
      for (const t of transactions) {
        if (t.type !== 'expense' || !t.payee) continue;
        const key = U.normPayee(t.payee);
        if (key.length < 3) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(t);
      }

      const today = U.todayStr();
      const results = [];

      for (const [key, charges] of groups) {
        if (charges.length < 2) continue;
        charges.sort((a, b) => a.date < b.date ? -1 : 1);

        const intervals = [];
        for (let i = 1; i < charges.length; i++) {
          intervals.push(U.daysBetween(charges[i - 1].date, charges[i].date));
        }

        const known = this.isKnownSubMerchant(key);

        // best-matching cadence by share of intervals within tolerance
        let best = null;
        for (const cad of this.SUB_CADENCES) {
          const hits = intervals.filter(d => Math.abs(d - cad.days) <= cad.tol).length;
          const score = hits / intervals.length;
          if (!best || score > best.score) best = { cad, score };
        }
        if (!best || best.score < (known ? 0.5 : 0.65)) continue;
        // two data points = one interval; only trust it for common cadences or known merchants
        if (charges.length === 2 && !known && !['monthly', 'annual'].includes(best.cad.id)) continue;

        // amount stability across consecutive charges (tolerates gradual price changes)
        let stablePairs = 0;
        for (let i = 1; i < charges.length; i++) {
          const prev = charges[i - 1].amount, cur = charges[i].amount;
          if (Math.abs(cur - prev) <= Math.max(1.5, 0.2 * prev)) stablePairs++;
        }
        const amtScore = stablePairs / (charges.length - 1);
        if (amtScore < (known ? 0.34 : 0.55)) continue;

        const amounts = charges.map(c => c.amount);
        const latest = amounts[amounts.length - 1];
        const prevMedian = amounts.length > 2 ? U.median(amounts.slice(0, -1)) : amounts[0];
        const priceChange = Math.abs(latest - prevMedian) > Math.max(0.5, 0.03 * prevMedian)
          ? { from: U.round2(prevMedian), to: U.round2(latest) }
          : null;

        // most frequent category & account across the group's charges
        const modeOf = (vals) => {
          const c = new Map();
          let bestV = null, bestN = 0;
          for (const v of vals) {
            if (!v) continue;
            const n = (c.get(v) || 0) + 1;
            c.set(v, n);
            if (n > bestN) { bestN = n; bestV = v; }
          }
          return bestV;
        };

        const lastDate = charges[charges.length - 1].date;
        const nextExpected = U.addDays(lastDate, Math.round(best.cad.days));
        const overdueDays = U.daysBetween(nextExpected, today);
        const inactive = overdueDays > best.cad.days * 0.75;

        const confidence = best.score * 0.6 + amtScore * 0.4 + (known ? 0.1 : 0);

        results.push({
          key,
          displayName: modeOf(charges.map(c => c.payee)) || key,
          categoryId: modeOf(charges.map(c => c.categoryId)),
          accountId: modeOf(charges.map(c => c.accountId)),
          cadence: best.cad.id,
          frequency: best.cad.freq,
          perYear: best.cad.perYear,
          amount: latest,
          monthlyCost: latest * best.cad.perYear / 12,
          chargeCount: charges.length,
          firstDate: charges[0].date,
          lastDate,
          nextExpected,
          inactive,
          priceChange,
          known,
          confidence: Math.min(1, confidence)
        });
      }

      return results.sort((a, b) => b.monthlyCost - a.monthlyCost);
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
