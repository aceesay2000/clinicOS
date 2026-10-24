import { useState } from 'react';
import * as db from '../db/local.js';
import { uuid } from '../db/local.js';
import { useDB } from '../hooks.js';
import * as M from '../lib/model.js';
import {
  COUNTABLE_UNITS, DIAGNOSES, DOSE_TEMPLATES, HOSPITALS, VITAL_FIELDS,
  ageOf, bpText, calcQty, medName, vitalFlag,
} from '../lib/clinical.js';
import { Chips, Modal, useToast } from '../components/ui.jsx';
import Queue from '../components/Queue.jsx';
import { PatientLine } from './Vitals.jsx';

// Unfinished consults survive switching between patients (not reloads).
const drafts = new Map();

export default function Doctor({ device }) {
  useDB();
  const [selected, setSelected] = useState(null);
  const queue = M.queue('doctor');
  const visit = db.get(selected) || queue[0];
  const urgent = queue.filter((v) => v.urgent).length;

  return (
    <div className="split">
      <aside>
        <Queue station="doctor" selected={visit?.id} onSelect={setSelected}
          renderMeta={(v) => v.urgent ? v.urgentReason || 'Urgent' : (v.complaints || []).join(' · ')} />
        <div className="small muted" style={{ padding: 14 }}>{queue.length} waiting · {urgent} urgent</div>
      </aside>
      <section>
        {visit
          ? <Consult key={visit.id} visit={visit} doctor={device.name} onDone={() => setSelected(null)} />
          : <div className="empty">Nobody waiting for the doctor.</div>}
      </section>
    </div>
  );
}

/** Medicines that can be prescribed today: loaded, not expired. */
function prescribable() {
  return M.medicines().filter((m) => !M.isExpired(m));
}

function alternativesFor(m) {
  const names = (m?.alternatives || []).map((a) => a.toLowerCase().trim());
  return prescribable().filter((x) => x.id !== m.id && (names.includes(x.name.toLowerCase()) || names.includes(medName(x).toLowerCase())));
}

function Consult({ visit, doctor, onDone }) {
  const toast = useToast();
  const patient = M.patientOf(visit);
  const vitals = M.vitalsFor(visit.id) || {};
  const age = ageOf(patient);
  const prev = M.consultFor(visit.id);
  const [d, setD] = useState(() => drafts.get(visit.id) || {
    diagnoses: prev?.diagnoses || [], notes: prev?.notes || '', other: '', referral: prev?.referral || null, items: [],
  });
  const [refer, setRefer] = useState(false);
  const [saving, setSaving] = useState(false);
  const update = (patch) => setD((s) => {
    const next = { ...s, ...patch };
    drafts.set(visit.id, next);
    return next;
  });

  if (!patient) return <div className="empty">Patient record not synced yet.</div>;

  // Stock already promised to *other* patients is excluded via `available`;
  // within this prescription, two lines of the same drug add up.
  const usedHere = (medicineId, uptoIndex) => d.items.slice(0, uptoIndex + 1)
    .filter((i) => i.medicineId === medicineId)
    .reduce((n, i) => n + calcQty(i, db.get(i.medicineId)), 0);

  const lines = d.items.map((it, idx) => {
    const m = db.get(it.medicineId);
    const qty = calcQty(it, m);
    const after = M.stockOf(it.medicineId).available - usedHere(it.medicineId, idx);
    const short = after < 0;
    const low = !short && after <= (Number(m?.lowThreshold) || 0);
    return { it, idx, m, qty, after, short, low, alts: short || low ? alternativesFor(m) : [] };
  });
  const blocked = lines.some((l) => l.short && !l.it.overrideReason?.trim()) || lines.some((l) => !l.qty);

  const addMed = (m) => {
    const t = COUNTABLE_UNITS.has(m.unit) ? DOSE_TEMPLATES[2] : { amount: 1, perDay: 1, days: 1 };
    update({ items: [...d.items, { id: uuid(), medicineId: m.id, amount: t.amount, perDay: t.perDay, days: t.days, slot: 'morning', qty: 1 }] });
  };
  const setItem = (idx, patch) => update({ items: d.items.map((x, i) => (i === idx ? { ...x, ...patch } : x)) });
  const removeItem = (idx) => update({ items: d.items.filter((_, i) => i !== idx) });

  const finish = async () => {
    setSaving(true);
    try {
      const diagnoses = [...d.diagnoses.filter((x) => x !== '+ Other'), ...(d.other.trim() ? [d.other.trim()] : [])];
      await M.finishConsult(visit, { diagnoses, notes: d.notes, referral: d.referral }, d.items, doctor);
      drafts.delete(visit.id);
      toast(d.items.length ? `${visit.clinicId} sent to Pharmacy · stock reserved` : `${visit.clinicId} finished`);
      onDone();
    } finally {
      setSaving(false);
    }
  };

  const past = M.pastVisits(patient.id);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0,1fr)', gap: 16 }} className="consult-grid">
      <div>
        <div className="card">
          {visit.urgent && <span className="badge urgent">URGENT{visit.urgentReason ? ` · ${visit.urgentReason.replace('Out of range: ', '')}` : ''}</span>}
          <h2 style={{ marginTop: 6 }}>{patient.name}</h2>
          <div className="small muted mono">{visit.clinicId}</div>
          <PatientLine visit={visit} patient={patient} />
        </div>
        <div className="card">
          <div className="label">Today's vitals</div>
          <div className="kv"><span>BP</span><b className={vitalFlag('bpSys', vitals.bpSys, age) === 'red' || vitalFlag('bpDia', vitals.bpDia, age) === 'red' ? 'red-text' : ''}>{bpText(vitals)}</b></div>
          {VITAL_FIELDS.filter((f) => !f.key.startsWith('bp') && vitals[f.key] !== '' && vitals[f.key] != null).map((f) => (
            <div className="kv" key={f.key}><span>{f.label}</span><b className={vitalFlag(f.key, vitals[f.key], age) === 'red' ? 'red-text' : ''}>{vitals[f.key]} {f.unit}</b></div>
          ))}
          <div className="kv"><span>Malaria RDT</span><b className={vitals.rdt === 'positive' ? 'red-text' : ''}>{vitals.rdt ? vitals.rdt[0].toUpperCase() + vitals.rdt.slice(1) : 'Not done'}</b></div>
          {vitals.note && <p className="small"><b>Nurse:</b> {vitals.note}</p>}
        </div>
        {past.length > 0 && (
          <div className="card">
            <div className="label">Past clinic days</div>
            {past.map((p) => (
              <p key={p.visit.id} className="small" style={{ margin: '4px 0' }}>
                <b>{p.visit.day.slice(0, 4)}</b> · BP {bpText(p.vitals)}{p.consult?.diagnoses?.length ? ` · ${p.consult.diagnoses.join(', ')}` : ''}{p.meds.length ? ` · ${p.meds.join(', ')}` : ''}
                {p.consult?.notes && <><br /><span className="muted">{p.consult.notes}</span></>}
              </p>
            ))}
          </div>
        )}
      </div>

      <div>
        <span className="label">Diagnosis</span>
        <Chips options={[...DIAGNOSES, '+ Other']} value={d.diagnoses} onChange={(v) => update({ diagnoses: v })} />
        {d.diagnoses.includes('+ Other') && (
          <input className="input" style={{ marginTop: 8 }} placeholder="Other diagnosis" value={d.other} onChange={(e) => update({ other: e.target.value })} />
        )}

        <label className="section-title" htmlFor="notes" style={{ display: 'block' }}>Notes</label>
        <textarea id="notes" className="input" value={d.notes} onChange={(e) => update({ notes: e.target.value })} placeholder="Optional" />

        <div className="card" style={{ marginTop: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>Prescription</h3>
            <MedicinePicker onPick={addMed} />
          </div>
          {lines.length === 0 && <p className="muted small">No medicines yet. Finishing without medicines sends the patient home.</p>}
          {lines.length > 0 && (
            <table className="t" style={{ marginTop: 8 }}>
              <thead><tr><th>Medicine</th><th>Dose</th><th>Qty</th><th>In stock after</th><th /></tr></thead>
              <tbody>
                {lines.map(({ it, idx, m, qty, after, short, low }) => (
                  <tr key={it.id}>
                    <td><b>{medName(m)}</b> <span className="muted small">{m?.form || m?.unit}</span></td>
                    <td><DoseEditor item={it} medicine={m} onChange={(p) => setItem(idx, p)} /></td>
                    <td className="mono"><b>{qty}</b> {m?.unit}</td>
                    <td className={'mono ' + (short ? 'red-text' : low ? 'amber-text' : 'green-text')}><b>{after}</b>{short ? ' · short' : low ? ' · low' : ''}</td>
                    <td><button className="btn sm" onClick={() => removeItem(idx)} aria-label={`Remove ${medName(m)}`}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {lines.filter((l) => l.short || l.low).map(({ it, idx, m, after, short, alts }) => (
            <div key={it.id} className={'banner ' + (short ? 'red' : 'amber')} style={{ marginTop: 10, color: 'var(--ink)' }}>
              <span style={{ flex: 1 }}>
                <b>{medName(m)} {short ? 'is short' : 'is running low'}</b> ({Math.max(0, after + (short ? calcQty(it, m) : 0))} {short ? 'available' : 'left after reserved'}).
                {alts.length ? ` Alternative on hand: ${alts.map((a) => `${medName(a)} (${M.stockOf(a.id).available} left)`).join(', ')}.` : ' No listed alternative.'}
              </span>
              {alts.slice(0, 2).map((a) => (
                <button key={a.id} className="btn sm" onClick={() => setItem(idx, { medicineId: a.id })}>Switch to {a.name}</button>
              ))}
              {short && (
                <input className="input" style={{ fontSize: 15, minHeight: 40 }} placeholder="Or give a reason to prescribe anyway"
                  value={it.overrideReason || ''} onChange={(e) => setItem(idx, { overrideReason: e.target.value })} />
              )}
            </div>
          ))}
        </div>

        {d.referral?.hospital && (
          <div className="banner amber" style={{ marginTop: 12 }}>
            <span style={{ flex: 1 }}><b>Referral:</b> {d.referral.hospital} — {d.referral.reason}</span>
            <button className="btn sm" onClick={() => update({ referral: null })}>Remove</button>
          </div>
        )}

        <div className="row" style={{ justifyContent: 'space-between', marginTop: 18 }}>
          <button className="btn" onClick={() => setRefer(true)}>Refer to hospital</button>
          <button className="btn primary" style={{ minWidth: 280 }} disabled={saving || blocked} onClick={finish}>
            {d.items.length ? 'Finish · send to Pharmacy' : 'Finish · patient goes home'}
          </button>
        </div>
        {blocked && <p className="err" style={{ textAlign: 'right' }}>Switch the short medicine or give a reason before finishing.</p>}
      </div>

      {refer && <ReferralModal initial={d.referral} onClose={() => setRefer(false)} onSave={(r) => { update({ referral: r }); setRefer(false); }} />}
      <style>{`@media (max-width: 1000px) { .consult-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

function MedicinePicker({ onPick }) {
  useDB();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const list = prescribable()
    .filter((m) => !q || medName(m).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (M.stockOf(b.id).available > 0) - (M.stockOf(a.id).available > 0));
  return (
    <div style={{ position: 'relative', width: 'min(340px, 100%)' }}>
      <input className="input" style={{ fontSize: 16 }} value={q} placeholder="Add medicine from stock…"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)} />
      {open && (
        <div className="card" style={{ position: 'absolute', zIndex: 10, top: '100%', left: 0, right: 0, maxHeight: 320, overflow: 'auto', padding: 4 }}>
          {list.map((m) => {
            const st = M.stockOf(m.id);
            return (
              <button key={m.id} className="qitem" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(m); setQ(''); setOpen(false); }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b>{medName(m)}</b>
                  <span className={'small mono ' + (st.available <= 0 ? 'red-text' : M.isLow(m) ? 'amber-text' : 'green-text')}>{st.available} {m.unit}</span>
                </div>
                <div className="meta">{m.form}</div>
              </button>
            );
          })}
          {!list.length && <div className="empty small">No medicine matches. Admin loads the formulary.</div>}
        </div>
      )}
    </div>
  );
}

function DoseEditor({ item, medicine, onChange }) {
  const countable = COUNTABLE_UNITS.has(medicine?.unit);
  // Half tablets are allowed below 1; whole steps above.
  const step = (k, dir, min) => {
    const cur = Number(item[k] || 0);
    const delta = k === 'amount' && (dir > 0 ? cur < 1 : cur <= 1) ? 0.5 : 1;
    onChange({ [k]: Math.max(min, cur + dir * delta) });
  };
  const Stepper = ({ k, label, min = 1, unit }) => (
    <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
      <button className="btn sm" style={{ minWidth: 40, padding: 0 }} onClick={() => step(k, -1, min)} aria-label={`Less ${label}`}>−</button>
      <b className="mono" style={{ minWidth: 30, textAlign: 'center' }}>{item[k]}</b>
      <button className="btn sm" style={{ minWidth: 40, padding: 0 }} onClick={() => step(k, 1, min)} aria-label={`More ${label}`}>+</button>
      <span className="small muted">{unit}</span>
    </span>
  );
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <select className="input" style={{ fontSize: 14, minHeight: 40, padding: '4px 8px' }} value=""
        onChange={(e) => { const t = DOSE_TEMPLATES[e.target.value]; if (t) onChange({ amount: t.amount, perDay: t.perDay, days: t.days }); }}>
        <option value="">{item.amount} × {item.perDay}/day × {item.days} days — template…</option>
        {DOSE_TEMPLATES.map((t, i) => <option key={t.label} value={i}>{t.label}</option>)}
      </select>
      <div className="row" style={{ gap: 10 }}>
        {Stepper({ k: 'amount', label: 'amount', unit: medicine?.unit, min: 0.5 })}
        {Stepper({ k: 'perDay', label: 'times a day', unit: '/day' })}
        {Stepper({ k: 'days', label: 'days', unit: 'days' })}
        {Number(item.perDay) === 1 && (
          <select className="input" style={{ fontSize: 14, minHeight: 40, width: 'auto', padding: '4px 8px' }} value={item.slot || 'morning'} onChange={(e) => onChange({ slot: e.target.value })} aria-label="When">
            <option value="morning">morning</option><option value="night">night</option>
          </select>
        )}
        {!countable && (
          <span className="row" style={{ gap: 4 }}><span className="small">Give</span>{Stepper({ k: 'qty', label: 'quantity', unit: medicine?.unit || '' })}</span>
        )}
      </div>
    </div>
  );
}

function ReferralModal({ initial, onClose, onSave }) {
  const [hospital, setHospital] = useState(initial?.hospital || HOSPITALS[0]);
  const [reason, setReason] = useState(initial?.reason || '');
  return (
    <Modal onClose={onClose}>
      <h2>Refer to hospital</h2>
      <div className="field" style={{ marginTop: 12 }}>
        <span className="label">Hospital</span>
        <Chips multi={false} options={HOSPITALS} value={hospital} onChange={(h) => h && setHospital(h)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="reason">Reason</label>
        <textarea id="reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!reason.trim()} onClick={() => onSave({ hospital, reason: reason.trim() })}>Save referral</button>
      </div>
    </Modal>
  );
}
