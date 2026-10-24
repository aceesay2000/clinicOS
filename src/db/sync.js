// Sync engine: pushes the outbox to the paired hub and pulls everything new.
//
// Data only ever leaves the tablet for the hub it was paired with: every
// request carries the device token, and the hub's identity is checked on each
// response, so joining a different network (or a different hub) just keeps
// the changes queued on the tablet until the clinic hub is back.

import * as db from './local.js';

const INTERVAL_MS = 3000;
const TIMEOUT_MS = 8000;

let config = null; // { hubUrl, hubId, token, deviceId, name, station }
let timer = null;
let unsubscribe = null;
let running = false;
const listeners = new Set();

const status = {
  state: 'offline', // 'synced' | 'syncing' | 'offline' | 'error' | 'unpaired'
  pending: 0,
  lastSync: null,
  message: '',
};

export const getStatus = () => ({ ...status });
export function onStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function setStatus(patch) {
  Object.assign(status, patch);
  for (const fn of listeners) fn(getStatus());
}

export function configure(cfg) {
  config = cfg;
}

function hubUrl(path) {
  return (config?.hubUrl || '').replace(/\/$/, '') + path;
}

async function call(path, body, url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url || hubUrl(path), {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Hub replied ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

/** Pair this tablet with a hub. Returns { hubId, token }. */
export async function pair(hubBase, code, deviceId, name) {
  const base = hubBase.replace(/\/$/, '');
  const hello = await call(null, null, base + '/api/hello');
  if (hello.app !== 'clinic-os') throw new Error('That address is not a ClinicOS hub');
  const res = await call(null, { code, deviceId, name }, base + '/api/pair');
  return { hubUrl: base, hubId: res.hubId, token: res.token };
}

export async function requestIdBlock() {
  return call('/api/idblock', { deviceId: config.deviceId, token: config.token });
}

export async function fetchBackup() {
  return call('/api/backup', { deviceId: config.deviceId, token: config.token });
}

export async function syncNow() {
  if (running || !config?.token) return;
  running = true;
  try {
    if (status.state !== 'synced' || status.pending) setStatus({ state: 'syncing' });
    let more = true;
    let first = true;
    while (more) {
      const since = (await db.getMeta('since')) || 0;
      const changes = first ? await db.readOutbox() : [];
      const res = await call('/api/sync', {
        deviceId: config.deviceId,
        token: config.token,
        hubId: config.hubId,
        since,
        changes,
        device: { name: config.name, station: config.station },
      });
      if (res.hubId !== config.hubId) throw new Error('Connected to a different hub — changes kept on this tablet');
      await db.applySync(changes, res.docs);
      await db.setMeta('since', res.seq);
      more = res.more;
      first = false;
    }
    const pending = await db.pendingCount();
    setStatus({ state: pending ? 'syncing' : 'synced', pending, lastSync: Date.now(), message: '' });
  } catch (err) {
    const pending = await db.pendingCount().catch(() => status.pending);
    const offline = err.name === 'AbortError' || err instanceof TypeError;
    setStatus({
      state: offline ? 'offline' : 'error',
      pending,
      message: offline ? 'Hub not reachable — saving on this tablet' : err.message,
    });
  } finally {
    running = false;
  }
}

export function start() {
  stop();
  if (!config?.token) {
    setStatus({ state: 'unpaired' });
    return;
  }
  syncNow();
  timer = setInterval(syncNow, INTERVAL_MS);
  window.addEventListener('online', syncNow);
  unsubscribe = db.subscribe(onLocalChange);
}

export function stop() {
  clearInterval(timer);
  window.removeEventListener('online', syncNow);
  unsubscribe?.();
}

let debounce;
function onLocalChange() {
  db.pendingCount().then((pending) => setStatus({ pending }));
  // Push local edits quickly so other stations see them within a couple of seconds.
  clearTimeout(debounce);
  debounce = setTimeout(syncNow, 300);
}
