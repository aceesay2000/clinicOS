import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../hub/store.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'clinicos-'));

test('different fields from two tablets merge without conflict', () => {
  const s = new Store(tmp());
  s.apply({ id: 'v1', type: 'visit', base: 0, fields: { station: 'vitals', complaints: ['Fever'] }, ts: 1 }, 'A');
  const seq = s.seq;
  s.apply({ id: 'v1', type: 'visit', base: seq, fields: { urgent: true }, ts: 2 }, 'B');
  s.apply({ id: 'v1', type: 'visit', base: seq, fields: { complaints: ['Fever', 'Cough'] }, ts: 3 }, 'C');
  const doc = s.docs.get('v1');
  assert.equal(doc.urgent, true);
  assert.deepEqual(doc.complaints, ['Fever', 'Cough']);
  assert.equal([...s.docs.values()].filter((d) => d.type === 'conflict').length, 0);
});

test('same field edited concurrently keeps both values in a conflict record', () => {
  const s = new Store(tmp());
  s.apply({ id: 'c1', type: 'consult', base: 0, fields: { notes: 'start' }, ts: 1 }, 'A');
  const base = s.seq;
  s.apply({ id: 'c1', type: 'consult', base, fields: { notes: 'from A' }, ts: 10 }, 'A');
  s.apply({ id: 'c1', type: 'consult', base, fields: { notes: 'from B' }, ts: 5 }, 'B'); // B had not seen A's edit
  const doc = s.docs.get('c1');
  assert.equal(doc.notes, 'from A', 'newest edit wins for now');
  const conflicts = [...s.docs.values()].filter((d) => d.type === 'conflict');
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].values.map((v) => v.value), ['from A', 'from B']);
});

test('an edit made after seeing the latest version is not a conflict', () => {
  const s = new Store(tmp());
  s.apply({ id: 'c1', type: 'consult', base: 0, fields: { notes: 'a' }, ts: 1 }, 'A');
  s.apply({ id: 'c1', type: 'consult', base: s.seq, fields: { notes: 'b' }, ts: 2 }, 'B');
  assert.equal(s.docs.get('c1').notes, 'b');
  assert.equal([...s.docs.values()].filter((d) => d.type === 'conflict').length, 0);
});

test('workflow fields (station) never raise conflicts', () => {
  const s = new Store(tmp());
  s.apply({ id: 'v1', type: 'visit', base: 0, fields: { station: 'vitals' }, ts: 1 }, 'A');
  const base = s.seq;
  s.apply({ id: 'v1', type: 'visit', base, fields: { station: 'doctor' }, ts: 2 }, 'A');
  s.apply({ id: 'v1', type: 'visit', base, fields: { station: 'pharmacy' }, ts: 3 }, 'B');
  assert.equal(s.docs.get('v1').station, 'pharmacy');
  assert.equal([...s.docs.values()].filter((d) => d.type === 'conflict').length, 0);
});

test('replaying the same change is idempotent', () => {
  const s = new Store(tmp());
  const ch = { id: 'p1', type: 'patient', base: 0, fields: { name: 'Fatou' }, ts: 1 };
  s.apply(ch, 'A');
  const seq = s.seq;
  s.apply(ch, 'A'); // e.g. response lost, tablet resends
  assert.equal(s.seq, seq);
});

test('records survive a hub restart, including a torn last line', () => {
  const dir = tmp();
  const s = new Store(dir);
  s.apply({ id: 'p1', type: 'patient', base: 0, fields: { name: 'Fatou' }, ts: 1 }, 'A');
  s.apply({ id: 'p2', type: 'patient', base: 0, fields: { name: 'Lamin' }, ts: 2 }, 'A');
  s.flush();
  fs.appendFileSync(path.join(dir, 'clinic-log.jsonl'), '{"id":"p3","ty'); // power cut mid-write
  const s2 = new Store(dir);
  assert.equal(s2.docs.get('p1').name, 'Fatou');
  assert.equal(s2.docs.get('p2').name, 'Lamin');
  assert.equal(s2.seq, s.seq);
});

test('changesSince pages through large backlogs in order', () => {
  const s = new Store(tmp());
  for (let i = 0; i < 25; i++) s.apply({ id: 'm' + i, type: 'movement', base: 0, fields: { qty: i }, ts: i }, 'A');
  const p1 = s.changesSince(0, 10);
  assert.equal(p1.docs.length, 10);
  assert.equal(p1.more, true);
  const p2 = s.changesSince(p1.docs.at(-1)._seq, 100);
  assert.equal(p2.docs.length, 15);
  assert.equal(p2.more, false);
  assert.ok(!('_f' in p2.docs[0]), 'field metadata stays on the hub');
});
