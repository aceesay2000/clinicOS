import { useState } from 'react';
import * as db from '../db/local.js';
import { useDB } from '../hooks.js';
import * as M from '../lib/model.js';
import { medName } from '../lib/clinical.js';
import { importFormulary } from '../lib/formulary.js';
import { SAMPLE_FORMULARY } from '../lib/sampleFormulary.js';
import { download } from '../lib/csv.js';
import { Modal, useToast } from '../components/ui.jsx';

export default function Stock({ role }) {
  useDB();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null); // { kind: 'receive'|'count'|'edit', m }
  const isAdmin = role === 'admin';
  const meds = M.medicines().filter((m) => !q || medName(m).toLowerCase().includes(q.toLowerCase()));

  const onFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const r = await importFormulary(await file.text());
    toast(`Formulary loaded: ${r.added} added, ${r.updated} updated`);
    e.target.value = '';
  };

  const loadSample = async () => {
    const r = await importFormulary(SAMPLE_FORMULARY);
    toast(`Sample formulary loaded: ${r.added} medicines`);
  };

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h1>Stock</h1>
        <div className="row">
          <input className="input" style={{ width: 240, fontSize: 16 }} placeholder="Search medicine" value={q} onChange={(e) => setQ(e.target.value)} />
          {isAdmin && (
            <>
              <label className="btn">Load formulary CSV<input type="file" accept=".csv,text/csv" onChange={onFile} hidden /></label>
              <button className="btn" onClick={() => download('formulary-template.csv', SAMPLE_FORMULARY)}>Template</button>
              <button className="btn primary" onClick={() => setModal({ kind: 'edit', m: null })}>Add medicine</button>
            </>
          )}
        </div>
      </div>
      {!M.medicines().length && (
        <div className="banner info" style={{ marginBottom: 12 }}>
          <span style={{ flex: 1 }}>No formulary yet. The admin loads the medicine list and starting counts from a spreadsheet (CSV) before clinic day.</span>
          {isAdmin && <button className="btn sm" onClick={loadSample}>Load sample list for a dry run</button>}
        </div>
      )}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="t">
          <thead><tr><th>Medicine</th><th>Form</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Expiry</th><th /></tr></thead>
          <tbody>
            {meds.map((m) => {
              const st = M.stockOf(m.id);
              const expired = M.isExpired(m);
              return (
                <tr key={m.id}>
                  <td><b>{medName(m)}</b>{m.batch && <div className="small muted">Batch {m.batch}</div>}</td>
                  <td className="small">{m.form} · {m.unit}</td>
                  <td className="mono">{st.onHand}</td>
                  <td className="mono">{st.reserved}</td>
                  <td className={'mono ' + (st.available <= 0 ? 'red-text' : M.isLow(m) ? 'amber-text' : '')}><b>{st.available}</b>{M.isLow(m) && !expired ? ' · low' : ''}</td>
                  <td className={'small ' + (expired ? 'red-text' : '')}>{m.expiry || '—'}{expired ? ' · EXPIRED (blocked)' : ''}</td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      <button className="btn sm" onClick={() => setModal({ kind: 'receive', m })}>Receive</button>
                      <button className="btn sm" onClick={() => setModal({ kind: 'count', m })}>Count</button>
                      {isAdmin && <button className="btn sm" onClick={() => setModal({ kind: 'edit', m })}>Edit</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Movements />
      {modal?.kind === 'receive' && <ReceiveModal m={modal.m} onClose={() => setModal(null)} />}
      {modal?.kind === 'count' && <CountModal m={modal.m} onClose={() => setModal(null)} />}
      {modal?.kind === 'edit' && <EditModal m={modal.m} onClose={() => setModal(null)} />}
    </div>
  );
}

function Movements() {
  const [show, setShow] = useState(false);
  const list = db.all('movement').sort((a, b) => b.createdAt - a.createdAt).slice(0, 200);
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>Stock movements (audit log)</h3>
        <button className="btn sm" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show latest 200'}</button>
      </div>
      {show && (
        <table className="t" style={{ marginTop: 8 }}>
          <thead><tr><th>Time</th><th>Medicine</th><th>Type</th><th>Qty</th><th>Effect on hand</th><th>Reason</th></tr></thead>
          <tbody>
            {list.map((mv) => (
              <tr key={mv.id}>
                <td className="small mono">{new Date(mv.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{medName(db.get(mv.medicineId))}</td>
                <td>{mv.kind}</td>
                <td className="mono">{mv.qty}</td>
                <td className="mono">{mv.delta > 0 ? '+' : ''}{mv.delta}</td>
                <td className="small">{mv.reason || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ReceiveModal({ m, onClose }) {
  const toast = useToast();
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('Received');
  return (
    <Modal onClose={onClose}>
      <h2>Receive {medName(m)}</h2>
      <div className="field" style={{ marginTop: 12 }}>
        <label className="label" htmlFor="rq">Quantity ({m.unit})</label>
        <input id="rq" className="input big mono" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} inputMode="numeric" autoFocus />
      </div>
      <div className="field">
        <label className="label" htmlFor="rr">Note</label>
        <input id="rr" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!Number(qty)} onClick={async () => { await M.receiveStock(m.id, qty, reason); toast('Stock added'); onClose(); }}>Add to stock</button>
      </div>
    </Modal>
  );
}

function CountModal({ m, onClose }) {
  const toast = useToast();
  const st = M.stockOf(m.id);
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const diff = counted === '' ? 0 : Number(counted) - st.onHand;
  return (
    <Modal onClose={onClose}>
      <h2>Physical count · {medName(m)}</h2>
      <p className="muted">Expected on the shelf: <b className="mono">{st.onHand}</b> {m.unit} ({st.reserved} of these are reserved for patients not yet dispensed).</p>
      <div className="field">
        <label className="label" htmlFor="cq">Counted</label>
        <input id="cq" className="input big mono" value={counted} onChange={(e) => setCounted(e.target.value.replace(/\D/g, ''))} inputMode="numeric" autoFocus />
      </div>
      {counted !== '' && <p className={diff ? 'amber-text' : 'green-text'}><b>{diff === 0 ? 'Matches — no adjustment needed' : `Difference ${diff > 0 ? '+' : ''}${diff}`}</b></p>}
      {diff !== 0 && (
        <div className="field">
          <label className="label" htmlFor="cr">Reason for the difference</label>
          <input id="cr" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. broken bottle, miscount at start" />
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={counted === '' || (diff !== 0 && !reason.trim())}
          onClick={async () => { await M.adjustStock(m.id, counted, reason.trim() || 'Count matched'); toast('Count recorded'); onClose(); }}>
          Record count
        </button>
      </div>
    </Modal>
  );
}

function EditModal({ m, onClose }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: m?.name || '', strength: m?.strength || '', form: m?.form || 'tablet', unit: m?.unit || 'tab',
    batch: m?.batch || '', expiry: m?.expiry || '', lowThreshold: m?.lowThreshold ?? 20,
    alternatives: (m?.alternatives || []).join('; '), start: '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const { start, ...rest } = f;
    await M.saveMedicine(m?.id, {
      ...rest, lowThreshold: Number(rest.lowThreshold) || 0,
      alternatives: rest.alternatives.split(/[;|]/).map((s) => s.trim()).filter(Boolean),
    }, m ? 0 : Number(start) || 0);
    toast('Medicine saved');
    onClose();
  };
  const input = (k, label, props = {}) => (
    <div className="field">
      <label className="label" htmlFor={'m-' + k}>{label}</label>
      <input id={'m-' + k} className="input" value={f[k]} onChange={set(k)} {...props} />
    </div>
  );
  return (
    <Modal onClose={onClose}>
      <h2>{m ? 'Edit medicine' : 'Add medicine'}</h2>
      <div className="grid2" style={{ marginTop: 12 }}>
        {input('name', 'Name')}
        {input('strength', 'Strength', { placeholder: '500 mg' })}
        {input('form', 'Form', { placeholder: 'tablet, syrup 100 ml…' })}
        <div className="field">
          <label className="label" htmlFor="m-unit">Dispensing unit</label>
          <select id="m-unit" className="input" value={f.unit} onChange={set('unit')}>
            {['tab', 'cap', 'sachet', 'bottle', 'tube', 'pack', 'vial'].map((u) => <option key={u}>{u}</option>)}
          </select>
        </div>
        {input('batch', 'Batch')}
        {input('expiry', 'Expiry', { type: 'date' })}
        {input('lowThreshold', 'Low-stock level', { inputMode: 'numeric' })}
        {!m && input('start', 'Starting count', { inputMode: 'numeric' })}
      </div>
      {input('alternatives', 'Alternatives (names, separated by ;)')}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {m ? <button className="btn danger" onClick={async () => { await db.put('medicine', m.id, { archived: true }); onClose(); }}>Remove from formulary</button> : <span />}
        <div className="row">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!f.name.trim()} onClick={save}>Save</button>
        </div>
      </div>
    </Modal>
  );
}
