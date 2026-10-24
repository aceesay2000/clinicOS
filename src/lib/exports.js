import * as db from '../db/local.js';
import * as M from './model.js';
import { ageOf, doseText, medName } from './clinical.js';
import { download, toCSV } from './csv.js';

const fname = (what) => `clinicos-${M.settings().day}-${what}`;

export function exportVisits() {
  const rows = M.visitsToday().map((v) => {
    const p = M.patientOf(v) || {};
    const vit = M.vitalsFor(v.id) || {};
    const c = M.consultFor(v.id) || {};
    const meds = M.rxItems(v.id).filter((i) => i.status === 'dispensed')
      .map((i) => `${medName(db.get(i.medicineId))} x${i.qty} (${doseText(i, db.get(i.medicineId))})`);
    return {
      card: v.clinicId, name: p.name, sex: p.sex, age: ageOf(p), village: p.village, household: p.household,
      phone: p.phone, guardian: p.guardian, complaints: v.complaints, consent: v.consent ? 'yes' : 'no',
      registered: new Date(v.createdAt).toLocaleTimeString(), urgent: v.urgent ? 'yes' : '', urgent_reason: v.urgentReason,
      bp: vit.bpSys ? `${vit.bpSys}/${vit.bpDia}` : '', temp: vit.temp, pulse: vit.pulse, spo2: vit.spo2, rr: vit.rr,
      weight: vit.weight, height: vit.height, glucose: vit.glucose, muac: vit.muac, rdt: vit.rdt,
      diagnoses: c.diagnoses, notes: c.notes, doctor: c.doctor,
      referral: c.referral?.hospital ? `${c.referral.hospital}: ${c.referral.reason}` : '',
      medicines_dispensed: meds, status: v.status, station_now: v.station,
    };
  });
  download(fname('patients.csv'), toCSV(rows));
}

export function exportDispensing() {
  const day = M.settings().day;
  const visitIds = new Set(M.visitsToday().map((v) => v.id));
  const rows = db.all('rxitem').filter((i) => visitIds.has(i.visitId)).map((i) => {
    const v = db.get(i.visitId);
    const m = db.get(i.medicineId);
    return {
      day, card: v?.clinicId, medicine: medName(m), qty: i.qty, unit: m?.unit, dose: doseText(i, m),
      status: i.status, prescribed_by: i.prescribedBy, dispensed_by: i.dispensedBy || '',
      substituted_for: i.originalMedicineId ? medName(db.get(i.originalMedicineId)) : '', substitution_reason: i.subReason || '',
      override_reason: i.overrideReason || '',
    };
  });
  download(fname('dispensing.csv'), toCSV(rows));
}

export function exportStock() {
  const rows = M.medicines().map((m) => {
    const st = M.stockOf(m.id);
    return {
      name: m.name, strength: m.strength, form: m.form, unit: m.unit, batch: m.batch, expiry: m.expiry,
      on_hand: st.onHand, reserved: st.reserved, available: st.available, low_threshold: m.lowThreshold,
    };
  });
  download(fname('stock.csv'), toCSV(rows));
}

export function exportMovements() {
  const rows = db.all('movement').sort((a, b) => a.createdAt - b.createdAt).map((mv) => ({
    time: new Date(mv.createdAt).toISOString(), medicine: medName(db.get(mv.medicineId)), kind: mv.kind,
    qty: mv.qty, delta: mv.delta, reason: mv.reason || '', card: db.get(mv.visitId)?.clinicId || '', device: mv.updatedBy,
  }));
  download(fname('stock-movements.csv'), toCSV(rows));
}

/** Everything on this phone, as JSON (restorable / importable later). */
export function exportBackupLocal() {
  const data = { app: 'clinic-os', exportedAt: Date.now(), source: 'phone', docs: db.all() };
  download(fname('backup.json'), JSON.stringify(data), 'application/json');
}
