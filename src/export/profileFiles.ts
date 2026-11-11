import type { ProfileData } from '../profiles/history';
import { bangkokIso } from './format';

const DEMAND_IMPORT = /^1\.0\.1\.27\./;

/** SAP "LP General 0525" text (format reverse-engineered from PEA LPConverter 1.0.1): ASCII, CRLF,
 *  `kw\t\t`, `PEA_Number \t\t<pea>`, then `YYYYMMDD\tHH:MM\t<kW .5f>` per point in Bangkok time.
 *  Uses the import demand column (1.0.1.27); null when the profile has none. */
export function sapText(pea: string, p: ProfileData): string | null {
  const di = p.columns.findIndex((c) => DEMAND_IMPORT.test(c.obis));
  if (di < 0) return null;
  const perKw = p.columns[di].unit === 'W' ? 1000 : 1; // SAP wants kW; some meters report W
  const lines = ['kw\t\t', `PEA_Number \t\t${pea}`];
  for (const r of p.rows) {
    if (r[0] == null) continue;
    const t = bangkokIso(r[0]); // 2026-11-09T00:15:00.000+07:00
    lines.push(`${t.slice(0, 10).replace(/-/g, '')}\t${t.slice(11, 16)}\t${((Number(r[di + 1]) || 0) / perKw).toFixed(5)}`);
  }
  return lines.join('\r\n') + '\r\n';
}

/** Wide CSV for Excel: BOM, `เวลา` (Bangkok) then one column per captured value with its unit; empty = unreadable. */
export function profileCsv(p: ProfileData): string {
  const head = ['เวลา', ...p.columns.map((c) => `${c.key} [${c.obis}]${c.unit ? ` (${c.unit})` : ''}`)];
  const rows = p.rows.map((r) => [r[0] == null ? '' : bangkokIso(r[0]).slice(0, 19).replace('T', ' '), ...r.slice(1).map((v) => (v == null ? '' : String(v)))]);
  return '﻿' + [head, ...rows].map((r) => r.map((s) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)).join(',')).join('\r\n') + '\r\n';
}
