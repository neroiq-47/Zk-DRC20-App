import { describe, expect, it } from '@jest/globals';
import { handleError, isValidEmail, isValidHandle, normalizeHandleInput, passwordError } from '../validation';

describe('handle validation', () => {
  it('accepts valid handles', () => {
    for (const h of ['abc', 'doge_fan_42', 'a'.repeat(30), '___']) expect(isValidHandle(h)).toBe(true);
  });
  it('rejects invalid handles', () => {
    for (const h of ['ab', 'a'.repeat(31), 'Alice', 'has space', 'dash-y', 'émile', '']) expect(isValidHandle(h)).toBe(false);
  });
  it('explains what is wrong', () => {
    expect(handleError('')).toBeNull();
    expect(handleError('ok_handle')).toBeNull();
    expect(handleError('Bob')).toMatch(/lowercase/);
    expect(handleError('a-b')).toMatch(/letters, numbers and underscores/);
    expect(handleError('ab')).toMatch(/at least 3/);
    expect(handleError('a'.repeat(31))).toMatch(/up to 30/);
  });
  it('normalizes typed input', () => {
    expect(normalizeHandleInput('@Doge Fan')).toBe('dogefan');
  });
});

describe('email and password', () => {
  it('checks email shape', () => {
    expect(isValidEmail('me@zoko.app')).toBe(true);
    expect(isValidEmail('nope')).toBe(false);
  });
  it('requires 12+ character passwords', () => {
    expect(passwordError('')).toBeNull();
    expect(passwordError('short')).toMatch(/12/);
    expect(passwordError('long enough pw')).toBeNull();
  });
});
