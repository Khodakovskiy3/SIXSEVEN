/**
 * Live smoke test of the Claude booking assistant against the configured
 * environment (run on Railway: ANTHROPIC_API_KEY never leaves the service).
 *
 * Flow (synthetic demo client only):
 *   1. one minimal Claude call → model, latency, token usage;
 *   2. runAssistant("book tomorrow after 18:00") with real tools + PostgreSQL;
 *   3. prepare → confirm a real booking for the first proposed slot;
 *   4. verify the booking row, then cancel it so the demo stays repeatable.
 *
 * Prints only metrics and class names — no secrets, no private data.
 * Requires --confirm. Spend: a few cents.
 */

import { config } from '../server/config.js';
import { closePool, query } from '../server/db.js';
import { getAiProvider } from '../server/ai/providers/index.js';
import { runAssistant } from '../server/ai/assistant.js';
import { prepareBookingConfirmation, confirmBooking } from '../server/ai/booking-confirmations.js';
import { getClientIdByUserId } from '../server/utils/identity.js';

const out = (label, value) => console.log(`[smoke] ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);

async function main() {
  if (!process.argv.includes('--confirm')) throw new Error('pass --confirm');
  const provider = getAiProvider();
  out('provider', provider.name);
  out('configured model', provider.model);
  if (!provider.isConfigured()) throw new Error('AI provider is not configured');

  // 1. minimal call
  const t0 = Date.now();
  const ping = await provider.complete({
    system: [{ text: 'Reply with the single word: ok' }],
    messages: [{ role: 'user', content: 'ping' }],
    tools: [],
  });
  out('ping', { ok: Boolean(ping.text), latencyMs: Date.now() - t0, usage: ping.usage, servedModel: ping.model || null });

  // 2. assistant with tools
  const email = process.env.DEMO_CLIENT_EMAIL || 'client@demo.example.com';
  const found = await query(`select id, name, role from users where lower(email) = lower($1) and role = 'client'`, [email]);
  const user = found.rows[0];
  if (!user) throw new Error('demo client not found');
  const clientId = await getClientIdByUserId(user.id);

  const t1 = Date.now();
  const result = await runAssistant({
    user,
    history: [{ role: 'user', content: 'Хочу завтра після 18:00 на групове тренування.' }],
  });
  out('assistant', {
    latencyMs: Date.now() - t1,
    stats: result.stats,
    slots: (result.slots || []).map((s) => `${s.date} ${s.time} ${s.class_name || s.workout} (#${s.schedule_id})`),
    hasPendingBooking: Boolean(result.pendingBooking),
    replyPreview: result.reply.slice(0, 300),
  });

  // 3. prepare → confirm (what the UI buttons do)
  const scheduleId = result.pendingBooking?.slot?.schedule_id
    ?? result.pendingBooking?.slot?.id
    ?? result.slots?.[0]?.schedule_id;
  if (!scheduleId) throw new Error('assistant proposed no slot (is there a class tomorrow after 18:00 and an active membership?)');
  const prepared = await prepareBookingConfirmation({ userId: user.id, clientId, scheduleId });
  if (!prepared.ok) throw new Error(`prepare refused: ${prepared.code}`);
  const { booking } = await confirmBooking({ userId: user.id, token: prepared.token });
  const row = await query(`select id, status from bookings where id = $1 and client_id = $2`, [booking.id, clientId]);
  out('booking created', row.rows[0]);

  // 4. cleanup
  await query(`update bookings set status = 'cancelled', cancelled_at = now() where id = $1`, [booking.id]);
  out('cleanup', 'booking cancelled; demo state restored');
  out('RESULT', 'PASS');
}

main()
  .catch((error) => {
    console.error(`[smoke] RESULT: FAIL — ${error.name}: ${error.message}`);
    if (error.cause) console.error(`[smoke] cause: ${error.cause.name}: ${String(error.cause.message).slice(0, 300)}`);
    process.exitCode = 1;
  })
  .finally(() => closePool());
