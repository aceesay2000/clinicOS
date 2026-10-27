import { useState } from 'react';
import * as db from '../db/local.js';
import * as sync from '../db/sync.js';
import { ROLES } from '../lib/clinical.js';
import { Chips } from '../components/ui.jsx';

const DEFAULT_NAMES = {
  registration: 'Desk 1', vitals: 'Table 1', doctor: 'Room A', pharmacy: 'Pharmacy', lead: 'Clinic lead', admin: 'Admin',
};

/** First run on a phone: choose its station, name it, enter the clinic code. */
export default function Setup({ onDone, existing }) {
  const [station, setStation] = useState(existing?.station || 'registration');
  const [name, setName] = useState(existing?.name || DEFAULT_NAMES.registration);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pickStation = (label) => {
    const r = ROLES.find((x) => x.label === label);
    if (name === DEFAULT_NAMES[station]) setName(DEFAULT_NAMES[r.id]);
    setStation(r.id);
  };

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const deviceId = existing?.deviceId || db.uuid();
      const p = await sync.pair('', code.trim(), deviceId, name);
      onDone({ deviceId, name: name.trim() || 'Phone', station, ...p });
    } catch (e) {
      setError(e.name === 'AbortError' || e instanceof TypeError
        ? 'No internet connection. Setting up a phone needs the internet once — try again when connected.'
        : e.message);
    } finally {
      setBusy(false);
    }
  };

  // Changing station later doesn't need the code again.
  const keepPairing = () => onDone({ ...existing, name: name.trim() || 'Phone', station });

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1 style={{ marginTop: 12 }}>{existing ? 'Change station' : 'Set up this phone'}</h1>
      <p className="muted">Each phone works one station. Everything is saved on the phone first, so a dropped connection never loses a record — it catches up as soon as the internet is back.</p>

      <div className="card">
        <label className="label">Which station is this phone for?</label>
        <Chips multi={false} options={ROLES.map((r) => r.label)} value={ROLES.find((r) => r.id === station)?.label} onChange={(l) => l && pickStation(l)} />
        <div className="field" style={{ marginTop: 14 }}>
          <label className="label" htmlFor="tname">Name shown on the lead board</label>
          <input id="tname" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {!existing?.token && (
          <div className="field">
            <label className="label" htmlFor="code">Clinic code (from the admin)</label>
            <input id="code" className="input big mono" style={{ maxWidth: 260 }} value={code} onChange={(e) => setCode(e.target.value.trim())} inputMode="numeric" autoComplete="off" />
          </div>
        )}
        {error && <p className="err" role="alert">{error}</p>}
        <div className="row" style={{ marginTop: 6 }}>
          {existing?.token
            ? <button className="btn primary" onClick={keepPairing}>Save</button>
            : <button className="btn primary" disabled={busy || !code} onClick={start}>{busy ? 'Checking…' : 'Start'}</button>}
        </div>
      </div>
      {!existing && <p className="small muted">First unlock uses the default PIN 1234. The admin should change PINs before clinic day.</p>}
    </div>
  );
}
