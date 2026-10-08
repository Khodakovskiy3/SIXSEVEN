/**
 * Provider-neutral contract for chat models used by the Cluvyra assistant.
 *
 * Conversation turns (neutral format):
 *   { role: 'user', content: string }
 *   { role: 'assistant', content: string }                      — plain history
 *   { role: 'assistant', raw: unknown, toolCalls: ToolCall[] }  — provider-native
 *                                                                 tool-call turn,
 *                                                                 replayed unchanged
 *   { role: 'tool', results: Array<{ id, name, content: string, isError: boolean }> }
 *
 * Tool definition: { name, description, input_schema } (JSON Schema).
 *
 * complete() resolves to:
 *   {
 *     text: string,                      — user-visible text of this response
 *     toolCalls: Array<{ id, name, input }>,
 *     raw: unknown,                      — provider-native assistant content
 *     stopReason: 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other',
 *     usage: { inputTokens: number, outputTokens: number },
 *     model: string,
 *   }
 */

export class AiProviderError extends Error {
  /**
   * @param {string} message
   * @param {{ code: 'unavailable'|'timeout'|'rate_limited'|'auth'|'bad_request'|'not_configured', retryable?: boolean, cause?: unknown }} details
   */
  constructor(message, { code, retryable = false, cause } = {}) {
    super(message);
    this.name = 'AiProviderError';
    this.code = code;
    this.retryable = retryable;
    this.cause = cause;
  }
}
