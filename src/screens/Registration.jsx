import { useEffect, useState } from 'react';
import { useDB } from '../hooks.js';
import * as M from '../lib/model.js';
import { COMPLAINTS, ageLabel, parseAge } from '../lib/clinical.js';
import { ensureIdBlock, nextClinicNumber, remainingNumbers } from '../lib/ids.js';
import { Chips, QR, Scanner, Seg, SyncBadge, useConfirm, useToast } from '../components/ui.jsx';

const EMPTY = { name: '', sex: '', ageText: '', phone: '', household: '', village: '', guardian: '' };

export default function Registration() {
  useDB();
  const toast = useToast();
  const confirm = useConfirm();
  const s = M.settings();
  const [q, setQ] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [complaints, setComplaints] = useState([]);
  const [consent, setConsent] = useState(false);
  const [existing, setExisting] = useState(null); // patient chosen from search
  const [cardNo, setCardNo] = useState('');
  const [suggested, setSuggested] = useState(null);
  const [left, setLeft] = useState(0);
  const [errors, setErrors] = useState({});
  const [scan, setScan] = useState(false);
  const [last, setLast] = useState(null);
  const [saving, setSaving] = useState(false);

  const refreshNumber = async () => {
    await ensureIdBlock();
    const n = await nextClinicNumber();
    setSuggested(n);
    setLeft(await remainingNumbers());
    return n;
  };

  useEffect(() => {
    refreshNumber().then((n) => n && setCardNo((c) => c || String(n)));
  }, []);

  const results = M.searchPatients(q);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target ? e.target.value : e }));
  const age = parseAge(form.ageText);
  const isChild = age && age.age < 16;

  const usePatient = (p) => {
    setExisting(p);
    setForm({
      name: p.name || '', sex: p.sex || '', ageText: (p.ageApprox ? 'about ' : '') + (ageLabel(p) || ''),
      phone: p.phone || '', household: p.household || '', village: p.village || '', guardian: p.guardian || '',
    });
    setCardNo(String(M.idNumber(p.clinicId) || ''));
    setQ('');
  };

  const reset = async () => {
    setForm(EMPTY);
    setComplaints([]);
    setConsent(false);
    setExisting(null);
    setErrors({});
    const n = await refreshNumber();
    setCardNo(n ? String(n) : '');
  };

  const submit = async () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Name is needed';
    if (!form.sex) e.sex = 'Choose female or male';
    if (!age) e.age = 'Age is needed — “about 40” is fine';
    if (!consent) e.consent = 'Ask the patient for consent first';
    const n = Number(cardNo);
    if (!n) e.card = 'Card number is needed';
    const holder = n && M.patientByClinicId(n);
    if (holder && holder.id !== existing?.id) e.card = `${M.formatId(n)} already belongs to ${holder.name}`;
    setErrors(e);
    if (Object.keys(e).length) return;

    if (!existing) {
      const dup = M.patients().find((p) => p.name?.trim().toLowerCase() === form.name.trim().toLowerCase()
        && (p.village || '') === form.village && Math.abs((M.ageOf(p) ?? 0) - age.age) <= 2);
      if (dup && !(await confirm(`${dup.name} (${dup.clinicId}, ${dup.village || 'no village'}) is already registered. Register a NEW patient anyway?`, 'Register new patient'))) return;
    }

    setSaving(true);
    try {
      const year = Number(s.day.slice(0, 4));
      const patient = {
        name: form.name.trim(), sex: form.sex, age: age.age, ageApprox: age.approx,
        birthYear: age.age >= 1 ? year - Math.floor(age.age) : null,
        phone: form.phone.trim(), household: form.household.trim(), village: form.village,
        guardian: isChild ? form.guardian.trim() : '',
      };
      const clinicId = M.formatId(n);
      const res = await M.registerPatient({ patientId: existing?.id, patient, complaints, consent, clinicId });
      if (res.existing) toast(`${clinicId} is already registered today — now at ${res.visit.station}`);
      else toast(`${clinicId} saved · sent to Vitals`);
      setLast({ clinicId, name: patient.name });
      await reset();
    } finally {
      setSaving(false);
    }
  };

  const today = M.visitsToday();
  const waitingVitals = M.queue('vitals').length;
  const todayVisit = existing && M.todaysVisit(existing.id);

  return (
    <div className="page">
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 16 }} className="reg-grid">
        <div>
          <div className="card">
            <label className="label" htmlFor="search">1 · Search first (name, phone, household or card number)</label>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input id="search" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Fatou Jallow" autoComplete="off" />
              <button className="btn" onClick={() => setScan(true)} aria-label="Scan card">⌗ Scan</button>
            </div>
            {results.map((p) => {
              const last = M.visitsOf(p.id)[0];
              return (
                <div key={p.id} className="row" style={{ justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                  <div>
                    <b>{p.name}</b> · {p.sex?.[0]} · {ageLabel(p)} · {p.village || '—'}{p.household ? ` · ${p.household}` : ''}
                    <div className="small muted">{p.clinicId}{last ? ` · seen ${last.day}${last.complaints?.length ? ` (${last.complaints.join(', ')})` : ''}` : ''}</div>
                  </div>
                  <button className="btn sm" onClick={() => usePatient(p)}>Use this patient</button>
                </div>
              );
            })}
            {q.trim().length >= 2 && !results.length && <p className="small muted">No match — register a new patient below.</p>}
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <label className="label">{existing ? `2 · Returning patient · ${existing.clinicId}` : '2 · Or register a new patient'}</label>
              {existing && <button className="btn sm" onClick={reset}>Clear — new patient</button>}
            </div>
            {todayVisit && <div className="banner amber" style={{ marginBottom: 12 }}>Already registered today — now at <b>{todayVisit.station}</b>. Saving will only update their details.</div>}
            <div className="grid2">
              <div className="field">
                <label className="label" htmlFor="name">Full name</label>
                <input id="name" className="input" value={form.name} onChange={set('name')} placeholder="e.g. Lamin Ceesay" autoComplete="off" />
                {errors.name && <div className="err">{errors.name}</div>}
              </div>
              <div className="field">
                <span className="label">Sex</span>
                <Seg options={[['F', 'Female'], ['M', 'Male']]} value={form.sex} onChange={set('sex')} />
                {errors.sex && <div className="err">{errors.sex}</div>}
              </div>
              <div className="field">
                <label className="label" htmlFor="age">Age (or “about”; “8m” for months)</label>
                <input id="age" className="input" value={form.ageText} onChange={set('ageText')} placeholder="e.g. 40" autoComplete="off" />
                {errors.age && <div className="err">{errors.age}</div>}
              </div>
              <div className="field">
                <label className="label" htmlFor="phone">Phone (optional)</label>
                <input id="phone" className="input" value={form.phone} onChange={set('phone')} placeholder="+220" inputMode="tel" />
              </div>
              <div className="field">
                <label className="label" htmlFor="household">Household / compound</label>
                <input id="household" className="input" value={form.household} onChange={set('household')} placeholder="e.g. Ceesay Kunda" />
              </div>
              <div className="field">
                <label className="label" htmlFor="village">Village</label>
                <select id="village" className="input" value={form.village} onChange={set('village')}>
                  <option value="">Choose…</option>
                  {s.villages.map((v) => <option key={v}>{v}</option>)}
                </select>
              </div>
              {isChild && (
                <div className="field">
                  <label className="label" htmlFor="guardian">Guardian name (child)</label>
                  <input id="guardian" className="input" value={form.guardian} onChange={set('guardian')} />
                </div>
              )}
            </div>
            <div className="field">
              <span className="label">Chief complaint (tap all that apply)</span>
              <Chips options={COMPLAINTS} value={complaints} onChange={setComplaints} />
            </div>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 16 }}>
              <label className="row" style={{ gap: 10, cursor: 'pointer', maxWidth: 380 }}>
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ width: 26, height: 26 }} />
                <span>Patient agreed to have their details recorded</span>
              </label>
              <button className="btn primary" style={{ minWidth: 260 }} disabled={saving} onClick={submit}>Register and send to Vitals</button>
            </div>
            {errors.consent && <div className="err">{errors.consent}</div>}
          </div>
        </div>

        <aside>
          <div className="card" style={{ textAlign: 'center' }}>
            <div className="label" style={{ textAlign: 'left' }}>{existing ? 'Patient card' : 'Next card to hand out'}</div>
            {cardNo ? <QR text={M.formatId(Number(cardNo))} size={150} /> : <div className="empty small">No number yet</div>}
            <div className="row" style={{ justifyContent: 'center', marginTop: 6, flexWrap: 'nowrap', gap: 6 }}>
              <b style={{ fontSize: 26 }}>{s.idPrefix}-</b>
              <input aria-label="Card number" className="input big mono" style={{ width: 120, textAlign: 'center', padding: 6 }}
                value={cardNo} onChange={(e) => setCardNo(e.target.value.replace(/\D/g, '').slice(0, 5))} inputMode="numeric" />
            </div>
            {errors.card && <div className="err">{errors.card}</div>}
            <p className="small muted">Pre-printed card. Read the number aloud so the patient remembers it.
              {suggested && Number(cardNo) !== suggested && !existing && <> Next unused: <button className="btn sm" onClick={() => setCardNo(String(suggested))}>{M.formatId(suggested)}</button></>}
            </p>
          </div>
          <div className="card">
            <div className="label">Today so far</div>
            <div className="kv"><span>Registered</span><b>{today.length}</b></div>
            <div className="kv"><span>Waiting at Vitals</span><b>{waitingVitals}</b></div>
            <div className="kv"><span>Card numbers left on this tablet</span><b>{left}</b></div>
            {last && <p className="small muted">Last: {last.clinicId} · {last.name}</p>}
          </div>
          <div className="banner info small" style={{ marginTop: 12 }}>
            <div>Hub offline? Keep going: everything is saved on this tablet.<br /><SyncBadge /></div>
          </div>
        </aside>
      </div>
      {scan && (
        <Scanner onClose={() => setScan(false)} onResult={(text) => {
          setScan(false);
          const p = M.patientByClinicId(text);
          if (p) usePatient(p);
          else { setCardNo(String(M.idNumber(text) || '')); toast(`New card ${text} — fill in the patient`); }
        }} />
      )}
      <style>{`@media (max-width: 900px) { .reg-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
