import { parseCSV } from './csv.js';
import * as M from './model.js';

/** Load formulary + starting stock rows (columns as in SAMPLE_FORMULARY). */
export async function importFormulary(text) {
  const rows = parseCSV(text);
  const existing = M.medicines();
  let added = 0, updated = 0;
  for (const r of rows) {
    if (!r.name) continue;
    const fields = {
      name: r.name, strength: r.strength || '', form: r.form || '', unit: (r.unit || 'tab').toLowerCase(),
      batch: r.batch || '', expiry: r.expiry || '', lowThreshold: Number(r.low_threshold) || 0,
      alternatives: (r.alternatives || '').split(/[;|]/).map((s) => s.trim()).filter(Boolean),
    };
    const match = existing.find((m) => m.name.toLowerCase() === fields.name.toLowerCase()
      && (m.strength || '') === fields.strength && (m.batch || '') === fields.batch);
    // Re-importing an existing line updates its details but never adds its starting stock twice.
    await M.saveMedicine(match?.id, fields, match ? 0 : Number(r.starting_count) || 0);
    match ? updated++ : added++;
  }
  return { added, updated };
}
