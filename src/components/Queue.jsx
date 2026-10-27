import { useState } from 'react';
import { useNow } from '../hooks.js';
import * as M from '../lib/model.js';
import { STATIONS, ageLabel } from '../lib/clinical.js';
import { Scanner, useConfirm, useToast } from './ui.jsx';

/** Left-hand waiting list shared by Vitals and Doctor. */
export default function Queue({ station, selected, onSelect, renderMeta }) {
  useNow();
  const toast = useToast();
  const confirm = useConfirm();
  const [lookup, setLookup] = useState('');
  const [scan, setScan] = useState(false);
  const list = M.queue(station);

  const open = async (text) => {
    const p = M.patientByClinicId(text);
    const v = p && M.todaysVisit(p.id);
    if (!v) return toast(`No patient registered today with card ${text}`);
    if (v.station !== station) {
      const here = STATIONS.find((s) => s.id === v.station)?.label;
      if (!(await confirm(`${p.name} is listed at ${here}. Bring them to this station?`, 'Bring here'))) return;
      await M.moveTo(v, station);
    }
    onSelect(v.id);
    setLookup('');
  };

  return (
    <>
      <div className="qhead"><b>Waiting</b><span className="muted small">{list.length} patient{list.length === 1 ? '' : 's'}</span></div>
      <div style={{ padding: '0 14px 10px' }}>
        <form className="row" style={{ flexWrap: 'nowrap', gap: 8 }} onSubmit={(e) => { e.preventDefault(); lookup && open(lookup); }}>
          <input className="input" style={{ fontSize: 16 }} value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="Type card number" inputMode="numeric" aria-label="Card number" />
          <button type="button" className="btn" onClick={() => setScan(true)}>Scan</button>
        </form>
      </div>
      <div style={{ flex: 1 }}>
        {list.map((v) => {
          const p = M.patientOf(v);
          return (
            <button key={v.id} className={'qitem' + (v.id === selected ? ' on' : v.urgent ? ' urgent' : '')} onClick={() => onSelect(v.id)}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="id mono">{v.clinicId}</span>
                <span className="small muted">{v.urgent && <span className="badge urgent">URGENT</span>} {M.minutesSince(v.stationSince)} min</span>
              </div>
              <div>{p?.name} · {p?.sex} · {ageLabel(p)}</div>
              <div className="meta">{renderMeta ? renderMeta(v) : (v.complaints || []).join(' · ')}</div>
            </button>
          );
        })}
        {!list.length && <div className="empty">Nobody waiting.</div>}
      </div>
      {scan && <Scanner onClose={() => setScan(false)} onResult={(t) => { setScan(false); open(t); }} />}
    </>
  );
}
