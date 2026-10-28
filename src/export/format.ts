import type { Reading } from '../profiles/templates';
import { toCsv } from './export';

const BKK_MS = 7 * 3600 * 1000; // Asia/Bangkok has no DST

export const bangkokIso = (epochMs: number): string => new Date(epochMs + BKK_MS).toISOString().slice(0, -1) + '+07:00';

export const exportName = (mac: string, mode: 'billing' | 'voltage24h', now: number = Date.now()): string =>
  `${mac.replace(/[^0-9A-Za-z]/g, '-')}_${mode}_${bangkokIso(now).slice(0, 10)}`;

/** toCsv plus a `# timestamp:` header mapping record index -> Bangkok ISO ("missing" if the clock is unreadable). */
export function csvWithTime(rows: Reading[][], meta: Record<string, unknown>): string {
  const timestamp: Record<string, string> = {};
  rows.forEach((rec, i) => {
    const c = rec.find((r) => r.key === 'clock');
    timestamp[i] = !c || c.missing || c.value === null ? 'missing' : bangkokIso(c.value);
  });
  return toCsv(rows, { ...meta, timestamp });
}
