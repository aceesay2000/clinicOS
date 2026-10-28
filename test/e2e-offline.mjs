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

async function setUpDevice(name, kind = 'shared') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.error(`[${name}] page error:`, e.message); process.exitCode = 1; });
  await page.goto(BASE);
  if (kind === 'personal') await page.getByRole('button', { name: 'My own phone', exact: true }).click();
  await page.fill('#tname', name);
  await page.fill('#code', code);
  await page.getByRole('button', { name: 'Set up device', exact: true }).click();
  return { ctx, page };
}

const pin = async (page, digits) => { for (const d of digits) await page.getByRole('button', { name: d, exact: true }).click(); };

async function signInAs(page, person, digits, station) {
  await page.getByRole('button', { name: new RegExp('^' + person) }).click();
  await pin(page, digits);
  if (station) await page.getByRole('button', { name: new RegExp('^' + station) }).click();
  await page.locator('header').getByText('Synced', { exact: true }).waitFor();
}

const TEAM = [
  ['Awa Jallow', 'volunteer', '1357'],
  ['Isatou Touray', 'nurse', '3690'],
  ['Dr Ousman Sowe', 'doctor', '2580'],
  ['Musa Sanneh', 'pharmacist', '4791'],
];

try {
  const admin = await setUpDevice('Admin laptop');
  await admin.page.getByText('Create the admin account').waitFor();
  await admin.page.fill('#admin-name', 'Abubacarr Ceesay');
  await admin.page.fill('#pin1', '2468');
  await admin.page.fill('#pin2', '2468');
  await admin.page.getByRole('button', { name: 'Create admin account' }).click();
  await admin.page.getByRole('button', { name: /^Admin/ }).click();
  await admin.page.locator('header').getByText('Synced', { exact: true }).waitFor();
  step('first person on a new clinic created the admin account');

  await admin.page.getByRole('button', { name: 'Team', exact: true }).click();
  for (const [name, role, digits] of TEAM) {
    await admin.page.getByRole('button', { name: 'Add team member' }).click();
    await admin.page.fill('#m-name', name);
    await admin.page.selectOption('#m-role', role);
    await admin.page.fill('#m-pin', digits);
    await admin.page.getByRole('button', { name: 'Add', exact: true }).click();
    await admin.page.getByRole('cell', { name: new RegExp('^' + name) }).waitFor();
  }
  step('admin added 4 team members with their own PINs');

  await admin.page.getByRole('button', { name: 'Stock', exact: true }).click();
  await admin.page.getByRole('button', { name: 'Load sample list for a dry run' }).click();
  await admin.page.getByText('Amlodipine 5 mg').waitFor();
  step('admin set up and loaded the formulary');

  const reg = await setUpDevice('Desk 1');
  await signInAs(reg.page, 'Awa Jallow', '1357');
  const vit = await setUpDevice('Table 2');
  await signInAs(vit.page, 'Isatou Touray', '3690', 'Vitals');
  const doc = await setUpDevice('Room A');
  await signInAs(doc.page, 'Dr Ousman Sowe', '2580', 'Doctor');
  const ph = await setUpDevice('Pharmacy');
  await signInAs(ph.page, 'Musa Sanneh', '4791');
  step('4 devices set up; each person signed in with their own PIN');

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
  await reg.page.getByText('Welcome back, Awa').waitFor();
  await pin(reg.page, '1357');
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

  // --- Any station can find a patient; registration sees location, not clinical notes ---
  await reg.page.getByRole('button', { name: /Find patient/ }).click();
  await reg.page.getByLabel('Search patients').fill('Fatou');
  await reg.page.getByRole('button', { name: /Fatou Jallow/ }).click();
  await reg.page.getByText('Finished · medicines dispensed').waitFor();
  if (await reg.page.getByText('BP 168/102').count()) throw new Error('registration should not see clinical details');
  await reg.page.getByRole('button', { name: 'Close', exact: true }).click();
  step('registration phone found Fatou: journey shown, clinical notes hidden');

  // --- Switch station: only the stations your role allows ---
  await vit.page.locator('header .station-pill').click();
  if (await vit.page.getByRole('button', { name: 'Doctor', exact: true }).count()) throw new Error('a nurse should not be offered the Doctor station');
  await vit.page.getByRole('button', { name: 'Registration', exact: true }).click();
  await vit.page.locator('header').getByText('Isatou · Registration').waitFor();
  await vit.page.locator('header .station-pill').click();
  await vit.page.getByRole('button', { name: 'Vitals / triage', exact: true }).click();
  await vit.page.locator('header').getByText('Isatou · Vitals / triage').waitFor();
  step('nurse switched Vitals → Registration → Vitals; Doctor not offered to her role');

  // --- Next clinic day: returning patient, history, past-day report ---
  const firstDay = await admin.page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await admin.page.getByRole('button', { name: 'Admin', exact: true }).click();
  await admin.page.fill('#s-day', '2027-01-23');
  await admin.page.getByRole('button', { name: 'Save', exact: true }).click();
  await admin.page.getByText('The clinic day is set to').waitFor();
  step('stale clinic-day warning shown when the day is not today');
  // Wait until the new clinic day has synced to Desk 1 (its warning banner appears).
  await reg.page.getByText('The clinic day is set to 2027-01-23').waitFor({ timeout: 20000 });
  await reg.page.fill('#search', 'Fatou');
  await reg.page.getByRole('button', { name: 'Use this patient' }).click();
  await reg.page.getByLabel('Patient agreed').check();
  await reg.page.getByRole('button', { name: 'Register and send to Vitals' }).click();
  await reg.page.getByText('sent to Vitals').waitFor();
  await doc.page.getByRole('button', { name: /Find patient/ }).click();
  await doc.page.getByLabel('Search patients').fill('DFC-0001');
  await doc.page.getByRole('button', { name: /Fatou Jallow/ }).click();
  await doc.page.getByText('Past clinic days · 1').waitFor();
  await doc.page.locator('details summary', { hasText: firstDay }).click();
  await doc.page.getByText('BP 168/102').waitFor();
  await doc.page.getByRole('button', { name: 'Close', exact: true }).click();
  step('returning patient on the next clinic day: doctor sees last visit history');
  await admin.page.getByRole('button', { name: 'Report', exact: true }).click();
  await admin.page.selectOption('#day-pick', firstDay);
  await admin.page.getByRole('heading', { name: `Past clinic day · ${firstDay}` }).waitFor();
  await admin.page.locator('tr', { hasText: 'Patients registered' }).getByText('2').waitFor();
  step('report opens a past clinic day (2 patients registered)');
  await admin.page.getByRole('button', { name: 'Switch to today' }).click();
  await admin.page.getByText('The clinic day is set to').waitFor({ state: 'detached' });
  step('one tap switched the clinic day back to today');

  // --- Team console: who is on duty, where ---
  await admin.page.getByRole('button', { name: 'Team', exact: true }).click();
  const duty = admin.page.locator('.card', { hasText: 'On duty now' });
  for (const who of ['Awa Jallow', 'Isatou Touray', 'Dr Ousman Sowe', 'Musa Sanneh']) await duty.getByText(who).waitFor({ timeout: 30000 });
  await shot(admin.page, '7-team');
  step('Team tab shows all 4 people on duty, with station and device');

  // --- Sign out hands the device to someone else ---
  await reg.page.locator('header .station-pill').click();
  await reg.page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await reg.page.getByText('Who’s working?').waitFor();
  step('Awa signed out of Desk 1; the device is ready for the next person');

  // --- New volunteer asks to join from their own phone; admin approves ---
  const binta = await setUpDevice('Binta’s phone', 'personal');
  await binta.page.getByRole('button', { name: 'New here? Ask to join' }).click();
  await binta.page.fill('#join-name', 'Binta Kinteh');
  await binta.page.fill('#pin1', '8642');
  await binta.page.fill('#pin2', '8642');
  await binta.page.getByRole('button', { name: 'Send request' }).click();
  await binta.page.getByText('Waiting for approval').waitFor();
  await admin.page.getByText('Binta Kinteh').waitFor({ timeout: 20000 });
  await admin.page.getByLabel('Role for Binta Kinteh').selectOption('nurse');
  await admin.page.getByRole('button', { name: 'Approve', exact: true }).click();
  await binta.page.getByText('You’re approved').waitFor({ timeout: 20000 });
  await binta.page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await pin(binta.page, '8642');
  await binta.page.getByRole('button', { name: /^Registration/ }).click();
  await binta.page.locator('header').getByText('Binta · Registration').waitFor();
  step('Binta asked to join on her own phone, admin approved her as a nurse, she signed in');

  // --- Lost phone: admin removes it; only a real admin PIN works ---
  const row = admin.page.locator('tr', { hasText: 'Binta’s phone' });
  await row.getByRole('button', { name: 'Remove' }).click();
  await pin(admin.page, '1111');
  await admin.page.getByText('Only an admin can remove a device').waitFor();
  await pin(admin.page, '2468');
  await admin.page.getByText('removed. It will erase its data').waitFor();
  await binta.page.getByText('This device was removed').waitFor({ timeout: 20000 });
  const left = await binta.page.evaluate(() => new Promise((ok) => {
    const r = indexedDB.open('clinic-os');
    r.onsuccess = () => { const c = r.result.transaction('docs').objectStore('docs').count(); c.onsuccess = () => ok(c.result); };
  }));
  if (left !== 0) throw new Error(`removed device still holds ${left} records`);
  step('admin removed Binta’s phone (wrong PIN refused); the phone erased all patient data');

  // The server's full backup must contain everything
  const dev = await admin.page.evaluate(() => new Promise((ok) => {
    const r = indexedDB.open('clinic-os');
    r.onsuccess = () => { const g = r.result.transaction('meta').objectStore('meta').get('device'); g.onsuccess = () => ok(g.result); };
  }));
  const backup = await fetch(BASE + '/api/backup', { method: 'POST', body: JSON.stringify({ deviceId: dev.deviceId, token: dev.token }) }).then((r) => r.json());
  const all = JSON.stringify(backup.docs);
  for (const s of ['Fatou Jallow', 'Lamin Ceesay', '"dispensed"']) if (!all.includes(s)) throw new Error('server backup missing ' + s);
  const awa = backup.docs.find((d) => d.type === 'member' && d.name === 'Awa Jallow');
  const fatouVisit = backup.docs.find((d) => d.type === 'visit' && d.clinicId === 'DFC-0001');
  if (!awa || !fatouVisit?.byUser) throw new Error('records are not stamped with who did them');
  if (JSON.stringify(backup.docs).includes('"pin":')) throw new Error('a plain PIN was stored');
  step('server database holds all records, each stamped with who did it; no plain PINs stored');
  console.log('\nE2E PASSED');
} catch (err) {
  console.error('\nE2E FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  hub.kill();
}
