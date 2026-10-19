export const HANDLE_RE = /^[a-z0-9_]{3,30}$/;
export const MIN_PASSWORD = 12;

export function isValidHandle(handle: string): boolean {
  return HANDLE_RE.test(handle);
}

/** Live feedback for the handle field. Returns null when valid or empty. */
export function handleError(handle: string): string | null {
  if (!handle) return null;
  if (/[A-Z]/.test(handle)) return 'Use lowercase letters only.';
  if (/[^a-zA-Z0-9_]/.test(handle)) return 'Use letters, numbers and underscores only.';
  if (handle.length < 3) return 'Handles need at least 3 characters.';
  if (handle.length > 30) return 'Handles can be up to 30 characters.';
  return null;
}

/** Normalizes typed input for the handle field: strips a leading @ and lowercases. */
export function normalizeHandleInput(raw: string): string {
  return raw.replace(/^@+/, '').toLowerCase().replace(/\s+/g, '');
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function passwordError(pw: string): string | null {
  if (!pw) return null;
  return pw.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters.` : null;
}
