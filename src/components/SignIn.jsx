import { useCallback, useEffect, useState } from 'react';
import * as db from '../db/local.js';
import { useDB, useSyncStatus } from '../hooks.js';
import { ROLES } from '../lib/clinical.js';
import * as T from '../lib/team.js';
import { PinPad, SyncBadge } from './ui.jsx';

const MAX_TRIES = 5;
const COOLDOWN_MS = 30000;
const stationLabel = (id) => ROLES.find((r) => r.id === id)?.label || id;

/**
 * Who is working on this device. Shows, in order of need: create the first
 * admin, quick unlock for the last person, pick your name, enter your PIN,
 * choose a station, or ask to join.
 */
export default function SignIn({ device, lastMemberId, lastStation, onSignedIn }) {
  useDB();
  const sync = useSyncStatus();
  const last = lastMemberId && T.member(lastMemberId);
  const [mode, setMode] = useState(last?.status === 'active' ? 'quick' : 'pick');
  const [chosen, setChosen] = useState(last?.status === 'active' ? last : null);
  const [pendingId, setPendingId] = useState(null);

  useEffect(() => { db.getMeta('pendingMemberId').then((id) => id && (setPendingId(id), setMode('waiting'))); }, []);

  const active = T.activeMembers();
  const synced = !!sync.lastSync;

  const finish = async (m) => {
    const allowed = T.stationsFor(m);
    const recent = (await db.getMeta('recentMembers')) || [];
    await db.setMeta('recentMembers', [m.id, ...recent.filter((x) => x !== m.id)].slice(0, 8));
    if (allowed.length === 1) return onSignedIn(m, allowed[0]);
    setChosen(m);
    setMode('station');
  };

  let body;
  if (!active.length && mode !== 'join' && mode !== 'waiting') {
    body = synced || !device.token
      ? <CreateAdmin onCreated={finish} />
      : <div className="pinbox"><h1>Loading the team…</h1><p className="muted">Connecting to the clinic for the first time.</p><SyncBadge /></div>;
  } else if (mode === 'quick' && chosen) {
    body = <EnterPin member={chosen} title={`Welcome back, ${chosen.name.split(' ')[0]}`} onOk={finish}
      footer={<button className="btn wide" onClick={() => { setChosen(null); setMode('pick'); }}>Not {chosen.name.split(' ')[0]}? Sign in as someone else</button>} />;
  } else if (mode === 'pin' && chosen) {
    body = <EnterPin member={chosen} title={chosen.name} onOk={finish} onCancel={() => setMode('pick')} />;
  } else if (mode === 'station' && chosen) {
    body = <PickStation member={chosen} lastStation={lastStation} onPick={(s) => onSignedIn(chosen, s)} />;
  } else if (mode === 'join') {
    body = <RequestAccess onCancel={() => setMode('pick')} onSent={async (m) => { await db.setMeta('pendingMemberId', m.id); setPendingId(m.id); setMode('waiting'); }} />;
  } else if (mode === 'waiting' && pendingId) {
    body = <Waiting memberId={pendingId} onDone={async (approved) => {
      await db.setMeta('pendingMemberId', null);
      setPendingId(null);
      if (approved) { setChosen(T.member(pendingId)); setMode('pin'); } else setMode('pick');
    }} />;
  } else {
    body = <PickMember onPick={(m) => { setChosen(m); setMode('pin'); }} onJoin={() => setMode('join')} />;
  }

  return (
    <div className="lock">
      <div style={{ width: 'min(460px, 100%)' }}>
        {body}
        <p className="small muted" style={{ textAlign: 'center', marginTop: 18 }}>{device.name} · <SyncBadge /></p>
      </div>
    </div>
  );
}

function PickMember({ onPick, onJoin }) {
  const [q, setQ] = useState('');
  const [recent, setRecent] = useState([]);
  useEffect(() => { db.getMeta('recentMembers').then((r) => setRecent(r || [])); }, []);
  const rank = (m) => { const i = recent.indexOf(m.id); return i < 0 ? 99 : i; };
  const list = T.activeMembers()
    .filter((m) => !q || m.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return (
    <div>
      <h1 style={{ textAlign: 'center' }}>Who’s working?</h1>
      <p className="muted" style={{ textAlign: 'center' }}>Tap your name, then enter your PIN.</p>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your name" aria-label="Search your name" autoComplete="off" />
      <div className="card" style={{ padding: 0, marginTop: 10, maxHeight: '46vh', overflow: 'auto' }}>
        {list.map((m) => (
          <button key={m.id} className="qitem" onClick={() => onPick(m)}>
            <b>{m.name}</b>
            <div className="meta">{T.roleLabel(m.role)}{rank(m) < 99 ? ' · used this device' : ''}</div>
          </button>
        ))}
        {!list.length && <div className="empty small">No one by that name. Ask to join below.</div>}
      </div>
      <button className="btn wide" style={{ marginTop: 12 }} onClick={onJoin}>New here? Ask to join</button>
    </div>
  );
}

function EnterPin({ member, title, onOk, onCancel, footer }) {
  const [error, setError] = useState('');
  const [tries, setTries] = useState(0);
  const [until, setUntil] = useState(0);
  const submit = useCallback((pin) => {
    if (Date.now() < until) return setError('Too many tries. Wait 30 seconds.');
    if (T.verifyPin(T.member(member.id), pin)) return onOk(T.member(member.id));
    const n = tries + 1;
    setTries(n);
    if (n >= MAX_TRIES) {
      setUntil(Date.now() + COOLDOWN_MS);
      setTries(0);
      setError('Too many tries. Wait 30 seconds, or ask the admin to reset your PIN.');
    } else setError(`Wrong PIN (${MAX_TRIES - n} tries left)`);
  }, [member.id, onOk, tries, until]);
  return (
    <div>
      <PinPad title={title} subtitle={`${T.roleLabel(member.role)} · enter your PIN`} onSubmit={submit} error={error} onCancel={onCancel} />
      {footer && <div style={{ marginTop: 14 }}>{footer}</div>}
    </div>
  );
}

function PickStation({ member, lastStation, onPick }) {
  const allowed = T.stationsFor(member);
  return (
    <div>
      <h1 style={{ textAlign: 'center' }}>Hi {member.name.split(' ')[0]}, which station?</h1>
      <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        {allowed.map((s) => (
          <button key={s} className={'btn wide' + (s === lastStation ? ' primary' : '')} onClick={() => onPick(s)}>
            {stationLabel(s)}{s === lastStation ? ' · last used here' : ''}
          </button>
        ))}
      </div>
    </div>
  );
}

function PinFields({ pin, setPin, pin2, setPin2 }) {
  return (
    <div className="grid2">
      <div className="field">
        <label className="label" htmlFor="pin1">Choose a 4-digit PIN</label>
        <input id="pin1" className="input big mono" type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoComplete="new-password" />
      </div>
      <div className="field">
        <label className="label" htmlFor="pin2">Type it again</label>
        <input id="pin2" className="input big mono" type="password" inputMode="numeric" maxLength={4} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} autoComplete="new-password" />
      </div>
    </div>
  );
}

function pinProblem(pin, pin2) {
  if (!T.validPin(pin)) return 'The PIN must be 4 digits.';
  if (pin !== pin2) return 'The two PINs don’t match.';
  if (/^(\d)\1{3}$/.test(pin) || pin === '1234') return 'Pick a PIN that is harder to guess than 1234 or 0000.';
  return '';
}

/** The very first person on a new clinic becomes its admin. */
function CreateAdmin({ onCreated }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState('');
  const create = async () => {
    const e = !name.trim() ? 'Enter your name.' : pinProblem(pin, pin2);
    setError(e);
    if (e) return;
    onCreated(await T.createMember({ name, role: 'admin', pin }));
  };
  return (
    <div className="card">
      <h1>Create the admin account</h1>
      <p className="muted">No one has signed in to this clinic yet. You’ll be the admin: you add the team, approve volunteers and manage devices.</p>
      <div className="field">
        <label className="label" htmlFor="admin-name">Your name</label>
        <input id="admin-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </div>
      <PinFields pin={pin} setPin={setPin} pin2={pin2} setPin2={setPin2} />
      {error && <p className="err" role="alert">{error}</p>}
      <button className="btn primary wide" onClick={create}>Create admin account</button>
    </div>
  );
}

function RequestAccess({ onCancel, onSent }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState('');
  const send = async () => {
    const e = !name.trim() ? 'Enter your full name.' : T.nameTaken(name) ? 'Someone with that name is already on the team. Add your surname or ask the admin.' : pinProblem(pin, pin2);
    setError(e);
    if (e) return;
    onSent(await T.requestAccess({ name, pin, phone }));
  };
  return (
    <div className="card">
      <h1>Ask to join</h1>
      <p className="muted">The clinic lead or admin will approve you and choose your station.</p>
      <div className="field">
        <label className="label" htmlFor="join-name">Full name</label>
        <input id="join-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </div>
      <div className="field">
        <label className="label" htmlFor="join-phone">Phone (optional)</label>
        <input id="join-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="+220" />
      </div>
      <PinFields pin={pin} setPin={setPin} pin2={pin2} setPin2={setPin2} />
      {error && <p className="err" role="alert">{error}</p>}
      <div className="row">
        <button className="btn" onClick={onCancel}>Back</button>
        <button className="btn primary" style={{ flex: 1 }} onClick={send}>Send request</button>
      </div>
    </div>
  );
}

function Waiting({ memberId, onDone }) {
  useDB();
  const m = T.member(memberId);
  if (m?.status === 'active') {
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <h1>You’re approved</h1>
        <p className="muted">{m.name} · {T.roleLabel(m.role)}</p>
        <button className="btn primary wide" onClick={() => onDone(true)}>Sign in</button>
      </div>
    );
  }
  if (m && m.status !== 'pending') {
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <h1>Request not approved</h1>
        <p className="muted">Speak to the clinic lead or admin.</p>
        <button className="btn wide" onClick={() => onDone(false)}>Back</button>
      </div>
    );
  }
  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <h1>Waiting for approval</h1>
      <p className="muted">{m?.name || 'Your request'} has been sent. Ask the clinic lead or admin to approve you in <b>Team</b>. This screen updates by itself.</p>
      <button className="btn wide" onClick={() => onDone(false)}>Cancel</button>
    </div>
  );
}
