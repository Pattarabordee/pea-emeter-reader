import type { DlmsClient } from '../dlms/client';
import { getCaptureObjects, getCapturePeriod, getEntriesInUse } from '../dlms/profile';
import { readRange } from './read';
import { billingTemplate, eventTemplate, loadTemplate, verifyCapture, type ColumnSpec, type Reading } from './templates';

// Whole-profile reads with each column scaled by the meter's own scaler_unit. Shared by the web app and the laptop tool.
export const PROFILES = {
  billing: { obis: '1.0.98.1.0.255', template: billingTemplate },
  event: { obis: '0.0.99.98.0.255', template: eventTemplate },
  load: { obis: '1.0.99.1.0.255', template: loadTemplate },
} as const;
export type ProfileKind = keyof typeof PROFILES | 'log'; // 'log' = any other ProfileGeneric in the object list
const UNITS: Record<number, string> = { 27: 'W', 28: 'VA', 29: 'var', 30: 'Wh', 31: 'VAh', 32: 'varh', 33: 'A', 35: 'V', 44: 'Hz', 255: '' };

export type ProfileColumn = { key: string; obis: string; unit: string; scaler: number };
export type ProfileData = {
  kind: ProfileKind; obis: string; error?: string; periodSec: number; entries: number;
  columns: ProfileColumn[]; rows: (number | null)[][]; // rows[i][0] = epoch ms, then one cell per column
};

/** scaler_unit of a captured register: class 3/4 attr 3, class 5 (demand register) attr 4. Null when unreadable. */
export async function scalerUnitOf(client: DlmsClient, classId: number, obis: string): Promise<{ scaler: number; unit: string } | null> {
  const attr = classId === 3 || classId === 4 ? 3 : classId === 5 ? 4 : 0;
  if (!attr) return null;
  try {
    const d = await client.get(classId, obis, attr);
    if (d.t !== 'structure' || d.v.length < 2) return null;
    const [s, u] = d.v;
    if (!('v' in s) || typeof s.v !== 'number' || u.t !== 'enum') return null;
    return { scaler: s.v, unit: UNITS[u.v] ?? '' };
  } catch {
    return null;
  }
}

/** Rows per day of the load profile (capture period; 15 min when unreadable). */
export async function loadRowsPerDay(client: DlmsClient): Promise<number> {
  const period = await getCapturePeriod(client, PROFILES.load.obis).catch(() => 900);
  return Math.ceil(86400 / (Number.isFinite(period) && period > 0 ? period : 900));
}

/** One profile: capture objects, per-column scaler_unit, then entries (the last `maxEntries`, or all when null).
 *  Never throws: a failure is returned as `error`, and the rows read before it are kept. `onRows` gets the
 *  same object after every chunk, so a caller that gives up (timeout) still has the partial read. */
export async function readProfile(client: DlmsClient, kind: ProfileKind, type: 1 | 3, maxEntries: number | null, logObis = '',
  onRows?: (n: number, total: number, partial: ProfileData) => void): Promise<ProfileData> {
  // A 'log' has no template: verifyCapture derives its columns from the meter's own capture_objects.
  const { obis, template } = kind === 'log' ? { obis: logObis, template: (): ColumnSpec[] => [] } : PROFILES[kind];
  const out: ProfileData = { kind, obis, periodSec: 0, entries: 0, columns: [], rows: [] };
  try {
    out.periodSec = await getCapturePeriod(client, obis).catch(() => 0);
    const objects = await getCaptureObjects(client, obis);
    const cols: ColumnSpec[] = verifyCapture(template(type), objects).columns;
    for (const [i, c] of cols.entries()) {
      if (c.kind === 'datetime') continue;
      // Voltage registers (1.0.{12,32,52,72}.x) are x0.01 on PEA meters whatever the meter declares (field: logs
      // showed 2129 V for 212.9 V with the meter's own scaler). Force -2 V; other columns take their scaler_unit.
      if (/^1\.\d+\.(12|32|52|72)\.\d+\.\d+\.255$/.test(c.obis)) { cols[i] = { ...c, scaler: -2, unit: 'V' }; continue; }
      const su = await scalerUnitOf(client, objects[i]?.classId ?? 0, c.obis);
      if (su) cols[i] = { ...c, scaler: su.scaler, unit: su.unit || c.unit };
    }
    const clockAt = cols.findIndex((c) => c.kind === 'datetime');
    out.columns = cols.filter((_, i) => i !== clockAt).map((c) => ({ key: c.key, obis: c.obis, unit: c.unit, scaler: c.scaler }));
    const shape = (rows: Reading[][]) => rows.map((r) => [clockAt >= 0 ? r[clockAt].value : null, ...r.filter((_, i) => i !== clockAt).map((x) => x.value)]);
    out.entries = await getEntriesInUse(client, obis);
    const from = maxEntries == null ? 1 : Math.max(1, out.entries - maxEntries + 1);
    const want = out.entries - from + 1;
    if (out.entries) {
      const rows = await readRange(client, obis, cols, from, out.entries, {
        onChunk: (n, soFar) => { out.rows = shape(soFar); onRows?.(n, want, out); },
      });
      out.rows = shape(rows);
    }
  } catch (e) {
    out.error = (e as Error).message;
  }
  return out;
}
