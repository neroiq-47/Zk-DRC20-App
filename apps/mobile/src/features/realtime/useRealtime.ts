import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { WS_URL } from '@/lib/config';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { applyRealtimeEvent, parseRealtimeEvent } from './applyEvent';
import { useRealtimeStatus } from './status';

const MIN_DELAY = 1000;
const MAX_DELAY = 30_000;

/** Backoff with full jitter: 1s, 2s, 4s ... capped at 30s. */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const cap = Math.min(MAX_DELAY, MIN_DELAY * 2 ** Math.max(0, attempt));
  return Math.round(MIN_DELAY / 2 + random() * (cap - MIN_DELAY / 2));
}

/**
 * Keeps one WebSocket open to the realtime endpoint while signed in and the app is active.
 * Reconnects with backoff, refreshes the access token before reconnecting, and applies events
 * to the react-query caches.
 */
export function useRealtime() {
  const qc = useQueryClient();
  const signedIn = useSession((s) => s.status === 'signedIn');
  const setStatus = useRealtimeStatus((s) => s.setStatus);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!signedIn) {
      setStatus('idle');
      return;
    }
    let disposed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active = AppState.currentState === 'active' || AppState.currentState == null;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const schedule = () => {
      clearTimer();
      if (disposed || !active) return;
      timer = setTimeout(connect, reconnectDelay(attempt++));
    };

    async function connect() {
      if (disposed || !active || wsRef.current) return;
      setStatus('connecting');
      let tokens = useSession.getState().tokens;
      if (tokens && tokens.expires_at - Date.now() < 60_000) {
        // Any authed request refreshes an expiring access token.
        await api('/users/me').catch(() => undefined);
        tokens = useSession.getState().tokens;
      }
      if (!tokens || disposed || !active) {
        setStatus('closed');
        return;
      }
      const ws = new WebSocket(`${WS_URL}?access_token=${encodeURIComponent(tokens.access_token)}`);
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setStatus('open');
        // Catch up on anything missed while disconnected.
        qc.invalidateQueries({ queryKey: ['conversations'] });
        qc.invalidateQueries({ queryKey: ['notifications'] });
      };
      ws.onmessage = (e) => {
        const event = parseRealtimeEvent(e.data);
        if (event) applyRealtimeEvent(qc, event, useSession.getState().user?.id ?? null);
      };
      ws.onerror = () => {
        // onclose follows; reconnect happens there.
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        setStatus('closed');
        schedule();
      };
    }

    const close = () => {
      clearTimer();
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      setStatus('closed');
    };

    const sub = AppState.addEventListener('change', (state) => {
      const nowActive = state === 'active';
      if (nowActive === active) return;
      active = nowActive;
      if (active) {
        attempt = 0;
        connect();
      } else {
        close();
      }
    });

    connect();
    return () => {
      disposed = true;
      sub.remove();
      close();
      setStatus('idle');
    };
  }, [signedIn, qc, setStatus]);
}
