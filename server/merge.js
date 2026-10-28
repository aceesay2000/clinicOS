// Field-level merge of one change from a phone into the stored record.
//
// Each stored field remembers the sequence number, timestamp and device of its
// last write, so two stations writing different fields of the same record
// merge cleanly. If two phones change the *same* field concurrently (the
// second writer had not seen the first write yet), the newest write wins for
// now and a conflict is returned with both values so the admin can review it.
// Nothing is silently lost.

// Workflow fields that many stations legitimately move; last write wins, no review.
const NO_REVIEW_FIELDS = new Set(['station', 'status', 'stationSince', 'packed', 'updatedAt', 'updatedBy', 'byUser']);
// Append-only / ephemeral record types never conflict.
const NO_REVIEW_TYPES = new Set(['event', 'movement', 'device', 'conflict']);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * existing: stored doc ({ id, type, ...fields, _seq, _f }) or undefined
 * change:   { id, type, base, fields, ts } — base is the _seq the phone last saw
 * Returns { doc, changed, conflicts }. When `changed`, the caller assigns a new
 * sequence number with stamp(doc, seq).
 */
export function merge(existing, change, deviceId) {
  const { id, type, base = 0, fields = {}, ts = Date.now() } = change;
  if (!id || !type) throw new Error('change needs id and type');
  const doc = existing ? { ...existing, _f: { ...existing._f } } : { id, type, _f: {} };
  const conflicts = [];
  const changed = [];

  for (const [field, value] of Object.entries(fields)) {
    if (field === 'id' || field === 'type' || field.startsWith('_')) continue;
    const meta = doc._f[field];
    if (meta && same(doc[field], value)) continue;
    if (meta) {
      const [fSeq, fTs, fDev] = meta;
      if (fSeq > base && fDev !== deviceId) {
        const incomingWins = ts >= fTs;
        if (!NO_REVIEW_TYPES.has(type) && !NO_REVIEW_FIELDS.has(field)) {
          conflicts.push({
            docId: id, docType: type, field,
            values: [{ value: doc[field], deviceId: fDev, ts: fTs }, { value, deviceId, ts }],
            kept: incomingWins ? 1 : 0,
          });
        }
        if (!incomingWins) continue;
      }
    }
    doc[field] = value;
    doc._f[field] = [null, ts, deviceId];
    changed.push(field);
  }
  return { doc, changed: changed.length > 0, changedFields: changed, conflicts };
}

/** Give a merged doc its new sequence number (also on the fields it changed). */
export function stamp(doc, seq, changedFields) {
  doc._seq = seq;
  for (const f of changedFields) doc._f[f] = [seq, doc._f[f][1], doc._f[f][2]];
  return doc;
}
