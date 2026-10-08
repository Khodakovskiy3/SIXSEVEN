/**
 * Ollama provider — optional local development backend (no API costs, works
 * offline). Production uses AnthropicProvider; a missing Ollama never breaks
 * the rest of the application, the assistant just reports it as unavailable.
 */

import { randomUUID } from 'node:crypto';

import { AiProviderError } from './base.js';

/** Neutral turns → Ollama /api/chat messages. */
export function toOllamaMessages(system, turns) {
  const messages = [{ role: 'system', content: system.map((block) => block.text).join('\n\n') }];
  for (const turn of turns) {
    if (turn.role === 'tool') {
      for (const result of turn.results) {
        messages.push({ role: 'tool', tool_name: result.name, content: result.content });
      }
    } else if (turn.role === 'assistant' && turn.raw) {
      messages.push(turn.raw);
    } else {
      messages.push({ role: turn.role, content: turn.content });
    }
  }
  return messages;
}

export class OllamaProvider {
  /**
   * @param {{ url: string, model: string, timeoutMs: number, fetchImpl?: typeof fetch }} options
   */
  constructor({ url, model, timeoutMs, fetchImpl = fetch }) {
    this.name = 'ollama';
    this.url = url.replace(/\/$/, '');
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.url && this.model);
  }

  async complete({ system, messages, tools, signal }) {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let response;
    try {
      response = await this.fetch(`${this.url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: toOllamaMessages(system, messages),
          tools: tools.map((tool) => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
          })),
          stream: false,
          think: false,
        }),
        signal: combined,
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new AiProviderError('Ollama timed out', { code: 'timeout', cause: error });
      }
      throw new AiProviderError('Ollama is unreachable', { code: 'unavailable', cause: error });
    }

    if (!response.ok) {
      throw new AiProviderError(`Ollama responded with ${response.status}`, { code: 'unavailable' });
    }

    const data = await response.json();
    const message = data?.message || {};
    const text = String(message.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const toolCalls = (message.tool_calls || []).map((call) => ({
      id: randomUUID(),
      name: call.function?.name,
      input: typeof call.function?.arguments === 'string'
        ? safeJson(call.function.arguments)
        : call.function?.arguments || {},
    }));

    return {
      text,
      toolCalls,
      raw: { role: 'assistant', content: message.content || '', tool_calls: message.tool_calls || [] },
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end',
      usage: {
        inputTokens: Number(data?.prompt_eval_count || 0),
        outputTokens: Number(data?.eval_count || 0),
      },
      model: this.model,
    };
  }
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
