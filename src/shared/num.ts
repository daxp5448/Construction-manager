/**
 * Exact numeric helpers.
 *
 * Money is stored as integer PAISE (1 rupee = 100 paise).
 * Quantities / weights / dimensions are stored as integer MILLI-units (x1000).
 * Percentages are stored as integer BASIS POINTS (1% = 100 bp, so 18% = 1800).
 * All multiplications go through BigInt so large rate x quantity products never
 * lose precision, and rounding is always "half away from zero".
 */

/** Parse a decimal string (with optional commas) into an integer scaled by 10^scale. Returns null when empty/invalid. */
export function parseScaled(input: string | number | null | undefined, scale: number): number | null {
  if (input === null || input === undefined) return null;
  let s = typeof input === 'number' ? String(input) : input;
  s = s.replace(/[,₹\s]/g, '');
  if (s === '' || s === '-' || s === '.') return null;
  if (/e/i.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    s = n.toFixed(scale);
  }
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const neg = !!m[1];
  const intPart = m[2] || '0';
  let frac = m[3] || '';
  let roundUp = false;
  if (frac.length > scale) {
    roundUp = frac.charCodeAt(scale) >= 53; // '5'
    frac = frac.slice(0, scale);
  }
  frac = frac.padEnd(scale, '0');
  let v = BigInt(intPart + frac) + (roundUp ? 1n : 0n);
  if (neg) v = -v;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

export const parseMoney = (v: string | number | null | undefined) => parseScaled(v, 2);
export const parseQty = (v: string | number | null | undefined) => parseScaled(v, 3);
export const parsePct = (v: string | number | null | undefined) => parseScaled(v, 2);

export function formatScaled(n: number | null | undefined, scale: number, minDecimals = scale, maxDecimals = scale): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  const neg = n < 0;
  const abs = BigInt(Math.abs(Math.round(n)));
  const base = 10n ** BigInt(scale);
  const ip = (abs / base).toString();
  let fp = (abs % base).toString().padStart(scale, '0');
  while (fp.length > minDecimals && fp.endsWith('0')) fp = fp.slice(0, -1);
  if (fp.length > maxDecimals) fp = fp.slice(0, maxDecimals);
  return (neg ? '-' : '') + ip + (fp.length ? '.' + fp : '');
}

/** Plain editable string, no grouping (for input boxes). */
export const moneyToInput = (paise: number | null | undefined) => formatScaled(paise, 2, 0, 2);
export const qtyToInput = (milli: number | null | undefined) => formatScaled(milli, 3, 0, 3);
export const pctToInput = (bp: number | null | undefined) => formatScaled(bp, 2, 0, 2);

/** Indian digit grouping: 12,34,56,789 */
export function groupIndian(intStr: string): string {
  if (intStr.length <= 3) return intStr;
  const last3 = intStr.slice(-3);
  let rest = intStr.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return parts.join(',') + ',' + last3;
}

/** ₹ 12,34,567.89 */
export function formatINR(paise: number | null | undefined, opts: { symbol?: boolean; decimals?: number } = {}): string {
  if (paise === null || paise === undefined || Number.isNaN(paise)) return '';
  const { symbol = true, decimals = 2 } = opts;
  const neg = paise < 0;
  const abs = BigInt(Math.abs(Math.round(paise)));
  let rupees = abs / 100n;
  const p = Number(abs % 100n);
  let frac = '';
  if (decimals >= 2) frac = '.' + String(p).padStart(2, '0');
  else if (decimals === 0 && p >= 50) rupees += 1n;
  return (neg ? '-' : '') + (symbol ? '₹ ' : '') + groupIndian(rupees.toString()) + frac;
}

/** 24.500 -> "24.50"; 24.375 -> "24.375" (min 2 decimals, max 3) */
export function formatQty(milli: number | null | undefined, unit?: string | null): string {
  if (milli === null || milli === undefined) return '';
  const s = formatScaled(Math.abs(milli), 3, 2, 3);
  const [i, f] = s.split('.');
  const out = (milli < 0 ? '-' : '') + groupIndian(i) + (f ? '.' + f : '');
  return unit ? `${out} ${unit}` : out;
}

export const formatPct = (bp: number | null | undefined) =>
  bp === null || bp === undefined ? '' : formatScaled(bp, 2, 0, 2) + '%';

function divRound(n: bigint, d: bigint): bigint {
  const neg = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return neg ? -q : q;
}

/** qty(milli) x rate(paise per 1 unit) -> paise */
export function mulQtyRate(qtyMilli: number, ratePaise: number): number {
  return Number(divRound(BigInt(Math.round(qtyMilli)) * BigInt(Math.round(ratePaise)), 1000n));
}

/** amount(paise) x pct(bp) / 10000 -> paise */
export function pctOf(amountPaise: number, bp: number): number {
  return Number(divRound(BigInt(Math.round(amountPaise)) * BigInt(Math.round(bp)), 10000n));
}

/** tax portion contained inside a tax-inclusive amount */
export function taxInside(grossPaise: number, bp: number): number {
  return Number(divRound(BigInt(Math.round(grossPaise)) * BigInt(Math.round(bp)), 10000n + BigInt(Math.round(bp))));
}

/** Multiply two milli quantities (L x W) giving milli: (a*b)/1000 */
export function mulMilli(a: number, b: number): number {
  return Number(divRound(BigInt(Math.round(a)) * BigInt(Math.round(b)), 1000n));
}

export const sum = (xs: Array<number | null | undefined>) => xs.reduce<number>((a, b) => a + (b || 0), 0);

// ---------- dates ----------
export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function nowLocalISO(d = new Date()): string {
  return `${todayISO(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-11-21 -> 21-Nov-2026 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}`;
}
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = /T(\d{2}:\d{2})/.exec(iso);
  return formatDate(iso) + (t ? ' ' + t[1] : '');
}
/** Indian financial year label for a date: 2026-11-21 -> "2026-27" */
export function financialYear(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
export function financialYearRange(fy: string): { from: string; to: string } {
  const start = Number(fy.slice(0, 4));
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}
export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

/** Normalise a vehicle registration: "gj 01 ab 1234" -> "GJ01AB1234" */
export function normalizeVehicle(v: string | null | undefined): string {
  return (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
