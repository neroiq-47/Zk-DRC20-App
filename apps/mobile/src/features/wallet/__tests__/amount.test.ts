import { describe, expect, it } from '@jest/globals';
import { compareUnits, formatDoge, formatUnits, parseUnits } from '../amount';

describe('formatUnits', () => {
  it('formats zero', () => {
    expect(formatUnits('0', 8)).toBe('0');
    expect(formatUnits('0', 0)).toBe('0');
    expect(formatUnits('000', 18)).toBe('0');
  });

  it('handles 0 decimals', () => {
    expect(formatUnits('12345', 0)).toBe('12345');
    expect(formatUnits('0012345', 0)).toBe('12345');
  });

  it('handles 18 decimals', () => {
    expect(formatUnits('1', 18)).toBe('0.000000000000000001');
    expect(formatUnits('1000000000000000000', 18)).toBe('1');
    expect(formatUnits('1234567890123456789', 18)).toBe('1.234567890123456789');
  });

  it('strips trailing zeros', () => {
    expect(formatUnits('150000000', 8)).toBe('1.5');
    expect(formatUnits('100000000', 8)).toBe('1');
    expect(formatUnits('10', 2)).toBe('0.1');
  });

  it('handles huge values without precision loss', () => {
    const huge = '123456789012345678901234567890123456789';
    expect(formatUnits(huge, 18)).toBe('123456789012345678901.234567890123456789');
    expect(formatUnits(huge, 0, { group: true })).toBe('123,456,789,012,345,678,901,234,567,890,123,456,789');
  });

  it('groups thousands and truncates fraction when asked', () => {
    expect(formatUnits('123456789000', 8, { group: true })).toBe('1,234.56789');
    expect(formatUnits('123456789999', 8, { maxFractionDigits: 2 })).toBe('1234.56');
  });

  it('returns a dash for invalid input', () => {
    expect(formatUnits('1.5', 8)).toBe('—');
    expect(formatUnits('abc', 8)).toBe('—');
    expect(formatUnits('', 8)).toBe('—');
  });

  it('formats DOGE from koinu', () => {
    expect(formatDoge('2500000000000')).toBe('25,000');
    expect(formatDoge(null)).toBe('—');
  });
});

describe('parseUnits', () => {
  it('parses zero', () => {
    expect(parseUnits('0', 8)).toBe('0');
    expect(parseUnits('0.0', 8)).toBe('0');
  });

  it('parses integers with 0 decimals', () => {
    expect(parseUnits('42', 0)).toBe('42');
    expect(parseUnits('42.', 0)).toBe('42');
    expect(parseUnits('42.5', 0)).toBeNull();
    expect(parseUnits('42.0', 0)).toBe('42');
  });

  it('parses 18 decimals', () => {
    expect(parseUnits('1', 18)).toBe('1000000000000000000');
    expect(parseUnits('0.000000000000000001', 18)).toBe('1');
    expect(parseUnits('1.234567890123456789', 18)).toBe('1234567890123456789');
  });

  it('accepts trailing zeros and leading dots', () => {
    expect(parseUnits('1.50', 8)).toBe('150000000');
    expect(parseUnits('.5', 8)).toBe('50000000');
    expect(parseUnits('1.500000000000', 2)).toBe('150');
  });

  it('rejects too many decimals', () => {
    expect(parseUnits('0.123456789', 8)).toBeNull();
    expect(parseUnits('1.001', 2)).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(parseUnits('', 8)).toBeNull();
    expect(parseUnits('.', 8)).toBeNull();
    expect(parseUnits('-1', 8)).toBeNull();
    expect(parseUnits('1e5', 8)).toBeNull();
    expect(parseUnits('1.2.3', 8)).toBeNull();
    expect(parseUnits('abc', 8)).toBeNull();
  });

  it('handles huge values and separators', () => {
    expect(parseUnits('123456789012345678901.234567890123456789', 18)).toBe('123456789012345678901234567890123456789');
    expect(parseUnits(' 1,000,000.25 ', 2)).toBe('100000025');
  });

  it('round-trips with formatUnits', () => {
    for (const [v, d] of [
      ['1.5', 8],
      ['0.00000001', 8],
      ['999999999999.999999999999999999', 18],
      ['7', 0],
    ] as const) {
      expect(formatUnits(parseUnits(v, d)!, d)).toBe(v);
    }
  });
});

describe('compareUnits', () => {
  it('compares big strings', () => {
    expect(compareUnits('100000000000000000000000', '99999999999999999999999')).toBe(1);
    expect(compareUnits('5', '5')).toBe(0);
    expect(compareUnits('4', '5')).toBe(-1);
  });
});
