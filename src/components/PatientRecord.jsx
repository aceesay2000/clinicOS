import { useState } from 'react';
import * as db from '../db/local.js';
import { useDB, useNow } from '../hooks.js';
import * as M from '../lib/model.js';
import { STATIONS, VITAL_FIELDS, ageLabel, bpText, doseText, medName } from '../lib/clinical.js';
import { Modal, Scanner, useToast } from './ui.jsx';

// Registration volunteers see where a patient is, not their clinical notes (PRD).
const CLINICAL_ROLES = new Set(['vitals', 'doctor', 'pharmacy', 'lead', 'admin']);
const STATION_ROLES = new Set(['vitals', 'doctor', 'pharmacy']);
const JOURNEY = ['registration', 'vitals', 'doctor', 'pharmacy', 'done'];
const stationLabel = (id) => STATIONS.find((s) => s.id === id)?.label || id;
const time = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Search any patient from any station, then open their record. */
export function FindPatient({ role, onClose, initialPatientId }) {
  useDB();
  const [q, setQ] = useState('');
  const [scan, setScan] = useState(false);
  const [patientId, setPatientId] = useState(initialPatientId || null);
  const results = M.searchPatients(q, 12);

  if (patientId) {
    return (
      <Modal onClose={onClose}>
        <PatientRecord patientId={patientId} role={role} onBack={initialPatientId ? null : () => setPatientId(null)} onClose={onClose} />
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <h2>Find a patient</h2>
      <div className="row" style={{ flexWrap: 'nowrap', marginTop: 12 }}>
        <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, card number, phone or household" aria-label="Search patients" autoComplete="off" />
        <button className="btn" onClick={() => setScan(true)}>Scan</button>
      </div>
      <div style={{ marginTop: 8 }}>
        {results.map((p) => {
          const v = M.todaysVisit(p.id);
          return (
            <button key={p.id} className="qitem" onClick={() => setPatientId(p.id)}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span><b>{p.name}</b> · <span className="mono">{p.clinicId}</span></span>
                {v ? <span className={'badge ' + (v.urgent ? 'urgent' : 'ok')}>{v.urgent ? 'URGENT · ' : ''}{stationLabel(v.station).toUpperCase()}</span> : <span className="badge grey">NOT HERE TODAY</span>}
              </div>
              <div className="meta">{p.sex} · {ageLabel(p)} · {p.village || '—'}{p.household ? ` · ${p.household}` : ''}</div>
            </button>
          );
        })}
        {q.trim().length >= 2 && !results.length && <p className="muted">No patient matches “{q}”.</p>}
        {q.trim().length < 2 && <p className="muted small">Type at least 2 letters, or scan the patient’s card.</p>}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className="btn" onClick={onClose}>Close</button></div>
      {scan && (
        <Scanner onClose={() => setScan(false)} onResult={(text) => {
          setScan(false);
          const p = M.patientByClinicId(text);
          if (p) setPatientId(p.id);
          else setQ(text);
        }} />
      )}
    </Modal>
  );
}

export default function PatientRecord({ patientId, role, onBack, onClose }) {
  useDB();
  useNow();
  const toast = useToast();
  const p = db.get(patientId);
  if (!p) return <p className="muted">Patient record not synced yet.</p>;
  const clinical = CLINICAL_ROLES.has(role);
  const canMove = role === 'lead' || role === 'admin';
  const today = M.todaysVisit(p.id);
  const past = M.visitsOf(p.id).filter((v) => v.id !== today?.id);

  const move = async (station) => {
    await M.moveTo(today, station);
    toast(`${today.clinicId} moved to ${stationLabel(station)}`);
  };

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>{p.name} · <span className="mono">{p.clinicId}</span></h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {p.sex === 'F' ? 'Female' : p.sex === 'M' ? 'Male' : '—'} · {ageLabel(p)} · {p.village || '—'}
            {p.household ? ` · ${p.household}` : ''}{p.phone ? ` · ${p.phone}` : ''}{p.guardian ? ` · Guardian: ${p.guardian}` : ''}
          </p>
        </div>
        {onBack && <button className="btn sm" onClick={onBack}>← Search</button>}
      </div>

      <div className="section-title">Today</div>
      {today ? (
        <>
          <Journey visit={today} />
          <p style={{ margin: '8px 0' }}>
            {today.station === 'done'
              ? <>Finished · {today.status === 'dispensed' ? 'medicines dispensed' : today.status === 'not-collected' ? 'did not collect medicines' : 'seen'}</>
              : <>Now at <b>{stationLabel(today.station)}</b> · waiting {M.minutesSince(today.stationSince)} min</>}
            {today.urgent && <> · <span className="badge urgent">URGENT</span> {today.urgentReason}</>}
          </p>
          {(today.complaints || []).length > 0 && <p className="small muted" style={{ margin: 0 }}>Complaint: {today.complaints.join(', ')}</p>}
          {clinical && <VisitDetail visit={today} />}
          {STATION_ROLES.has(role) && today.station !== role && today.station !== 'done' && (
            <button className="btn" style={{ marginTop: 10 }} onClick={async () => { await M.moveTo(today, role); toast(`${today.clinicId} is now in your queue`); onClose?.(); }}>
              Bring to my station ({stationLabel(role)})
            </button>
          )}
          {canMove && (
            <>
              <div className="label" style={{ marginTop: 14 }}>Move patient to</div>
              <div className="chips">
                {STATIONS.filter((s) => s.id !== 'registration').map((s) => (
                  <button key={s.id} className={'chip' + (today.station === s.id ? ' on' : '')} disabled={today.station === s.id} onClick={() => move(s.id)}>{s.label}</button>
                ))}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className={'btn' + (today.urgent ? ' danger' : '')} onClick={() => db.put('visit', today.id, { urgent: !today.urgent, urgentReason: today.urgent ? '' : 'Marked urgent by clinic lead' })}>
                  {today.urgent ? 'Remove urgent' : 'Mark urgent'}
                </button>
                {M.rxItems(today.id).some((i) => i.status === 'reserved') && (
                  <button className="btn" onClick={async () => { await M.releaseVisit(today); toast('Reserved stock released'); }}>Release reserved stock</button>
                )}
              </div>
            </>
          )}
        </>
      ) : <p className="muted">Not registered today.</p>}

      <div className="section-title">Past clinic days · {past.length}</div>
      {past.map((v) => (
        <details key={v.id} className="card" style={{ padding: 12, marginTop: 8 }}>
          <summary style={{ cursor: 'pointer' }}>
            <b>{v.day}</b> · {(v.complaints || []).join(', ') || 'no complaint recorded'}
            {clinical && M.consultFor(v.id)?.diagnoses?.length ? ` · ${M.consultFor(v.id).diagnoses.join(', ')}` : ''}
          </summary>
          {clinical ? <VisitDetail visit={v} /> : <p className="small muted">Clinical details are visible to clinical stations.</p>}
        </details>
      ))}
      {!past.length && <p className="muted small">No earlier visits.</p>}

      {onClose && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}><button className="btn" onClick={onClose}>Close</button></div>}
    </div>
  );
}

function Journey({ visit }) {
  const at = JOURNEY.indexOf(visit.station);
  const events = db.all('event').filter((e) => e.visitId === visit.id && e.kind === 'arrived');
  const arrived = (s) => events.filter((e) => e.station === s).sort((a, b) => b.at - a.at)[0]?.at;
  return (
    <div className="journey" role="list" aria-label="Patient journey">
      {JOURNEY.map((s, i) => {
        const state = i < at ? 'done' : i === at ? 'now' : '';
        const t = s === 'registration' ? visit.createdAt : arrived(s);
        return (
          <div key={s} role="listitem" className={'j-step ' + state}>
            {state === 'done' ? '✓ ' : state === 'now' ? '● ' : ''}{stationLabel(s)}
            {t && state ? <span className="j-time">{time(t)}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function VisitDetail({ visit }) {
  const v = M.vitalsFor(visit.id);
  const c = M.consultFor(visit.id);
  const items = M.rxItems(visit.id);
  if (!v && !c && !items.length) return <p className="small muted" style={{ margin: '6px 0' }}>No vitals or consultation yet.</p>;
  return (
    <div style={{ marginTop: 8 }}>
      {v && (
        <p className="small" style={{ margin: '4px 0' }}>
          <b>Vitals:</b> BP {bpText(v)}
          {VITAL_FIELDS.filter((f) => !f.key.startsWith('bp') && v[f.key] !== '' && v[f.key] != null).map((f) => ` · ${f.label} ${v[f.key]} ${f.unit}`).join('')}
          {v.rdt ? ` · RDT ${v.rdt}` : ''}
        </p>
      )}
      {v?.note && <p className="small" style={{ margin: '4px 0' }}><b>Nurse:</b> {v.note}</p>}
      {c?.diagnoses?.length > 0 && <p className="small" style={{ margin: '4px 0' }}><b>Diagnosis:</b> {c.diagnoses.join(', ')}</p>}
      {c?.notes && <p className="small" style={{ margin: '4px 0' }}><b>Doctor ({c.doctor}):</b> {c.notes}</p>}
      {c?.referral?.hospital && <p className="small" style={{ margin: '4px 0' }}><b>Referred:</b> {c.referral.hospital} — {c.referral.reason}</p>}
      {items.length > 0 && (
        <ul className="small" style={{ margin: '4px 0', paddingLeft: 18 }}>
          {items.map((i) => {
            const m = db.get(i.medicineId);
            return <li key={i.id}>{medName(m)} ×{i.qty} — {doseText(i, m)} <span className="muted">({i.status})</span></li>;
          })}
        </ul>
      )}
    </div>
  );
}
