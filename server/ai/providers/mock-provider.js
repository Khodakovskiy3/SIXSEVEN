/**
 * Scripted provider for automated tests — no network, no API credits.
 *
 * Each entry of `script` is either a response object (partial complete()
 * result) or a function `(request) => response` that can inspect the request
 * (e.g. the latest tool results) before answering. Requests are recorded in
 * `calls` for assertions.
 */

import { AiProviderError } from './base.js';

export class MockProvider {
  constructor(script = []) {
    this.name = 'mock';
    this.model = 'mock-model';
    this.script = [...script];
    this.calls = [];
  }

  isConfigured() {
    return true;
  }

  enqueue(...responses) {
    this.script.push(...responses);
  }

  async complete(request) {
    this.calls.push(structuredClone({ system: request.system, messages: request.messages, tools: request.tools }));
    const next = this.script.shift();
    if (!next) {
      throw new AiProviderError('Mock script exhausted', { code: 'unavailable' });
    }
    const response = typeof next === 'function' ? await next(request) : next;
    if (response instanceof Error) {
      throw response;
    }
    const toolCalls = response.toolCalls || [];
    return {
      text: response.text || '',
      toolCalls,
      raw: response.raw || [
        ...(response.text ? [{ type: 'text', text: response.text }] : []),
        ...toolCalls.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.input })),
      ],
      stopReason: response.stopReason || (toolCalls.length > 0 ? 'tool_use' : 'end'),
      usage: response.usage || { inputTokens: 10, outputTokens: 5 },
      model: this.model,
    };
  }
}
