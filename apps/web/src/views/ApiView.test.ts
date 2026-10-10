import { describe, expect, it } from 'vitest';
import { generationEndpointId } from './ApiView';

describe('generationEndpointId', () => {
  it('removes the API-version row-key prefix before starting generation', () => {
    expect(
      generationEndpointId({
        id: 'av_a8172f1c:endpoint_create_order',
        versionId: 'av_a8172f1c',
      }),
    ).toBe('endpoint_create_order');
  });

  it('keeps an unscoped canonical endpoint id unchanged', () => {
    expect(generationEndpointId({ id: 'endpoint_create_order', versionId: 'av_a8172f1c' })).toBe(
      'endpoint_create_order',
    );
  });
});
