// On-device database. Every write lands in IndexedDB (docs + outbox, in one
// transaction) before anything else happens, so a record survives a dead
// battery, a page reload or a lost Wi-Fi signal. The outbox holds the fields
// changed since the last successful sync; sync.js replays it to the hub.
//
// All docs are also kept in memory so screens can query synchronously and
// re-render on every change (a full clinic day is only a few MB).

const DB_NAME = 'clinic-os';
const DB_VERSION = 1;

let idb;
const docs = new Map();
const listeners = new Set();
let version = 0;

export function uuid() {
  // crypto.randomUUID only exists in secure contexts (not on plain-http local runs).
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

let persistent = true;
/** False when the browser refused storage and records live only in memory. */
export const isPersistent = () => persistent;

export async function openDB() {
  try {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      db.createObjectStore('docs', { keyPath: 'id' });
      db.createObjectStore('outbox', { keyPath: 'id' });
      db.createObjectStore('meta');
    };
    idb = await Promise.race([req(open), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 4000))]);
  } catch {
    // Private windows and some embedded views block storage. Keep working,
    // but the app warns loudly that nothing survives closing the page.
    persistent = false;
    idb = memoryDB();
  }
  const all = await req(idb.transaction('docs').objectStore('docs').getAll());
  for (const d of all) docs.set(d.id, d);
  // Ask the browser not to evict our data under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
  notify();
}

/** Minimal in-memory stand-in with the slice of the IndexedDB API used here. */
function memoryDB() {
  const stores = { docs: new Map(), outbox: new Map(), meta: new Map() };
  const keyPaths = { docs: 'id', outbox: 'id', meta: null };
  return {
    transaction(names) {
      const tx = {};
      let open = 0;
      const finish = () => setTimeout(() => open === 0 && tx.oncomplete?.(), 0);
      const request = (fn) => {
        const r = {};
        open++;
        queueMicrotask(() => {
          r.result = fn();
          r.onsuccess?.();
          open--;
          finish();
        });
        return r;
      };
      tx.objectStore = (name) => {
        const m = stores[name], kp = keyPaths[name];
        return {
          get: (k) => request(() => structuredClone(m.get(k))),
          getAll: () => request(() => [...m.values()].map((v) => structuredClone(v))),
          count: () => request(() => m.size),
          put: (v, k) => request(() => m.set(kp ? v[kp] : k, structuredClone(v))),
          delete: (k) => request(() => m.delete(k)),
          clear: () => request(() => m.clear()),
        };
      };
      finish();
      return tx;
    },
  };
}

// ---------- meta (device settings) ----------

export async function getMeta(key) {
  return req(idb.transaction('meta').objectStore('meta').get(key));
}

export async function setMeta(key, value) {
  const tx = idb.transaction('meta', 'readwrite');
  tx.objectStore('meta').put(value, key);
  await done(tx);
}

// ---------- reads ----------

export const get = (id) => docs.get(id);
export const all = (type) => {
  const out = [];
  for (const d of docs.values()) if (!type || d.type === type) out.push(d);
  return out;
};
export const getVersion = () => version;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  version++;
  for (const fn of listeners) fn(version);
}

// ---------- writes ----------

let deviceId = null;
export const setDeviceId = (id) => (deviceId = id);

// Server time minus this phone's clock, learned on each sync. Volunteers'
// phones are not always set to the right time; wait times and "newest edit
// wins" both rely on timestamps that agree across phones.
let clockOffset = 0;
export const setClockOffset = (ms) => { if (Number.isFinite(ms)) clockOffset = Math.round(ms); };
export const now = () => Date.now() + clockOffset;

/**
 * Create or update a record. Only `fields` are changed; other fields are kept.
 * Returns the saved doc. Resolves once the change is durable on this device.
 */
export async function put(type, id, fields) {
  id ||= uuid();
  const ts = now();
  const prev = docs.get(id);
  const change = { ...fields, updatedAt: ts, updatedBy: deviceId };
  if (!prev) change.createdAt = fields.createdAt || ts;
  const doc = { ...(prev || { id, type }), ...change };
  docs.set(id, doc);

  const tx = idb.transaction(['docs', 'outbox'], 'readwrite');
  const outbox = tx.objectStore('outbox');
  const pending = await req(outbox.get(id));
  outbox.put({
    id, type,
    base: pending ? pending.base : prev?._seq || 0,
    fields: { ...(pending?.fields || {}), ...change },
    ts,
  });
  tx.objectStore('docs').put(doc);
  await done(tx);
  notify();
  return doc;
}

export async function putMany(items) {
  for (const { type, id, fields } of items) await put(type, id, fields);
}

// ---------- used by sync ----------

export async function readOutbox() {
  return req(idb.transaction('outbox').objectStore('outbox').getAll());
}

export async function pendingCount() {
  return req(idb.transaction('outbox').objectStore('outbox').count());
}

/**
 * After a sync round trip: drop outbox entries the server accepted (unless edited
 * again meanwhile), then apply the server's docs. Local unsynced fields stay on top.
 */
export async function applySync(sent, incoming) {
  const tx = idb.transaction(['docs', 'outbox'], 'readwrite');
  const outbox = tx.objectStore('outbox');
  const store = tx.objectStore('docs');
  for (const s of sent) {
    const cur = await req(outbox.get(s.id));
    if (cur && cur.ts === s.ts) outbox.delete(s.id);
  }
  for (const doc of incoming) {
    const pending = await req(outbox.get(doc.id));
    const merged = pending ? { ...doc, ...pending.fields } : doc;
    docs.set(doc.id, merged);
    store.put(merged);
  }
  await done(tx);
  if (incoming.length) notify();
}

/** Remove every record from this phone (after the server backup is confirmed). */
export async function wipe() {
  const tx = idb.transaction(['docs', 'outbox', 'meta'], 'readwrite');
  tx.objectStore('docs').clear();
  tx.objectStore('outbox').clear();
  tx.objectStore('meta').clear();
  await done(tx);
  docs.clear();
  notify();
}
