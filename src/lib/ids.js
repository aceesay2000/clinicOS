// Patient card numbers (DFC-0001). The hub hands each registration tablet a
// block of numbers, so two desks never issue the same number even when they
// are both offline. A pre-printed card number can always be typed in instead.

import * as db from '../db/local.js';
import * as sync from '../db/sync.js';
import { patients, idNumber } from './model.js';

const LOW_WATER = 20;

export async function idBlocks() {
  return (await db.getMeta('idBlocks')) || [];
}

function usedNumbers() {
  return new Set(patients().map((p) => idNumber(p.clinicId)));
}

export async function nextClinicNumber() {
  const used = usedNumbers();
  for (const b of await idBlocks()) {
    for (let n = b.start; n <= b.end; n++) if (!used.has(n)) return n;
  }
  return null;
}

export async function remainingNumbers() {
  const used = usedNumbers();
  let left = 0;
  for (const b of await idBlocks()) for (let n = b.start; n <= b.end; n++) if (!used.has(n)) left++;
  return left;
}

/** Top up the block when running low. Silently does nothing while offline. */
export async function ensureIdBlock() {
  if ((await remainingNumbers()) >= LOW_WATER) return;
  try {
    const block = await sync.requestIdBlock();
    await db.setMeta('idBlocks', [...(await idBlocks()), block]);
  } catch {
    // offline or unpaired — try again on the next registration
  }
}
