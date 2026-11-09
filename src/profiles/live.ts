import type { DlmsClient } from '../dlms/client';
import type { DlmsData } from '../dlms/types';
import type { ColumnSpec, Reading } from './templates';

const c = (key: string, obis: string, unit: string): ColumnSpec => ({ key, obis, kind: 'u32', scaler: 0, unit });

// Spec 6.5. Scaler here is a placeholder; the real one comes from each register's attr 3. Type 3 per-phase list is "to confirm" in the spec.
export function LIVE_REGISTERS(type: 1 | 3): ColumnSpec[] {
  const base = [
    c('voltage', '1.0.12.7.0.255', 'V'),
    c('current', '1.0.31.7.0.255', 'A'),
    c('powerImport', '1.0.1.7.0.255', 'W'),
    c('powerExport', '1.0.2.7.0.255', 'W'),
    c('apparentPower', '1.0.9.7.0.255', 'VA'),
    c('powerFactor', '1.0.13.7.0.255', ''),
  ];
  if (type === 1) return base;
  return [
    ...base,
    c('voltageL1', '1.0.32.7.0.255', 'V'), c('voltageL2', '1.0.52.7.0.255', 'V'), c('voltageL3', '1.0.72.7.0.255', 'V'),
    c('currentL2', '1.0.51.7.0.255', 'A'), c('currentL3', '1.0.71.7.0.255', 'A'), // L1 current = 1.0.31.7 already in base
  ];
}

// DLMS unit enum (IEC 62056-62) for the units a live read can show.
const UNITS: Record<number, string> = { 27: 'W', 28: 'VA', 29: 'var', 30: 'Wh', 31: 'VAh', 32: 'varh', 33: 'A', 35: 'V', 44: 'Hz', 255: '' };

type ScalerUnit = { scaler: number; unit: string };
// Per-client cache so scaler/unit (attr 3) are read once across interval ticks; a new connection starts fresh.
const cache = new WeakMap<DlmsClient, Map<string, ScalerUnit>>();

async function scalerUnit(client: DlmsClient, s: ColumnSpec): Promise<ScalerUnit> {
  const m = cache.get(client) ?? cache.set(client, new Map()).get(client)!;
  const hit = m.get(s.obis);
  if (hit) return hit;
  const d = await client.get(3, s.obis, 3);
  if (d.t !== 'structure' || d.v.length < 2 || !('v' in d.v[0]) || typeof d.v[0].v !== 'number' || d.v[1].t !== 'enum') throw new Error('bad scaler_unit');
  const su = { scaler: d.v[0].v, unit: UNITS[d.v[1].v] ?? s.unit };
  m.set(s.obis, su);
  return su;
}

const num = (d: DlmsData): number => {
  if ('v' in d && typeof d.v === 'number') return d.v;
  throw new Error('non-numeric register value');
};

const scale = (raw: number, scaler: number) => (scaler < 0 ? raw / 10 ** -scaler : raw * 10 ** scaler);
// The PEA BLE-iMeter app divides voltage by 100 whatever the meter says. A GUNKUL meter (6600433046, 2026-11-08)
// declared scaler -1 for raw 23437, i.e. 2343.7 V. So voltage uses -2 first, and falls back to the meter's own
// scaler only when -2 gives an impossible LV voltage and the meter's scaler gives a sensible one.
const PEA_VOLTAGE_SCALER = -2;
const isVoltage = (key: string) => key.startsWith('voltage');
const plausibleVolts = (v: number) => v >= 50 && v <= 500;

function pickScaler(key: string, raw: number, meterScaler: number): number {
  if (!isVoltage(key) || meterScaler === PEA_VOLTAGE_SCALER) return meterScaler;
  if (plausibleVolts(scale(raw, PEA_VOLTAGE_SCALER)) || !plausibleVolts(scale(raw, meterScaler))) return PEA_VOLTAGE_SCALER;
  return meterScaler;
}

// The same GUNKUL family also declares current one decade too coarse: 6600433732 (2026-11-09) gave current raw 873
// with scaler -2 (8.73 A) next to 229.51 V, 202.93 VA and 116.97 W; V x I x PF only matches P at 0.873 A.
// So when voltage and apparent power are both read, pick the current decade that best fits I = S / V.
function crossCheckCurrent(out: Reading[]): void {
  const v = out.find((r) => r.key === 'voltage' && !r.missing)?.value;
  const s = out.find((r) => r.key === 'apparentPower' && !r.missing)?.value;
  const i = out.find((r) => r.key === 'current' && !r.missing);
  if (!v || !s || !i || i.raw == null || i.raw === 0 || v < 50 || s < 5) return; // too little load to judge
  const raw = i.raw;
  const want = s / v;
  const best = [i.scaler, i.scaler - 1, i.scaler + 1]
    .map((sc) => ({ sc, err: Math.abs(Math.log10(scale(raw, sc) / want)) }))
    .sort((a, b) => a.err - b.err)[0];
  if (best.sc !== i.scaler && best.err < 0.3) { i.scaler = best.sc; i.value = scale(raw, best.sc); }
}

export async function readLive(client: DlmsClient, type: 1 | 3): Promise<Reading[]> {
  const out: Reading[] = [];
  for (const s of LIVE_REGISTERS(type)) {
    const base = { key: s.key, obis: s.obis, scaler: s.scaler, unit: s.unit };
    try {
      const su = await scalerUnit(client, s);
      const raw = num(await client.get(3, s.obis, 2));
      const scaler = pickScaler(s.key, raw, su.scaler);
      out.push({ ...base, unit: su.unit, scaler, raw, value: scale(raw, scaler), missing: false });
    } catch {
      out.push({ ...base, raw: null, value: null, missing: true });
    }
  }
  crossCheckCurrent(out);
  return out;
}
