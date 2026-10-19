// Basic client-side checks only. The server verifies addresses and signatures for real.

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

export type AddressProblem = 'empty' | 'length' | 'prefix' | 'characters' | null;

/** Returns why an input does not look like a Dogecoin mainnet address, or null when it looks fine. */
export function dogecoinAddressProblem(input: string): AddressProblem {
  const a = (input ?? '').trim();
  if (!a) return 'empty';
  if (!BASE58.test(a)) return 'characters';
  if (a.length < 25 || a.length > 34) return 'length';
  if (!/^[DA9]/.test(a)) return 'prefix';
  return null;
}

export function isLikelyDogecoinAddress(input: string): boolean {
  return dogecoinAddressProblem(input) === null;
}

export function addressProblemMessage(p: AddressProblem): string | null {
  switch (p) {
    case 'empty':
      return 'Enter a Dogecoin address.';
    case 'characters':
      return 'This address has characters Dogecoin addresses never use. Check for typos or extra spaces.';
    case 'length':
      return 'Dogecoin addresses are 25 to 34 characters long.';
    case 'prefix':
      return 'Dogecoin mainnet addresses start with D, A or 9.';
    default:
      return null;
  }
}

export function truncateMiddle(value: string, head = 6, tail = 6): string {
  if (!value || value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
