// Hub document store: master copy of every record for the clinic day.
//
// Tablets send *field-level* changes. Each field on the hub remembers the hub
// sequence number, timestamp and device of its last write, so two stations
// writing different fields of the same record merge cleanly. If two devices
// change the *same* field concurrently (the second writer had not seen the
// first write yet), the newest write wins for now and a `conflict` record is
// created with both values so the admin can review it. Nothing is silently lost.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Workflow fields that many stations legitimately move; last write wins, no review.
const NO_REVIEW_FIELDS = new Set(['station', 'status', 'stationSince', 'packed', 'updatedAt', 'updatedBy']);
// Append-only / ephemeral record types never conflict.
const NO_REVIEW_TYPES = new Set(['event', 'movement', 'device', 'conflict']);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.logFile = path.join(dataDir, 'clinic-log.jsonl');
    this.docs = new Map();
    this.seq = 0;
    fs.mkdirSync(dataDir, { recursive: true });
    this.load();
    this.log = fs.openSync(this.logFile, 'a');
  }

  load() {
    if (!fs.existsSync(this.logFile)) return;
    const lines = fs.readFileSync(this.logFile, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const doc = JSON.parse(line);
        this.docs.set(doc.id, doc);
        if (doc._seq > this.seq) this.seq = doc._seq;
      } catch {
        // A torn final line after a power cut: skip it, everything before is intact.
      }
    }
  }

  persist(doc) {
    // Device heartbeats are ephemeral and would bloat the log.
    if (doc.type === 'device') return;
    fs.writeSync(this.log, JSON.stringify(doc) + '\n');
  }

  flush() {
    fs.fsyncSync(this.log);
  }

  /**
   * Apply one change from a device.
   * change = { id, type, base, fields, ts }
   *   base:   the hub _seq of this doc the device last saw (0 = never seen)
   *   fields: only the fields the device changed
   *   ts:     device time (ms) of the latest edit
   */
  apply(change, deviceId) {
    const { id, type, base = 0, fields = {}, ts = Date.now() } = change;
    if (!id || !type) throw new Error('change needs id and type');
    const existing = this.docs.get(id);
    const doc = existing ? { ...existing, _f: { ...existing._f } } : { id, type, _f: {} };
    const conflicts = [];
    let changed = false;

    for (const [field, value] of Object.entries(fields)) {
      if (field === 'id' || field === 'type' || field.startsWith('_')) continue;
      const meta = doc._f[field];
      if (meta && same(doc[field], value)) continue;
      if (meta) {
        const [fSeq, fTs, fDev] = meta;
        const concurrent = fSeq > base && fDev !== deviceId;
        if (concurrent) {
          const reviewable = !NO_REVIEW_TYPES.has(type) && !NO_REVIEW_FIELDS.has(field);
          const incomingWins = ts >= fTs;
          if (reviewable) {
            conflicts.push({
              docId: id, docType: type, field,
              values: [
                { value: doc[field], deviceId: fDev, ts: fTs },
                { value, deviceId, ts },
              ],
              kept: incomingWins ? 1 : 0,
            });
          }
          if (!incomingWins) continue;
        }
      }
      doc[field] = value;
      doc._f[field] = [this.seq + 1, ts, deviceId];
      changed = true;
    }

    if (changed) {
      doc._seq = ++this.seq;
      this.docs.set(id, doc);
      this.persist(doc);
    }
    for (const c of conflicts) this.putConflict(c);
    return { doc: this.docs.get(id), conflicts };
  }

  putConflict(c) {
    const doc = {
      id: 'conflict:' + crypto.randomUUID(), type: 'conflict', ...c,
      resolved: false, createdAt: Date.now(), _f: {}, _seq: ++this.seq,
    };
    this.docs.set(doc.id, doc);
    this.persist(doc);
  }

  /** Server-side write (heartbeats, admin actions on the hub). */
  putLocal(id, type, fields) {
    return this.apply({ id, type, base: Infinity, fields, ts: Date.now() }, 'hub');
  }

  changesSince(since, limit = 2000) {
    const out = [];
    for (const doc of this.docs.values()) if (doc._seq > since) out.push(doc);
    out.sort((a, b) => a._seq - b._seq);
    const page = out.slice(0, limit);
    return { docs: page.map(stripMeta), more: out.length > limit };
  }

  all() {
    return [...this.docs.values()].map(stripMeta);
  }
}

export function stripMeta(doc) {
  const { _f, ...rest } = doc;
  return rest;
}
