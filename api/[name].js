// Vercel serverless entry: /api/hello, /api/pair, /api/sync, /api/idblock, /api/backup
import { getDB } from '../server/db.js';
import { handle } from '../server/api.js';

export default async function handler(req, res) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  let status, json;
  try {
    [status, json] = await handle(await getDB(), req.method, req.query.name, body);
  } catch (err) {
    console.error(err);
    [status, json] = [503, { error: String(err.message || err) }];
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(json);
}
