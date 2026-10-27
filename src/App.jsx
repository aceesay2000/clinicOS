import { useCallback, useEffect, useState } from 'react';
import * as db from './db/local.js';
import * as sync from './db/sync.js';
import { useDB } from './hooks.js';
import { checkPin, dayIsStale, localDay, saveSettings, settings } from './lib/model.js';
import { ROLES } from './lib/clinical.js';
import { Modal, PinPad, SyncBadge, ToastProvider } from './components/ui.jsx';
import { FindPatient } from './components/PatientRecord.jsx';
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
  const [lastRole, setLastRole] = useState(null); // station to return to after the lock
  const [view, setView] = useState(null);
  const [finding, setFinding] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('theme') || 'light'; } catch { return 'light'; }
  });

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
      t = setTimeout(() => lock(), IDLE_LOCK_MS);
    };
    const evs = ['pointerdown', 'keydown', 'scroll'];
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(t);
      evs.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [role]);

  function lock() {
    setRole((r) => {
      if (r) setLastRole(r);
      return null;
    });
    setFinding(false);
    setSwitching(false);
  }

  const enter = (r) => {
    setRole(r);
    setView(null);
  };

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

  if (!role) return <Lock device={device} lastRole={lastRole} onUnlock={enter} />;

  const views = VIEWS_FOR[role] || [];
  const current = view && views.includes(view) ? view : views[0];
  const [, Screen] = VIEWS[current];

  return (
    <ToastProvider>
      <div className="app">
        <TopBar device={device} role={role} views={views} current={current} setView={setView}
          theme={theme} setTheme={setTheme} onLock={lock} onFind={() => setFinding(true)} onSwitch={() => setSwitching(true)} />
        <StaleDayBanner canFix={role === 'admin' || role === 'lead'} />
        {!db.isPersistent() && (
          <div className="banner red" role="alert" style={{ borderRadius: 0 }}>
            This browser is not letting ClinicOS save data. Records disappear when this page closes — do not use it for real patients.
          </div>
        )}
        <main className="main">
          <Screen device={device} role={role} saveDevice={saveDevice} setView={setView} />
        </main>
        {finding && <FindPatient role={role} onClose={() => setFinding(false)} />}
        {switching && <SwitchStation current={role} onClose={() => setSwitching(false)} onSwitch={(r) => { setSwitching(false); enter(r); }} />}
      </div>
    </ToastProvider>
  );
}

function TopBar({ device, role, views, current, setView, theme, setTheme, onLock, onFind, onSwitch }) {
  useDB();
  const s = settings();
  const roleLabel = ROLES.find((r) => r.id === role)?.label || role;
  return (
    <header className="topbar">
      <span className="brand">ClinicOS</span>
      <span className="clinic">{s.clinicName} · {s.eventName}</span>
      <button className="station-pill" onClick={onSwitch} title="Switch station">{roleLabel} · {device.name} ⇄</button>
      {views.length > 1 && (
        <nav className="nav">
          {views.map((v) => (
            <button key={v} className={v === current ? 'on' : ''} onClick={() => setView(v)}>{VIEWS[v][0]}</button>
          ))}
        </nav>
      )}
      <span className="spacer" />
      <SyncBadge />
      <button className="btn sm" onClick={onFind}>⌕ Find patient</button>
      <button className="btn sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle low-brightness mode">
        {theme === 'dark' ? '☀' : '☾'}
      </button>
      <button className="btn sm" onClick={onLock}>Lock</button>
    </header>
  );
}

function Lock({ device, lastRole, onUnlock }) {
  useDB();
  const [error, setError] = useState('');
  // Unlock back into the station this phone was last working, or its own station.
  const back = lastRole || device.station;
  const roleLabel = ROLES.find((r) => r.id === back)?.label;
  const submit = useCallback((pin) => {
    if (checkPin(back, pin)) return onUnlock(back);
    if (back !== device.station && checkPin(device.station, pin)) return onUnlock(device.station);
    if (checkPin('admin', pin)) return onUnlock('admin');
    setError('Wrong PIN — try again');
  }, [back, device.station, onUnlock]);
  return (
    <div className="lock">
      <div>
        <PinPad title={`${roleLabel} · ${device.name}`} subtitle="Enter the station PIN" onSubmit={submit} error={error} />
        <p className="center muted small" style={{ textAlign: 'center', marginTop: 18 }}><SyncBadge /></p>
      </div>
    </div>
  );
}

/** Work a different station on this phone, e.g. a registration volunteer covering the doctor's queue. */
function SwitchStation({ current, onClose, onSwitch }) {
  const [target, setTarget] = useState(null);
  const [error, setError] = useState('');
  const submit = useCallback((pin) => {
    if (checkPin(target, pin) || checkPin('admin', pin)) return onSwitch(target);
    setError(`Wrong PIN for ${ROLES.find((r) => r.id === target)?.label}`);
  }, [target, onSwitch]);
  return (
    <Modal onClose={onClose}>
      {!target ? (
        <>
          <h2>Switch station</h2>
          <p className="muted">Work another station on this phone. You will need that station’s PIN.</p>
          <div className="chips" style={{ marginTop: 12 }}>
            {ROLES.map((r) => (
              <button key={r.id} className={'chip' + (r.id === current ? ' on' : '')} disabled={r.id === current} onClick={() => setTarget(r.id)}>{r.label}</button>
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}><button className="btn" onClick={onClose}>Cancel</button></div>
        </>
      ) : (
        <PinPad title={ROLES.find((r) => r.id === target)?.label} subtitle="Enter this station’s PIN (or the admin PIN)" onSubmit={submit} error={error} onCancel={() => { setTarget(null); setError(''); }} />
      )}
    </Modal>
  );
}

/** Warn every station when the clinic day in settings is not today (e.g. still last year’s date). */
function StaleDayBanner({ canFix }) {
  useDB();
  if (!dayIsStale()) return null;
  const today = localDay(new Date());
  return (
    <div className="banner amber" role="alert" style={{ borderRadius: 0 }}>
      <span style={{ flex: 1 }}>
        The clinic day is set to <b>{settings().day}</b>, but today is <b>{today}</b>. New patients are filed under {settings().day}, and today’s queues only show that day.
      </span>
      {canFix
        ? <button className="btn sm" onClick={() => saveSettings({ day: today })}>Switch to today</button>
        : <b>Tell the clinic lead or admin.</b>}
    </div>
  );
}
