import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openLocal } from '../server/db.js';
import { handle } from '../server/api.js';
import { merge } from '../server/merge.js';

process.env.CLINIC_CODE = '246810';

async function setup() {
  const db = await openLocal('memory://');
  const call = async (name, body, method = 'POST') => {
    const [status, json] = await handle(db, method, name, body);
    return { status, ...json };
  };
  const phone = async (deviceId) => {
    const { token, hubId } = await call('pair', { code: '246810', deviceId, name: deviceId });
    let since = 0;
    return {
      async sync(changes = []) {
        const r = await call('sync', { deviceId, token, hubId, since, changes });
        since = r.seq;
        return r;
      },
      token, deviceId,
    };
  };
  return { db, call, phone };
}

const conflicts = (docs) => docs.filter((d) => d.type === 'conflict');

test('pairing needs the right clinic code', async () => {
  const { call } = await setup();
  assert.equal((await call('pair', { code: '000000', deviceId: 'x' })).status, 403);
  const ok = await call('pair', { code: '246810', deviceId: 'x' });
  assert.equal(ok.status, 200);
  assert.ok(ok.token && ok.hubId);
  assert.equal((await call('sync', { deviceId: 'x', token: 'wrong' })).status, 401);
});

test('a record from one phone reaches another phone', async () => {
  const { phone } = await setup();
  const a = await phone('A'), b = await phone('B');
  await a.sync([{ id: 'p1', type: 'patient', base: 0, fields: { name: 'Fatou Jallow' }, ts: 1 }]);
  const r = await b.sync();
  assert.equal(r.docs.find((d) => d.id === 'p1').name, 'Fatou Jallow');
  assert.equal((await b.sync()).docs.length, 0, 'nothing new on the next sync');
});

test('different fields from two phones merge without conflict', async () => {
  const { phone } = await setup();
  const a = await phone('A'), b = await phone('B');
  const r1 = await a.sync([{ id: 'v1', type: 'visit', base: 0, fields: { station: 'vitals', complaints: ['Fever'] }, ts: 1 }]);
  const base = r1.docs.find((d) => d.id === 'v1')._seq;
  await a.sync([{ id: 'v1', type: 'visit', base, fields: { urgent: true }, ts: 2 }]);
  const r = await b.sync([{ id: 'v1', type: 'visit', base, fields: { complaints: ['Fever', 'Cough'] }, ts: 3 }]);
  const v = r.docs.filter((d) => d.id === 'v1').at(-1);
  assert.equal(v.urgent, true);
  assert.deepEqual(v.complaints, ['Fever', 'Cough']);
  assert.equal(conflicts(r.docs).length, 0);
});

test('same field edited on two phones while one was offline keeps both versions', async () => {
  const { phone } = await setup();
  const a = await phone('A'), b = await phone('B');
  const r1 = await a.sync([{ id: 'c1', type: 'consult', base: 0, fields: { notes: 'start' }, ts: 1 }]);
  const base = r1.docs.find((d) => d.id === 'c1')._seq;
  await a.sync([{ id: 'c1', type: 'consult', base, fields: { notes: 'from A' }, ts: 10 }]);
  const r = await b.sync([{ id: 'c1', type: 'consult', base, fields: { notes: 'from B (offline)' }, ts: 5 }]);
  assert.equal(r.docs.filter((d) => d.id === 'c1').at(-1).notes, 'from A', 'newest edit shows for now');
  const c = conflicts(r.docs);
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].values.map((v) => v.value), ['from A', 'from B (offline)']);
});

test('resending the same changes after a lost reply changes nothing', async () => {
  const { phone, call } = await setup();
  const a = await phone('A');
  const ch = [{ id: 'p1', type: 'patient', base: 0, fields: { name: 'Fatou' }, ts: 1 }];
  const r1 = await a.sync(ch);
  const r2 = await a.sync(ch);
  assert.equal(r2.docs.length, 0);
  const backup = await call('backup', { deviceId: 'A', token: a.token });
  assert.equal(backup.docs.filter((d) => d.type === 'patient').length, 1);
  assert.ok(r1.seq > 0);
});

test('two phones syncing at the same moment never skip records', async () => {
  const { phone } = await setup();
  const phones = await Promise.all(['A', 'B', 'C', 'D'].map(phone));
  const reader = await phone('R');
  await Promise.all(phones.map((p, i) => p.sync(
    Array.from({ length: 25 }, (_, k) => ({ id: `mv-${i}-${k}`, type: 'movement', base: 0, fields: { qty: k }, ts: k })),
  )));
  const seen = new Set();
  let r;
  do { r = await reader.sync(); r.docs.forEach((d) => seen.add(d.id)); } while (r.more);
  assert.equal([...seen].filter((id) => id.startsWith('mv-')).length, 100);
});

test('card-number blocks never overlap', async () => {
  const { phone, call } = await setup();
  const a = await phone('A'), b = await phone('B');
  const [x, y] = await Promise.all([
    call('idblock', { deviceId: 'A', token: a.token }),
    call('idblock', { deviceId: 'B', token: b.token }),
  ]);
  assert.ok(x.end < y.start || y.end < x.start);
});

test('merge: workflow fields never raise conflicts', () => {
  const existing = { id: 'v1', type: 'visit', station: 'doctor', _f: { station: [5, 2, 'A'] }, _seq: 5 };
  const r = merge(existing, { id: 'v1', type: 'visit', base: 1, fields: { station: 'pharmacy' }, ts: 3 }, 'B');
  assert.equal(r.doc.station, 'pharmacy');
  assert.equal(r.conflicts.length, 0);
});

test('only an active admin with the right PIN can remove a device; removed devices are cut off', async () => {
  const { hashPin } = await import('../src/lib/pin.js');
  const { phone, call } = await setup();
  const a = await phone('A'), b = await phone('B');
  const adminId = 'member:admin-1', volId = 'member:vol-1';
  await a.sync([
    { id: adminId, type: 'member', base: 0, fields: { name: 'Admin', role: 'admin', status: 'active', pinHash: hashPin('2468', adminId) }, ts: 1 },
    { id: volId, type: 'member', base: 0, fields: { name: 'Vol', role: 'volunteer', status: 'active', pinHash: hashPin('1357', volId) }, ts: 1 },
  ]);
  const revoke = (adminIdArg, pin) => call('revoke', { deviceId: 'A', token: a.token, target: 'B', adminId: adminIdArg, pin });
  assert.equal((await revoke(adminId, '0000')).status, 403, 'wrong PIN refused');
  assert.equal((await revoke(volId, '1357')).status, 403, 'a volunteer cannot remove devices');
  assert.equal((await revoke(adminId, '2468')).status, 200);
  const r = await b.sync();
  assert.equal(r.status, 410);
  assert.equal(r.revoked, true);
  assert.equal((await call('idblock', { deviceId: 'B', token: b.token })).status, 410);
  const dev = (await a.sync()).docs.find((d) => d.id === 'device:B');
  assert.equal(dev.revoked, true, 'admins see the device as removed');
  // Setting the device up again with the clinic code lets it back in.
  const again = await call('pair', { code: '246810', deviceId: 'B', name: 'B' });
  assert.equal((await call('sync', { deviceId: 'B', token: again.token })).status, 200);
  assert.equal((await a.sync()).docs.find((d) => d.id === 'device:B').revoked, false, 'shows as active again');
});
