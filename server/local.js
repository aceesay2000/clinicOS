// Run ClinicOS on your own computer (for trying it out and for development):
//   npm start                → builds the app, serves it on http://localhost:8080
// Data is kept in ./data/local-db. Online, Vercel runs api/[name].js instead.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDB } from './db.js';
import { handle } from './api.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 8080);
process.env.CLINIC_CODE ||= '123456';
if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL && !('LOCAL_DB_DIR' in process.env)) {
  process.env.LOCAL_DB_DIR = path.join(ROOT, 'data', 'local-db');
  fs.mkdirSync(process.env.LOCAL_DB_DIR, { recursive: true });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res) {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(DIST, rel);
  if (!file.startsWith(DIST)) return send(res, 403, { error: 'Forbidden' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) return send(res, 404, { error: 'App not built yet. Run: npm run build' });
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' || rel === '/sw.js' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const m = req.url.match(/^\/api\/([a-z]+)/);
  if (!m) return serveStatic(req, res);
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    try {
      const [status, json] = await handle(await getDB(), req.method, m[1], raw ? JSON.parse(raw) : {});
      send(res, status, json);
    } catch (err) {
      send(res, 400, { error: String(err.message || err) });
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n  ClinicOS is running at http://localhost:${PORT}`);
  console.log(`  Clinic code: ${process.env.CLINIC_CODE}\n`);
});
