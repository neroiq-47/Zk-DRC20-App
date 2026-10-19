import { describe, expect, it } from '@jest/globals';
import { addressProblemMessage, dogecoinAddressProblem, isLikelyDogecoinAddress, truncateMiddle } from '../address';

describe('isLikelyDogecoinAddress', () => {
  it('accepts plausible mainnet addresses', () => {
    expect(isLikelyDogecoinAddress('DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L')).toBe(true);
    expect(isLikelyDogecoinAddress('  DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L  ')).toBe(true);
    expect(isLikelyDogecoinAddress('A8tVv2ZkUQDzq9cXJp7mJkDUMr2yAj7Y2T')).toBe(true);
    expect(isLikelyDogecoinAddress('9xh3JkAnLKd5H3ULk9yUe7S6rH7m4fKRdd')).toBe(true);
  });

  it('rejects empty input', () => {
    expect(dogecoinAddressProblem('')).toBe('empty');
    expect(dogecoinAddressProblem('   ')).toBe('empty');
  });

  it('rejects wrong prefixes (bitcoin, litecoin, testnet)', () => {
    expect(dogecoinAddressProblem('1BoatSLRHtKNngkdXEeobR76b53LETtpyT')).toBe('prefix');
    expect(dogecoinAddressProblem('LZ3pJ5hJmJ8xNbN4mRhYkY8uV7tEUQ2JZu')).toBe('prefix');
    expect(dogecoinAddressProblem('nZ3pJ5hJmJ8xNbN4mRhYkY8uV7tEUQ2JZu')).toBe('prefix');
  });

  it('rejects non-base58 characters', () => {
    expect(dogecoinAddressProblem('DH5yaieqoZN36fDVciNyRueRGvGLR3mr0L')).toBe('characters'); // 0
    expect(dogecoinAddressProblem('DH5yaieqoZN36fDVciNyRueRGvGLR3mrOL')).toBe('characters'); // O
    expect(dogecoinAddressProblem('DH5yaieqoZN36fDVciNyRueRGvGLR3mrIL')).toBe('characters'); // I
    expect(dogecoinAddressProblem('DH5yaieqoZN36fDVciNyRueRGvGLR3mrlL')).toBe('characters'); // l
    expect(dogecoinAddressProblem('DH5yaieqoZN36fDV ciNyRueRGvGLR3mr7L')).toBe('characters');
  });

  it('rejects bad lengths', () => {
    expect(dogecoinAddressProblem('DH5yaieqoZN36fDVciNyRue')).toBe('length'); // 23
    expect(dogecoinAddressProblem('DH5yaieqoZN36fDVciNyRueRGvGLR3mr7LXX')).toBe('length'); // 36
    expect(isLikelyDogecoinAddress('D' + '1'.repeat(24))).toBe(true); // 25
    expect(isLikelyDogecoinAddress('D' + '1'.repeat(33))).toBe(true); // 34
  });

  it('has friendly messages', () => {
    expect(addressProblemMessage('prefix')).toMatch(/start with D, A or 9/);
    expect(addressProblemMessage(null)).toBeNull();
  });
});

describe('truncateMiddle', () => {
  it('keeps short values', () => {
    expect(truncateMiddle('abc')).toBe('abc');
  });
  it('truncates long values', () => {
    expect(truncateMiddle('DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L')).toBe('DH5yai…R3mr7L');
  });
});
