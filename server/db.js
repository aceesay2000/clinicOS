// Database connection. On Vercel this is the Postgres database from the
// project's Storage tab (DATABASE_URL / POSTGRES_URL). Locally, with no
// database configured, an in-process Postgres (PGlite) is used instead.

let dbPromise;

export function getDB() {
  dbPromise ||= open();
  return dbPromise;
}

async function open() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url, max: 3 });
    return {
      query: (sql, params) => pool.query(sql, params),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn({ query: (sql, params) => client.query(sql, params) });
          await client.query('COMMIT');
          return out;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
    };
  }
  // Online, an in-memory database would silently lose records between requests.
  if (process.env.VERCEL) throw new Error('No database connected. In Vercel: project → Storage → connect a Postgres database.');
  return openLocal(process.env.LOCAL_DB_DIR);
}

/** In-process Postgres for local runs and tests. dir = undefined keeps it in memory. */
export async function openLocal(dir) {
  // Kept out of the online bundle: only local runs and tests use it.
  const name = '@electric-sql/pglite';
  const { PGlite } = await import(/* @vite-ignore */ name);
  const pg = new PGlite(dir);
  return {
    query: (sql, params) => pg.query(sql, params),
    tx: (fn) => pg.transaction((t) => fn({ query: (sql, params) => t.query(sql, params) })),
  };
}
