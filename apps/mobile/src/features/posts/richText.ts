export type RichSegment =
  | { type: 'text'; text: string }
  | { type: 'hashtag'; text: string; tag: string }
  | { type: 'mention'; text: string; handle: string }
  | { type: 'link'; text: string; url: string };

// Hashtags: letters/digits/underscore (unicode letters allowed), must contain a non-digit.
// Mentions follow the handle rule ^[a-z0-9_]{3,30}$ (case-insensitive in text).
// Links: http(s) URLs or bare www. hosts.
const TOKEN = /(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+)|(^|[^\p{L}\p{N}_&/])#([\p{L}\p{N}_]{1,100})|(^|[^\p{L}\p{N}_@./])@([A-Za-z0-9_]{3,30})(?![A-Za-z0-9_@])/gu;
const TRAILING_PUNCT = /[.,!?;:)\]}'"]+$/;

export function parseRichText(body: string): RichSegment[] {
  const out: RichSegment[] = [];
  let last = 0;
  const pushText = (s: string) => {
    if (!s) return;
    const prev = out[out.length - 1];
    if (prev && prev.type === 'text') prev.text += s;
    else out.push({ type: 'text', text: s });
  };
  for (const m of body.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (m[1]) {
      let url = m[1];
      const trail = url.match(TRAILING_PUNCT)?.[0] ?? '';
      if (trail) url = url.slice(0, -trail.length);
      pushText(body.slice(last, idx));
      out.push({ type: 'link', text: url, url: url.startsWith('http') ? url : `https://${url}` });
      last = idx + url.length;
    } else if (m[3] !== undefined) {
      const tag = m[3];
      if (/^\p{N}+$/u.test(tag)) continue; // "#1" is not a hashtag
      const start = idx + m[2].length;
      pushText(body.slice(last, start));
      out.push({ type: 'hashtag', text: `#${tag}`, tag });
      last = start + 1 + tag.length;
    } else if (m[5] !== undefined) {
      const start = idx + m[4].length;
      pushText(body.slice(last, start));
      out.push({ type: 'mention', text: `@${m[5]}`, handle: m[5].toLowerCase() });
      last = start + 1 + m[5].length;
    }
  }
  pushText(body.slice(last));
  return out;
}

export function extractHashtags(body: string): string[] {
  return [...new Set(parseRichText(body).flatMap((s) => (s.type === 'hashtag' ? [s.tag.toLowerCase()] : [])))];
}

export function extractMentions(body: string): string[] {
  return [...new Set(parseRichText(body).flatMap((s) => (s.type === 'mention' ? [s.handle] : [])))];
}
