/** Amounts arrive as decimal strings ("35000.00"); format without converting to floats. */
export function money(amount: string | null | undefined, currency = 'TZS'): string {
  if (amount == null) return '—';
  const negative = amount.startsWith('-');
  const [whole = '0', frac] = (negative ? amount.slice(1) : amount).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '−' : ''}${currency} ${grouped}${frac ? `.${frac}` : ''}`;
}

/** Compact axis label: 1,330,000.00 → 1.3M */
export function compact(amount: string): string {
  const n = Number(amount);
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(Math.round(n));
}

const dateTime = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Dar_es_Salaam' });
const dateOnly = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Dar_es_Salaam' });

export const when = (iso: string | null | undefined) => (iso ? dateTime.format(new Date(iso)) : '—');
export const day = (iso: string | null | undefined) => (iso ? dateOnly.format(new Date(iso)) : '—');

export function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const ACRONYMS: Record<string, string> = { p2p: 'P2P', kyc: 'KYC', fx: 'FX', id: 'ID' };

/** "P2P_TRANSFER" → "P2P transfer", "NATIONAL_ID" → "National ID" */
export const humanize = (s: string) => {
  const words = s.toLowerCase().split('_').map((w) => ACRONYMS[w] ?? w);
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
};

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
