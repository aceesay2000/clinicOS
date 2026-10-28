// Team members: who is working, what they may do, and what they did.
// Members sync to every device so people can sign in even while offline.

import * as db from '../db/local.js';
import { hashPin } from './pin.js';

export const ALL_STATIONS = ['registration', 'vitals', 'doctor', 'pharmacy', 'lead', 'admin'];

export const TEAM_ROLES = [
  { id: 'volunteer', label: 'Registration volunteer', stations: ['registration'] },
  { id: 'nurse', label: 'Nurse / triage', stations: ['vitals', 'registration'] },
  { id: 'doctor', label: 'Doctor', stations: ['doctor', 'vitals'] },
  { id: 'pharmacist', label: 'Pharmacy', stations: ['pharmacy'] },
  { id: 'lead', label: 'Clinic lead', stations: ['lead', 'registration', 'vitals', 'doctor', 'pharmacy'] },
  { id: 'admin', label: 'Admin', stations: ALL_STATIONS },
];

export const roleLabel = (id) => TEAM_ROLES.find((r) => r.id === id)?.label || id;
export const stationsFor = (m) => (m ? TEAM_ROLES.find((r) => r.id === m.role)?.stations || [] : []);
export const canManageTeam = (m) => m?.status === 'active' && (m.role === 'admin' || m.role === 'lead');
export const isAdmin = (m) => m?.status === 'active' && m.role === 'admin';

export const members = () => db.all('member').sort((a, b) => a.name.localeCompare(b.name));
export const activeMembers = () => members().filter((m) => m.status === 'active');
export const pendingMembers = () => members().filter((m) => m.status === 'pending');
export const member = (id) => db.get(id);

export const validPin = (pin) => /^\d{4}$/.test(String(pin || ''));
export const verifyPin = (m, pin) => !!m && m.status === 'active' && m.pinHash === hashPin(pin, m.id);

async function save(id, fields) {
  return db.put('member', id, fields);
}

export async function createMember({ name, role, pin, phone = '' }) {
  const id = 'member:' + db.uuid();
  return save(id, { name: name.trim(), role, phone: phone.trim(), pinHash: hashPin(pin, id), status: 'active' });
}

/** A new volunteer asks to join from their own device; a lead or admin approves. */
export async function requestAccess({ name, pin, phone = '' }) {
  const id = 'member:' + db.uuid();
  return save(id, { name: name.trim(), role: 'volunteer', phone: phone.trim(), pinHash: hashPin(pin, id), status: 'pending' });
}

export const approve = (m, role) => save(m.id, { status: 'active', role });
export const decline = (m) => save(m.id, { status: 'declined' });
export const deactivate = (m) => save(m.id, { status: 'inactive' });
export const reactivate = (m) => save(m.id, { status: 'active' });
export const setRole = (m, role) => save(m.id, { role });
export const resetPin = (m, pin) => save(m.id, { pinHash: hashPin(pin, m.id) });

export function nameTaken(name, exceptId) {
  const n = name.trim().toLowerCase();
  return members().some((m) => m.id !== exceptId && m.status !== 'declined' && m.name.trim().toLowerCase() === n);
}

/** Patients this member moved along today (registered, triaged, seen, dispensed…). */
export function patientsHandled(memberId, dayStart) {
  const visits = new Set();
  for (const e of db.all('event')) if (e.byUser === memberId && e.at >= dayStart) visits.add(e.visitId);
  return visits.size;
}

/** Devices as reported by their last check-in with the server. */
export const devices = () => db.all('device').sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
export const isOnline = (d) => db.now() - (d.lastSeen || 0) < 45000;
