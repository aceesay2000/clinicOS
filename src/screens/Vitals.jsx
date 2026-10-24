import { useState } from 'react';
import * as db from '../db/local.js';
import { useDB } from '../hooks.js';
import * as M from '../lib/model.js';
import { VITAL_FIELDS, ageLabel, ageOf, bpText, redFlags, vitalFlag } from '../lib/clinical.js';
import { Seg, useToast } from '../components/ui.jsx';
import Queue from '../components/Queue.jsx';

const NUM_KEYS = VITAL_FIELDS.map((f) => f.key);
const blank = () => Object.fromEntries([...NUM_KEYS, 'rdt', 'note'].map((k) => [k, '']));

export function PatientLine({ visit, patient }) {
  const past = M.pastVisits(patient.id)[0];
  return (
    <p className="muted" style={{ margin: '4px 0 14px' }}>
      {patient.sex === 'F' ? 'Female' : 'Male'} · {ageLabel(patient)} · {patient.village || '—'}
      {visit.complaints?.length ? ` · Complaint: ${visit.complaints.join(', ')}` : ''}
      {past?.vitals?.bpSys ? ` · Seen ${past.visit.day.slice(0, 4)}: BP ${bpText(past.vitals)}` : ''}
    </p>
  );
}

export default function Vitals() {
  useDB();
  const [selected, setSelected] = useState(null);
  const queue = M.queue('vitals');
  const visit = db.get(selected) || queue[0];

  return (
    <div className="split">
      <aside><Queue station="vitals" selected={visit?.id} onSelect={setSelected} /></aside>
      <section>
        {visit ? <VitalsForm key={visit.id} visit={visit} onSent={() => setSelected(null)} /> : <div className="empty">Nobody waiting for vitals.</div>}
      </section>
    </div>
  );
}

function VitalsForm({ visit, onSent }) {
  const toast = useToast();
  const patient = M.patientOf(visit);
  const age = ageOf(patient);
  const [v, setV] = useState(() => ({ ...blank(), ...stripMeta(M.vitalsFor(visit.id)) }));
  const [notUrgent, setNotUrgent] = useState(false);
  const [manualUrgent, setManualUrgent] = useState(!!visit.urgent && !visit.urgentReason?.startsWith('Out of range'));
  const [showNote, setShowNote] = useState(!!v.note);
  const [saving, setSaving] = useState(false);

  if (!patient) return <div className="empty">Patient record not synced yet.</div>;

  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target ? e.target.value : e }));
  const flags = redFlags(v, age);
  const urgent = manualUrgent || (flags.length > 0 && !notUrgent);

  const send = async () => {
    setSaving(true);
    try {
      const clean = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, NUM_KEYS.includes(k) && x !== '' ? Number(x) : x]));
      const reason = manualUrgent ? 'Marked urgent by nurse' : flags.length ? `Out of range: ${flags.map((f) => f.label).join(', ')}` : '';
      await M.saveVitals(visit, clean, { urgent, urgentReason: reason, send: true });
      toast(`${visit.clinicId} sent to Doctor${urgent ? ' (urgent)' : ''}`);
      onSent();
    } finally {
      setSaving(false);
    }
  };

  const Num = ({ k, label }) => {
    const f = VITAL_FIELDS.find((x) => x.key === k);
    const flag = vitalFlag(k, v[k], age);
    return (
      <div className="field">
        <label className="label" htmlFor={k}>{label || f.label} {f.unit && <span className="muted">{f.unit}</span>}</label>
        <input id={k} className={'input big mono' + (flag ? ' ' + flag : '')} value={v[k]} onChange={set(k)} inputMode="decimal" autoComplete="off" />
        {flag === 'red' && <div className="err">Out of range</div>}
      </div>
    );
  };

  const bpFlag = vitalFlag('bpSys', v.bpSys, age) || vitalFlag('bpDia', v.bpDia, age);

  return (
    <div style={{ maxWidth: 860 }}>
      <h1>{patient.name} <span className="muted mono" style={{ fontWeight: 500 }}>· {visit.clinicId}</span></h1>
      <PatientLine visit={visit} patient={patient} />

      <div className="grid4">
        <div className="field">
          <span className="label">Blood pressure <span className="muted">mmHg</span></span>
          <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
            <input aria-label="Systolic" className={'input big mono' + (bpFlag ? ' ' + bpFlag : '')} value={v.bpSys} onChange={set('bpSys')} inputMode="numeric" style={{ minWidth: 0 }} />
            <b>/</b>
            <input aria-label="Diastolic" className={'input big mono' + (bpFlag ? ' ' + bpFlag : '')} value={v.bpDia} onChange={set('bpDia')} inputMode="numeric" style={{ minWidth: 0 }} />
          </div>
          {bpFlag === 'red' && <div className="err">High: flagged for doctor</div>}
        </div>
        {Num({ k: 'temp', label: 'Temperature' })}
        {Num({ k: 'pulse', label: 'Pulse' })}
        {Num({ k: 'spo2', label: 'SpO2' })}
        {Num({ k: 'rr', label: 'Resp. rate' })}
        {Num({ k: 'weight', label: 'Weight' })}
        {Num({ k: 'height', label: 'Height (optional)' })}
        {Num({ k: 'glucose', label: 'Blood glucose' })}
        {age != null && age < 5 && Num({ k: 'muac', label: 'MUAC (under 5)' })}
      </div>

      <div className="field">
        <span className="label">Malaria rapid test</span>
        <div style={{ maxWidth: 480 }}>
          <Seg options={[['positive', 'Positive'], ['negative', 'Negative'], ['', 'Not done']]} value={v.rdt} onChange={set('rdt')} />
        </div>
      </div>

      {flags.length > 0 && (
        <div className={'banner ' + (notUrgent ? 'info' : 'red')} style={{ margin: '12px 0' }}>
          <span style={{ flex: 1 }}>
            <b>{flags.length} value{flags.length > 1 ? 's' : ''} out of range</b> ({flags.map((f) => f.label).join(', ')}).{' '}
            {notUrgent ? 'Marked not urgent by nurse.' : 'This patient will go to the front of the doctor queue.'}
          </span>
          <button className="btn sm" onClick={() => setNotUrgent(!notUrgent)}>{notUrgent ? 'Make urgent' : 'Not urgent'}</button>
        </div>
      )}
      {!flags.length && (
        <div className="row" style={{ margin: '12px 0' }}>
          <button className={'btn' + (manualUrgent ? ' danger' : '')} onClick={() => setManualUrgent(!manualUrgent)} aria-pressed={manualUrgent}>
            {manualUrgent ? '✓ Urgent — tap to undo' : 'Mark urgent'}
          </button>
        </div>
      )}

      {showNote && (
        <div className="field">
          <label className="label" htmlFor="note">Note for doctor</label>
          <textarea id="note" className="input" value={v.note} onChange={set('note')} />
        </div>
      )}

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 20 }}>
        {!showNote ? <button className="btn" onClick={() => setShowNote(true)}>Add note for doctor</button> : <span />}
        <button className="btn primary" style={{ minWidth: 280 }} disabled={saving} onClick={send}>
          Send to Doctor{urgent ? ' (urgent)' : ''}
        </button>
      </div>
    </div>
  );
}

function stripMeta(doc) {
  if (!doc) return {};
  const out = {};
  for (const k of [...NUM_KEYS, 'rdt', 'note']) if (doc[k] != null) out[k] = String(doc[k]);
  return out;
}
