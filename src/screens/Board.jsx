import { useState } from 'react';
import * as db from '../db/local.js';
import { useDB, useNow } from '../hooks.js';
import * as M from '../lib/model.js';
import { ageLabel, bpText, medName } from '../lib/clinical.js';
import { FindPatient } from '../components/PatientRecord.jsx';

const SHOW = 5;

export default function Board({ setView, role }) {
  useDB();
  useNow(15000);
  const [open, setOpen] = useState(null);
  const r = M.dayReport();
  const low = M.lowStock();

  return (
    <div className="page">
      <div className="grid4">
        <div className="card stat"><div>Registered</div><div className="n">{r.registered}</div></div>
        <div className="card stat"><div>Seen by a doctor</div><div className="n">{r.seen}</div></div>
        <div className="card stat"><div>Medicines dispensed</div><div className="n">{r.dispensed}</div></div>
        <div className={'card stat' + (r.urgentWaiting ? ' red' : '')}><div>Urgent waiting</div><div className="n">{r.urgentWaiting}</div></div>
      </div>

      <div className="grid4" style={{ marginTop: 12, alignItems: 'start' }}>
        <Column title="Vitals" station="vitals" onOpen={setOpen} />
        <Column title="Doctors" station="doctor" onOpen={setOpen} />
        <Column title="Pharmacy" station="pharmacy" onOpen={setOpen} />
        <div className="card">
          <h3>Stock alerts</h3>
          {low.slice(0, 8).map(({ m, available }) => (
            <div className="kv" key={m.id}><span>{medName(m)}</span><b className={available <= 0 ? 'red-text' : 'amber-text'}>{available}</b></div>
          ))}
          {!low.length && <p className="muted small">No medicine below its low-stock level.</p>}
          <button className="btn wide" style={{ marginTop: 10 }} onClick={() => setView('stock')}>Open full stock list</button>
        </div>
      </div>

      <Devices />
      {open && <FindPatient role={role} initialPatientId={db.get(open)?.patientId} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Column({ title, station, onOpen }) {
  const [all, setAll] = useState(false);
  const list = M.queue(station);
  const longest = list.reduce((mx, v) => Math.max(mx, M.minutesSince(v.stationSince)), 0);
  const rooms = station === 'doctor'
    ? db.all('device').filter((d) => d.station === 'doctor').map((d) => d.name)
    : null;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>{title}</h3><span className="small muted">{list.length} {station === 'pharmacy' ? 'to collect' : 'waiting'}</span>
      </div>
      {longest > 0 && <div className={'small ' + (longest >= 20 ? 'amber-text' : 'muted')} style={{ fontWeight: 700 }}>Longest wait {longest} min</div>}
      {rooms?.length > 0 && <div className="small muted">{rooms.join(' · ')}</div>}
      <div style={{ marginTop: 8 }}>
        {(all ? list : list.slice(0, SHOW)).map((v) => {
          const p = M.patientOf(v);
          const vit = M.vitalsFor(v.id);
          const late = station === 'pharmacy' && M.minutesSince(v.stationSince) >= 30;
          return (
            <button key={v.id} className="card" onClick={() => onOpen(v.id)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: 10, marginTop: 6, cursor: 'pointer', ...(v.urgent ? { borderColor: 'var(--red)', background: 'var(--red-soft)' } : {}) }}>
              <b className="mono">{v.clinicId}</b> {p?.name?.split(' ')[0]} {p?.name?.split(' ').slice(1).map((x) => x[0] + '.').join(' ')} · {ageLabel(p)}
              <div className="small">
                {v.urgent
                  ? <b className="red-text">Urgent{vit?.bpSys ? ` · BP ${bpText(vit)}` : v.urgentReason ? ` · ${v.urgentReason}` : ''}</b>
                  : late ? <b className="amber-text">Not collected · {M.minutesSince(v.stationSince)} min</b>
                    : <span className="muted">{M.minutesSince(v.stationSince)} min{station === 'pharmacy' && v.packed ? ' · packed' : ''}</span>}
              </div>
            </button>
          );
        })}
        {list.length > SHOW && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setAll(!all)}>{all ? 'Show less' : `+ ${list.length - SHOW} more`}</button>}
        {!list.length && <p className="small muted">Nobody waiting.</p>}
      </div>
    </div>
  );
}

function Devices() {
  useNow(10000);
  const devices = db.all('device').sort((a, b) => (a.station || '').localeCompare(b.station || ''));
  if (!devices.length) return null;
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row" style={{ gap: 18 }}>
        <b>Devices</b>
        {devices.map((d) => {
          const ago = M.minutesSince(d.lastSeen);
          const ok = db.now() - d.lastSeen < 45000;
          return (
            <span key={d.id} className="sync small">
              <i className={'dot ' + (ok ? 'ok' : 'warn')} /> {d.name}
              {!ok && ` · not seen for ${ago} min`}
            </span>
          );
        })}
      </div>
    </div>
  );
}
