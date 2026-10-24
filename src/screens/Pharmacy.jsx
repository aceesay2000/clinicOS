import { useState } from 'react';
import * as db from '../db/local.js';
import { useDB, useNow } from '../hooks.js';
import * as M from '../lib/model.js';
import { doseText, medName } from '../lib/clinical.js';
import { Modal, PrintPortal, useConfirm, useToast } from '../components/ui.jsx';
import Slip from '../components/Slip.jsx';

export default function Pharmacy({ device }) {
  useDB();
  useNow();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState('pack');
  const [selected, setSelected] = useState(null);
  const [printing, setPrinting] = useState(null);
  const [sub, setSub] = useState(null);

  const atPharmacy = M.queue('pharmacy');
  const lists = {
    pack: atPharmacy.filter((v) => !v.packed),
    ready: atPharmacy.filter((v) => v.packed),
    done: M.visitsToday().filter((v) => v.status === 'dispensed' || v.status === 'not-collected')
      .sort((a, b) => (b.dispensedAt || b.updatedAt) - (a.dispensedAt || a.updatedAt)),
  };
  const list = lists[tab];
  const visit = (selected && db.get(selected)) || list[0];

  const dispense = async () => {
    const v = visit;
    await M.dispense(v, device.name);
    toast(`${v.clinicId} dispensed · stock updated`);
    setPrinting(v.id);
    setSelected(null);
  };

  const notCollected = async () => {
    if (!(await confirm('Release the reserved medicines back to stock?', 'Release'))) return;
    await M.releaseVisit(visit);
    toast(`${visit.clinicId} released back to stock`);
    setSelected(null);
  };

  return (
    <div className="split">
      <aside>
        <div className="seg" style={{ padding: 12 }}>
          {[['pack', 'To pack'], ['ready', 'Ready'], ['done', 'Done']].map(([k, l]) => (
            <button key={k} className={'chip' + (tab === k ? ' on' : '')} onClick={() => { setTab(k); setSelected(null); }} style={{ fontSize: 14, padding: '6px 8px' }}>
              {l} · {lists[k].length}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }}>
          {list.map((v) => {
            const p = M.patientOf(v);
            const items = M.rxItems(v.id).filter((i) => i.status !== 'released');
            return (
              <button key={v.id} className={'qitem' + (visit?.id === v.id ? ' on' : '')} onClick={() => setSelected(v.id)}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="id mono">{v.clinicId}</span>
                  <span className="small muted">{v.room ? `from ${v.room} · ` : ''}{tab === 'done' ? v.status === 'not-collected' ? 'not collected' : 'dispensed' : `${M.minutesSince(v.stationSince)} min`}</span>
                </div>
                <div>{p?.name} · {items.length} item{items.length === 1 ? '' : 's'}</div>
              </button>
            );
          })}
          {!list.length && <div className="empty">{tab === 'done' ? 'Nothing dispensed yet today.' : 'No prescriptions here.'}</div>}
        </div>
        <LowStockBox />
      </aside>
      <section>
        {visit ? (
          <Order visit={visit} tab={tab} onSub={setSub} onDispense={dispense} onNotCollected={notCollected} onPrint={() => setPrinting(visit.id)} />
        ) : <div className="empty">Prescriptions appear here as soon as the doctor finishes — pack them before the patient arrives.</div>}
      </section>
      {sub && <SubstituteModal item={sub} onClose={() => setSub(null)} onDone={() => { setSub(null); toast('Substitution recorded — doctor’s original kept on record'); }} />}
      {printing && <PrintPortal onDone={() => setPrinting(null)}><Slip visit={db.get(printing)} /></PrintPortal>}
    </div>
  );
}

function Order({ visit, tab, onSub, onDispense, onNotCollected, onPrint }) {
  const p = M.patientOf(visit);
  const c = M.consultFor(visit.id);
  const items = M.rxItems(visit.id).filter((i) => i.status !== 'released');
  const open = visit.station === 'pharmacy';

  const togglePicked = async (it) => {
    await db.put('rxitem', it.id, { picked: !it.picked });
    const allPicked = items.every((i) => (i.id === it.id ? !it.picked : i.picked));
    if (allPicked !== !!visit.packed) await M.setPacked(visit, allPicked);
  };

  return (
    <div style={{ maxWidth: 820 }}>
      <h1>{p?.name} <span className="muted mono" style={{ fontWeight: 500 }}>· {visit.clinicId}</span></h1>
      <p className="muted" style={{ margin: '4px 0 14px' }}>
        Prescribed by {c?.doctor || visit.room || '—'}{c?.diagnoses?.length ? ` · ${c.diagnoses.join(', ')}` : ''}
        {visit.status === 'not-collected' && <> · <span className="badge warn">NOT COLLECTED</span></>}
      </p>
      <div className="card" style={{ padding: 0 }}>
        {items.map((it) => {
          const m = db.get(it.medicineId);
          const orig = it.originalMedicineId && db.get(it.originalMedicineId);
          const st = M.stockOf(it.medicineId);
          return (
            <div key={it.id} className="row" style={{ padding: 14, borderBottom: '1px solid var(--line)', flexWrap: 'nowrap' }}>
              {open && (
                <input type="checkbox" checked={!!it.picked} onChange={() => togglePicked(it)} aria-label={`Packed ${medName(m)}`} style={{ width: 26, height: 26, flexShrink: 0 }} />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 18 }}><b>{medName(m)} · {it.qty} {m?.unit}</b></div>
                <div className="muted">{doseText(it, m)}</div>
                {orig && <div className="small amber-text">Substituted for {medName(orig)} ×{it.originalQty} — {it.subReason}</div>}
                {it.overrideReason && <div className="small amber-text">Prescribed over stock: {it.overrideReason}</div>}
              </div>
              {open && (
                <>
                  <span className="small" style={{ whiteSpace: 'nowrap' }}>Stock after: <b className={'mono ' + (st.available < 0 ? 'red-text' : M.isLow(m || {}) ? 'amber-text' : 'green-text')}>{st.available}</b></span>
                  <button className="btn sm" onClick={() => onSub(it)}>Substitute</button>
                </>
              )}
              {it.status === 'dispensed' && <span className="badge ok">DISPENSED</span>}
            </div>
          );
        })}
      </div>
      {open && (
        <div className="card" style={{ marginTop: 12 }}>
          <b>Before handing over:</b> confirm the ID card number, explain the dose pictograms on the slip, and ask the patient to repeat back when to take each medicine.
        </div>
      )}
      <div className="row" style={{ marginTop: 20, justifyContent: 'space-between' }}>
        <div className="row">
          <button className="btn" onClick={onPrint}>{tab === 'done' ? 'Reprint slip' : 'Print slip only'}</button>
          {open && <button className="btn" onClick={onNotCollected}>Patient did not collect</button>}
        </div>
        {open && <button className="btn primary" style={{ minWidth: 260 }} onClick={onDispense}>Dispense and print slip</button>}
      </div>
    </div>
  );
}

function LowStockBox() {
  const low = M.lowStock().slice(0, 6);
  if (!low.length) return null;
  return (
    <div style={{ padding: 14, borderTop: '1px solid var(--line)' }}>
      <div className="label">Low stock</div>
      {low.map(({ m, available }) => (
        <div className="kv small" key={m.id}><span>{medName(m)}</span><b className={available <= 0 ? 'red-text' : 'amber-text'}>{available} {m.unit}</b></div>
      ))}
    </div>
  );
}

function SubstituteModal({ item, onClose, onDone }) {
  const m = db.get(item.medicineId);
  const altNames = (m?.alternatives || []).map((a) => a.toLowerCase());
  const options = M.medicines().filter((x) => x.id !== item.medicineId && !M.isExpired(x))
    .sort((a, b) => altNames.includes(b.name.toLowerCase()) - altNames.includes(a.name.toLowerCase()));
  const [medId, setMedId] = useState(options[0]?.id || '');
  const [qty, setQty] = useState(item.qty);
  const [reason, setReason] = useState('');
  const save = async () => {
    await M.substitute(item, medId, qty, reason.trim());
    onDone();
  };
  return (
    <Modal onClose={onClose}>
      <h2>Substitute {medName(m)}</h2>
      <p className="muted small">The doctor's original prescription stays on record.</p>
      <div className="field">
        <label className="label" htmlFor="sub-med">Give instead</label>
        <select id="sub-med" className="input" value={medId} onChange={(e) => setMedId(e.target.value)}>
          <option value={item.medicineId}>Same medicine — change quantity only</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{medName(o)} · {M.stockOf(o.id).available} {o.unit} available{altNames.includes(o.name.toLowerCase()) ? ' · listed alternative' : ''}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor="sub-qty">Quantity</label>
        <input id="sub-qty" className="input mono" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
      </div>
      <div className="field">
        <label className="label" htmlFor="sub-reason">Reason (required)</label>
        <input id="sub-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. out of stock, only 10 left" />
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!reason.trim() || !Number(qty) || !medId} onClick={save}>Save substitution</button>
      </div>
    </Modal>
  );
}
