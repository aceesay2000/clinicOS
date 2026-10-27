// Sync engine: pushes the outbox to the clinic server and pulls everything new.
//
// Every request carries the phone's token, and the server's identity is
// checked on each reply. Whenever the server can't be reached (no signal,
// Wi-Fi down, generator off), changes stay queued on the phone and are sent
// automatically when the connection is back.

import * as db from './local.js';

const TIMEOUT_MS = 8000;

let config = null; // { hubUrl ('' = this site), hubId (server id), token, deviceId, name, station }
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
      const err = new Error(data.error || `Server replied ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

/** Register this phone with the clinic server. Returns { hubUrl, hubId, token }. */
export async function pair(hubBase, code, deviceId, name) {
  const base = hubBase.replace(/\/$/, '');
  const hello = await call(null, null, base + '/api/hello');
  if (hello.app !== 'clinic-os') throw new Error('That address is not a ClinicOS server');
  const res = await call(null, { code, deviceId, name }, base + '/api/pair');
  return { hubUrl: base, hubId: res.hubId, token: res.token };
}

export async function requestIdBlock() {
  return call('/api/idblock', { deviceId: config.deviceId, token: config.token });
}

export async function fetchBackup() {
  return call('/api/backup', { deviceId: config.deviceId, token: config.token });
}

// Polling pace: quick while the clinic is busy, slower when nothing is
// happening, and paused while the screen is off (saves battery and server calls).
const ACTIVE_MS = 3000;
const IDLE_MS = 6000;
const ACTIVE_WINDOW_MS = 60000;
const HEARTBEAT_MS = 20000;
const CHUNK = 300;
let lastActivity = 0;
let lastHeartbeat = 0;

export async function syncNow() {
  if (running || !config?.token) return;
  running = true;
  clearTimeout(timer);
  try {
    if (status.state !== 'synced' || status.pending) setStatus({ state: 'syncing' });
    let more = true;
    while (more) {
      const since = (await db.getMeta('since')) || 0;
      const changes = (await db.readOutbox()).slice(0, CHUNK);
      const beat = Date.now() - lastHeartbeat > HEARTBEAT_MS;
      const sentAt = Date.now();
      const res = await call('/api/sync', {
        deviceId: config.deviceId,
        token: config.token,
        hubId: config.hubId,
        since,
        changes,
        device: beat ? { name: config.name, station: config.station } : undefined,
      });
      if (res.hubId !== config.hubId) throw new Error('Connected to a different clinic server — changes kept on this phone');
      if (beat) lastHeartbeat = Date.now();
      // Keep timestamps consistent across phones whose clocks disagree.
      if (res.time) db.setClockOffset(res.time - (sentAt + Date.now()) / 2);
      await db.applySync(changes, res.docs);
      await db.setMeta('since', res.seq);
      if (changes.length || res.docs.some((d) => d.type !== 'device')) lastActivity = Date.now();
      more = res.more || changes.length === CHUNK;
    }
    const pending = await db.pendingCount();
    setStatus({ state: pending ? 'syncing' : 'synced', pending, lastSync: Date.now(), message: '' });
  } catch (err) {
    const pending = await db.pendingCount().catch(() => status.pending);
    const offline = err.name === 'AbortError' || err instanceof TypeError;
    setStatus({
      state: offline ? 'offline' : 'error',
      pending,
      message: offline ? 'No connection — saving on this phone' : err.message,
    });
  } finally {
    running = false;
    schedule();
  }
}

function schedule() {
  clearTimeout(timer);
  if (!config?.token || document.visibilityState === 'hidden') return;
  const busy = Date.now() - lastActivity < ACTIVE_WINDOW_MS;
  timer = setTimeout(syncNow, busy ? ACTIVE_MS : IDLE_MS);
}

function onVisible() {
  if (document.visibilityState === 'visible') syncNow();
}

export function start() {
  stop();
  if (!config?.token) {
    setStatus({ state: 'unpaired' });
    return;
  }
  syncNow();
  window.addEventListener('online', syncNow);
  document.addEventListener('visibilitychange', onVisible);
  unsubscribe = db.subscribe(onLocalChange);
}

export function stop() {
  clearTimeout(timer);
  window.removeEventListener('online', syncNow);
  document.removeEventListener('visibilitychange', onVisible);
  unsubscribe?.();
}

let debounce;
function onLocalChange() {
  db.pendingCount().then((pending) => {
    setStatus({ pending });
    if (!pending) return;
    // Push local edits quickly so other stations see them within a couple of seconds.
    lastActivity = Date.now();
    clearTimeout(debounce);
    debounce = setTimeout(syncNow, 300);
  });
}
