import { useEffect, useState, useSyncExternalStore } from 'react';
import * as db from './db/local.js';
import * as sync from './db/sync.js';

/** Re-render whenever any local record changes (local edit or synced in). */
export function useDB() {
  return useSyncExternalStore(db.subscribe, db.getVersion);
}

export function useSyncStatus() {
  const [s, set] = useState(sync.getStatus());
  useEffect(() => sync.onStatus(set), []);
  return s;
}

/** Ticks so "waiting 12 min" labels stay current. */
export function useNow(ms = 30000) {
  const [now, set] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => set(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
