export interface PushMessage {
  to: string;
  title?: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushSender {
  readonly enabled: boolean;
  send(messages: PushMessage[]): Promise<Array<{ ok: boolean; error?: string }>>;
}

/** Best-effort delivery through the Expo push service. */
export class ExpoPushSender implements PushSender {
  constructor(
    readonly enabled: boolean,
    private url: string,
    private accessToken: string | null,
  ) {}

  async send(messages: PushMessage[]): Promise<Array<{ ok: boolean; error?: string }>> {
    if (!this.enabled || !messages.length) return messages.map(() => ({ ok: true }));
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    const res = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(messages.map((m) => ({ ...m, sound: 'default' }))),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Expo push HTTP ${res.status}`);
    const json = (await res.json()) as { data?: Array<{ status: string; message?: string; details?: { error?: string } }> };
    return (json.data ?? []).map((t) =>
      t.status === 'ok' ? { ok: true } : { ok: false, error: t.details?.error ?? t.message ?? 'error' },
    );
  }
}

export class RecordingPushSender implements PushSender {
  readonly enabled = true;
  sent: PushMessage[] = [];
  async send(messages: PushMessage[]) {
    this.sent.push(...messages);
    return messages.map(() => ({ ok: true }));
  }
}
