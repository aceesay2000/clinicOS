import { useState } from 'react';
import * as db from '../db/local.js';
import * as sync from '../db/sync.js';
import { useDB, useNow } from '../hooks.js';
import { ROLES } from '../lib/clinical.js';
import * as M from '../lib/model.js';
import * as T from '../lib/team.js';
import { Modal, PinPad, useToast } from '../components/ui.jsx';

const stationLabel = (id) => ROLES.find((r) => r.id === id)?.label || id || '—';
const ago = (t) => {
  if (!t) return 'never';
  const m = M.minutesSince(t);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : new Date(t).toLocaleDateString();
};

/** Team & devices: who is working where, approvals, accounts and devices. */
export default function Team({ me, device }) {
  useDB();
  useNow(15000);
  const [modal, setModal] = useState(null);
  const admin = T.isAdmin(me);
  const dayStart = new Date(new Date(db.now()).toDateString()).getTime();
  const active = T.activeMembers();
  const pending = T.pendingMembers();
  const devices = T.devices().filter((d) => !d.revoked);
  const onDuty = devices.filter((d) => T.isOnline(d) && d.memberId);
  // Leads manage volunteers and clinicians; only admins manage admins.
  const canEdit = (m) => admin || (T.canManageTeam(me) && m.role !== 'admin');

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h1>Team & devices</h1>
        <button className="btn primary" onClick={() => setModal({ kind: 'add' })}>Add team member</button>
      </div>

      <div className="grid4">
        <div className="card stat"><div>On duty now</div><div className="n">{onDuty.length}</div></div>
        <div className="card stat"><div>Team members</div><div className="n">{active.length}</div></div>
        <div className="card stat"><div>Devices online</div><div className="n">{devices.filter(T.isOnline).length}<span className="muted" style={{ fontSize: 20 }}> / {devices.length}</span></div></div>
        <div className={'card stat' + (pending.length ? ' red' : '')}><div>Waiting for approval</div><div className="n">{pending.length}</div></div>
      </div>

      {pending.length > 0 && (
        <div className="card" style={{ marginTop: 12, borderColor: 'var(--amber)' }}>
          <h2>Waiting for approval</h2>
          {pending.map((m) => <Approval key={m.id} m={m} admin={admin} />)}
        </div>
      )}

      <div className="card" style={{ marginTop: 12 }}>
        <h2>On duty now</h2>
        {onDuty.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="t" style={{ marginTop: 8 }}>
              <thead><tr><th>Person</th><th>Station</th><th>Device</th><th>Seen</th></tr></thead>
              <tbody>
                {onDuty.map((d) => (
                  <tr key={d.id}><td><b>{d.memberName}</b></td><td>{stationLabel(d.station)}</td><td>{d.name} <span className="muted small">{d.kind === 'personal' ? 'own phone' : 'clinic'}</span></td><td className="small">{ago(d.lastSeen)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">Nobody is signed in on a connected device right now.</p>}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2>Team members</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="t" style={{ marginTop: 8 }}>
            <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Patients today</th><th /></tr></thead>
            <tbody>
              {T.members().filter((m) => m.status !== 'declined' && m.status !== 'pending').map((m) => {
                const on = onDuty.find((d) => d.memberId === m.id);
                return (
                  <tr key={m.id}>
                    <td><b>{m.name}</b>{m.id === me.id && <span className="muted small"> (you)</span>}{m.phone && <div className="small muted">{m.phone}</div>}</td>
                    <td>{T.roleLabel(m.role)}</td>
                    <td>{m.status === 'inactive'
                      ? <span className="badge grey">INACTIVE</span>
                      : on ? <span className="badge ok">ON DUTY · {stationLabel(on.station).toUpperCase()}</span> : <span className="badge grey">OFF</span>}</td>
                    <td className="mono">{T.patientsHandled(m.id, dayStart)}</td>
                    <td>{canEdit(m) && <button className="btn sm" onClick={() => setModal({ kind: 'edit', m })}>Manage</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2>Devices</h2>
        <p className="small muted" style={{ marginTop: 4 }}>Remove a device that is lost, stolen or no longer used. It stops syncing and erases its patient data the next time it connects.</p>
        <div style={{ overflowX: 'auto' }}>
          <table className="t" style={{ marginTop: 8 }}>
            <thead><tr><th>Device</th><th>Type</th><th>Signed in</th><th>Last seen</th><th /></tr></thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td><span className={'dot ' + (T.isOnline(d) ? 'ok' : 'warn')} style={{ display: 'inline-block', marginRight: 8 }} /><b>{d.name}</b>{d.deviceId === device.deviceId && <span className="muted small"> (this one)</span>}</td>
                  <td>{d.kind === 'personal' ? 'Personal phone' : 'Clinic tablet'}</td>
                  <td>{d.memberName ? `${d.memberName} · ${stationLabel(d.station)}` : <span className="muted">nobody</span>}</td>
                  <td className="small">{ago(d.lastSeen)}</td>
                  <td>{admin && d.deviceId !== device.deviceId && <button className="btn sm danger" onClick={() => setModal({ kind: 'remove', d })}>Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!admin && <p className="small muted">Only an admin can remove devices.</p>}
      </div>

      {modal?.kind === 'add' && <MemberForm admin={admin} onClose={() => setModal(null)} />}
      {modal?.kind === 'edit' && <MemberForm admin={admin} m={modal.m} me={me} onClose={() => setModal(null)} />}
      {modal?.kind === 'remove' && <RemoveDevice d={modal.d} me={me} onClose={() => setModal(null)} />}
    </div>
  );
}

function roleOptions(admin) {
  return T.TEAM_ROLES.filter((r) => admin || r.id !== 'admin');
}

function Approval({ m, admin }) {
  const toast = useToast();
  const [role, setRole] = useState('volunteer');
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid var(--line)' }}>
      <div><b>{m.name}</b>{m.phone && <span className="muted"> · {m.phone}</span>}<div className="small muted">Asked {ago(m.createdAt)}</div></div>
      <div className="row">
        <select className="input" style={{ width: 'auto', fontSize: 16, minHeight: 44 }} value={role} onChange={(e) => setRole(e.target.value)} aria-label={`Role for ${m.name}`}>
          {roleOptions(admin).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <button className="btn primary sm" onClick={async () => { await T.approve(m, role); toast(`${m.name} approved as ${T.roleLabel(role)}`); }}>Approve</button>
        <button className="btn sm" onClick={async () => { await T.decline(m); toast(`${m.name} declined`); }}>Decline</button>
      </div>
    </div>
  );
}

function MemberForm({ m, me, admin, onClose }) {
  const toast = useToast();
  const [name, setName] = useState(m?.name || '');
  const [phone, setPhone] = useState(m?.phone || '');
  const [role, setRole] = useState(m?.role || 'volunteer');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const editing = !!m;
  const self = m && me && m.id === me.id;
  const lastAdmin = m?.role === 'admin' && T.activeMembers().filter((x) => x.role === 'admin').length === 1;

  const save = async () => {
    const e = !name.trim() ? 'Enter a name.'
      : T.nameTaken(name, m?.id) ? 'Someone on the team already has that name. Add a surname.'
      : (!editing || pin) && !T.validPin(pin) ? 'The PIN must be 4 digits.'
      : lastAdmin && role !== 'admin' ? 'There must be at least one admin.'
      : '';
    setError(e);
    if (e) return;
    if (editing) {
      await db.put('member', m.id, { name: name.trim(), phone: phone.trim(), role });
      if (pin) await T.resetPin(m, pin);
      toast(`${name} updated${pin ? ' · new PIN set' : ''}`);
    } else {
      await T.createMember({ name, role, pin, phone });
      toast(`${name} added. Tell them their PIN.`);
    }
    onClose();
  };

  const toggleActive = async () => {
    if (m.status === 'active') await T.deactivate(m);
    else await T.reactivate(m);
    toast(m.status === 'active' ? `${m.name} can no longer sign in` : `${m.name} can sign in again`);
    onClose();
  };

  return (
    <Modal onClose={onClose}>
      <h2>{editing ? `Manage ${m.name}` : 'Add team member'}</h2>
      <div className="field" style={{ marginTop: 12 }}>
        <label className="label" htmlFor="m-name">Full name</label>
        <input id="m-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid2">
        <div className="field">
          <label className="label" htmlFor="m-role">Role</label>
          <select id="m-role" className="input" value={role} onChange={(e) => setRole(e.target.value)} disabled={self}>
            {roleOptions(admin).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="m-phone">Phone (optional)</label>
          <input id="m-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>Can work: {T.TEAM_ROLES.find((r) => r.id === role)?.stations.map(stationLabel).join(', ')}</p>
      <div className="field">
        <label className="label" htmlFor="m-pin">{editing ? 'New PIN (leave blank to keep)' : '4-digit PIN'}</label>
        <input id="m-pin" className="input mono" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoComplete="off" />
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {editing && !self && !lastAdmin
          ? <button className="btn danger" onClick={toggleActive}>{m.status === 'active' ? 'Deactivate' : 'Reactivate'}</button>
          : <span />}
        <div className="row">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>{editing ? 'Save' : 'Add'}</button>
        </div>
      </div>
    </Modal>
  );
}

function RemoveDevice({ d, me, onClose }) {
  const toast = useToast();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (pin) => {
    if (busy) return;
    setBusy(true);
    try {
      await sync.revokeDevice(d.deviceId, me.id, pin);
      toast(`${d.name} removed. It will erase its data when it next connects.`);
      onClose();
    } catch (e) {
      setError(e.name === 'AbortError' || e instanceof TypeError ? 'Removing a device needs the internet.' : e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal onClose={onClose}>
      <PinPad title={`Remove ${d.name}?`} subtitle="Enter your admin PIN to confirm" onSubmit={submit} error={error} onCancel={onClose} />
    </Modal>
  );
}
