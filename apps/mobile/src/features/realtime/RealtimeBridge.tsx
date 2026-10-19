import { useRealtime } from './useRealtime';

/** Mount once inside the signed-in app layout (inside QueryClientProvider). Renders nothing. */
export function RealtimeBridge() {
  useRealtime();
  return null;
}
