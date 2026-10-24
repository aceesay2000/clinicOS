// ClinicOS hub: run on the clinic laptop. No internet needed, no native deps.
//
//   node hub/server.js            (serves the built app from dist/ and the sync API)
//   PORT=8080 DATA_DIR=./data BACKUP_DIR=/media/usb node hub/server.js
//
// Tablets join the clinic Wi-Fi, open http://<laptop-ip>:<port>, and pair once
// with the pairing code printed below. After that they save everything locally
// and sync here whenever they can reach the hub.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DIST_DIR = path.join(ROOT, 'dist');
const BACKUP_DIR = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(DATA_DIR, 'backups');
const ID_BLOCK_SIZE = Number(process.env.ID_BLOCK_SIZE || 100);

const store = new Store(DATA_DIR);
const configFile = path.join(DATA_DIR, 'hub.json');
const config = loadConfig();

function loadConfig() {
  let cfg = {};
  if (fs.existsSync(configFile)) cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  cfg.hubId ||= crypto.randomUUID();
  cfg.pairingCode ||= String(crypto.randomInt(100000, 1000000));
  cfg.nextId ||= 1;
  cfg.devices ||= {};
  if (process.argv.includes('--new-code')) cfg.pairingCode = String(crypto.randomInt(100000, 1000000));
  fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2));
  return cfg;
}

function saveConfig() {
  const tmp = configFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, configFile);
}

function authed(body) {
  const dev = config.devices[body.deviceId];
  if (!dev || !body.token) return false;
  const a = Buffer.from(dev.token), b = Buffer.from(String(body.token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- API ----------

const api = {
  'GET /api/hello': () => ({ app: 'clinic-os', hubId: config.hubId, seq: store.seq, time: Date.now() }),

  'POST /api/pair': (body) => {
    if (String(body.code) !== config.pairingCode) return [403, { error: 'Wrong pairing code' }];
    if (!body.deviceId) return [400, { error: 'deviceId required' }];
    const token = crypto.randomBytes(24).toString('hex');
    config.devices[body.deviceId] = { name: body.name || 'Tablet', token, pairedAt: Date.now() };
    saveConfig();
    return { hubId: config.hubId, token };
  },

  'POST /api/sync': (body) => {
    if (!authed(body)) return [401, { error: 'Device not paired with this hub' }];
    if (body.hubId && body.hubId !== config.hubId) return [409, { error: 'Different hub' }];
    let applied = 0;
    for (const change of body.changes || []) {
      store.apply(change, body.deviceId);
      applied++;
    }
    if (applied) store.flush();
    if (body.device) heartbeat(body.deviceId, body.device);
    const since = Number(body.since) || 0;
    const { docs, more } = store.changesSince(since);
    const seq = more ? docs[docs.length - 1]._seq : store.seq;
    return { hubId: config.hubId, applied, docs, more, seq };
  },

  'POST /api/idblock': (body) => {
    if (!authed(body)) return [401, { error: 'Device not paired with this hub' }];
    const start = config.nextId;
    config.nextId += ID_BLOCK_SIZE;
    saveConfig();
    return { start, end: start + ID_BLOCK_SIZE - 1 };
  },

  'POST /api/backup': (body) => {
    if (!authed(body)) return [401, { error: 'Device not paired with this hub' }];
    return { hubId: config.hubId, exportedAt: Date.now(), seq: store.seq, docs: store.all() };
  },
};

const lastBeat = new Map();
function heartbeat(deviceId, info) {
  // Only write when something changed or every 20s, to keep sequence churn low.
  const key = JSON.stringify(info);
  const prev = lastBeat.get(deviceId);
  if (prev && prev.key === key && Date.now() - prev.at < 20000) return;
  lastBeat.set(deviceId, { key, at: Date.now() });
  store.putLocal('device:' + deviceId, 'device', { ...info, deviceId, lastSeen: Date.now() });
}

// ---------- static files ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.csv': 'text/csv',
};

function serveStatic(req, res) {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(DIST_DIR, rel);
  if (!file.startsWith(DIST_DIR)) return send(res, 403, 'Forbidden');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(file)) return send(res, 404, 'App not built yet. Run: npm run build');
  const ext = path.extname(file);
  const noCache = ext === '.html' || rel === '/sw.js';
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': noCache ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(file).pipe(res);
}

function send(res, status, body) {
  const json = typeof body !== 'string';
  res.writeHead(status, {
    'Content-Type': json ? 'application/json' : 'text/plain',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(json ? JSON.stringify(body) : body);
}

const server = http.createServer((req, res) => {
  const route = `${req.method} ${req.url.split('?')[0]}`;
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const handler = api[route];
  if (!handler) {
    if (req.url.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    return serveStatic(req, res);
  }
  let raw = '';
  req.on('data', (c) => {
    raw += c;
    if (raw.length > 20e6) req.destroy();
  });
  req.on('end', () => {
    try {
      const body = raw ? JSON.parse(raw) : {};
      const out = handler(body);
      if (Array.isArray(out)) send(res, out[0], out[1]);
      else send(res, 200, out);
    } catch (err) {
      console.error(route, err);
      send(res, 500, { error: String(err.message || err) });
    }
  });
});

// ---------- hourly backup ----------

function backup() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(store.logFile, path.join(BACKUP_DIR, `clinic-log-${stamp}.jsonl`));
    console.log(`[backup] saved to ${BACKUP_DIR}`);
  } catch (err) {
    console.error('[backup] failed:', err.message);
  }
}
setInterval(backup, 60 * 60 * 1000).unref();

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  ClinicOS hub is running');
  console.log(`  Pairing code:  ${config.pairingCode}`);
  console.log(`  On this laptop: http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  On tablets:     http://${ip}:${PORT}`);
  console.log(`  Data:          ${DATA_DIR}  (${store.docs.size} records)\n`);
});

process.on('SIGINT', () => {
  store.flush();
  process.exit(0);
});
