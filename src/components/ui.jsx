import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import qrcode from 'qrcode-generator';
import { useSyncStatus } from '../hooks.js';

export function Chips({ options, value = [], onChange, multi = true }) {
  const toggle = (o) => {
    if (!multi) return onChange(o === value ? null : o);
    onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  };
  return (
    <div className="chips">
      {options.map((o) => {
        const on = multi ? value.includes(o) : value === o;
        return (
          <button type="button" key={o} className={'chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => toggle(o)}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function Seg({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button type="button" key={v} className={'chip' + (value === v ? ' on' : '')} aria-pressed={value === v} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function SyncBadge() {
  const s = useSyncStatus();
  const waiting = s.pending ? ` · ${s.pending} change${s.pending === 1 ? '' : 's'} waiting to sync` : '';
  let dot = 'warn', text;
  if (s.state === 'unpaired') text = `Not paired with hub · saved on this tablet${waiting}`;
  else if (s.state === 'synced') { dot = 'ok'; text = 'Synced to hub'; }
  else if (s.state === 'syncing') { dot = 'ok'; text = `Syncing${waiting}`; }
  else if (s.state === 'error') { dot = 'bad'; text = `Sync problem${waiting}`; }
  else text = `Offline${waiting || ' · saved on this tablet'}`;
  return (
    <span className="sync" title={s.message || ''}>
      <i className={'dot ' + dot} /> {text}
    </span>
  );
}

export function QR({ text, size = 140 }) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const cells = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) cells.push(`M${c} ${r}h1v1h-1z`);
  return (
    <svg width={size} height={size} viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label={`QR code ${text}`} shapeRendering="crispEdges">
      <rect x="-2" y="-2" width={n + 4} height={n + 4} fill="#fff" />
      <path d={cells.join('')} fill="#000" />
    </svg>
  );
}

export function PinPad({ title, subtitle, onSubmit, error, onCancel }) {
  const [pin, setPin] = useState('');
  useEffect(() => {
    if (pin.length === 4) {
      onSubmit(pin);
      setPin('');
    }
  }, [pin, onSubmit]);
  useEffect(() => {
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) setPin((p) => (p + e.key).slice(0, 4));
      if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="pinbox">
      <h1>{title}</h1>
      {subtitle && <p className="muted">{subtitle}</p>}
      <div className="pin-dots">{[0, 1, 2, 3].map((i) => <i key={i} className={i < pin.length ? 'f' : ''} />)}</div>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="pad">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => <button key={d} onClick={() => setPin((p) => p + d)}>{d}</button>)}
        <button onClick={() => (onCancel ? onCancel() : setPin(''))} style={{ fontSize: 16 }}>{onCancel ? 'Cancel' : 'Clear'}</button>
        <button onClick={() => setPin((p) => p + '0')}>0</button>
        <button onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete">⌫</button>
      </div>
    </div>
  );
}

export function Modal({ children, onClose }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [msg, setMsg] = useState(null);
  const t = useRef();
  const show = (m) => {
    setMsg(m);
    clearTimeout(t.current);
    t.current = setTimeout(() => setMsg(null), 3500);
  };
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  );
}

/** Render children into #print-root, then open the print dialog. */
export function PrintPortal({ children, onDone }) {
  useEffect(() => {
    const after = () => onDone?.();
    window.addEventListener('afterprint', after);
    const t = setTimeout(() => window.print(), 150);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', after);
    };
  }, [onDone]);
  return createPortal(children, document.getElementById('print-root'));
}

/** Camera QR scanning where the browser supports it; typing the number always works. */
export function Scanner({ onResult, onClose }) {
  const video = useRef();
  const cb = useRef(onResult);
  cb.current = onResult;
  const [error, setError] = useState('');
  useEffect(() => {
    let stream, stop = false;
    (async () => {
      try {
        if (!('BarcodeDetector' in window)) throw new Error('This browser cannot scan. Type the card number instead.');
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera needs a secure connection (see setup guide). Type the card number instead.');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.current.srcObject = stream;
        await video.current.play();
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        while (!stop) {
          const codes = await detector.detect(video.current).catch(() => []);
          if (codes[0]) { cb.current(codes[0].rawValue); return; }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch (e) {
        setError(e.message);
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return (
    <Modal onClose={onClose}>
      <h2>Scan patient card</h2>
      {error ? <p className="err">{error}</p> : <video ref={video} playsInline muted style={{ width: '100%', borderRadius: 12, marginTop: 12, background: '#000' }} />}
      <button className="btn wide" style={{ marginTop: 12 }} onClick={onClose}>Close</button>
    </Modal>
  );
}
