import { ByteReader, decodeDateTime } from '../dlms/axdr';
import type { DlmsData, DlmsDateTime } from '../dlms/types';
import type { ColumnSpec, Reading } from './templates';

function cellDate(cell: DlmsData | undefined): DlmsDateTime | null {
  if (cell?.t === 'datetime') return cell.v;
  if (cell?.t === 'octet' && cell.v.length === 12) return decodeDateTime(new ByteReader(cell.v));
  return null;
}

/** Cells are matched to columns by position. Unreadable/absent cells are missing (value null), never 0. */
export function decodeRow(row: DlmsData[], cols: ColumnSpec[]): Reading[] {
  return cols.map((s, i): Reading => {
    const base = { key: s.key, obis: s.obis, scaler: s.scaler, unit: s.unit };
    const miss: Reading = { ...base, raw: null, value: null, missing: true };
    const cell = row[i];
    if (s.kind === 'datetime') {
      const d = cellDate(cell);
      if (!d || d.missing || !d.date) return miss;
      const ms = d.date.getTime();
      return { ...base, raw: ms, value: ms, missing: false };
    }
    if (!cell || !('v' in cell) || typeof cell.v !== 'number') return miss;
    return { ...base, raw: cell.v, value: cell.v * 10 ** s.scaler, missing: false };
  });
}
