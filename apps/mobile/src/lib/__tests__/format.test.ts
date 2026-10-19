import { describe, expect, it } from '@jest/globals';
import { compactCount, plural, relativeTime } from '../format';

describe('relativeTime', () => {
  const now = new Date(2026, 9, 19, 12, 0, 0);
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it('shows now for very recent times', () => {
    expect(relativeTime(ago(2_000), now)).toBe('now');
    expect(relativeTime(ago(-5_000), now)).toBe('now'); // slight clock skew
  });
  it('uses seconds, minutes, hours and days', () => {
    expect(relativeTime(ago(30_000), now)).toBe('30s');
    expect(relativeTime(ago(2 * 60_000), now)).toBe('2m');
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe('3h');
    expect(relativeTime(ago(2 * 86_400_000), now)).toBe('2d');
  });
  it('switches to a date after a week', () => {
    expect(relativeTime(new Date(2026, 9, 4, 9, 0), now)).toBe('Oct 4');
    expect(relativeTime(new Date(2024, 0, 15), now)).toBe('Jan 15, 2024');
  });
  it('returns empty string for invalid input', () => {
    expect(relativeTime('not a date', now)).toBe('');
  });
});

describe('compactCount', () => {
  it('keeps small numbers as is', () => {
    expect(compactCount(0)).toBe('0');
    expect(compactCount(999)).toBe('999');
  });
  it('compacts thousands, millions and billions without overstating', () => {
    expect(compactCount(1000)).toBe('1K');
    expect(compactCount(1234)).toBe('1.2K');
    expect(compactCount(1299)).toBe('1.2K');
    expect(compactCount(15_300)).toBe('15.3K');
    expect(compactCount(999_999)).toBe('999K');
    expect(compactCount(2_000_000)).toBe('2M');
    expect(compactCount(1_250_000)).toBe('1.2M');
    expect(compactCount(3_400_000_000)).toBe('3.4B');
  });
  it('handles odd input', () => {
    expect(compactCount(NaN)).toBe('0');
    expect(compactCount(-1500)).toBe('-1.5K');
  });
});

describe('plural', () => {
  it('picks the right form', () => {
    expect(plural(1, 'follower')).toBe('follower');
    expect(plural(2, 'follower')).toBe('followers');
    expect(plural(0, 'reply', 'replies')).toBe('replies');
  });
});
