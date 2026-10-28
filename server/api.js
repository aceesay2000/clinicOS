// The ClinicOS server: pairing, sync, card-number blocks and backup.
// Each handler takes (db, body) and returns [status, json].

import crypto from 'node:crypto';
import { merge, stamp } from './merge.js';
import { hashPin } from '../src/lib/pin.js';

const ID_BLOCK_SIZE = Number(process.env.ID_BLOCK_SIZE || 100);
const PAGE = 2000;

const SCHEMA = `
create table if not exists docs (
  id text primary key, type text not null, seq bigint not null,
  data jsonb not null, fmeta jsonb not null default '{}'
);
create index if not exists docs_seq_idx on docs (seq);
create sequence if not exists doc_seq;
create table if not exists devices (
  device_id text primary key, name text, token text not null, paired_at timestamptz not null default now()
);
create table if not exists config (key text primary key, value jsonb not null);
`;

// Additive changes for databases created by earlier versions; safe to repeat.
const MIGRATIONS = [
  'alter table devices add column if not exists revoked boolean not null default false',
  'alter table devices add column if not exists kind text',
];

// Per server instance: schema checked once, server id read once.
const ready = new WeakMap();
const serverIds = new WeakMap();
function ensureSchema(db) {
  if (!ready.has(db)) {
    ready.set(db, (async () => {
      const { rows } = await db.query(`select value from config where key = 'serverId'`).catch(() => ({ rows: [] }));
      if (!rows[0]) {
        for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await db.query(stmt);
        await db.query(`insert into config (key, value) values ('serverId', $1), ('nextId', '1') on conflict do nothing`, [JSON.stringify(crypto.randomUUID())]);
      }
      for (const m of MIGRATIONS) await db.query(m);
    })().catch((err) => { ready.delete(db); throw err; }));
  }
  return ready.get(db);
}

async function serverId(db) {
  if (!serverIds.has(db)) {
    const { rows } = await db.query(`select value from config where key = 'serverId'`);
    serverIds.set(db, rows[0].value);
  }
  return serverIds.get(db);
}

/** false = unknown device, 'revoked' = removed by an admin, true = OK. */
async function authed(q, body) {
  if (!body.deviceId || !body.token) return false;
  const { rows } = await q.query('select token, revoked from devices where device_id = $1', [body.deviceId]);
  if (!rows[0]) return false;
  const a = Buffer.from(rows[0].token), b = Buffer.from(String(body.token));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return rows[0].revoked ? 'revoked' : true;
}

const REVOKED = [410, { error: 'This device was removed by the clinic admin.', revoked: true }];
const NOT_SET_UP = [401, { error: 'This device is not set up for the clinic. Set it up again with the clinic code.' }];
async function gate(q, body) {
  const a = await authed(q, body);
  return a === true ? null : a === 'revoked' ? REVOKED : NOT_SET_UP;
}

const rowToDoc = (r) => ({ ...r.data, _seq: Number(r.seq) });

async function loadDoc(q, id) {
  const { rows } = await q.query('select data, fmeta, seq from docs where id = $1 for update', [id]);
  return rows[0] ? { ...rows[0].data, _f: rows[0].fmeta, _seq: Number(rows[0].seq) } : undefined;
}

async function write(q, doc, changedFields) {
  const { rows } = await q.query(`select nextval('doc_seq') as seq`);
  stamp(doc, Number(rows[0].seq), changedFields);
  const { _f, _seq, ...data } = doc;
  await q.query(
    `insert into docs (id, type, seq, data, fmeta) values ($1, $2, $3, $4, $5)
     on conflict (id) do update set seq = excluded.seq, data = excluded.data, fmeta = excluded.fmeta`,
    [doc.id, doc.type, _seq, JSON.stringify(data), JSON.stringify(_f)],
  );
}

/** Apply one change inside a transaction; returns the number of conflicts recorded. */
export async function applyChange(q, change, deviceId) {
  const existing = await loadDoc(q, change.id);
  const { doc, changed, changedFields, conflicts } = merge(existing, change, deviceId);
  if (changed) await write(q, doc, changedFields);
  for (const c of conflicts) {
    await write(q, { id: 'conflict:' + crypto.randomUUID(), type: 'conflict', ...c, resolved: false, createdAt: Date.now(), _f: {} }, []);
  }
  return conflicts.length;
}

export const handlers = {
  async 'GET hello'(db) {
    // Database round-trip time helps spot a server and database in different regions.
    const t = Date.now();
    await db.query('select 1');
    return [200, { app: 'clinic-os', hubId: await serverId(db), time: Date.now(), region: process.env.VERCEL_REGION || 'local', dbMs: Date.now() - t }];
  },

  async 'POST pair'(db, body) {
    const code = process.env.CLINIC_CODE;
    if (!code) return [500, { error: 'The clinic code has not been set up yet (CLINIC_CODE).' }];
    if (String(body.code || '').trim() !== code) return [403, { error: 'Wrong clinic code' }];
    if (!body.deviceId) return [400, { error: 'deviceId required' }];
    const token = crypto.randomBytes(24).toString('hex');
    await db.query(
      `insert into devices (device_id, name, token, kind) values ($1, $2, $3, $4)
       on conflict (device_id) do update set name = excluded.name, token = excluded.token, kind = excluded.kind, revoked = false, paired_at = now()`,
      [body.deviceId, body.name || 'Phone', token, body.kind === 'personal' ? 'personal' : 'shared'],
    );
    // A device set up again after being removed shows as active again.
    const { rows: prev } = await db.query('select data from docs where id = $1', ['device:' + body.deviceId]);
    if (prev[0]?.data?.revoked) {
      await db.tx(async (q) => {
        await q.query('select pg_advisory_xact_lock(4242)');
        await applyChange(q, { id: 'device:' + body.deviceId, type: 'device', base: Infinity, fields: { revoked: false }, ts: Date.now() }, 'server');
      });
    }
    return [200, { hubId: await serverId(db), token }];
  },

  async 'POST sync'(db, body) {
    const denied = await gate(db, body);
    if (denied) return denied;
    const sid = await serverId(db);
    if (body.hubId && body.hubId !== sid) return [409, { error: 'Different clinic server' }];
    const changes = body.changes || [];
    if (changes.length || body.device) {
      await db.tx(async (q) => {
        // One writer at a time keeps sequence numbers in commit order, so a
        // phone reading "everything after N" can never skip a record.
        await q.query('select pg_advisory_xact_lock(4242)');
        for (const ch of changes) await applyChange(q, ch, body.deviceId);
        if (body.device) await heartbeat(q, body.deviceId, body.device);
      });
    }
    const since = Number(body.since) || 0;
    const { rows } = await db.query('select data, seq from docs where seq > $1 order by seq limit $2', [since, PAGE + 1]);
    const more = rows.length > PAGE;
    const docs = rows.slice(0, PAGE).map(rowToDoc);
    let seq = since;
    if (docs.length) seq = docs[docs.length - 1]._seq;
    return [200, { hubId: sid, applied: changes.length, docs, more, seq, time: Date.now() }];
  },

  async 'POST idblock'(db, body) {
    const denied = await gate(db, body);
    if (denied) return denied;
    return db.tx(async (q) => {
      const { rows } = await q.query(`select value from config where key = 'nextId' for update`);
      const start = Number(rows[0].value);
      await q.query(`update config set value = $1 where key = 'nextId'`, [JSON.stringify(start + ID_BLOCK_SIZE)]);
      return [200, { start, end: start + ID_BLOCK_SIZE - 1 }];
    });
  },

  /**
   * Remove a device (lost or stolen phone, volunteer leaving). Only an active
   * admin can do it, proven by their own PIN checked here on the server; the
   * device stops syncing and erases its patient data next time it connects.
   */
  async 'POST revoke'(db, body) {
    const denied = await gate(db, body);
    if (denied) return denied;
    const { rows } = await db.query('select data from docs where id = $1', [String(body.adminId || '')]);
    const admin = rows[0]?.data;
    if (!admin || admin.type !== 'member' || admin.role !== 'admin' || admin.status !== 'active' || admin.pinHash !== hashPin(body.pin, body.adminId)) {
      return [403, { error: 'Only an admin can remove a device. Check your PIN.' }];
    }
    if (!body.target || body.target === body.deviceId) return [400, { error: 'Choose another device to remove.' }];
    const res = await db.query('update devices set revoked = true where device_id = $1', [body.target]);
    if (!res.rowCount && !res.affectedRows) return [404, { error: 'Device not found' }];
    await db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock(4242)');
      await applyChange(q, { id: 'device:' + body.target, type: 'device', base: Infinity, fields: { revoked: true, revokedAt: Date.now(), revokedBy: body.adminId }, ts: Date.now() }, 'server');
    });
    return [200, { ok: true }];
  },

  async 'POST backup'(db, body) {
    const denied = await gate(db, body);
    if (denied) return denied;
    const { rows } = await db.query('select data, seq from docs order by seq');
    return [200, { hubId: await serverId(db), exportedAt: Date.now(), docs: rows.map(rowToDoc) }];
  },
};

// Device "last seen" for the lead board; written at most every 20 s per phone.
async function heartbeat(q, deviceId, info) {
  const id = 'device:' + deviceId;
  const existing = await loadDoc(q, id);
  const same = existing && Object.entries(info).every(([k, v]) => existing[k] === v);
  if (same && Date.now() - existing.lastSeen < 20000) return;
  await applyChange(q, { id, type: 'device', base: Infinity, fields: { ...info, deviceId, lastSeen: Date.now() }, ts: Date.now() }, 'server');
}

/** Route a request: name like "sync", method "GET"/"POST". */
export async function handle(db, method, name, body) {
  const h = handlers[`${method} ${name}`];
  if (!h) return [404, { error: 'Not found' }];
  try {
    await ensureSchema(db);
    return await h(db, body || {});
  } catch (err) {
    console.error(name, err);
    return [500, { error: 'Server error — changes are kept on the phone and will retry.' }];
  }
}
