import { expect, test } from 'vitest';
import { configuredModel } from '../model.js';

test('DeepSeek uses the official Pi completions provider without contacting the model', () => {
  const { model } = configuredModel({
    AI_PROVIDER: 'deepseek',
    AI_MODEL: 'deepseek-flash',
    AI_API_KEY: 'test-only',
  });
  expect(model.baseUrl).toBe('https://api.deepseek.com');
  expect(model.api).toBe('openai-completions');
});
test('no implicit model, provider, or credential fallback', () => {
  expect(() => configuredModel({})).toThrow();
  expect(() =>
    configuredModel({ AI_PROVIDER: 'deepseek', AI_MODEL: 'invented', AI_API_KEY: 'test-only' }),
  ).toThrow();
});
