import * as db from '../db/local.js';
import * as M from '../lib/model.js';
import { ageLabel, doseSlots, doseText, medName } from '../lib/clinical.js';
import { QR } from './ui.jsx';

// Sized for a 58 mm thermal printer (≈48 mm printable); also fine on A5/A4.
const slipCss = `
.slip { width: 48mm; font: 11px/1.35 system-ui, Arial, sans-serif; color: #000; }
.slip h1 { font-size: 13px; text-align: center; margin: 0; letter-spacing: .02em; }
.slip .c { text-align: center; }
.slip hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
.slip .id { font-size: 18px; font-weight: 800; white-space: nowrap; margin-right: 6px; }
.slip .med { font-weight: 800; font-size: 12px; }
.slip .slots { display: flex; justify-content: flex-end; gap: 6px; }
.slip .slot { width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid #000; display: grid; place-items: center; font-weight: 800; font-size: 11px; }
.slip .slot.on { background: #000; color: #fff; }
.letter { width: 170mm; font: 13px/1.5 system-ui, Arial, sans-serif; color: #000; page-break-before: always; padding-top: 10mm; }
`;

function Icons() {
  const s = { width: 20, height: 16 };
  return (
    <div className="slots" aria-hidden="true">
      <svg viewBox="0 0 24 20" style={s}><path d="M2 16h20M6 16a6 6 0 0 1 12 0M12 3v3M4 8l2 2M20 8l-2 2" stroke="#000" strokeWidth="2" fill="none" /></svg>
      <svg viewBox="0 0 24 20" style={s}><circle cx="12" cy="10" r="4" stroke="#000" strokeWidth="2" fill="none" /><path d="M12 1v3M12 16v3M3 10h3M18 10h3M5 3l2 2M17 15l2 2M19 3l-2 2M7 15l-2 2" stroke="#000" strokeWidth="2" /></svg>
      <svg viewBox="0 0 24 20" style={s}><path d="M15 2a8 8 0 1 0 7 11A7 7 0 0 1 15 2z" stroke="#000" strokeWidth="2" fill="none" /></svg>
    </div>
  );
}

export default function Slip({ visit }) {
  const s = M.settings();
  const p = M.patientOf(visit);
  const c = M.consultFor(visit.id);
  const items = M.rxItems(visit.id).filter((i) => i.status !== 'released');
  const dateText = new Date(visit.day + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <>
      <style>{slipCss}</style>
      <div className="slip">
        <h1>{s.clinicName.toUpperCase()}</h1>
        <div className="c">{s.eventName} · {s.place} · {dateText}</div>
        <hr />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="id">{visit.clinicId}</span>
          <span>{p?.name} · {p?.sex} · {ageLabel(p)}</span>
        </div>
        {c?.diagnoses?.length > 0 && <div>For: {c.diagnoses.join(', ').toLowerCase()}</div>}
        <Icons />
        {items.map((it) => {
          const m = db.get(it.medicineId);
          const slots = doseSlots(it);
          return (
            <div key={it.id}>
              <hr />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                <span className="med">{medName(m)}</span>
                {slots && (
                  <span className="slots">
                    {slots.map((n, i) => <span key={i} className={'slot' + (n ? ' on' : '')}>{n || ''}</span>)}
                  </span>
                )}
              </div>
              <div>{doseText(it, m)} · {it.qty} {m?.unit}{it.note ? ` · ${it.note}` : ''}</div>
            </div>
          );
        })}
        <hr />
        {c?.notes && <p style={{ margin: '4px 0' }}><b>Doctor's advice:</b> {c.notes}</p>}
        <p style={{ margin: '4px 0' }}>Come back if you feel worse, have chest pain, a bad headache or swelling.</p>
        {c?.referral?.hospital && <p style={{ margin: '4px 0' }}><b>Go to:</b> {c.referral.hospital}. Take the referral letter.</p>}
        <hr />
        <div className="c"><QR text={visit.clinicId} size={70} /></div>
        <div className="c">Questions: {s.phone || '[clinic phone]'}<br />Keep your card: {visit.clinicId}</div>
      </div>
      {c?.referral?.hospital && <ReferralLetter visit={visit} patient={p} consult={c} />}
    </>
  );
}

function ReferralLetter({ visit, patient, consult }) {
  const s = M.settings();
  const vit = M.vitalsFor(visit.id) || {};
  const meds = M.rxItems(visit.id).filter((i) => i.status !== 'released').map((i) => `${medName(db.get(i.medicineId))} — ${doseText(i, db.get(i.medicineId))}`);
  return (
    <div className="letter">
      <h2 style={{ margin: 0 }}>{s.clinicName} — Referral letter</h2>
      <p>{s.eventName}, {s.place} · {visit.day}</p>
      <p><b>To:</b> {consult.referral.hospital}</p>
      <p><b>Patient:</b> {patient?.name} ({visit.clinicId}) · {patient?.sex} · age {ageLabel(patient)} · {patient?.village}{patient?.phone ? ` · ${patient.phone}` : ''}</p>
      <p><b>Reason for referral:</b> {consult.referral.reason}</p>
      <p><b>Findings today:</b> BP {vit.bpSys ? `${vit.bpSys}/${vit.bpDia}` : '—'} · Temp {vit.temp || '—'} · Pulse {vit.pulse || '—'} · SpO2 {vit.spo2 || '—'} · RDT {vit.rdt || 'not done'}</p>
      <p><b>Diagnosis:</b> {(consult.diagnoses || []).join(', ') || '—'}</p>
      {consult.notes && <p><b>Notes:</b> {consult.notes}</p>}
      <p><b>Given today:</b> {meds.length ? meds.join('; ') : 'none'}</p>
      <p style={{ marginTop: 30 }}>Signed: ______________________ ({consult.doctor})</p>
    </div>
  );
}
