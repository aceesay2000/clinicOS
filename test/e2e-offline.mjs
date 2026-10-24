// End-to-end: local server + 5 browser "phones"; one goes offline mid-clinic.
//   npm run build && node test/e2e-offline.mjs
// Uses the Playwright + Chromium installed on the machine (not a project dependency).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 8091;
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS_DIR;

const code = '135790';
const hub = spawn(process.execPath, ['server/local.js'], { env: { ...process.env, PORT, CLINIC_CODE: code, LOCAL_DB_DIR: 'memory://' }, stdio: 'pipe' });
await new Promise((resolve) => hub.stdout.on('data', (d) => String(d).includes('Clinic code') && resolve()));

const browser = await chromium.launch();
const step = (msg) => console.log('✓', msg);
const shot = async (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, name + '.png') });

async function tablet(station, name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.error(`[${name}] page error:`, e.message); process.exitCode = 1; });
  await page.goto(BASE);
  await page.getByRole('button', { name: station, exact: true }).click();
  await page.fill('#tname', name);
  await page.fill('#code', code);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.locator('header').getByText('Synced', { exact: true }).waitFor();
  return { ctx, page };
}

try {
  const admin = await tablet('Admin', 'Admin laptop');
  await admin.page.getByRole('button', { name: 'Stock', exact: true }).click();
  await admin.page.getByRole('button', { name: 'Load sample list for a dry run' }).click();
  await admin.page.getByText('Amlodipine 5 mg').waitFor();
  step('admin set up and loaded the formulary');

  const reg = await tablet('Registration', 'Desk 1');
  const vit = await tablet('Vitals / triage', 'Table 2');
  const doc = await tablet('Doctor', 'Room A');
  const ph = await tablet('Pharmacy', 'Pharmacy');
  step('4 station phones set up with the clinic code');

  async function register(page, name, sex, age, complaints) {
    await page.fill('#name', name);
    await page.getByRole('button', { name: sex === 'F' ? 'Female' : 'Male', exact: true }).click();
    await page.fill('#age', age);
    await page.selectOption('#village', 'Kerewan');
    for (const c of complaints) await page.getByRole('button', { name: c, exact: true }).click();
    await page.getByLabel('Patient agreed').check();
    await page.getByRole('button', { name: 'Register and send to Vitals' }).click();
    await page.getByText('sent to Vitals').waitFor();
  }

  await register(reg.page, 'Fatou Jallow', 'F', '52', ['BP check', 'Body pain']);
  await shot(reg.page, '1-registration');
  await vit.page.getByText('Fatou Jallow').first().waitFor();
  step('registered Fatou on Desk 1 → appears on Vitals tablet');

  // --- Desk 1 loses the network ---
  await reg.ctx.setOffline(true);
  await register(reg.page, 'Lamin Ceesay', 'M', '6', ['Fever']);
  await reg.page.locator('header').getByText(/Offline · \d+ changes? waiting to sync/).waitFor({ timeout: 15000 });
  step('Desk 1 offline: Lamin saved on the phone, badge shows changes waiting');

  await reg.page.reload(); // still offline: app must open from cache with data intact
  await reg.page.getByText('Enter the station PIN').waitFor();
  for (const d of '1234') await reg.page.getByRole('button', { name: d, exact: true }).click();
  await reg.page.locator('header').getByText(/changes? waiting to sync/).waitFor();
  await reg.page.fill('#search', 'Lamin');
  await reg.page.getByText('Use this patient').waitFor();
  await shot(reg.page, '2-offline-registration');
  step('reloaded while offline: app opened from cache, Lamin still on the phone');
  if (await vit.page.getByText('Lamin Ceesay').count()) throw new Error('Lamin should not reach Vitals while Desk 1 is offline');

  // --- Vitals: urgent BP ---
  await vit.page.getByText('Fatou Jallow').first().click();
  await vit.page.getByLabel('Systolic').fill('168');
  await vit.page.getByLabel('Diastolic').fill('102');
  await vit.page.fill('#temp', '37.1');
  await vit.page.fill('#pulse', '88');
  await vit.page.fill('#spo2', '97');
  await vit.page.fill('#weight', '74');
  await vit.page.getByText('This patient will go to the front of the doctor queue').waitFor();
  await shot(vit.page, '3-vitals');
  await vit.page.getByRole('button', { name: 'Send to Doctor (urgent)' }).click();
  step('Vitals flagged BP 168/102 and sent Fatou as urgent');

  // --- Desk 1 reconnects ---
  await reg.ctx.setOffline(false);
  await reg.page.locator('header').getByText('Synced', { exact: true }).waitFor({ timeout: 15000 });
  await vit.page.getByText('Lamin Ceesay').first().waitFor({ timeout: 10000 });
  step('Desk 1 reconnected: queued changes synced, Lamin now on Vitals');

  // --- Doctor ---
  await doc.page.getByText('URGENT').first().waitFor();
  await doc.page.getByRole('button', { name: 'Hypertension', exact: true }).click();
  await doc.page.fill('#notes', 'BP still high. Advise less salt; recheck next clinic day.');
  await doc.page.getByPlaceholder('Add medicine from stock…').fill('amlo');
  await doc.page.getByRole('button', { name: /Amlodipine 5 mg/ }).click();
  await doc.page.locator('select').first().selectOption({ label: '1 × once a day × 30 days' });
  await shot(doc.page, '4-doctor');
  await doc.page.getByRole('button', { name: 'Finish · send to Pharmacy' }).click();
  step('Doctor prescribed Amlodipine 5 mg × 30 (reserved)');

  // --- Pharmacy ---
  await ph.page.getByText('Fatou Jallow').first().waitFor();
  await ph.page.getByText('Amlodipine 5 mg · 30 tab').waitFor();
  await shot(ph.page, '5-pharmacy');
  await ph.page.evaluate(() => { window.print = () => {}; });
  await ph.page.getByRole('button', { name: 'Dispense and print slip' }).click();
  await ph.page.getByText('dispensed · stock updated').waitFor();
  if (SHOTS) {
    await ph.page.emulateMedia({ media: 'print' });
    await ph.page.locator('#print-root .slip').screenshot({ path: path.join(SHOTS, '7-slip.png') });
    await ph.page.emulateMedia({ media: 'screen' });
  }
  step('Pharmacy dispensed');

  // --- Stock + board on the admin laptop ---
  await admin.page.getByRole('button', { name: 'Stock', exact: true }).click();
  await admin.page.waitForFunction(() => [...document.querySelectorAll('tr')].some((r) => r.textContent.includes('Amlodipine 5 mg') && r.children[2]?.textContent === '270'), null, { timeout: 10000 });
  step('stock on hand went 300 → 270 on the admin screen');
  await admin.page.getByRole('button', { name: 'Clinic lead', exact: true }).click();
  await admin.page.getByText('Lamin C.').waitFor();
  await shot(admin.page, '6-board');
  step('lead board shows live queues');

  // The server's full backup must contain everything
  const dev = await admin.page.evaluate(() => new Promise((ok) => {
    const r = indexedDB.open('clinic-os');
    r.onsuccess = () => { const g = r.result.transaction('meta').objectStore('meta').get('device'); g.onsuccess = () => ok(g.result); };
  }));
  const backup = await fetch(BASE + '/api/backup', { method: 'POST', body: JSON.stringify({ deviceId: dev.deviceId, token: dev.token }) }).then((r) => r.json());
  const all = JSON.stringify(backup.docs);
  for (const s of ['Fatou Jallow', 'Lamin Ceesay', '"dispensed"']) if (!all.includes(s)) throw new Error('server backup missing ' + s);
  step('server database holds all records');
  console.log('\nE2E PASSED');
} catch (err) {
  console.error('\nE2E FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  hub.kill();
}
