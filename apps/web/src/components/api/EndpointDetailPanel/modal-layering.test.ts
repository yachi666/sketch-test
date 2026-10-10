import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function zIndexFor(stylesheet: string, selector: string): number {
  const ruleStart = stylesheet.indexOf(`${selector} {`);
  const ruleEnd = stylesheet.indexOf('}', ruleStart);
  const rule = stylesheet.slice(ruleStart, ruleEnd).match(/z-index:\s*(\d+)/);
  if (ruleStart < 0 || !rule?.[1]) throw new Error(`Missing z-index for ${selector}`);
  return Number(rule[1]);
}

describe('endpoint sub-dialog layering', () => {
  it('renders generated-case and definition overlays above the endpoint dialog', () => {
    const subDialogStyles = readFileSync(
      resolve(import.meta.dirname, '../../../styles.css'),
      'utf8',
    );
    const endpointDialogStyles = readFileSync(
      resolve(import.meta.dirname, '../../../styles-legacy.css'),
      'utf8',
    );

    expect(zIndexFor(subDialogStyles, '.endpoint-definition-overlay')).toBeGreaterThan(
      zIndexFor(endpointDialogStyles, '.endpoint-dialog-overlay'),
    );
  });
});
