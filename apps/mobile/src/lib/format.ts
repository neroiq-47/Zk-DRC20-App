const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Short relative time for feeds: "now", "45s", "2m", "3h", "5d", then "Oct 4"
 * (or "Oct 4, 2024" when the year differs from now).
 */
export function relativeTime(iso: string | Date, now: Date = new Date()): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const ms = d.getTime();
  if (Number.isNaN(ms)) return '';
  const sec = Math.floor((now.getTime() - ms) / 1000);
  if (sec < 5) return 'now';
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const label = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? label : `${label}, ${d.getFullYear()}`;
}

/** "Joined October 2024" style month + year. */
export function monthYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const full = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${full[d.getMonth()]} ${d.getFullYear()}`;
}

function trim(n: number): string {
  // one decimal, dropping a trailing ".0"
  const s = (Math.floor(n * 10) / 10).toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** Compact counts: 999 -> "999", 1234 -> "1.2K", 15300 -> "15.3K", 2_000_000 -> "2M". Rounds down so we never overstate. */
export function compactCount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(Math.trunc(n));
  if (a < 1000) return `${sign}${a}`;
  if (a < 1_000_000) {
    const k = a / 1000;
    return `${sign}${k >= 100 ? Math.floor(k) : trim(k)}K`;
  }
  if (a < 1_000_000_000) {
    const m = a / 1_000_000;
    return `${sign}${m >= 100 ? Math.floor(m) : trim(m)}M`;
  }
  const b = a / 1_000_000_000;
  return `${sign}${b >= 100 ? Math.floor(b) : trim(b)}B`;
}

/** "1 follower" / "2 followers" helper. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}
