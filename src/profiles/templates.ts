import type { CaptureObject } from '../dlms/types';

export type ColumnSpec = { key: string; obis: string; kind: 'datetime' | 'u8' | 'u16' | 'u32'; scaler: number; unit: string };
/** datetime Readings: raw = value = ms since epoch (UTC instant), scaler 0, unit ''. */
export type Reading = { key: string; obis: string; raw: number | null; scaler: number; unit: string; value: number | null; missing: boolean };

export const CLOCK_OBIS = '0.0.1.0.0.255';
const c = (key: string, obis: string, kind: ColumnSpec['kind'], scaler = 0, unit = ''): ColumnSpec => ({ key, obis, kind, scaler, unit });

const clock = () => c('clock', CLOCK_OBIS, 'datetime');
// Spec 6.3: Type 1 = single 1.0.12.27 column; Type 3 = L1 1.0.32.27 + L2 1.0.52.27 + L3 1.0.72.27 in that slot.
const volts = (type: 1 | 3, suffix: string): ColumnSpec[] =>
  (type === 1
    ? [c('voltageL1', '1.0.12.27.0.255', 'u16', -2, 'V')]
    : [c('voltageL1', '1.0.32.27.0.255', 'u16', -2, 'V'), c('voltageL2', '1.0.52.27.0.255', 'u16', -2, 'V'), c('voltageL3', '1.0.72.27.0.255', 'u16', -2, 'V')]
  ).map((s) => ({ ...s, key: s.key + suffix }));

// Energy/power units follow the column names; display divisors are unconfirmed (spec 6.4), so raw is always shown too.
export const billingTemplate = (type: 1 | 3): ColumnSpec[] => [
  clock(),
  c('kwhImport', '1.0.1.8.0.255', 'u32', 0, 'kWh'),
  c('kwhExport', '1.0.2.8.0.255', 'u32', 0, 'kWh'),
  c('kwhAbsolute', '1.0.15.8.0.255', 'u32', 0, 'kWh'),
  c('kwhNet', '1.0.16.8.0.255', 'u32', 0, 'kWh'),
  c('maxDemandImport', '1.0.1.6.0.255', 'u32', 0, 'kW'),
  c('maxDemandExport', '1.0.2.6.0.255', 'u32', 0, 'kW'),
  ...volts(type, 'Min'),
  c('alarm1', '0.0.97.98.20.255', 'u32'),
  c('alarm2', '0.0.97.98.21.255', 'u32'),
];

export const loadTemplate = (type: 1 | 3): ColumnSpec[] => [
  clock(),
  c('status', '0.0.96.10.1.255', 'u8'),
  ...volts(type, 'Avg'),
  c('demandImport', '1.0.1.27.0.255', 'u32', 0, 'kW'),
  c('demandExport', '1.0.2.27.0.255', 'u32', 0, 'kW'),
];

export const eventTemplate = (type: 1 | 3): ColumnSpec[] => [
  clock(),
  c('eventCode', '0.0.96.11.0.255', 'u8'),
  ...volts(type, ''),
];

const KNOWN = new Map<string, ColumnSpec>();
for (const t of [1, 3] as const)
  for (const s of [...billingTemplate(t), ...loadTemplate(t), ...eventTemplate(t)]) if (!KNOWN.has(s.obis)) KNOWN.set(s.obis, s);

/**
 * Spec 6.7. Match cols vs live capture_objects by obis, in order. On mismatch derive columns from the live layout:
 * an obis found in any known template keeps its kind/scaler/unit; an unknown obis becomes u32, scaler 0, no unit.
 */
export function verifyCapture(cols: ColumnSpec[], live: CaptureObject[]): { ok: boolean; usedLive: boolean; columns: ColumnSpec[] } {
  if (cols.length === live.length && cols.every((s, i) => s.obis === live[i].obis)) return { ok: true, usedLive: false, columns: cols };
  // Voltage obis repeat across profiles with different keys (Min/Avg/none): prefer cols' own spec, and re-suffix known voltage keys to cols' profile.
  const own = new Map(cols.map((s) => [s.obis, s]));
  const suffix = cols.find((s) => s.key.startsWith('voltageL1'))?.key.slice(9) ?? '';
  const columns = live.map((o, i) => {
    const k = own.get(o.obis) ?? KNOWN.get(o.obis);
    if (!k) return c(`col${i}`, o.obis, 'u32');
    return /^voltageL\d/.test(k.key) && !own.has(o.obis) ? { ...k, key: k.key.slice(0, 9) + suffix } : { ...k };
  });
  return { ok: false, usedLive: true, columns };
}
