// Clinic records and the actions stations take on them. Every action is a
// local write (see db/local.js), so it works the same with or without the hub.

import * as db from '../db/local.js';
import { calcQty, ageOf, DEFAULT_VILLAGES } from './clinical.js';
import { hashPin } from './pin.js';

// ---------- settings ----------

export const DEFAULT_PIN = '1234';

export function localDay(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function settings() {
  const s = db.get('settings') || {};
  return {
    clinicName: 'Dembo Fula Clinic',
    eventName: 'Free Clinic Day',
    place: 'Kerewan',
    phone: '',
    idPrefix: 'DFC',
    villages: DEFAULT_VILLAGES,
    pins: {},
    ...s,
    day: s.day || localDay(),
  };
}

export const saveSettings = (fields) => db.put('settings', 'settings', fields);

export function checkPin(role, pin) {
  const pins = settings().pins || {};
  const stored = pins[role];
  if (!stored) return pin === DEFAULT_PIN;
  return stored === hashPin(pin);
}

export function usingDefaultPins() {
  const pins = settings().pins || {};
  return ['registration', 'vitals', 'doctor', 'pharmacy', 'lead', 'admin'].some((r) => !pins[r]);
}

// ---------- memoised selectors (recomputed only when data changes) ----------

function memo(fn) {
  let v = -1, cache;
  return () => {
    if (v !== db.getVersion()) {
      cache = fn();
      v = db.getVersion();
    }
    return cache;
  };
}

export const formatId = (n, prefix = settings().idPrefix) => `${prefix}-${String(n).padStart(4, '0')}`;
export const idNumber = (clinicId) => Number(String(clinicId || '').replace(/\D/g, '')) || null;

export const patients = memo(() => db.all('patient').filter((p) => !p.removed));
export const medicines = memo(() => db.all('medicine').filter((m) => !m.archived).sort((a, b) => a.name.localeCompare(b.name)));

export const visitsToday = memo(() => {
  const day = settings().day;
  return db.all('visit').filter((v) => v.day === day && !v.removed);
});

const byVisit = (type) => memo(() => {
  const m = new Map();
  for (const d of db.all(type)) {
    if (!m.has(d.visitId)) m.set(d.visitId, []);
    m.get(d.visitId).push(d);
  }
  return m;
});
const itemsIndex = byVisit('rxitem');

export const rxItems = (visitId) => [...(itemsIndex().get(visitId) || [])].sort((a, b) => a.createdAt - b.createdAt);
export const vitalsFor = (visitId) => db.get('vitals:' + visitId);
export const consultFor = (visitId) => db.get('consult:' + visitId);
export const patientOf = (visit) => db.get(visit?.patientId);

export function patientByClinicId(clinicId) {
  const n = idNumber(clinicId);
  return patients().find((p) => idNumber(p.clinicId) === n);
}

export function visitsOf(patientId) {
  return db.all('visit').filter((v) => v.patientId === patientId && !v.removed).sort((a, b) => b.day.localeCompare(a.day));
}

export function todaysVisit(patientId) {
  const day = settings().day;
  return visitsToday().find((v) => v.patientId === patientId && v.day === day);
}

/** Short history line per earlier clinic day, newest first. */
export function pastVisits(patientId) {
  const day = settings().day;
  return visitsOf(patientId).filter((v) => v.day < day).map((v) => {
    const vit = vitalsFor(v.id);
    const c = consultFor(v.id);
    const meds = rxItems(v.id).filter((i) => i.status === 'dispensed').map((i) => {
      const m = db.get(i.medicineId);
      return m ? `${m.name} ${m.strength || ''}`.trim() : '';
    });
    return { visit: v, vitals: vit, consult: c, meds };
  });
}

export function searchPatients(q, limit = 8) {
  q = q.trim().toLowerCase();
  if (q.length < 2) return [];
  const n = idNumber(q);
  const words = q.split(/\s+/);
  const scored = [];
  for (const p of patients()) {
    const hay = [p.name, p.phone, p.household, p.village, p.guardian, p.clinicId].filter(Boolean).join(' ').toLowerCase();
    let score = 0;
    if (n && idNumber(p.clinicId) === n) score += 100;
    if (words.every((w) => hay.includes(w))) score += 10;
    if (p.name?.toLowerCase().startsWith(q)) score += 5;
    if (score) scored.push([score, p]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map((s) => s[1]);
}

// ---------- queues ----------

export function queue(station) {
  const list = visitsToday().filter((v) => v.station === station);
  return list.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || a.stationSince - b.stationSince);
}

export const minutesSince = (t) => (t ? Math.max(0, Math.floor((Date.now() - t) / 60000)) : 0);

// ---------- stock ----------

/** medicineId -> { onHand, reserved, available } */
export const stock = memo(() => {
  const s = new Map();
  const row = (id) => {
    if (!s.has(id)) s.set(id, { onHand: 0, reserved: 0, available: 0 });
    return s.get(id);
  };
  for (const mv of db.all('movement')) row(mv.medicineId).onHand += Number(mv.delta) || 0;
  for (const it of db.all('rxitem')) if (it.status === 'reserved') row(it.medicineId).reserved += Number(it.qty) || 0;
  for (const r of s.values()) r.available = r.onHand - r.reserved;
  return s;
});

export const stockOf = (medicineId) => stock().get(medicineId) || { onHand: 0, reserved: 0, available: 0 };

export function isExpired(m) {
  return m?.expiry && m.expiry < settings().day;
}

export function isLow(m) {
  const st = stockOf(m.id);
  return st.available <= (Number(m.lowThreshold) || 0);
}

export function lowStock() {
  return medicines().filter((m) => !isExpired(m) && isLow(m)).map((m) => ({ m, ...stockOf(m.id) }))
    .sort((a, b) => a.available - b.available);
}

function movement(medicineId, kind, qty, delta, extra = {}) {
  return db.put('movement', null, { medicineId, kind, qty, delta, ...extra });
}

// ---------- actions ----------

function event(visitId, station, kind) {
  return db.put('event', null, { visitId, station, kind, at: Date.now() });
}

export async function moveTo(visit, station, fields = {}) {
  if (visit.station && visit.station !== station) await event(visit.id, visit.station, 'finished');
  await db.put('visit', visit.id, { station, stationSince: Date.now(), ...fields });
  await event(visit.id, station, 'arrived');
}

export async function registerPatient({ patientId, patient, complaints, consent, clinicId }) {
  const p = await db.put('patient', patientId || null, { ...patient, clinicId });
  const existing = todaysVisit(p.id);
  if (existing) return { patient: p, visit: existing, existing: true };
  const visit = await db.put('visit', null, {
    patientId: p.id, clinicId, day: settings().day, complaints, consent: !!consent,
    station: 'vitals', stationSince: Date.now(), urgent: false, status: 'open',
  });
  await event(visit.id, 'registration', 'finished');
  await event(visit.id, 'vitals', 'arrived');
  return { patient: p, visit };
}

export async function saveVitals(visit, vitals, { urgent, urgentReason, send }) {
  await db.put('vitals', 'vitals:' + visit.id, { visitId: visit.id, ...vitals });
  await db.put('visit', visit.id, { urgent: !!urgent, urgentReason: urgent ? urgentReason || '' : '' });
  if (send) await moveTo(visit, 'doctor');
}

/**
 * Doctor finishes: notes are saved, prescribed quantities are reserved
 * against stock, and the order appears on the pharmacy list.
 */
export async function finishConsult(visit, consult, items, doctor) {
  await db.put('consult', 'consult:' + visit.id, { visitId: visit.id, ...consult, doctor, finishedAt: Date.now() });
  for (const it of items) {
    const m = db.get(it.medicineId);
    const qty = calcQty(it, m);
    const saved = await db.put('rxitem', it.id || null, {
      visitId: visit.id, medicineId: it.medicineId, amount: it.amount, perDay: it.perDay,
      days: it.days, slot: it.slot || 'morning', qty, status: 'reserved', note: it.note || '',
      prescribedBy: doctor, overrideReason: it.overrideReason || '',
    });
    await movement(it.medicineId, 'reserved', qty, 0, { visitId: visit.id, itemId: saved.id });
  }
  const hasRx = items.length > 0;
  await moveTo(visit, hasRx ? 'pharmacy' : 'done', { status: hasRx ? 'rx' : 'seen', packed: false, room: doctor });
}

export async function substitute(item, newMedicineId, qty, reason) {
  await movement(item.medicineId, 'released', item.qty, 0, { visitId: item.visitId, itemId: item.id, reason });
  await db.put('rxitem', item.id, {
    originalMedicineId: item.originalMedicineId || item.medicineId,
    originalQty: item.originalQty ?? item.qty,
    medicineId: newMedicineId, qty: Number(qty), substituted: true, subReason: reason,
  });
  await movement(newMedicineId, 'reserved', Number(qty), 0, { visitId: item.visitId, itemId: item.id, reason });
}

export async function setPacked(visit, packed) {
  await db.put('visit', visit.id, { packed });
}

export async function dispense(visit, by) {
  for (const it of rxItems(visit.id)) {
    if (it.status !== 'reserved') continue;
    await db.put('rxitem', it.id, { status: 'dispensed', dispensedAt: Date.now(), dispensedBy: by });
    await movement(it.medicineId, 'dispensed', it.qty, -Number(it.qty), { visitId: visit.id, itemId: it.id });
  }
  await moveTo(visit, 'done', { status: 'dispensed', dispensedAt: Date.now() });
}

/** Patient left without collecting: give the reserved stock back. */
export async function releaseVisit(visit, reason = 'Patient did not collect') {
  for (const it of rxItems(visit.id)) {
    if (it.status !== 'reserved') continue;
    await db.put('rxitem', it.id, { status: 'released' });
    await movement(it.medicineId, 'released', it.qty, 0, { visitId: visit.id, itemId: it.id, reason });
  }
  await moveTo(visit, 'done', { status: 'not-collected' });
}

export async function receiveStock(medicineId, qty, reason = 'Received') {
  return movement(medicineId, 'received', Number(qty), Number(qty), { reason });
}

/** End-of-day count: record the difference as an adjustment with a reason. */
export async function adjustStock(medicineId, counted, reason) {
  const diff = Number(counted) - stockOf(medicineId).onHand;
  if (!diff) return null;
  return movement(medicineId, 'adjusted', Math.abs(diff), diff, { reason, counted: Number(counted) });
}

export async function saveMedicine(id, fields, startingCount) {
  const m = await db.put('medicine', id || null, fields);
  if (startingCount) await receiveStock(m.id, startingCount, 'Starting stock');
  return m;
}

// ---------- reports ----------

export function dayReport() {
  const visits = visitsToday();
  const seen = visits.filter((v) => consultFor(v.id)?.finishedAt);
  const dispensed = visits.filter((v) => v.status === 'dispensed');
  const urgentWaiting = visits.filter((v) => v.urgent && v.station !== 'done');
  const diag = new Map();
  for (const v of seen) for (const d of consultFor(v.id).diagnoses || []) diag.set(d, (diag.get(d) || 0) + 1);
  const meds = new Map();
  for (const v of visits) for (const it of rxItems(v.id)) {
    if (it.status !== 'dispensed') continue;
    meds.set(it.medicineId, (meds.get(it.medicineId) || 0) + Number(it.qty));
  }
  const referrals = seen.filter((v) => consultFor(v.id)?.referral?.hospital);
  const journeys = dispensed.filter((v) => v.dispensedAt).map((v) => v.dispensedAt - v.createdAt);
  const avgJourney = journeys.length ? Math.round(journeys.reduce((a, b) => a + b, 0) / journeys.length / 60000) : null;
  return {
    registered: visits.length,
    seen: seen.length,
    dispensed: dispensed.length,
    notCollected: visits.filter((v) => v.status === 'not-collected').length,
    urgentWaiting: urgentWaiting.length,
    referrals: referrals.length,
    avgJourney,
    topDiagnoses: [...diag.entries()].sort((a, b) => b[1] - a[1]),
    medsDispensed: [...meds.entries()].map(([id, qty]) => ({ m: db.get(id), qty })).sort((a, b) => b.qty - a.qty),
  };
}

export { ageOf };
