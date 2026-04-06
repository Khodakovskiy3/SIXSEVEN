import { query } from '../db.js';

export async function getClientIdByUserId(userId) {
  const result = await query('select id from clients where user_id = $1', [userId]);
  return result.rows[0]?.id || null;
}

export async function getTrainerIdByUserId(userId) {
  const result = await query('select id from trainers where user_id = $1', [userId]);
  return result.rows[0]?.id || null;
}
