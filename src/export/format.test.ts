import { describe, expect, it } from 'vitest';
import type { Reading } from '../profiles/templates';
import { bangkokIso, csvWithTime, exportName } from './format';

const clock = (v: number | null): Reading => ({ key: 'clock', obis: '0.0.1.0.0.255', raw: v, scaler: 0, unit: '', value: v, missing: v === null });
const T = Date.UTC(2026, 9, 28, 17, 30, 0); // 2026-10-29 00:30 in Bangkok

describe('format', () => {
  it('bangkokIso shifts to +07:00, not UTC Z', () => {
    expect(bangkokIso(T)).toBe('2026-10-29T00:30:00.000+07:00');
  });

  it('exportName has sanitized MAC, mode and Bangkok date', () => {
    expect(exportName('AA:BB:CC', 'voltage24h', T)).toBe('AA-BB-CC_voltage24h_2026-10-29');
  });

  it('csvWithTime puts per-record timestamps and caller meta in the header; null clock is missing, never 1970', () => {
    const csv = csvWithTime([[clock(T)], [clock(null)]], { name: 'M1', mac: 'AA:BB', periodSec: 900 });
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toContain('# name: "M1"');
    expect(lines).toContain('# periodSec: 900');
    expect(lines).toContain('# timestamp: {"0":"2026-10-29T00:30:00.000+07:00","1":"missing"}');
    expect(csv).not.toContain('1970');
    expect(lines).toContain('record,key,obis,raw,scaler,unit,value,missing');
  });
});
