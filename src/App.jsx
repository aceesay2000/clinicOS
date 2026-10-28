import { useEffect, useState } from 'react';
import * as db from './db/local.js';
import * as sync from './db/sync.js';
import { useDB, useSyncStatus } from './hooks.js';
import { dayIsStale, localDay, saveSettings, settings } from './lib/model.js';
import { ROLES } from './lib/clinical.js';
import * as T from './lib/team.js';
import { Modal, SyncBadge, ToastProvider, useConfirm } from './components/ui.jsx';
import { FindPatient } from './components/PatientRecord.jsx';
import SignIn from './components/SignIn.jsx';
import Setup from './screens/Setup.jsx';
import Registration from './screens/Registration.jsx';
import Vitals from './screens/Vitals.jsx';
import Doctor from './screens/Doctor.jsx';
import Pharmacy from './screens/Pharmacy.jsx';
import Board from './screens/Board.jsx';
import Stock from './screens/Stock.jsx';
import Report from './screens/Report.jsx';
import Team from './screens/Team.jsx';
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
  team: ['Team', Team],
  admin: ['Admin', Admin],
};

// What each station shows. The signed-in person's role decides which stations they may pick.
const VIEWS_FOR = {
  registration: ['registration'],
  vitals: ['vitals'],
  doctor: ['doctor'],
  pharmacy: ['pharmacy', 'stock'],
  lead: ['board', 'stock', 'report', 'team'],
  admin: ['board', 'registration', 'vitals', 'doctor', 'pharmacy', 'stock', 'report', 'team', 'admin'],
};

const stationLabel = (id) => ROLES.find((r) => r.id === id)?.label || id;

export default function App() {
  const [ready, setReady] = useState(false);
  const [device, setDevice] = useState(null);
  const [session, setSession] = useState(null); // { memberId, station } while signed in
  const [locked, setLocked] = useState(true);
  const [last, setLast] = useState({}); // last person + station on this device, for quick unlock
  const [view, setView] = useState(null);
  const [finding, setFinding] = useState(false);
  const [menu, setMenu] = useState(false);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('theme') || 'light'; } catch { return 'light'; }
  });
  const status = useSyncStatus();

  useEffect(() => {
    (async () => {
      await db.openDB();
      const dev = await db.getMeta('device');
      if (dev) activate(dev);
      setLast((await db.getMeta('session')) || {});
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch { /* private mode */ }
  }, [theme]);

  // Lock after 2 minutes without a touch; the same person unlocks with their PIN.
  useEffect(() => {
    if (!session || locked) return;
    let t;
    const reset = () => {
      clearTimeout(t);
      t = setTimeout(lock, IDLE_LOCK_MS);
    };
    const evs = ['pointerdown', 'keydown', 'scroll'];
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(t);
      evs.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [session, locked]);

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

  function lock() {
    setLocked(true);
    setFinding(false);
    setMenu(false);
  }

  async function signIn(m, station) {
    const s = { memberId: m.id, station };
    db.setUserId(m.id);
    sync.setPresence({ station, memberId: m.id, memberName: m.name });
    await db.setMeta('session', s);
    setLast(s);
    setSession(s);
    setLocked(false);
    setView(null);
  }

  async function signOut({ erase } = {}) {
    db.setUserId(null);
    sync.setPresence({});
    await db.setMeta('session', { station: session?.station });
    setLast({ station: session?.station });
    setSession(null);
    setLocked(true);
    setMenu(false);
    if (erase) {
      await db.wipe();
      window.location.reload();
    }
  }

  if (!ready) return <div className="lock"><p className="muted">Opening ClinicOS…</p></div>;

  if (status.state === 'revoked') return <Revoked />;

  if (!device) {
    return (
      <ToastProvider>
        <Setup onDone={saveDevice} />
      </ToastProvider>
    );
  }

  const me = session && T.member(session.memberId);
  // Signed out elsewhere (deactivated by the admin) or locked: back to sign-in.
  if (!session || locked || !me || me.status !== 'active') {
    return (
      <ToastProvider>
        <SignIn key={session?.memberId || last.memberId || 'pick'} device={device} lastMemberId={session?.memberId || last.memberId}
          lastStation={last.station} onSignedIn={signIn} />
      </ToastProvider>
    );
  }

  const views = VIEWS_FOR[session.station] || [];
  const current = view && views.includes(view) ? view : views[0];
  const [, Screen] = VIEWS[current];

  return (
    <ToastProvider>
      <div className="app">
        <TopBar me={me} station={session.station} views={views} current={current} setView={setView}
          theme={theme} setTheme={setTheme} onFind={() => setFinding(true)} onMenu={() => setMenu(true)} />
        <StaleDayBanner canFix={session.station === 'admin' || session.station === 'lead'} />
        {!db.isPersistent() && (
          <div className="banner red" role="alert" style={{ borderRadius: 0 }}>
            This browser is not letting ClinicOS save data. Records disappear when this page closes — do not use it for real patients.
          </div>
        )}
        <main className="main">
          <Screen device={device} role={session.station} me={me} saveDevice={saveDevice} setView={setView} />
        </main>
        {finding && <FindPatient role={session.station} onClose={() => setFinding(false)} />}
        {menu && (
          <AccountMenu me={me} device={device} station={session.station} pending={status.pending}
            onClose={() => setMenu(false)} onLock={lock} onSignOut={signOut}
            onSwitch={(s) => { setMenu(false); signIn(me, s); }} />
        )}
      </div>
    </ToastProvider>
  );
}

function TopBar({ me, station, views, current, setView, theme, setTheme, onFind, onMenu }) {
  useDB();
  const s = settings();
  return (
    <header className="topbar">
      <span className="brand">ClinicOS</span>
      <span className="clinic">{s.clinicName} · {s.eventName}</span>
      <button className="station-pill" onClick={onMenu} title="Switch station or sign out">
        {me.name.split(' ')[0]} · {stationLabel(station)} ▾
      </button>
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
    </header>
  );
}

/** Under the person's name: switch station, lock, sign out (and erase a personal phone). */
function AccountMenu({ me, device, station, pending, onClose, onLock, onSignOut, onSwitch }) {
  const confirm = useConfirm();
  const others = T.stationsFor(me).filter((s) => s !== station);
  const personal = device.kind === 'personal';
  const erase = async () => {
    const msg = pending
      ? `${pending} change${pending === 1 ? ' has' : 's have'} not reached the server yet. Erasing now would lose ${pending === 1 ? 'it' : 'them'}. Connect to the internet and wait for “Synced” first.`
      : 'Sign out and erase all patient data from this phone? You can set it up again later with the clinic code.';
    if (pending) return confirm(msg, 'OK');
    if (await confirm(msg, 'Sign out and erase')) onSignOut({ erase: true });
  };
  return (
    <Modal onClose={onClose}>
      <h2>{me.name}</h2>
      <p className="muted" style={{ marginTop: 4 }}>{T.roleLabel(me.role)} · working {stationLabel(station)} on {device.name}</p>
      {others.length > 0 && (
        <>
          <div className="label" style={{ marginTop: 16 }}>Switch station</div>
          <div className="chips">
            {others.map((s) => <button key={s} className="chip" onClick={() => onSwitch(s)}>{stationLabel(s)}</button>)}
          </div>
        </>
      )}
      <div style={{ display: 'grid', gap: 10, marginTop: 20 }}>
        <button className="btn wide" onClick={onLock}>Lock screen (keep me signed in)</button>
        <button className="btn wide" onClick={() => onSignOut()}>Sign out</button>
        {personal && <button className="btn danger wide" onClick={erase}>Sign out and erase data from this phone</button>}
        <button className="btn wide" onClick={onClose}>Cancel</button>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>Sign out when you hand this device to someone else, so their work is recorded under their name.</p>
    </Modal>
  );
}

/** The admin removed this device: erase patient data and explain. */
function Revoked() {
  useEffect(() => { db.wipe(); }, []);
  return (
    <div className="lock">
      <div className="pinbox card">
        <h1>This device was removed</h1>
        <p className="muted">The clinic admin removed this device from ClinicOS, and its patient data has been erased. To use it again, set it up with the clinic code.</p>
        <button className="btn primary wide" onClick={() => window.location.reload()}>Set up again</button>
      </div>
    </div>
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
