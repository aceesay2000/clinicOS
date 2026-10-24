import { useEffect, useState } from 'react';
import * as db from '../db/local.js';
import * as sync from '../db/sync.js';
import { useDB, useSyncStatus } from '../hooks.js';
import * as M from '../lib/model.js';
import { ROLES } from '../lib/clinical.js';
import { hashPin } from '../lib/pin.js';
import { idBlocks } from '../lib/ids.js';
import { exportBackupLocal } from '../lib/exports.js';
import { download } from '../lib/csv.js';
import { PrintPortal, QR, useToast } from '../components/ui.jsx';
import Setup from './Setup.jsx';

export default function Admin({ device, saveDevice }) {
  useDB();
  const [editDevice, setEditDevice] = useState(false);
  if (editDevice) return <Setup existing={device} onDone={async (d) => { await saveDevice(d); setEditDevice(false); }} />;
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <h1 style={{ marginBottom: 12 }}>Admin</h1>
      {M.usingDefaultPins() && <div className="banner amber" style={{ marginBottom: 12 }}>Some stations still use the default PIN 1234. Set new PINs below before clinic day.</div>}
      <Conflicts />
      <ClinicSettings />
      <Pins />
      <ThisTablet device={device} onEdit={() => setEditDevice(true)} />
      <Cards />
      <Data />
    </div>
  );
}

function ClinicSettings() {
  const toast = useToast();
  const s = M.settings();
  const [f, setF] = useState({ ...s, villages: s.villages.join(', ') });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    await M.saveSettings({
      clinicName: f.clinicName, eventName: f.eventName, place: f.place, phone: f.phone, day: f.day,
      idPrefix: f.idPrefix.trim().toUpperCase() || 'DFC',
      villages: f.villages.split(',').map((v) => v.trim()).filter(Boolean),
    });
    toast('Clinic settings saved');
  };
  const input = (k, label, props) => (
    <div className="field"><label className="label" htmlFor={'s-' + k}>{label}</label><input id={'s-' + k} className="input" value={f[k]} onChange={set(k)} {...props} /></div>
  );
  return (
    <div className="card">
      <h2>Clinic day</h2>
      <div className="grid3" style={{ marginTop: 10 }}>
        {input('clinicName', 'Clinic name')}
        {input('eventName', 'Event')}
        {input('place', 'Place')}
        {input('day', 'Clinic day', { type: 'date' })}
        {input('phone', 'Clinic phone (printed on slips)')}
        {input('idPrefix', 'Card prefix')}
      </div>
      {input('villages', 'Villages (comma separated)')}
      <button className="btn primary" onClick={save}>Save</button>
    </div>
  );
}

function Pins() {
  const toast = useToast();
  const [pins, setPins] = useState({});
  const save = async () => {
    const bad = Object.values(pins).some((p) => p && !/^\d{4}$/.test(p));
    if (bad) return toast('PINs must be exactly 4 digits');
    const current = M.settings().pins || {};
    const next = { ...current };
    for (const [role, pin] of Object.entries(pins)) if (pin) next[role] = hashPin(pin);
    await M.saveSettings({ pins: next });
    setPins({});
    toast('PINs saved — they reach other tablets on the next sync');
  };
  return (
    <div className="card">
      <h2>Station PINs</h2>
      <p className="small muted">4 digits each. Leave blank to keep the current PIN. The admin PIN unlocks every station.</p>
      <div className="grid3">
        {ROLES.map((r) => (
          <div className="field" key={r.id}>
            <label className="label" htmlFor={'pin-' + r.id}>{r.label} {!(M.settings().pins || {})[r.id] && <span className="badge warn">default</span>}</label>
            <input id={'pin-' + r.id} className="input mono" inputMode="numeric" maxLength={4} value={pins[r.id] || ''}
              onChange={(e) => setPins({ ...pins, [r.id]: e.target.value.replace(/\D/g, '') })} placeholder="••••" />
          </div>
        ))}
      </div>
      <button className="btn primary" onClick={save}>Save PINs</button>
    </div>
  );
}

function ThisTablet({ device, onEdit }) {
  const status = useSyncStatus();
  const [blocks, setBlocks] = useState([]);
  useEffect(() => { idBlocks().then(setBlocks); }, []);
  return (
    <div className="card">
      <h2>This tablet</h2>
      <div className="grid2" style={{ marginTop: 10 }}>
        <div>
          <div className="kv"><span>Name</span><b>{device.name}</b></div>
          <div className="kv"><span>Station</span><b>{ROLES.find((r) => r.id === device.station)?.label}</b></div>
          <div className="kv"><span>Hub</span><b>{device.token ? device.hubUrl : 'Not paired'}</b></div>
        </div>
        <div>
          <div className="kv"><span>Sync</span><b>{status.state}</b></div>
          <div className="kv"><span>Changes waiting to sync</span><b>{status.pending}</b></div>
          <div className="kv"><span>Last sync</span><b>{status.lastSync ? new Date(status.lastSync).toLocaleTimeString() : '—'}</b></div>
          <div className="kv"><span>Card number blocks</span><b>{blocks.map((b) => `${b.start}–${b.end}`).join(', ') || '—'}</b></div>
        </div>
      </div>
      {status.message && <p className="err">{status.message}</p>}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => sync.syncNow()}>Sync now</button>
        <button className="btn" onClick={onEdit}>Change station / pair with hub</button>
      </div>
    </div>
  );
}

function Conflicts() {
  const toast = useToast();
  const list = db.all('conflict').filter((c) => !c.resolved).sort((a, b) => a.createdAt - b.createdAt);
  if (!list.length) return null;
  const keep = async (c, idx) => {
    await db.put(c.docType, c.docId, { [c.field]: c.values[idx].value });
    await db.put('conflict', c.id, { resolved: true, chosen: idx });
    toast('Conflict resolved');
  };
  const show = (v) => (typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—'));
  const deviceName = (id) => db.get('device:' + id)?.name || id?.slice(0, 8);
  return (
    <div className="card" style={{ borderColor: 'var(--amber)' }}>
      <h2>Sync conflicts to review · {list.length}</h2>
      <p className="small muted">Two tablets changed the same thing while out of touch. Both versions are kept; the newer one is showing until you choose.</p>
      {list.map((c) => {
        const doc = db.get(c.docId);
        const who = doc?.clinicId || M.patientOf(db.get(doc?.visitId))?.name || c.docId.slice(0, 8);
        return (
          <div key={c.id} style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}>
            <b>{c.docType} · {c.field}</b> <span className="muted">· {who}</span>
            <div className="grid2" style={{ marginTop: 6 }}>
              {c.values.map((v, i) => (
                <div key={i} className="card" style={{ padding: 10 }}>
                  <div className="small muted">{deviceName(v.deviceId)} · {new Date(v.ts).toLocaleTimeString()} {c.kept === i && <span className="badge ok">showing</span>}</div>
                  <div style={{ margin: '6px 0', wordBreak: 'break-word' }}>{show(v.value)}</div>
                  <button className="btn sm" onClick={() => keep(c, i)}>Keep this</button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Cards() {
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('100');
  const [printing, setPrinting] = useState(false);
  const s = M.settings();
  const nums = [];
  for (let n = Number(from); n <= Math.min(Number(to), Number(from) + 499); n++) nums.push(n);
  return (
    <div className="card">
      <h2>Pre-printed patient cards</h2>
      <p className="small muted">Print QR cards for a number range and give each registration desk the stack matching its block. Max 500 per print.</p>
      <div className="row">
        <input className="input mono" style={{ width: 120 }} value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, ''))} aria-label="From" />
        <span>to</span>
        <input className="input mono" style={{ width: 120 }} value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, ''))} aria-label="To" />
        <button className="btn" disabled={!nums.length} onClick={() => setPrinting(true)}>Print {nums.length} cards</button>
      </div>
      {printing && (
        <PrintPortal onDone={() => setPrinting(false)}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4mm', font: '11px system-ui, Arial', color: '#000' }}>
            {nums.map((n) => (
              <div key={n} style={{ width: '62mm', height: '38mm', border: '1px dashed #888', padding: '3mm', display: 'flex', gap: '3mm', alignItems: 'center', breakInside: 'avoid' }}>
                <QR text={M.formatId(n)} size={100} />
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{M.formatId(n)}</div>
                  <div>{s.clinicName}</div>
                  <div>Keep this card. Bring it next time.</div>
                </div>
              </div>
            ))}
          </div>
        </PrintPortal>
      )}
    </div>
  );
}

function Data() {
  const toast = useToast();
  const status = useSyncStatus();
  const [confirm, setConfirm] = useState('');
  const hubBackup = async () => {
    try {
      const data = await sync.fetchBackup();
      download(`clinicos-hub-backup-${M.settings().day}.json`, JSON.stringify({ app: 'clinic-os', source: 'hub', ...data }), 'application/json');
    } catch (e) {
      toast(`Hub backup failed: ${e.message}`);
    }
  };
  const wipe = async () => {
    await db.wipe();
    window.location.reload();
  };
  return (
    <div className="card">
      <h2>Backup & after the event</h2>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={hubBackup}>Download full backup from hub</button>
        <button className="btn" onClick={exportBackupLocal}>Download this tablet's data</button>
      </div>
      <p className="small muted">The hub also saves a backup copy every hour (set BACKUP_DIR to a USB stick). Cloud backup is done after the event, when someone has signal.</p>
      <div className="banner red" style={{ marginTop: 14, color: 'var(--ink)' }}>
        <div style={{ flex: 1 }}>
          <b>Wipe this tablet</b> — removes all patient data from this device. Only after the hub backup is confirmed.
          {status.pending > 0 && <div className="err">{status.pending} changes have not reached the hub yet. Sync first.</div>}
        </div>
        <input className="input" style={{ width: 160, fontSize: 16 }} placeholder="Type WIPE" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <button className="btn danger" disabled={confirm !== 'WIPE' || status.pending > 0} onClick={wipe}>Wipe</button>
      </div>
    </div>
  );
}
