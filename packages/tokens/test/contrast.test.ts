import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colors, contrastRatio } from '../src/index.ts';

// Brand guide section 11: text contrast meets WCAG 2.2 AA (4.5:1 for normal text).
const textTokens = ['textPrimary', 'textSecondary', 'link', 'successText', 'goldText', 'danger'] as const;

for (const scheme of ['light', 'dark'] as const) {
  const c = colors[scheme];
  for (const token of textTokens) {
    for (const bg of ['background', 'surface'] as const) {
      test(`${scheme} ${token} on ${bg} meets 4.5:1`, () => {
        assert.ok(contrastRatio(c[token], c[bg]) >= 4.5, `${c[token]} on ${c[bg]} = ${contrastRatio(c[token], c[bg]).toFixed(2)}`);
      });
    }
  }
  test(`${scheme} white on primary button meets 4.5:1`, () => {
    assert.ok(contrastRatio(c.onPrimary, c.primary) >= 4.5);
  });
}
