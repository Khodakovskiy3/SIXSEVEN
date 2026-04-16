import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'sports_club_db',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || undefined,
  max: 10,
  idleTimeoutMillis: 30000,
});

export async function query(text, params) {
  return pool.query(text, params);
}

export async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } catch (err) {
    try {
      await client.query('rollback');
    } catch {
      // ignore rollback errors
    }
    throw err;
  } finally {
    client.release();
  }
}

export default pool;
