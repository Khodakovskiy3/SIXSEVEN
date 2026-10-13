/**
 * Claude (Anthropic Messages API) provider — the production AI backend.
 *
 * Uses the official @anthropic-ai/sdk with a manual tool-use loop driven by
 * server/ai/assistant.js. The API key never leaves the server.
 *
 * Model: ANTHROPIC_MODEL (default claude-sonnet-5-5). Claude 5.x models always
 * think; ANTHROPIC_EFFORT (default "low") keeps chat latency and cost down.
 * For the 5.x family the request opts into server-side refusal fallback.
 */

import Anthropic from '@anthropic-ai/sdk';

import { AiProviderError } from './base.js';

/** Models that accept output_config.effort and server-side `fallbacks: "default"`. */
const MODELS_WITH_EFFORT_AND_FALLBACK = new Set([
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
  'claude-fable-5-1',
  'claude-fable-5',
]);

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Neutral turns → Anthropic MessageParam[]. */
export function toAnthropicMessages(turns) {
  return turns.map((turn) => {
    if (turn.role === 'tool') {
      return {
        role: 'user',
        content: turn.results.map((result) => ({
          type: 'tool_result',
          tool_use_id: result.id,
          content: result.content,
          is_error: Boolean(result.isError),
        })),
      };
    }
    if (turn.role === 'assistant' && turn.raw) {
      // Replayed exactly as returned (thinking blocks included) — the harness
      // stays append-only within a request.
      return { role: 'assistant', content: turn.raw };
    }
    return { role: turn.role, content: turn.content };
  });
}

function mapStopReason(reason) {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

export class AnthropicProvider {
  /**
   * @param {{ apiKey: string, model: string, effort?: string, maxTokens: number, timeoutMs: number, maxRetries: number, refusalFallback?: boolean, client?: object }} options
   */
  constructor({ apiKey, model, effort, maxTokens, timeoutMs, maxRetries, refusalFallback = true, client }) {
    this.name = 'anthropic';
    this.model = model;
    this.effort = effort;
    this.maxTokens = maxTokens;
    this.refusalFallback = refusalFallback;
    this.configured = Boolean(apiKey) || Boolean(client);
    this.client = client || (apiKey
      ? new Anthropic({ apiKey, timeout: timeoutMs, maxRetries })
      : null);
  }

  isConfigured() {
    return this.configured;
  }

  /**
   * @param {{ system: Array<{ text: string, cache?: boolean }>, messages: object[], tools: object[], signal?: AbortSignal }} request
   */
  async complete({ system, messages, tools, signal }) {
    if (!this.client) {
      throw new AiProviderError('ANTHROPIC_API_KEY is not configured', { code: 'not_configured' });
    }

    const supportsModernParams = MODELS_WITH_EFFORT_AND_FALLBACK.has(this.model);
    const params = {
      model: this.model,
      max_tokens: this.maxTokens,
      system: system.map((block) => ({
        type: 'text',
        text: block.text,
        ...(block.cache ? { cache_control: { type: 'ephemeral' } } : {}),
      })),
      messages: toAnthropicMessages(messages),
      ...(tools.length > 0 ? { tools, tool_choice: { type: 'auto' } } : {}),
      ...(supportsModernParams && this.effort ? { output_config: { effort: this.effort } } : {}),
    };

    let response;
    try {
      if (supportsModernParams && this.refusalFallback) {
        response = await this.client.beta.messages.create(
          { ...params, betas: [FALLBACK_BETA], fallbacks: 'default' },
          { signal }
        );
      } else {
        response = await this.client.messages.create(params, { signal });
      }
    } catch (error) {
      throw translateError(error);
    }

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    const toolCalls = response.content
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({ id: block.id, name: block.name, input: block.input ?? {} }));

    return {
      text,
      toolCalls,
      raw: response.content,
      stopReason: mapStopReason(response.stop_reason),
      usage: {
        inputTokens: Number(response.usage?.input_tokens || 0)
          + Number(response.usage?.cache_read_input_tokens || 0)
          + Number(response.usage?.cache_creation_input_tokens || 0),
        outputTokens: Number(response.usage?.output_tokens || 0),
      },
      model: response.model || this.model,
    };
  }
}

/** Maps SDK errors to provider-neutral errors (most specific first). */
function translateError(error) {
  if (error instanceof Anthropic.APIUserAbortError) {
    return new AiProviderError('AI request aborted', { code: 'timeout', cause: error });
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiProviderError('AI provider timed out', { code: 'timeout', retryable: true, cause: error });
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiProviderError('AI provider rejected credentials', { code: 'auth', cause: error });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiProviderError('AI provider rate limit', { code: 'rate_limited', retryable: true, cause: error });
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
    return new AiProviderError('AI request rejected', { code: 'bad_request', cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiProviderError('AI provider unreachable', { code: 'unavailable', retryable: true, cause: error });
  }
  if (error instanceof Anthropic.APIError) {
    return new AiProviderError('AI provider error', { code: 'unavailable', retryable: true, cause: error });
  }
  return error;
}
