# NestEgg — Budget & Retirement Planner

A comprehensive, **local-first** personal finance desktop app for Windows. All data stays on
your computer — no accounts, no cloud, no telemetry.

![NestEgg](renderer/assets/icon.png)

## Features

**Everyday money**
- **Accounts** — checking, savings, brokerage, 401(k)/Roth/IRA/HSA/529, property, credit cards, loans and mortgages, grouped with live net worth
- **Transactions** — fast entry (`Ctrl+N` anywhere), search and filters, transfers that correctly move money between accounts, CSV export
- **Bank file import** — OFX / QFX (what most US banks export), CSV with column mapping, and **PDF credit-card statements** (Chase-style): transactions, new balance, minimum payment and APR are parsed straight off the bill, card payments are flagged to avoid double counting, and any line the parser can't read confidently lands in a fix-it-yourself review bucket. Everything goes through a review screen with automatic duplicate detection before anything is saved
- **Cascade suggestions** — after an import, recurring charges found in the new data (confirmed patterns and known subscription merchants) are offered for one-click tracking in Recurring
- **Paystub import** — drop in a paystub PDF (ADP-style) and NestEgg reads the employer, pay period, gross/net and retirement deduction, estimates your **annual income**, and offers one-click setup: record the paycheck, create/update the recurring deposit, and sync your salary and contribution % into the Retirement planner
- **Loan tracking** — installment loans (auto, mortgage, student, personal) take their contract terms: amount financed, term in months, first payment date. NestEgg shows payment X of Y, the scheduled payoff date, whether your payoff plan runs ahead of or behind schedule, and can estimate the current balance from the amortization schedule. One click schedules the monthly payment as a recurring transfer
- **Auto-categorization** — suggests categories from your own history, plus explicit payee rules; correcting a category during import teaches NestEgg a new rule automatically
- **Subscription finder** — detects recurring charges in your history (regular timing + stable amounts), totals your monthly/yearly subscription cost, flags price increases, spots subscriptions that stopped, and converts any of them into tracked Recurring items
- **Budget** — monthly plans per category, progress with over-budget warnings, copy last month, auto-fill from your 3-month spending history, custom categories
- **Recurring** — bills, subscriptions, paychecks and auto-savings; due reminders on the dashboard, optional auto-posting
- **Goals** — target amounts and dates, linked to a real account or tracked manually, required monthly pace

**Planning**
- **Debt payoff** — snowball vs avalanche simulation with real amortization: debt-free date, total interest, interest saved vs minimum payments, payoff order
- **Retirement planner (US)** — salary growth, employee contribution + employer match, extra savings, inflation; deterministic projection **plus 1,000-run Monte Carlo** with percentile bands, plan success rate, safe-spending solver (highest spending at 90% success), Social Security bend-point estimator with claiming-age adjustment, what-if chips (retire earlier/later, save more, spend less), current IRS contribution limits
- **Reports** — income vs spending trends, stacked category history, net worth history, category totals over 6m/12m/YTD/all-time

**App**
- Dark & light themes, careful accessible chart palette
- Daily rotating backups (14 kept) + JSON export/restore
- Sample dataset to explore every feature (Settings → Load sample data)

## Development

```bash
npm install
npm start          # run the app
npm run icon       # regenerate icon.png / icon.ico
npm run dist       # build the Windows installer (dist/NestEgg Setup x.y.z.exe)
node scripts/dev-server.js   # browser preview at http://localhost:8642 (localStorage-backed)
```

## Releasing

Releases are automated by [`.github/workflows/release.yml`](.github/workflows/release.yml).
To ship a new version:

```bash
# 1. bump "version" in package.json (e.g. 1.0.1), commit and push
# 2. tag it and push the tag:
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions builds the installer on a Windows runner and attaches
`NestEgg Setup <version>.exe` to a new release for that tag. (Run the workflow
manually from the Actions tab to get a test build as an artifact without releasing.)

## Architecture

- **Electron** (sandboxed renderer, context isolation, CSP) — `main.js`, `preload.js`, `store.js`
- **Renderer** — dependency-free vanilla JS views (`renderer/js/views/*`), Chart.js for charts,
  a small design-token system in `styles.css`
- **Data** — single JSON document in `%APPDATA%/nestegg/nestegg-data.json`, atomic writes,
  automatic daily backups in `backups/`
- **Engines** (`renderer/js/engines.js`) — debt amortization simulator, Social Security PIA
  estimate, deterministic retirement projection, seeded Monte Carlo simulation

## Disclaimer

NestEgg is a planning tool, not financial advice. Projections use your assumptions and
simplified tax treatment. Verify Social Security estimates at ssa.gov and current
contribution limits at irs.gov.
