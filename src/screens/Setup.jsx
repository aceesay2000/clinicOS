import { useState } from 'react';
import * as db from '../db/local.js';
import * as sync from '../db/sync.js';
import { ROLES } from '../lib/clinical.js';
import { Chips } from '../components/ui.jsx';

const DEFAULT_NAMES = {
  registration: 'Desk 1', vitals: 'Table 1', doctor: 'Room A', pharmacy: 'Pharmacy', lead: 'Lead tablet', admin: 'Hub laptop',
};

/** First run on a tablet: name it, give it a station, pair with the hub. */
export default function Setup({ onDone, existing }) {
  const [station, setStation] = useState(existing?.station || 'registration');
  const [name, setName] = useState(existing?.name || DEFAULT_NAMES.registration);
  const [hubUrl, setHubUrl] = useState(existing?.hubUrl || window.location.origin);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pickStation = (label) => {
    const r = ROLES.find((x) => x.label === label);
    if (name === DEFAULT_NAMES[station]) setName(DEFAULT_NAMES[r.id]);
    setStation(r.id);
  };

  const finish = async (pairing) => {
    const dev = { deviceId: existing?.deviceId || db.uuid(), name: name.trim() || 'Tablet', station, ...(pairing || {}) };
    if (existing && !pairing) Object.assign(dev, { hubUrl: existing.hubUrl, hubId: existing.hubId, token: existing.token });
    onDone(dev);
  };

  const pairNow = async () => {
    setBusy(true);
    setError('');
    try {
      const deviceId = existing?.deviceId || db.uuid();
      const p = await sync.pair(hubUrl, code.trim(), deviceId, name);
      onDone({ deviceId, name: name.trim() || 'Tablet', station, ...p });
    } catch (e) {
      setError(e.name === 'AbortError' || e instanceof TypeError ? 'Cannot reach the hub at that address. Check the clinic Wi-Fi.' : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1 style={{ marginTop: 12 }}>{existing ? 'Change tablet setup' : 'Set up this tablet'}</h1>
      <p className="muted">Each tablet is locked to one station. Everything is saved on the tablet first and copied to the hub laptop whenever it is in range.</p>

      <div className="card">
        <label className="label">1 · Which station is this tablet for?</label>
        <Chips multi={false} options={ROLES.map((r) => r.label)} value={ROLES.find((r) => r.id === station)?.label} onChange={(l) => l && pickStation(l)} />
        <div className="field" style={{ marginTop: 14 }}>
          <label className="label" htmlFor="tname">Tablet name (shown on the lead board)</label>
          <input id="tname" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <label className="label">2 · Pair with the hub laptop</label>
        <p className="small muted" style={{ marginTop: 0 }}>The pairing code is shown on the hub laptop when it starts. Data is only ever sent to this hub.</p>
        <div className="grid2">
          <div className="field">
            <label className="label" htmlFor="hub">Hub address</label>
            <input id="hub" className="input" value={hubUrl} onChange={(e) => setHubUrl(e.target.value)} inputMode="url" />
          </div>
          <div className="field">
            <label className="label" htmlFor="code">Pairing code</label>
            <input id="code" className="input big mono" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" />
          </div>
        </div>
        {error && <p className="err" role="alert">{error}</p>}
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn primary" disabled={busy || code.length !== 6} onClick={pairNow}>{busy ? 'Pairing…' : 'Pair and start'}</button>
          <button className="btn" disabled={busy} onClick={() => finish(null)}>{existing ? 'Save without re-pairing' : 'Start offline — pair later'}</button>
        </div>
      </div>
      {!existing && <p className="small muted">First unlock uses the default PIN 1234. The admin should change PINs before clinic day.</p>}
    </div>
  );
}
