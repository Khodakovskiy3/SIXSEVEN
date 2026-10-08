/**
 * Cluvyra AI assistant orchestrator — a manual, bounded tool-use loop.
 *
 *   history ─► provider.complete() ─► tool calls? ─► executeTool() (validated,
 *       ▲                                              user-scoped SQL)
 *       └──────────────── tool results ◄──────────────┘
 *
 * Limits: AI_MAX_TOOL_ROUNDS model calls per request, at most
 * MAX_CALLS_PER_ROUND tool calls per response, an overall deadline, and the
 * provider's own timeout/retry settings.
 */

import { config } from '../config.js';
import { logError } from '../utils/logger.js';
import { getClientIdByUserId } from '../utils/identity.js';
import { ROLE } from '../utils/constants.js';
import { getAiProvider } from './providers/index.js';
import { AiProviderError } from './providers/base.js';
import { buildDynamicContext, buildStaticPrompt, detectLanguage } from './prompt.js';
import { executeTool, toolsForUser } from './tools.js';

const MAX_CALLS_PER_ROUND = 4;

const TEXT = {
  uk: {
    refusal: 'Вибачте, з цим запитом я допомогти не можу. Спробуйте запитати про тренування або розклад.',
    tooManySteps: 'Не вдалося завершити запит за відведену кількість кроків. Уточніть, будь ласка, дату, час чи тип заняття.',
    empty: 'Не вдалося сформувати відповідь. Спробуйте переформулювати запит.',
    toolFailed: 'Internal error while running the tool.',
  },
  en: {
    refusal: "Sorry, I can't help with that request. Try asking about training or the class schedule.",
    tooManySteps: "I couldn't finish this request in the allowed number of steps. Please specify the date, time or class type.",
    empty: "I couldn't produce an answer. Please try rephrasing.",
    toolFailed: 'Internal error while running the tool.',
  },
};

export class AiUnavailableError extends Error {
  constructor(reason, cause) {
    super(`AI assistant unavailable: ${reason}`);
    this.name = 'AiUnavailableError';
    this.reason = reason;
    this.cause = cause;
  }
}

/** Whether the assistant can serve requests right now (config-level). */
export function aiStatus() {
  const provider = getAiProvider();
  return {
    enabled: config.ai.enabled,
    provider: provider.name,
    available: config.ai.enabled && provider.isConfigured(),
  };
}

/**
 * @param {{ user: { id: number, name: string, role: string }, history: Array<{ role: 'user'|'assistant', content: string }> }} params
 * @returns {Promise<{ reply: string, slots?: object[], pendingBooking?: object, stats: object }>}
 */
export async function runAssistant({ user, history }) {
  const provider = getAiProvider();
  if (!config.ai.enabled) {
    throw new AiUnavailableError('disabled');
  }
  if (!provider.isConfigured()) {
    throw new AiUnavailableError('not_configured');
  }

  const lang = detectLanguage(history[history.length - 1]?.content);
  const clientId = user.role === ROLE.CLIENT ? await getClientIdByUserId(user.id) : null;
  const ctx = { user, clientId };

  const system = [
    { text: buildStaticPrompt(), cache: true },
    { text: await buildDynamicContext(user, clientId) },
  ];
  const tools = toolsForUser(user);
  const messages = history.map((turn) => ({ role: turn.role, content: turn.content }));
  const output = {};
  const stats = { inputTokens: 0, outputTokens: 0, toolCalls: 0, rounds: 0, model: provider.model, provider: provider.name };

  // Overall wall-clock budget for the whole loop (per-call timeouts are in the provider).
  const deadline = AbortSignal.timeout(config.ai.timeoutMs * 2);

  let reply = '';
  for (let round = 0; round < config.ai.maxToolRounds; round += 1) {
    let response;
    try {
      response = await provider.complete({ system, messages, tools, signal: deadline });
    } catch (error) {
      if (error instanceof AiProviderError) {
        throw new AiUnavailableError(error.code, error);
      }
      if (deadline.aborted) {
        throw new AiUnavailableError('timeout', error);
      }
      throw error;
    }

    stats.rounds += 1;
    stats.inputTokens += response.usage.inputTokens;
    stats.outputTokens += response.usage.outputTokens;
    stats.model = response.model || stats.model;

    if (response.stopReason === 'refusal') {
      reply = TEXT[lang].refusal;
      break;
    }

    if (response.toolCalls.length === 0) {
      reply = response.text || TEXT[lang].empty;
      break;
    }

    if (round === config.ai.maxToolRounds - 1) {
      reply = TEXT[lang].tooManySteps;
      break;
    }

    messages.push({ role: 'assistant', raw: response.raw, toolCalls: response.toolCalls });

    const results = [];
    for (const [index, call] of response.toolCalls.entries()) {
      if (index >= MAX_CALLS_PER_ROUND) {
        results.push({
          id: call.id,
          name: call.name,
          content: JSON.stringify({ error: 'Too many tool calls in one step; call fewer tools at once.' }),
          isError: true,
        });
        continue;
      }
      stats.toolCalls += 1;
      try {
        const result = await executeTool(call, ctx, output);
        results.push({ id: call.id, name: call.name, ...result });
      } catch (error) {
        logError('AI tool execution failed', error, { tool: call.name, userId: user.id });
        results.push({ id: call.id, name: call.name, content: JSON.stringify({ error: TEXT[lang].toolFailed }), isError: true });
      }
    }
    messages.push({ role: 'tool', results });
  }

  return {
    reply: reply || TEXT[lang].empty,
    ...(output.slots && output.slots.length > 0 && !output.pendingBooking ? { slots: output.slots.slice(0, 6) } : {}),
    ...(output.pendingBooking ? { pendingBooking: output.pendingBooking } : {}),
    stats,
  };
}
