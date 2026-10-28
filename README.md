# clinicOS — Free Clinic Day

Clinic day tracker for the Dembo Fula Clinic free clinic day (Badibou, Kerewan). One patient ID follows
each patient through **Registration → Vitals → Doctor → Pharmacy → home**, with stock-checked
prescriptions, a live clinic-lead board and an end-of-day report.

It's a normal website that volunteers open on their own phones. **If the internet drops, nothing is lost:**
every change is saved on the phone first, the top bar shows *"Offline · 3 changes waiting to sync"*, and
everything is sent automatically when the connection is back.

## People and devices

- **Devices** (clinic tablets or volunteers’ own phones) are set up once with the **clinic code**.
- **People** sign in on any set-up device with **their own name and 4-digit PIN**, then pick a station their
  role allows (volunteer: registration · nurse: vitals, registration · doctor: doctor, vitals · pharmacy ·
  clinic lead: all stations, board, report, team · admin: everything).
- The first person to open a brand-new clinic creates the **admin** account. The admin adds the team in
  **Team → Add team member**, or a newcomer taps **New here? Ask to join** and a lead or admin approves them.
- Every record is stamped with who did it and on which device.

## On clinic day

1. Volunteers open the clinic’s web address in Chrome (and tap *Add to Home screen*). First time on a
   device: set it up with the clinic code.
2. **Who’s working?** Tap your name, enter your PIN, pick your station.
3. The screen locks after 2 minutes idle; your PIN unlocks it (“Not you?” lets someone else sign in).
4. Tap **your name** in the top bar to switch station, lock, or **sign out**. Sign out before handing a
   device to someone else. On your own phone, **Sign out and erase** removes all patient data from it.
5. **Find patient** (top bar, every station) searches by name, card, phone or household and shows where the
   patient is now plus every past clinic day. Registration sees the journey; clinical stations also see
   vitals, diagnoses and medicines.
6. The admin and lead watch **Team**: who is on duty at which station and device, patients handled per
   person, approvals waiting, and every device’s last check-in. A lost phone: **Team → Devices → Remove**
   (admin PIN required, checked by the server). It stops syncing and erases its data when it next connects.
7. At the end of the day the admin opens **Report** (CSV exports) and **Admin → Download full backup**,
   and volunteers sign out and erase their own phones.

## Before clinic day (admin)

- **Stock → Load formulary CSV** with the real medicine list and counts (tap **Template** for the columns).
- **Team**: add everyone with a role and PIN (or approve their requests). Only admins can add admins.
- **Admin → Clinic day**: date, village list, clinic phone number for slips. Every station warns if the
  clinic day isn't today's date, so last year's date can't be used by mistake.
- **Report** opens any past clinic day; returning patients are found by search and their history follows them.
- **Admin → Pre-printed patient cards**: print QR cards; each registration phone gets its own number block.
- Clinical leads review the vitals ranges and diagnosis lists in `src/lib/clinical.js`.
- Dry run with ~30 mock patients and real volunteers.

## Hosting (Vercel)

The site, its server code (`api/`) and a Postgres database all live in one Vercel project.

| Setting | Where | Value |
|---|---|---|
| Database | Vercel project → **Storage** → create Postgres (Neon) and connect it | sets `DATABASE_URL` automatically |
| Clinic code | Vercel project → **Settings → Environment Variables** | `CLINIC_CODE` = the code volunteers type |

Merging a pull request into `main` redeploys the site automatically. The database creates its own
tables on first use.

## Try it on your own computer

Needs Node.js (LTS, from nodejs.org). No database needed: a local one is created in `./data`.

```bash
npm install
npm start          # builds and runs on http://localhost:8080 — clinic code 123456; create the admin on first open
```

## How the offline failsafe works

| Piece | What it does |
|---|---|
| Phone database (`src/db/local.js`) | Every save goes into the phone's own database **and** an outbox in one step, before anything else. Survives reloads, flat batteries and lost signal. |
| Sync (`src/db/sync.js`) | Every 3 s, and right after each save, sends the outbox and pulls everything new. When the server can't be reached, changes wait and go later. |
| Server (`server/api.js`) | Merges changes **field by field**, so vitals from one phone and notes from another never clash. If two phones change the *same* field while one was offline, both versions are kept and the admin chooses (**Admin → Sync conflicts**). |
| Card numbers (`src/lib/ids.js`) | Each registration phone gets its own block (DFC-0001…0100), so numbers never collide even offline. |
| Stock (`src/lib/model.js`) | Every change is a logged movement. Doctor *Finish* reserves, pharmacy *Dispense* deducts, *Did not collect* releases. Expired items can't be prescribed. |

## Development

```bash
npm run serve      # terminal 1: API + built app on :8080
npm run dev        # terminal 2: hot-reloading app on :5173 (proxies /api)
npm test           # server merge/sync tests (in-memory Postgres), dose maths, vitals flags
npm run build && node test/e2e-offline.mjs   # browser test: 5 phones, one offline mid-clinic
```

```
api/[name].js        Vercel entry for /api/hello, pair, sync, idblock, backup
server/              merge logic, sync handlers, database connection, local server
src/db/              phone database + sync engine
src/lib/             clinical rules, records & stock, exports
src/screens/         Registration, Vitals, Doctor, Pharmacy, Clinic lead, Stock, Report, Admin
```

## Not built yet

Bluetooth thermal printing (slips print through the browser for now, sized for 58 mm), duplicate-patient
merge tool, local-language labels, SMS (Phase 2).
