/**
 * Backend tools exposed to the AI assistant.
 *
 * Security model:
 *  • Claude only *requests* a tool call; this module validates every argument
 *    (zod) and runs fixed, parameterised SQL. The model never writes SQL.
 *  • Every tool is scoped to the authenticated user from the JWT (ctx). There
 *    is no argument that selects another user or client.
 *  • Tools are read-only, except prepare_booking which records a *pending*
 *    proposal. Creating the booking requires the user's explicit confirmation
 *    through POST /api/ai/bookings/confirm (see booking-confirmations.js).
 *  • Results contain only class data, aggregate seat counts and the user's
 *    own records — never other clients' names, emails or hashes.
 */

import { z } from 'zod';

import { query } from '../db.js';
import { config } from '../config.js';
import { prepareBookingConfirmation } from './booking-confirmations.js';
import { checkBookingEligibility } from '../services/booking-service.js';
import { addDays, isHhMm, isIsoDate, todayInZone, weekdayOf } from '../utils/time.js';
import { ROLE } from '../utils/constants.js';

const MAX_SEARCH_SPAN_DAYS = 14;
const MAX_SEARCH_RESULTS = 20;

const isoDate = z.string().refine(isIsoDate, 'Expected a date in YYYY-MM-DD format');
const hhmm = z.string().refine(isHhMm, 'Expected a time in HH:MM 24h format');
const scheduleId = z.coerce.number().int().positive();

const SCHEMAS = {
  search_classes: z.object({
    date_from: isoDate,
    date_to: isoDate.optional(),
    time_from: hhmm.optional(),
    time_to: hhmm.optional(),
    category: z.enum(['group', 'personal']).optional(),
    query: z.string().trim().max(60).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_SEARCH_RESULTS).optional(),
  }).strict(),
  get_class_availability: z.object({ schedule_id: scheduleId }).strict(),
  get_my_bookings: z.object({}).strict(),
  get_my_membership: z.object({}).strict(),
  prepare_booking: z.object({ schedule_id: scheduleId }).strict(),
};

/** Tool definitions in Anthropic/neutral format (JSON Schema). */
const DEFINITIONS = {
  search_classes: {
    name: 'search_classes',
    description:
      'Search the real class schedule of the organisation for upcoming classes in a date range, '
      + 'optionally filtered by start time window, category or name. Returns only classes that have not '
      + 'started yet, with seats left. Use this before suggesting any class; never invent classes or times. '
      + 'Dates are local dates in the organisation timezone.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'First local date to search, YYYY-MM-DD.' },
        date_to: { type: 'string', description: `Last local date (inclusive), YYYY-MM-DD. At most ${MAX_SEARCH_SPAN_DAYS} days after date_from. Defaults to date_from.` },
        time_from: { type: 'string', description: 'Earliest class start time, HH:MM (24h). E.g. "after 18:00" → "18:00".' },
        time_to: { type: 'string', description: 'Latest class start time, HH:MM (24h).' },
        category: { type: 'string', enum: ['group', 'personal'], description: 'group = group classes, personal = personal training.' },
        query: { type: 'string', description: 'Part of a class or trainer name, e.g. "yoga".' },
        limit: { type: 'integer', description: `Max results (1-${MAX_SEARCH_RESULTS}).` },
      },
      required: ['date_from'],
      additionalProperties: false,
    },
  },
  get_class_availability: {
    name: 'get_class_availability',
    description:
      'Get live details and seats left for one class by schedule_id, plus whether the current user is '
      + 'eligible to book it (membership, category, capacity) and the reason if not.',
    input_schema: {
      type: 'object',
      properties: { schedule_id: { type: 'integer', description: 'schedule_id from search_classes.' } },
      required: ['schedule_id'],
      additionalProperties: false,
    },
  },
  get_my_bookings: {
    name: 'get_my_bookings',
    description: "List the current user's upcoming active bookings.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  get_my_membership: {
    name: 'get_my_membership',
    description: "Get the current user's active membership: plan, what it allows (group/personal), valid-until date, visits left for single passes.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  prepare_booking: {
    name: 'prepare_booking',
    description:
      'Prepare a booking of one class for the current user after they clearly chose a specific slot. '
      + 'This does NOT book: it validates the rules and shows the user a confirmation card with a '
      + '"Confirm" button. The booking is created only if the user presses that button. Never tell the '
      + 'user the class is booked after calling this tool.',
    input_schema: {
      type: 'object',
      properties: { schedule_id: { type: 'integer', description: 'schedule_id of the chosen class.' } },
      required: ['schedule_id'],
      additionalProperties: false,
    },
  },
};

const CLIENT_TOOLS = ['search_classes', 'get_class_availability', 'get_my_bookings', 'get_my_membership', 'prepare_booking'];
const STAFF_TOOLS = ['search_classes'];

/**
 * Tool definitions available to a user.
 *
 * @param {{ role: string }} user
 */
export function toolsForUser(user) {
  const names = user.role === ROLE.CLIENT ? CLIENT_TOOLS : STAFF_TOOLS;
  return names.map((name) => DEFINITIONS[name]);
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

async function searchClasses(input, ctx) {
  const today = todayInZone();
  const lastAllowed = addDays(today, config.ai.bookingHorizonDays);
  const dateFrom = input.date_from < today ? today : input.date_from;
  let dateTo = input.date_to || input.date_from;
  if (dateTo < dateFrom) {
    dateTo = dateFrom;
  }
  if (dateTo > addDays(dateFrom, MAX_SEARCH_SPAN_DAYS)) {
    dateTo = addDays(dateFrom, MAX_SEARCH_SPAN_DAYS);
  }
  if (dateTo > lastAllowed) {
    dateTo = lastAllowed;
  }
  if (dateFrom > lastAllowed) {
    return { classes: [], note: `Booking opens at most ${config.ai.bookingHorizonDays} days ahead.` };
  }

  const result = await query(
    `select s.id as schedule_id, s.date, to_char(s.time, 'HH24:MI') as time,
            w.name as class_name, w.category, w.duration_minutes, w.max_clients,
            u.name as trainer,
            (select count(*) from bookings b where b.schedule_id = s.id and b.status = 'active')::int as booked,
            exists (select 1 from bookings b
                    where b.schedule_id = s.id and b.status = 'active' and b.client_id = $8) as booked_by_me
     from schedules s
     join workouts w on w.id = s.workout_id
     left join trainers t on t.id = s.trainer_id
     left join users u on u.id = t.user_id
     where w.status = 'active'
       and s.date between $1 and $2
       and ((s.date + s.time) at time zone $3) > now()
       and ($4::time is null or s.time >= $4::time)
       and ($5::time is null or s.time <= $5::time)
       and ($6::text is null or w.category = $6)
       and ($7::text is null or w.name ilike '%' || $7 || '%' escape '\\' or u.name ilike '%' || $7 || '%' escape '\\')
     order by s.date, s.time
     limit $9`,
    [
      dateFrom,
      dateTo,
      config.timezone,
      input.time_from || null,
      input.time_to || null,
      input.category || null,
      input.query ? escapeLike(input.query) : null,
      ctx.clientId || 0,
      input.limit || 12,
    ]
  );

  return {
    searched: { date_from: dateFrom, date_to: dateTo },
    classes: result.rows.map((row) => ({
      schedule_id: row.schedule_id,
      class_name: row.class_name,
      category: row.category,
      date: row.date,
      weekday: weekdayOf(row.date),
      time: row.time,
      duration_minutes: row.duration_minutes,
      trainer: row.trainer || null,
      spots_left: Math.max(0, Number(row.max_clients) - Number(row.booked)),
      already_booked_by_you: row.booked_by_me,
    })),
  };
}

async function getClassAvailability(input, ctx) {
  const result = await query(
    `select s.id as schedule_id, s.date, to_char(s.time, 'HH24:MI') as time,
            w.name as class_name, w.category, w.duration_minutes, w.max_clients, w.status,
            u.name as trainer,
            (select count(*) from bookings b where b.schedule_id = s.id and b.status = 'active')::int as booked,
            ((s.date + s.time) at time zone $2) > now() as is_future
     from schedules s
     join workouts w on w.id = s.workout_id
     left join trainers t on t.id = s.trainer_id
     left join users u on u.id = t.user_id
     where s.id = $1`,
    [input.schedule_id, config.timezone]
  );
  const row = result.rows[0];
  if (!row || row.status !== 'active') {
    return { error: 'Class not found.' };
  }

  const details = {
    schedule_id: row.schedule_id,
    class_name: row.class_name,
    category: row.category,
    date: row.date,
    weekday: weekdayOf(row.date),
    time: row.time,
    duration_minutes: row.duration_minutes,
    trainer: row.trainer || null,
    spots_left: Math.max(0, Number(row.max_clients) - Number(row.booked)),
    has_started: !row.is_future,
  };

  if (ctx.clientId) {
    const eligibility = await checkBookingEligibility({ clientId: ctx.clientId, scheduleId: input.schedule_id });
    details.you_can_book = eligibility.ok;
    if (!eligibility.ok) {
      details.reason_if_not = eligibility.message;
    }
  }
  return details;
}

async function getMyBookings(input, ctx) {
  const result = await query(
    `select b.schedule_id, s.date, to_char(s.time, 'HH24:MI') as time, w.name as class_name, u.name as trainer
     from bookings b
     join schedules s on s.id = b.schedule_id
     join workouts w on w.id = s.workout_id
     left join trainers t on t.id = s.trainer_id
     left join users u on u.id = t.user_id
     where b.client_id = $1 and b.status = 'active'
       and ((s.date + s.time) at time zone $2) > now()
     order by s.date, s.time
     limit 20`,
    [ctx.clientId, config.timezone]
  );
  return {
    bookings: result.rows.map((row) => ({ ...row, weekday: weekdayOf(row.date), trainer: row.trainer || null })),
  };
}

async function getMyMembership(input, ctx) {
  const result = await query(
    `select coalesce(sp.name, s.type) as plan_name, sp.access_type, sp.plan_type, sp.usage_count,
            s.end_date, s.created_at
     from subscriptions s
     left join subscription_plans sp on sp.id = s.plan_id
     where s.client_id = $1 and s.status = 'active' and s.end_date >= current_date
     order by s.end_date desc
     limit 1`,
    [ctx.clientId]
  );
  const row = result.rows[0];
  if (!row) {
    return { active: false, note: 'No active membership. The front desk can assign one.' };
  }
  const allows = {
    gym: 'gym access only (no class booking)',
    gym_group: 'gym + group classes',
    group: 'group classes',
    personal: 'personal training',
  }[row.access_type] || 'unknown';

  const membership = { active: true, plan_name: row.plan_name, allows, valid_until: row.end_date };
  if (row.plan_type === 'single' && row.usage_count != null) {
    const used = await query(
      `select count(*)::int as used from bookings
       where client_id = $1 and status = 'active' and created_at >= $2`,
      [ctx.clientId, row.created_at]
    );
    membership.visits_left = Math.max(0, Number(row.usage_count) - used.rows[0].used);
  }
  return membership;
}

async function prepareBooking(input, ctx, output) {
  const prepared = await prepareBookingConfirmation({
    userId: ctx.user.id,
    clientId: ctx.clientId,
    scheduleId: input.schedule_id,
  });
  if (!prepared.ok) {
    return { status: 'not_bookable', reason: prepared.message };
  }
  // The token goes to the browser only (via `output`), never to the model.
  output.pendingBooking = {
    token: prepared.token,
    expiresAt: prepared.expiresAt,
    slot: prepared.slot,
  };
  return {
    status: 'awaiting_user_confirmation',
    slot: prepared.slot,
    membership_used: prepared.subscription.plan_name,
    confirmation_expires_in_minutes: config.ai.bookingTokenTtlMin,
    instruction: 'Ask the user to press the Confirm button on the card. Do not claim the class is booked.',
  };
}

const EXECUTORS = {
  search_classes: searchClasses,
  get_class_availability: getClassAvailability,
  get_my_bookings: getMyBookings,
  get_my_membership: getMyMembership,
  prepare_booking: prepareBooking,
};

/**
 * Validates and executes one tool call.
 *
 * @param {{ name: string, input: unknown }} call
 * @param {{ user: { id: number, role: string }, clientId: number|null }} ctx
 * @param {object} output — collects UI payloads (slots, pendingBooking).
 * @returns {Promise<{ content: string, isError: boolean }>}
 */
export async function executeTool(call, ctx, output) {
  const allowed = toolsForUser(ctx.user).some((tool) => tool.name === call.name);
  if (!allowed) {
    return { content: JSON.stringify({ error: `Tool "${call.name}" is not available for this user.` }), isError: true };
  }

  const parsed = SCHEMAS[call.name].safeParse(call.input ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      content: JSON.stringify({ error: `Invalid arguments: ${issue.path.join('.') || 'input'} — ${issue.message}` }),
      isError: true,
    };
  }

  if (CLIENT_TOOLS.includes(call.name) && !STAFF_TOOLS.includes(call.name) && !ctx.clientId) {
    return { content: JSON.stringify({ error: 'No client profile for this user.' }), isError: true };
  }

  const result = await EXECUTORS[call.name](parsed.data, ctx, output);

  if (call.name === 'search_classes' && result.classes) {
    output.slots = result.classes;
  }

  return { content: JSON.stringify(result), isError: Boolean(result.error) };
}

export const TOOL_NAMES = Object.keys(DEFINITIONS);
