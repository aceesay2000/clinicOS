// Clinical defaults. These are starting points for the clinical leads to
// review and adjust before clinic day — they are not a substitute for
// clinical judgement, and a nurse can always mark a patient urgent by hand.

export const STATIONS = [
  { id: 'registration', label: 'Registration' },
  { id: 'vitals', label: 'Vitals' },
  { id: 'doctor', label: 'Doctor' },
  { id: 'pharmacy', label: 'Pharmacy' },
  { id: 'done', label: 'Gone home' },
];

export const ROLES = [
  { id: 'registration', label: 'Registration' },
  { id: 'vitals', label: 'Vitals / triage' },
  { id: 'doctor', label: 'Doctor' },
  { id: 'pharmacy', label: 'Pharmacy' },
  { id: 'lead', label: 'Clinic lead' },
  { id: 'admin', label: 'Admin' },
];

export const COMPLAINTS = [
  'Fever', 'Cough', 'Body pain', 'BP check', 'Diabetes check', 'Eye', 'Skin',
  'Pregnancy', 'Child check', 'Other',
];

export const DIAGNOSES = [
  'Hypertension', 'Malaria', 'Diabetes', 'Resp. infection', 'Musculoskeletal pain',
  'Skin', 'Eye', 'Worms', 'Diarrhoea', 'UTI', 'Anaemia', 'Pain',
];

export const DEFAULT_VILLAGES = [
  'Kerewan', 'Dembo Fula', 'Farafenni', 'Ngayen Sanjal', 'Saba', 'Njaba Kunda',
  'Illiasa', 'Salikenni', 'No Kunda', 'Kinteh Kunda', 'Other',
];

export const HOSPITALS = ['Kerewan Health Centre', 'Farafenni General Hospital', 'Essau', 'Banjul (EFSTH)'];

/** age in years from a visit-time age or a birth year */
export function ageOf(patient, today = new Date()) {
  if (patient?.birthYear) return today.getFullYear() - patient.birthYear;
  return patient?.age ?? null;
}

export function parseAge(text) {
  const t = String(text || '').trim().toLowerCase();
  const months = t.match(/^(?:about\s*)?(\d{1,2})\s*m/);
  if (months) return { age: Math.round((Number(months[1]) / 12) * 100) / 100, approx: t.startsWith('about') };
  const years = t.match(/(\d{1,3})/);
  if (!years) return null;
  return { age: Number(years[1]), approx: /about|~|abt/.test(t) };
}

export function ageLabel(p) {
  const a = ageOf(p);
  if (a == null) return '';
  if (a < 1) return `${Math.round(a * 12)} mo`;
  return String(a);
}

// Each rule returns 'red' (flag + urgent), 'amber' (look again) or null.
export const VITAL_FIELDS = [
  { key: 'bpSys', label: 'BP systolic', unit: 'mmHg' },
  { key: 'bpDia', label: 'BP diastolic', unit: 'mmHg' },
  { key: 'temp', label: 'Temperature', unit: '°C', step: 0.1 },
  { key: 'pulse', label: 'Pulse', unit: '/min' },
  { key: 'spo2', label: 'SpO2', unit: '%' },
  { key: 'rr', label: 'Resp. rate', unit: '/min' },
  { key: 'weight', label: 'Weight', unit: 'kg', step: 0.1 },
  { key: 'height', label: 'Height', unit: 'cm' },
  { key: 'glucose', label: 'Blood glucose', unit: 'mmol/L', step: 0.1 },
  { key: 'muac', label: 'MUAC', unit: 'cm', step: 0.1, under5: true },
];

export function vitalFlag(key, value, age) {
  if (value === '' || value == null || Number.isNaN(Number(value))) return null;
  const v = Number(value);
  const child = age != null && age < 12;
  const infant = age != null && age < 1;
  switch (key) {
    case 'bpSys': return v >= 160 || v < 90 ? 'red' : v >= 140 ? 'amber' : null;
    case 'bpDia': return v >= 100 || v < 50 ? 'red' : v >= 90 ? 'amber' : null;
    case 'temp': return v >= 39 || v < 35 ? 'red' : v >= 37.5 ? 'amber' : null;
    case 'pulse':
      if (infant) return v > 160 || v < 100 ? 'red' : null;
      if (child) return v > 140 || v < 60 ? 'red' : null;
      return v > 120 || v < 50 ? 'red' : v > 100 ? 'amber' : null;
    case 'spo2': return v < 92 ? 'red' : v < 95 ? 'amber' : null;
    case 'rr':
      if (infant) return v > 50 ? 'red' : null;
      if (age != null && age < 5) return v > 40 ? 'red' : null;
      return v > 30 || v < 10 ? 'red' : v > 20 ? 'amber' : null;
    case 'glucose': return v < 3.0 || v > 15 ? 'red' : v > 11 ? 'amber' : null;
    case 'muac': return v < 11.5 ? 'red' : v < 12.5 ? 'amber' : null;
    default: return null;
  }
}

export function redFlags(vitals, age) {
  if (!vitals) return [];
  const out = [];
  for (const f of VITAL_FIELDS) {
    if (vitalFlag(f.key, vitals[f.key], age) === 'red') out.push(f);
  }
  if (vitals.rdt === 'positive') out.push({ key: 'rdt', label: 'Malaria RDT positive' });
  return out;
}

export function bpText(v) {
  return v?.bpSys && v?.bpDia ? `${v.bpSys}/${v.bpDia}` : '—';
}

// ---------- prescribing ----------

// Units counted one by one; quantity = amount × times a day × days.
export const COUNTABLE_UNITS = new Set(['tab', 'cap', 'sachet']);

export const DOSE_TEMPLATES = [
  { label: '1 × once a day × 30 days', amount: 1, perDay: 1, days: 30 },
  { label: '1 × twice a day × 5 days', amount: 1, perDay: 2, days: 5 },
  { label: '1 × 3 a day × 5 days', amount: 1, perDay: 3, days: 5 },
  { label: '2 × 3 a day × 5 days', amount: 2, perDay: 3, days: 5 },
  { label: '1 × once a day × 3 days', amount: 1, perDay: 1, days: 3 },
  { label: 'Single dose', amount: 1, perDay: 1, days: 1 },
];

export function calcQty(item, medicine) {
  if (!COUNTABLE_UNITS.has(medicine?.unit)) return item.qty || 1;
  return Math.max(0, Math.ceil(Number(item.amount || 0) * Number(item.perDay || 0) * Number(item.days || 0)));
}

/** amounts for [morning, midday, night] pictograms; null when it doesn't fit 3 slots */
export function doseSlots(item) {
  const a = item.amount;
  switch (Number(item.perDay)) {
    case 1: return item.slot === 'night' ? [0, 0, a] : [a, 0, 0];
    case 2: return [a, 0, a];
    case 3: return [a, a, a];
    default: return null;
  }
}

const TIMES = { 1: 'once a day', 2: 'twice a day', 3: '3 times a day', 4: '4 times a day' };

export function doseText(item, medicine) {
  const unit = medicine?.unit || 'dose';
  const plural = Number(item.amount) === 1 ? unit : unit + 's';
  const unitWord = { tab: 'tablet', cap: 'capsule' }[unit];
  const u = unitWord ? (Number(item.amount) === 1 ? unitWord : unitWord + 's') : plural;
  const when = Number(item.perDay) === 1 ? (item.slot === 'night' ? 'each night' : 'each morning') : TIMES[item.perDay] || `${item.perDay} times a day`;
  const days = Number(item.days) === 1 ? 'once only' : `for ${item.days} days`;
  return `${item.amount} ${u} ${when}, ${days}`;
}

export function medName(m) {
  return m ? `${m.name}${m.strength ? ' ' + m.strength : ''}` : 'Unknown medicine';
}
