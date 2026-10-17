import type { Money } from './types';

/** "TZS 56,500.00" -> { currency: "TZS", amount: "56,500" } (drops .00 on whole amounts). */
export function splitMoney(m: Money): { currency: string; amount: string } {
  const [currency = '', amount = ''] = m.formatted.split(' ');
  return { currency, amount: amount.replace(/\.00$/, '') };
}

export const short = (m: Money) => {
  const { currency, amount } = splitMoney(m);
  return `${currency} ${amount}`;
};

export function relativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso);
  const mins = Math.round((now - t.getTime()) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const time = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return `${t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
}

/** "JUMA HAMISI" -> "Juma Hamisi" for greetings and lists. */
export const titleCase = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().replace(/(^|\s|-)\p{L}/gu, (c) => c.toUpperCase());

export const initials = (s: string | null | undefined) =>
  titleCase(s).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('') || '·';

/** Morning/afternoon/evening greeting in Swahili, as Tanzanian merchants expect. */
export function greeting(date = new Date()): string {
  const h = date.getHours();
  return h < 12 ? 'Habari za asubuhi' : h < 17 ? 'Habari za mchana' : 'Habari za jioni';
}
