/**
 * Unit tests for Cluvyra platform code that needs no database:
 * syntax of all JS files, PWA manifest, configuration validation,
 * timezone helpers, AI providers and conversation validation.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

describe('syntax & PWA', () => {
  test('every JS file parses (server, public incl. sw.js, scripts, electron)', async () => {
    const { listJsFiles, checkFiles } = await import('../scripts/check-syntax.js');
    const files = listJsFiles();
    assert.ok(files.some((file) => file.endsWith(join('public', 'sw.js'))));
    assert.deepEqual(checkFiles(files), []);
  });

  test('manifest is valid and references existing icons', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'public', 'manifest.json'), 'utf8'));
    assert.equal(manifest.short_name, 'Cluvyra');
    assert.equal(manifest.start_url, '/app');
    assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
    for (const icon of manifest.icons) {
      assert.ok(existsSync(join(ROOT, 'public', icon.src)), icon.src);
    }
  });

  test('service worker never caches API or uploads', () => {
    const sw = readFileSync(join(ROOT, 'public', 'sw.js'), 'utf8');
    assert.match(sw, /startsWith\('\/api'\)\) return;/);
    assert.match(sw, /startsWith\('\/assets\/uploads\/'\)\) return;/);
    assert.match(sw, /addEventListener\('notificationclick'/);
  });

  test('no API keys or secrets in frontend files', async () => {
    const { listJsFiles } = await import('../scripts/check-syntax.js');
    for (const file of listJsFiles(ROOT, ['public'])) {
      const content = readFileSync(file, 'utf8');
      assert.doesNotMatch(content, /sk-ant-|ANTHROPIC_API_KEY|JWT_SECRET|SMTP_PASS/, file);
    }
  });

  test('Electron bundle never ships .env', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.build.extraResources, undefined);
    assert.ok(pkg.build.files.includes('!.env'));
  });
});

describe('configuration', () => {
  const base = async () => (await import('../server/config.js'));

  function cfg(overrides) {
    return {
      isProduction: true,
      auth: { jwtSecret: 'a'.repeat(64) },
      db: { url: 'postgres://x' },
      mail: { host: 'smtp.example.com', from: 'no-reply@example.com', debugOtp: false },
      ai: { enabled: true, provider: 'anthropic', anthropicApiKey: 'key' },
      uploads: { dir: '/data/uploads' },
      ...overrides,
    };
  }

  test('a complete production config has no errors', async () => {
    const { checkConfig } = await base();
    assert.deepEqual(checkConfig(cfg({})).errors, []);
  });

  test('production refuses weak JWT secrets and missing AI key', async () => {
    const { checkConfig } = await base();
    assert.ok(checkConfig(cfg({ auth: { jwtSecret: 'change_me' } })).errors.some((e) => /JWT_SECRET/.test(e)));
    assert.ok(checkConfig(cfg({ auth: { jwtSecret: 'short' } })).errors.length > 0);
    assert.ok(checkConfig(cfg({ ai: { enabled: true, provider: 'anthropic', anthropicApiKey: '' } })).errors.some((e) => /ANTHROPIC_API_KEY/.test(e)));
    assert.deepEqual(checkConfig(cfg({ ai: { enabled: false, provider: 'anthropic', anthropicApiKey: '' } })).errors, []);
  });

  test('production refuses DEBUG_OTP=1', async () => {
    const { checkConfig } = await base();
    const mail = { host: 'smtp.example.com', from: 'x@example.com', debugOtp: true };
    assert.ok(checkConfig(cfg({ mail })).errors.some((e) => /DEBUG_OTP/.test(e)));
    assert.ok(checkConfig(cfg({ db: { url: '', hasExplicitHost: false } })).errors.some((e) => /DATABASE_URL/.test(e)));
  });

  test('missing SMTP / uploads volume are warnings, not silent', async () => {
    const { checkConfig } = await base();
    const { warnings } = checkConfig(cfg({ mail: { host: '' }, uploads: { dir: '' } }));
    assert.ok(warnings.some((w) => /SMTP/.test(w)));
    assert.ok(warnings.some((w) => /UPLOADS_DIR/.test(w)));
  });

  test('public config exposes no secrets', async () => {
    const { publicConfig } = await base();
    const json = JSON.stringify(publicConfig());
    assert.doesNotMatch(json, /apiKey|jwt|password|smtp|database/i);
  });
});

describe('time helpers (Europe/Kyiv)', () => {
  test('local date differs from UTC late in the evening', async () => {
    const { todayInZone, zonedNow } = await import('../server/utils/time.js');
    assert.equal(todayInZone(new Date('2026-10-08T22:30:00Z'), 'Europe/Kyiv'), '2026-10-09');
    assert.equal(zonedNow(new Date('2026-10-08T22:30:00Z'), 'Europe/Kyiv').time, '01:30');
  });

  test('DST transitions', async () => {
    const { zonedNow } = await import('../server/utils/time.js');
    // Spring forward: 2026-03-29 03:00 EET → 04:00 EEST.
    assert.equal(zonedNow(new Date('2026-03-29T00:30:00Z'), 'Europe/Kyiv').time, '02:30');
    assert.equal(zonedNow(new Date('2026-03-29T01:30:00Z'), 'Europe/Kyiv').time, '04:30');
    // Fall back: 2026-10-25 04:00 EEST → 03:00 EET.
    assert.equal(zonedNow(new Date('2026-10-25T00:30:00Z'), 'Europe/Kyiv').time, '03:30');
    assert.equal(zonedNow(new Date('2026-10-25T01:30:00Z'), 'Europe/Kyiv').time, '03:30');
  });

  test('calendar arithmetic and validation', async () => {
    const { addDays, isIsoDate, isHhMm, weekdayOf } = await import('../server/utils/time.js');
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-03-28', 1), '2026-03-29');
    assert.equal(weekdayOf('2026-10-09'), 'Friday');
    assert.equal(isIsoDate('2026-02-30'), false);
    assert.equal(isIsoDate('2026-02-28'), true);
    assert.equal(isHhMm('18:00'), true);
    assert.equal(isHhMm('24:00'), false);
  });
});

describe('AI providers', () => {
  test('Anthropic provider: request shape, tool turns, fallbacks, effort', async () => {
    const { AnthropicProvider } = await import('../server/ai/providers/anthropic-provider.js');
    const sent = [];
    const response = {
      model: 'claude-opus-5-5',
      stop_reason: 'tool_use',
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: 'Searching…' },
        { type: 'tool_use', id: 'tu_1', name: 'search_classes', input: { date_from: '2026-10-09' } },
      ],
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50 },
    };
    const fakeClient = {
      beta: { messages: { create: async (params) => { sent.push(['beta', params]); return response; } } },
      messages: { create: async (params) => { sent.push(['std', params]); return response; } },
    };
    const provider = new AnthropicProvider({ client: fakeClient, model: 'claude-opus-5-5', effort: 'low', maxTokens: 1000, timeoutMs: 1000, maxRetries: 0 });
    const result = await provider.complete({
      system: [{ text: 'rules', cache: true }, { text: 'context' }],
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', raw: response.content, toolCalls: [] },
        { role: 'tool', results: [{ id: 'tu_1', name: 'search_classes', content: '{}', isError: false }] },
      ],
      tools: [{ name: 'search_classes', description: 'd', input_schema: { type: 'object', properties: {} } }],
    });

    const [kind, params] = sent[0];
    assert.equal(kind, 'beta');
    assert.equal(params.model, 'claude-opus-5-5');
    assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
    assert.equal(params.fallbacks, 'default');
    assert.deepEqual(params.output_config, { effort: 'low' });
    assert.deepEqual(params.tool_choice, { type: 'auto' });
    assert.deepEqual(params.system[0].cache_control, { type: 'ephemeral' });
    assert.equal(params.system[1].cache_control, undefined);
    assert.equal(params.thinking, undefined, 'thinking is not disabled on Opus 5.5');
    assert.deepEqual(params.messages[1].content, response.content, 'assistant tool turn replayed unchanged');
    assert.equal(params.messages[2].content[0].type, 'tool_result');
    assert.equal(params.messages[2].content[0].tool_use_id, 'tu_1');

    assert.equal(result.stopReason, 'tool_use');
    assert.equal(result.text, 'Searching…');
    assert.deepEqual(result.toolCalls, [{ id: 'tu_1', name: 'search_classes', input: { date_from: '2026-10-09' } }]);
    assert.equal(result.usage.inputTokens, 150);
  });

  test('Anthropic provider: older/other models use the standard endpoint without effort', async () => {
    const { AnthropicProvider } = await import('../server/ai/providers/anthropic-provider.js');
    const sent = [];
    const fakeClient = {
      beta: { messages: { create: async () => assert.fail('beta must not be used') } },
      messages: { create: async (params) => { sent.push(params); return { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} }; } },
    };
    const provider = new AnthropicProvider({ client: fakeClient, model: 'claude-haiku-4-5', effort: 'low', maxTokens: 500, timeoutMs: 1000, maxRetries: 0 });
    const result = await provider.complete({ system: [{ text: 's' }], messages: [{ role: 'user', content: 'x' }], tools: [] });
    assert.equal(result.stopReason, 'end');
    assert.equal(sent[0].output_config, undefined);
    assert.equal(sent[0].tools, undefined);
  });

  test('Anthropic provider without API key is not configured and fails safely', async () => {
    const { AnthropicProvider } = await import('../server/ai/providers/anthropic-provider.js');
    const provider = new AnthropicProvider({ apiKey: '', model: 'claude-opus-5-5', maxTokens: 10, timeoutMs: 10, maxRetries: 0 });
    assert.equal(provider.isConfigured(), false);
    await assert.rejects(provider.complete({ system: [], messages: [], tools: [] }), { code: 'not_configured' });
  });

  test('Anthropic SDK errors are mapped (timeout, rate limit, auth)', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const { AnthropicProvider } = await import('../server/ai/providers/anthropic-provider.js');
    const make = (error) => new AnthropicProvider({
      client: { beta: { messages: { create: async () => { throw error; } } }, messages: { create: async () => { throw error; } } },
      model: 'claude-opus-5-5', maxTokens: 10, timeoutMs: 10, maxRetries: 0,
    });
    const call = (p) => p.complete({ system: [], messages: [{ role: 'user', content: 'x' }], tools: [] });
    await assert.rejects(call(make(new Anthropic.APIConnectionTimeoutError())), { code: 'timeout' });
    await assert.rejects(call(make(new Anthropic.APIConnectionError({ message: 'down' }))), { code: 'unavailable' });
  });

  test('Ollama provider: tool calls and unavailability', async () => {
    const { OllamaProvider } = await import('../server/ai/providers/ollama-provider.js');
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.messages[0].role, 'system');
      assert.equal(body.tools[0].function.name, 'search_classes');
      return new Response(JSON.stringify({
        message: { content: '', tool_calls: [{ function: { name: 'search_classes', arguments: { date_from: '2026-10-09' } } }] },
        prompt_eval_count: 7,
        eval_count: 3,
      }));
    };
    const provider = new OllamaProvider({ url: 'http://ollama:11434', model: 'qwen3:8b', timeoutMs: 1000, fetchImpl });
    const result = await provider.complete({
      system: [{ text: 'rules' }],
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'search_classes', description: 'd', input_schema: { type: 'object' } }],
    });
    assert.equal(result.stopReason, 'tool_use');
    assert.equal(result.toolCalls[0].input.date_from, '2026-10-09');

    const down = new OllamaProvider({ url: 'http://ollama:11434', model: 'm', timeoutMs: 1000, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    await assert.rejects(down.complete({ system: [], messages: [], tools: [] }), { code: 'unavailable' });
  });

  test('conversation validation and language detection', async () => {
    const { normalizeHistory } = await import('../server/routes/ai.js');
    const { detectLanguage } = await import('../server/ai/prompt.js');
    assert.equal(normalizeHistory('x'), null);
    assert.equal(normalizeHistory([{ role: 'system', content: 'x' }]), null);
    assert.equal(normalizeHistory([{ role: 'user', content: '  ' }]), null);
    assert.deepEqual(normalizeHistory([{ role: 'assistant', content: 'hi' }, { role: 'user', content: 'yo' }]), [{ role: 'user', content: 'yo' }]);
    const long = normalizeHistory([{ role: 'user', content: 'a'.repeat(10_000) }]);
    assert.ok(long[0].content.length <= 2000);
    assert.equal(detectLanguage('Хочу завтра на йогу'), 'uk');
    assert.equal(detectLanguage('Book me a yoga class tomorrow'), 'en');
  });
});
