// Dev-only: launch the real app, load demo data, screenshot key views.
// Usage: npx electron scripts/capture.js <outputDir>
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const outDir = process.argv[2] || __dirname;
// isolated userData so the capture run never touches real data
app.setPath('userData', path.join(outDir, 'capture-profile'));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 920, show: false, backgroundColor: '#0d0d0d',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.show();
  await sleep(1200);

  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, name), img.toPNG());
    console.log('captured', name);
  };

  // load demo data through the onboarding flow
  await win.webContents.executeJavaScript(`
    (() => {
      const btn = document.querySelector('[data-choice="demo"]');
      if (btn) btn.click();
      return true;
    })()`);
  await sleep(900);
  await shot('01-dashboard-dark.png');

  await win.webContents.executeJavaScript(`App.go('subscriptions'); true`);
  await sleep(700);
  await shot('07-subscriptions-dark.png');

  await win.webContents.executeJavaScript(`
    App.go('transactions');
    setTimeout(() => Views.transactions.openImportPreview([
      { date: '2026-07-03', amount: -15.49, payee: 'NETFLIX.COM 866-579-7172', memo: '', fitId: 'A1' },
      { date: '2026-07-05', amount: -84.12, payee: 'KROGER #451', memo: '', fitId: 'A2' },
      { date: '2026-07-06', amount: -6.50, payee: 'JOES COFFEE SHOP', memo: 'latte', fitId: 'A3' },
      { date: '2026-07-07', amount: 2725.00, payee: 'ACME CORP PAYROLL', memo: 'DIRECT DEPOSIT', fitId: 'A4' },
      { date: '2026-07-08', amount: -52.30, payee: 'SHELL OIL 5744', memo: '', fitId: 'A5' }
    ]), 300);
    true`);
  await sleep(1100);
  await shot('08-import-preview-dark.png');
  await win.webContents.executeJavaScript(`document.querySelector('.modal-overlay')?.remove(); true`);

  await win.webContents.executeJavaScript(`App.go('retirement'); true`);
  await sleep(1400);
  await shot('02-retirement-dark.png');

  await win.webContents.executeJavaScript(`App.go('budget'); true`);
  await sleep(700);
  await shot('03-budget-dark.png');

  await win.webContents.executeJavaScript(`App.go('debt'); true`);
  await sleep(900);
  await shot('04-debt-dark.png');

  await win.webContents.executeJavaScript(`
    Store.state.settings.theme = 'light';
    App.applyTheme('light');
    App.go('dashboard');
    true`);
  await sleep(900);
  await shot('05-dashboard-light.png');

  await win.webContents.executeJavaScript(`App.go('transactions'); true`);
  await sleep(700);
  await shot('06-transactions-light.png');

  app.quit();
});
