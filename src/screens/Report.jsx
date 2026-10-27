import { useState } from 'react';
import { useDB } from '../hooks.js';
import * as M from '../lib/model.js';
import { medName } from '../lib/clinical.js';
import * as X from '../lib/exports.js';
import { PrintPortal } from '../components/ui.jsx';

export default function Report() {
  useDB();
  const [printing, setPrinting] = useState(false);
  const s = M.settings();
  const days = M.clinicDays();
  const [picked, setPicked] = useState(null);
  const day = picked || s.day;
  const r = M.dayReport(day);
  const body = <ReportBody r={r} s={s} day={day} />;
  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{day === s.day ? 'End-of-day report' : 'Past clinic day'} · {day}</h1>
        <button className="btn primary" onClick={() => setPrinting(true)}>Print report</button>
      </div>
      {days.length > 1 && (
        <div className="card" style={{ marginTop: 12 }}>
          <label className="label" htmlFor="day-pick">Clinic day</label>
          <select id="day-pick" className="input" value={day} onChange={(e) => setPicked(e.target.value)}>
            {!days.some((d) => d.day === s.day) && <option value={s.day}>{s.day} · today · 0 patients</option>}
            {days.map((d) => <option key={d.day} value={d.day}>{d.day}{d.day === s.day ? ' · today' : ''} · {d.count} patient{d.count === 1 ? '' : 's'}</option>)}
          </select>
        </div>
      )}
      <div className="card" style={{ marginTop: 12 }}>{body}</div>
      <div className="card">
        <h3>Export {day} (CSV opens in Excel / Google Sheets)</h3>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => X.exportVisits(day)}>Patients & visits</button>
          <button className="btn" onClick={() => X.exportDispensing(day)}>Dispensing log</button>
          <button className="btn" onClick={X.exportStock}>Stock now</button>
          <button className="btn" onClick={X.exportMovements}>All stock movements</button>
        </div>
        <p className="small muted">Exports contain patient details. Keep files on clinic devices and delete them from shared phones after copying to the admin laptop.</p>
      </div>
      {printing && <PrintPortal onDone={() => setPrinting(false)}><div style={{ font: '13px/1.5 system-ui, Arial', color: '#000' }}>{body}</div></PrintPortal>}
    </div>
  );
}

function ReportBody({ r, s, day }) {
  return (
    <>
      <h2>{s.clinicName} · {s.eventName} · {s.place} · {day}</h2>
      <table className="t" style={{ marginTop: 10 }}>
        <tbody>
          <tr><td>Patients registered</td><td><b>{r.registered}</b></td></tr>
          <tr><td>Seen by a doctor</td><td><b>{r.seen}</b></td></tr>
          <tr><td>Medicines dispensed (patients)</td><td><b>{r.dispensed}</b></td></tr>
          <tr><td>Did not collect medicines</td><td><b>{r.notCollected}</b></td></tr>
          <tr><td>Referred to hospital</td><td><b>{r.referrals}</b></td></tr>
          <tr><td>Average journey (registration → dispensed)</td><td><b>{r.avgJourney != null ? `${r.avgJourney} min` : '—'}</b></td></tr>
        </tbody>
      </table>
      <div className="grid2" style={{ marginTop: 14 }}>
        <div>
          <h3>Top conditions</h3>
          <table className="t"><tbody>
            {r.topDiagnoses.map(([d, n]) => <tr key={d}><td>{d}</td><td className="mono">{n}</td></tr>)}
            {!r.topDiagnoses.length && <tr><td className="muted">None yet</td></tr>}
          </tbody></table>
        </div>
        <div>
          <h3>Medicines dispensed</h3>
          <table className="t"><tbody>
            {r.medsDispensed.map(({ m, qty }) => <tr key={m?.id}><td>{medName(m)}</td><td className="mono">{qty} {m?.unit}</td></tr>)}
            {!r.medsDispensed.length && <tr><td className="muted">None yet</td></tr>}
          </tbody></table>
        </div>
      </div>
      <h3 style={{ marginTop: 14 }}>{day === s.day ? 'Stock left' : 'Stock now (current count, not as of that day)'}</h3>
      <table className="t"><tbody>
        {M.medicines().map((m) => {
          const st = M.stockOf(m.id);
          return <tr key={m.id}><td>{medName(m)}</td><td className="mono">{st.onHand} {m.unit}</td><td className="small">{M.isLow(m) ? 'LOW' : ''}</td></tr>;
        })}
      </tbody></table>
    </>
  );
}
