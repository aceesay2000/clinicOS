import { useCallback, useEffect, useState } from 'react';
import * as db from './db/local.js';
import * as sync from './db/sync.js';
import { useDB } from './hooks.js';
import { checkPin, settings } from './lib/model.js';
import { ROLES } from './lib/clinical.js';
import { PinPad, SyncBadge, ToastProvider } from './components/ui.jsx';
import Setup from './screens/Setup.jsx';
import Registration from './screens/Registration.jsx';
import Vitals from './screens/Vitals.jsx';
import Doctor from './screens/Doctor.jsx';
import Pharmacy from './screens/Pharmacy.jsx';
import Board from './screens/Board.jsx';
import Stock from './screens/Stock.jsx';
import Report from './screens/Report.jsx';
import Admin from './screens/Admin.jsx';

const IDLE_LOCK_MS = 2 * 60 * 1000;

const VIEWS = {
  board: ['Clinic lead', Board],
  registration: ['Registration', Registration],
  vitals: ['Vitals', Vitals],
  doctor: ['Doctor', Doctor],
  pharmacy: ['Pharmacy', Pharmacy],
  stock: ['Stock', Stock],
  report: ['Report', Report],
  admin: ['Admin', Admin],
};

const VIEWS_FOR = {
  registration: ['registration'],
  vitals: ['vitals'],
  doctor: ['doctor'],
  pharmacy: ['pharmacy', 'stock'],
  lead: ['board', 'stock', 'report'],
  admin: ['board', 'registration', 'vitals', 'doctor', 'pharmacy', 'stock', 'report', 'admin'],
};

export default function App() {
  const [ready, setReady] = useState(false);
  const [device, setDevice] = useState(null);
  const [role, setRole] = useState(null); // null = locked
  const [view, setView] = useState(null);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');

  useEffect(() => {
    (async () => {
      await db.openDB();
      const dev = await db.getMeta('device');
      if (dev) activate(dev);
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch { /* private mode */ }
  }, [theme]);

  // Lock after 2 minutes without a touch.
  useEffect(() => {
    if (!role) return;
    let t;
    const reset = () => {
      clearTimeout(t);
      t = setTimeout(() => setRole(null), IDLE_LOCK_MS);
    };
    const evs = ['pointerdown', 'keydown', 'scroll'];
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(t);
      evs.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [role]);

  function activate(dev) {
    db.setDeviceId(dev.deviceId);
    sync.configure(dev);
    sync.start();
    setDevice(dev);
  }

  const saveDevice = async (dev) => {
    await db.setMeta('device', dev);
    activate(dev);
  };

  if (!ready) return <div className="lock"><p className="muted">Opening ClinicOS…</p></div>;

  if (!device) {
    return (
      <ToastProvider>
        <Setup onDone={(dev) => { saveDevice(dev); setRole(dev.station); }} />
      </ToastProvider>
    );
  }

  if (!role) return <Lock device={device} onUnlock={(r) => { setRole(r); setView(null); }} />;

  const views = VIEWS_FOR[role] || [];
  const current = view && views.includes(view) ? view : views[0];
  const [, Screen] = VIEWS[current];

  return (
    <ToastProvider>
      <div className="app">
        <TopBar device={device} role={role} views={views} current={current} setView={setView}
          theme={theme} setTheme={setTheme} onLock={() => setRole(null)} />
        <main className="main">
          <Screen device={device} role={role} saveDevice={saveDevice} setView={setView} />
        </main>
      </div>
    </ToastProvider>
  );
}

function TopBar({ device, role, views, current, setView, theme, setTheme, onLock }) {
  useDB();
  const s = settings();
  const roleLabel = ROLES.find((r) => r.id === device.station)?.label || device.station;
  return (
    <header className="topbar">
      <span className="brand">ClinicOS</span>
      <span className="clinic">{s.clinicName} · {s.eventName}</span>
      <span className="station-pill">{roleLabel} · {device.name}{role === 'admin' && device.station !== 'admin' ? ' (admin)' : ''}</span>
      {views.length > 1 && (
        <nav className="nav">
          {views.map((v) => (
            <button key={v} className={v === current ? 'on' : ''} onClick={() => setView(v)}>{VIEWS[v][0]}</button>
          ))}
        </nav>
      )}
      <span className="spacer" />
      <SyncBadge />
      <button className="btn sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle low-brightness mode">
        {theme === 'dark' ? '☀' : '☾'}
      </button>
      <button className="btn sm" onClick={onLock}>Lock</button>
    </header>
  );
}

function Lock({ device, onUnlock }) {
  useDB();
  const [error, setError] = useState('');
  const roleLabel = ROLES.find((r) => r.id === device.station)?.label;
  const submit = useCallback((pin) => {
    if (checkPin(device.station, pin)) return onUnlock(device.station);
    if (checkPin('admin', pin)) return onUnlock('admin');
    setError('Wrong PIN — try again');
  }, [device.station, onUnlock]);
  return (
    <div className="lock">
      <div>
        <PinPad title={`${roleLabel} · ${device.name}`} subtitle="Enter the station PIN" onSubmit={submit} error={error} />
        <p className="center muted small" style={{ textAlign: 'center', marginTop: 18 }}><SyncBadge /></p>
      </div>
    </div>
  );
}
