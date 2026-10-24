# clinicOS — Free Clinic Day

Clinic day tracker: an offline-first clinic platform for the Dembo Fula Clinic free clinic day (Badibou, Kerewan).
One patient ID follows each patient through **Registration → Vitals → Doctor → Pharmacy → home**,
with stock-checked prescriptions, a live clinic-lead board and an end-of-day report.

**Internet is never needed.** Every change is saved on the tablet first. Changes are copied to the
hub laptop over the clinic's own Wi-Fi whenever the tablet can reach it. If the Wi-Fi drops, the hub is
switched off, or the tablet joins a different network, changes wait on the tablet (the top bar shows
*"Offline · 3 changes waiting to sync"*) and go to the hub automatically when it is back.

## Quick start (hub laptop)

```bash
npm install
npm start          # builds the app and starts the hub on port 8080
```

The hub prints a **pairing code** and the addresses to open on tablets, e.g.

```
  ClinicOS hub is running
  Pairing code:  482913
  On this laptop: http://localhost:8080
  On tablets:     http://192.168.8.100:8080
```

1. On the laptop open `http://localhost:8080`, choose **Admin**, enter the pairing code.
2. **Stock → Load formulary CSV** (start from `public/formulary-template.csv`), or *Load sample list* for a dry run.
3. **Admin → Station PINs**: replace the default PIN `1234` for every station.
4. On each tablet: join the clinic Wi-Fi, open the "On tablets" address, pick the station, enter the pairing code.

Options: `PORT=8080`, `DATA_DIR=./data`, `BACKUP_DIR=/media/usb-stick` (hourly copy of the data),
`ID_BLOCK_SIZE=100`, and `node hub/server.js --new-code` to issue a new pairing code.

## How offline sync works

| Piece | Where | What it does |
|---|---|---|
| Local database | each tablet (IndexedDB) | Every save is written to the tablet's own database **and** an outbox in one step, before anything else happens. Survives reloads, battery death and lost Wi-Fi. |
| Sync engine | `src/db/sync.js` | Every 3 s (and right after each save) sends the outbox to the hub and pulls everything new. Only talks to the hub the tablet was paired with: each request carries the device token and the hub's identity is checked on every reply. |
| Hub | `hub/` on the laptop | Master copy for the day, written to an append-only log on disk (`data/clinic-log.jsonl`). Merges changes **field by field**, so vitals from one tablet and notes from another never clash. |
| Conflicts | Admin screen | If two tablets change the *same* field while out of touch, both versions are kept, the newer one shows, and the admin chooses. Nothing is overwritten silently. |
| Card numbers | `src/lib/ids.js` | The hub hands each registration tablet a block of numbers (DFC-0001…0100), so two desks never issue the same number even when both are offline. |
| Stock | `src/lib/model.js` | Every change is a logged movement (received, reserved, dispensed, released, adjusted). *Finish* at the doctor reserves; *Dispense* deducts; *Did not collect* releases. Doctors see **available** = on hand − reserved. Expired items cannot be prescribed. |

## Tablets and offline start-up

Chrome only keeps the app itself (not just the data) available offline on `localhost` or `https`.
On the hub laptop this works out of the box. For tablets reaching the hub over plain `http://192.168.x.x`:

- **For now:** on each tablet open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add the hub
  address (e.g. `http://192.168.8.100:8080`), enable, relaunch. This also enables camera QR scanning.
  Then *Add to Home screen*.
- **Planned (per PRD):** package the same app as an Android app with Capacitor, which removes this step.

Without either, tablets still save everything locally while the page is open; they just cannot
*reload* the page while the hub is unreachable. Typing the card number or using a USB/Bluetooth
barcode scanner works everywhere.

## Development

```bash
npm run hub        # terminal 1: hub on :8080 (serves dist/ and /api)
npm run dev        # terminal 2: Vite dev server with hot reload, proxies /api to the hub
npm test           # unit tests: hub merge/conflicts, crash recovery, dose maths, vitals flags
npm run build && node test/e2e-offline.mjs   # browser test: 5 tablets, one offline mid-clinic
```

```
hub/server.js        HTTP server: pairing, sync, card-number blocks, backup, static app
hub/store.js         field-level merge, conflict records, append-only log
src/db/local.js      on-device database + outbox
src/db/sync.js       sync loop, pairing, status badge
src/lib/clinical.js  vitals ranges, diagnoses, dose templates, quantity maths  ← clinical leads review
src/lib/model.js     patients, visits, queues, stock, station actions, report
src/screens/         Registration, Vitals, Doctor, Pharmacy, Board (clinic lead), Stock, Report, Admin
src/components/      queue list, printable slip + referral letter, QR, PIN pad
```

## Before clinic day

- Clinical leads review the vitals ranges and diagnosis/complaint lists in `src/lib/clinical.js`.
- Confirm the village list and clinic phone number in **Admin → Clinic day**.
- Print QR cards per desk (**Admin → Pre-printed patient cards**) matching each desk's number block.
- Dry run with ~30 mock patients and real volunteers.

## Not built yet

Bluetooth ESC/POS printing (slips print through the browser's print dialog for now, sized for 58 mm),
cloud backup (download the full backup from **Admin** instead), Capacitor packaging,
admin merge tool for duplicate patients, local-language labels, SMS (Phase 2).
