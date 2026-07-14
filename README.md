# NestEgg — Budget & Retirement Planner

A comprehensive, **local-first** personal finance desktop app for Windows. All data stays on
your computer — no accounts, no cloud, no telemetry.

![NestEgg](renderer/assets/icon.png)

## Features

**Everyday money**
- **Accounts** — checking, savings, brokerage, 401(k)/Roth/IRA/HSA/529, property, credit cards, loans and mortgages, grouped with live net worth
- **Transactions** — fast entry (`Ctrl+N` anywhere), search and filters, transfers that correctly move money between accounts, CSV import (with column mapping) and export
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
