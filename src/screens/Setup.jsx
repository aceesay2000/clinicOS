import { useState } from 'react';
import * as db from '../db/local.js';
import * as sync from '../db/sync.js';
import { Seg } from '../components/ui.jsx';

/**
 * Once per device: what it is and the clinic code. People then sign in with
 * their own name and PIN, so a shared clinic tablet can be used by many.
 */
export default function Setup({ onDone, existing, onCancel }) {
  const [kind, setKind] = useState(existing?.kind || 'shared');
  const [name, setName] = useState(existing?.name || '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const deviceId = existing?.deviceId || db.uuid();
      const label = name.trim() || (kind === 'personal' ? 'Personal phone' : 'Clinic tablet');
      const p = await sync.pair('', code.trim(), deviceId, label, kind);
      onDone({ deviceId, name: label, kind, ...p });
    } catch (e) {
      setError(e.name === 'AbortError' || e instanceof TypeError
        ? 'No internet connection. Setting up a device needs the internet once. Try again when connected.'
        : e.message);
    } finally {
      setBusy(false);
    }
  };

  // Renaming a device that is already set up doesn't need the code again.
  const saveOnly = () => onDone({ ...existing, name: name.trim() || existing.name, kind });

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <h1 style={{ marginTop: 12 }}>{existing ? 'This device' : 'Set up this device'}</h1>
      {!existing && <p className="muted">Do this once per phone or tablet. After that, each person signs in with their own name and PIN.</p>}

      <div className="card">
        <span className="label">Whose device is this?</span>
        <Seg options={[['shared', 'Clinic tablet (shared)'], ['personal', 'My own phone']]} value={kind} onChange={setKind} />
        <p className="small muted" style={{ marginBottom: 0 }}>
          {kind === 'personal'
            ? 'When you sign out you can erase all patient data from your phone.'
            : 'Several people can take turns on this device, each signing in as themselves.'}
        </p>
        <div className="field" style={{ marginTop: 14 }}>
          <label className="label" htmlFor="tname">Device name</label>
          <input id="tname" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'personal' ? 'e.g. Awa’s phone' : 'e.g. Tablet 3'} />
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
            ? <button className="btn primary" onClick={saveOnly}>Save</button>
            : <button className="btn primary" disabled={busy || !code} onClick={start}>{busy ? 'Checking…' : 'Set up device'}</button>}
          {onCancel && <button className="btn" onClick={onCancel}>Cancel</button>}
        </div>
      </div>
    </div>
  );
}
