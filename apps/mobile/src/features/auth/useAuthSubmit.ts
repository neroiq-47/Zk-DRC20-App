import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthResponse, LoginRequest, RegisterRequest } from '@zoko/contracts';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { meKey } from '@/lib/useMe';

async function completeSignIn(res: AuthResponse, qc: ReturnType<typeof useQueryClient>) {
  qc.setQueryData(meKey, res.user);
  useSession.getState().setUser(res.user);
  // Flipping the session to signedIn makes the root Stack.Protected guard switch to the app.
  await useSession.getState().setTokens(res);
}

export function useSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => api<AuthResponse>('/auth/login', { method: 'POST', body, auth: false }),
    onSuccess: (res) => completeSignIn(res, qc),
  });
}

export function useSignUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RegisterRequest) => api<AuthResponse>('/auth/register', { method: 'POST', body, auth: false }),
    onSuccess: (res) => completeSignIn(res, qc),
  });
}

/** Maps an error to a form-level message and per-field messages from Problem.errors. */
export function describeAuthError(err: unknown, kind: 'signin' | 'signup'): { message: string | null; fields: Record<string, string> } {
  if (!err) return { message: null, fields: {} };
  if (err instanceof ApiError) {
    const fields = err.problem?.errors ?? {};
    if (kind === 'signin' && (err.status === 401 || err.status === 400)) return { message: "That email and password don't match. Try again.", fields };
    if (err.status === 429) return { message: 'Too many attempts. Wait a moment and try again.', fields };
    if (err.status === 409 && !Object.keys(fields).length) return { message: err.problem?.detail ?? 'That email or handle is already in use.', fields };
    if (Object.keys(fields).length) return { message: null, fields };
    return { message: err.problem?.detail ?? err.problem?.title ?? 'Something went wrong. Try again.', fields };
  }
  return { message: "We couldn't reach Zoko. Check your connection and try again.", fields: {} };
}
