import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcQty, doseSlots, doseText, parseAge, redFlags, vitalFlag } from '../src/lib/clinical.js';
import { parseCSV, toCSV } from '../src/lib/csv.js';

test('quantity = amount × times a day × days for counted units', () => {
  assert.equal(calcQty({ amount: 1, perDay: 3, days: 5 }, { unit: 'tab' }), 15);
  assert.equal(calcQty({ amount: 2, perDay: 3, days: 5 }, { unit: 'tab' }), 30);
  assert.equal(calcQty({ amount: 0.5, perDay: 3, days: 5 }, { unit: 'tab' }), 8, 'half tablets round up');
  assert.equal(calcQty({ amount: 1, perDay: 2, days: 5, qty: 2 }, { unit: 'bottle' }), 2, 'bottles use the given qty');
});

test('dose slots and plain-language instructions', () => {
  assert.deepEqual(doseSlots({ amount: 1, perDay: 1 }), [1, 0, 0]);
  assert.deepEqual(doseSlots({ amount: 1, perDay: 1, slot: 'night' }), [0, 0, 1]);
  assert.deepEqual(doseSlots({ amount: 2, perDay: 3 }), [2, 2, 2]);
  assert.equal(doseText({ amount: 1, perDay: 1, days: 30 }, { unit: 'tab' }), '1 tablet each morning, for 30 days');
  assert.equal(doseText({ amount: 2, perDay: 3, days: 5 }, { unit: 'tab' }), '2 tablets 3 times a day, for 5 days');
});

test('wireframe example BP 168/102 is flagged red', () => {
  assert.equal(vitalFlag('bpSys', 168, 52), 'red');
  assert.equal(vitalFlag('bpDia', 102, 52), 'red');
  assert.equal(vitalFlag('temp', 37.1, 52), null);
  const flags = redFlags({ bpSys: 168, bpDia: 102, temp: 37.1, pulse: 88, spo2: 97 }, 52);
  assert.deepEqual(flags.map((f) => f.key), ['bpSys', 'bpDia']);
  assert.equal(vitalFlag('muac', 11.0, 2), 'red');
  assert.equal(vitalFlag('pulse', 130, 3), null, 'child pulse range differs from adult');
});

test('ages: "about 40" and months', () => {
  assert.deepEqual(parseAge('about 40'), { age: 40, approx: true });
  assert.deepEqual(parseAge('34'), { age: 34, approx: false });
  assert.equal(parseAge('8m').age, 0.67);
  assert.equal(parseAge(''), null);
});

test('CSV round trip with quotes and commas', () => {
  const csv = toCSV([{ name: 'Amoxicillin, 250', note: 'say "hi"' }]);
  assert.deepEqual(parseCSV(csv), [{ name: 'Amoxicillin, 250', note: 'say "hi"' }]);
});
