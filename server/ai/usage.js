/**
 * AI cost control: per-user rate limits and usage accounting.
 *
 *  • short-term limit — AI_REQUESTS_PER_MINUTE per user (in memory, sliding
 *    window; correct for the single-instance deployment);
 *  • daily cap — AI_DAILY_REQUEST_LIMIT requests per user per local day,
 *    counted from ai_usage_events (survives restarts);
 *  • every request is recorded without message text: provider, model,
 *    status, token counts, tool calls, latency.
 */

import { query } from '../db.js';
import { config } from '../config.js';
import { logError } from '../utils/logger.js';

const WINDOW_MS = 60_000;
/** @type {Map<number, number[]>} */
const recentRequests = new Map();

/**
 * @param {number} userId
 * @returns {{ allowed: boolean, retryAfterSec?: number }}
 */
export function checkMinuteLimit(userId, now = Date.now()) {
  const timestamps = (recentRequests.get(userId) || []).filter((t) => now - t < WINDOW_MS);
  if (timestamps.length >= config.ai.requestsPerMinute) {
    recentRequests.set(userId, timestamps);
    return { allowed: false, retryAfterSec: Math.ceil((WINDOW_MS - (now - timestamps[0])) / 1000) };
  }
  timestamps.push(now);
  recentRequests.set(userId, timestamps);
  if (recentRequests.size > 10_000) {
    // Drop idle users so the map cannot grow without bound.
    for (const [key, values] of recentRequests) {
      if (values.every((t) => now - t >= WINDOW_MS)) recentRequests.delete(key);
    }
  }
  return { allowed: true };
}

/** Test helper. */
export function resetMinuteLimits() {
  recentRequests.clear();
}

/** @returns {Promise<boolean>} true while the user is under the daily cap. */
export async function isUnderDailyLimit(userId) {
  const result = await query(
    `select count(*)::int as used from ai_usage_events
     where user_id = $1 and created_at >= date_trunc('day', now())`,
    [userId]
  );
  return result.rows[0].used < config.ai.dailyRequestLimit;
}

/**
 * @param {{ userId: number, provider: string, model: string, status: string, inputTokens?: number, outputTokens?: number, toolCalls?: number, latencyMs?: number }} event
 */
export async function recordUsage(event) {
  try {
    await query(
      `insert into ai_usage_events
         (user_id, provider, model, status, input_tokens, output_tokens, tool_calls, latency_ms)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        event.userId,
        event.provider,
        String(event.model || '').slice(0, 80),
        event.status,
        event.inputTokens || 0,
        event.outputTokens || 0,
        event.toolCalls || 0,
        Math.round(event.latencyMs || 0),
      ]
    );
  } catch (error) {
    logError('AI usage accounting failed', error);
  }
}

/** Aggregated metrics for staff dashboards (last N days). */
export async function usageSummary(days = 30) {
  const result = await query(
    `select provider, model, status, count(*)::int as requests,
            coalesce(sum(input_tokens), 0)::int as input_tokens,
            coalesce(sum(output_tokens), 0)::int as output_tokens,
            coalesce(sum(tool_calls), 0)::int as tool_calls,
            coalesce(round(avg(latency_ms)), 0)::int as avg_latency_ms
     from ai_usage_events
     where created_at >= now() - make_interval(days => $1)
     group by provider, model, status
     order by requests desc`,
    [days]
  );
  return result.rows;
}
