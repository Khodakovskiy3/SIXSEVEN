/**
 * Provider selection (AI_PROVIDER). A test can inject its own provider with
 * setAiProvider(); production always builds AnthropicProvider from config.
 */

import { config } from '../../config.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { OllamaProvider } from './ollama-provider.js';

let override = null;
let cached = null;

export function createProvider(ai = config.ai) {
  if (ai.provider === 'ollama') {
    return new OllamaProvider({ url: ai.ollamaUrl, model: ai.ollamaModel, timeoutMs: ai.timeoutMs });
  }
  return new AnthropicProvider({
    apiKey: ai.anthropicApiKey,
    model: ai.anthropicModel,
    effort: ai.anthropicEffort,
    maxTokens: ai.maxTokens,
    timeoutMs: ai.timeoutMs,
    maxRetries: ai.maxRetries,
    refusalFallback: ai.refusalFallback,
  });
}

/** @returns {{ name: string, model: string, isConfigured(): boolean, complete(request: object): Promise<object> }} */
export function getAiProvider() {
  if (override) {
    return override;
  }
  if (!cached) {
    cached = createProvider();
  }
  return cached;
}

/** Test hook: replace the provider (pass null to restore). */
export function setAiProvider(provider) {
  override = provider;
}
