import { createModels } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { zaiProvider } from '@earendil-works/pi-ai/providers/zai';
import { zaiCodingCnProvider } from '@earendil-works/pi-ai/providers/zai-coding-cn';

export function configuredModel(env: NodeJS.ProcessEnv = process.env) {
  const provider = env['AI_PROVIDER'];
  const modelId = env['AI_MODEL'];
  const apiKey = env['AI_API_KEY'];
  if (!provider || !modelId || !apiKey) throw new Error('Set AI_PROVIDER, AI_MODEL and AI_API_KEY');
  const models = createModels();
  if (provider === 'openai') models.setProvider(openaiProvider());
  else if (provider === 'anthropic') models.setProvider(anthropicProvider());
  else if (provider === 'deepseek') models.setProvider(deepseekProvider());
  else if (provider === 'zai') models.setProvider(zaiProvider());
  else if (provider === 'zai-coding-cn') models.setProvider(zaiCodingCnProvider());
  else throw new Error('Unsupported AI_PROVIDER');
  const model = models.getModel(provider, modelId);
  if (!model) throw new Error('AI_MODEL is not in the selected Pi provider catalog');
  return { model, apiKey, streamFn: models.streamSimple.bind(models) };
}
