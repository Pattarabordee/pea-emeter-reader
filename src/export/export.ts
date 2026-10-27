import type { Reading } from '../profiles/templates';

// Layout: UTF-8 BOM, then `# <key>: <json>` meta lines, then a header row, then one row per Reading.
// `record` is the 0-based index of the Reading[] in `rows`, so records stay distinguishable.
// A missing (or null) raw/value cell is empty, never 0.
const COLUMNS = ['record', 'key', 'obis', 'raw', 'scaler', 'unit', 'value', 'missing'] as const;

const esc = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const num = (r: Reading, v: number | null): string => (r.missing || v === null ? '' : String(v));

export function toCsv(rows: Reading[][], meta: Record<string, unknown>): string {
  const lines = Object.entries(meta).map(([k, v]) => `# ${k}: ${JSON.stringify(v)}`);
  lines.push(COLUMNS.join(','));
  rows.forEach((record, i) =>
    record.forEach((r) =>
      lines.push([String(i), esc(r.key), esc(r.obis), num(r, r.raw), String(r.scaler), esc(r.unit), num(r, r.value), String(r.missing)].join(',')),
    ),
  );
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function toJson(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

/** The only browser-touching function. */
export function download(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been dispatched; some browsers (Firefox) fail if revoked synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
