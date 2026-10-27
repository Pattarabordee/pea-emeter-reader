import { describe, expect, it } from 'vitest';
import type { DlmsData } from '../dlms/types';
import { decodeRow } from './decode';
import { billingTemplate, eventTemplate, loadTemplate, verifyCapture } from './templates';

const u32 = (v: number): DlmsData => ({ t: 'u32', v });
const dt = (d: Date | null): DlmsData => ({ t: 'datetime', v: { date: d, missing: d === null } });
const T = new Date('2026-10-01T00:00:00Z');
const row1: DlmsData[] = [dt(T), u32(1000), u32(20), u32(1020), u32(980), u32(5), u32(1), { t: 'u16', v: 23002 }, u32(0), u32(0)];

describe('templates (spec 6.3)', () => {
  it('Type 1 billing = 10 columns', () => {
    const t = billingTemplate(1);
    expect(t.map((c) => c.obis)).toEqual([
      '0.0.1.0.0.255', '1.0.1.8.0.255', '1.0.2.8.0.255', '1.0.15.8.0.255', '1.0.16.8.0.255',
      '1.0.1.6.0.255', '1.0.2.6.0.255', '1.0.12.27.0.255', '0.0.97.98.20.255', '0.0.97.98.21.255',
    ]);
  });
  it('Type 3 billing inserts L2/L3 right after L1 (12 columns)', () => {
    const t = billingTemplate(3).map((c) => c.obis);
    expect(t).toHaveLength(12);
    expect(t.slice(7, 10)).toEqual(['1.0.32.27.0.255', '1.0.52.27.0.255', '1.0.72.27.0.255']);
    expect(t.slice(10)).toEqual(['0.0.97.98.20.255', '0.0.97.98.21.255']);
  });
  it('load and event counts', () => {
    expect([loadTemplate(1).length, loadTemplate(3).length]).toEqual([5, 7]);
    expect([eventTemplate(1).length, eventTemplate(3).length]).toEqual([3, 5]);
    expect(loadTemplate(3).map((c) => c.obis).slice(2, 5)).toEqual(['1.0.32.27.0.255', '1.0.52.27.0.255', '1.0.72.27.0.255']);
  });
});

describe('decodeRow', () => {
  it('scales voltage and keeps obis/raw/unit', () => {
    const r = decodeRow(row1, billingTemplate(1));
    const v = r.find((x) => x.key === 'voltageL1Min')!;
    expect(v).toMatchObject({ raw: 23002, value: 230.02, unit: 'V', scaler: -2, obis: '1.0.12.27.0.255', missing: false });
    expect(r[1]).toMatchObject({ key: 'kwhImport', raw: 1000, value: 1000, unit: 'kWh' });
    expect(r[0]).toMatchObject({ value: T.getTime(), missing: false });
  });
  it('short row => trailing cells missing, not 0', () => {
    const r = decodeRow(row1.slice(0, 8), billingTemplate(1));
    expect(r[8]).toMatchObject({ missing: true, value: null, raw: null });
    expect(r[9].missing).toBe(true);
    expect(r[7].missing).toBe(false);
  });
  it('null cell and missing datetime => missing', () => {
    const r = decodeRow([dt(null), { t: 'null' }], loadTemplate(1));
    expect(r[0]).toMatchObject({ missing: true, value: null });
    expect(r[1]).toMatchObject({ missing: true, value: null, raw: null });
  });
  it('12-byte octet clock is parsed', () => {
    const oct = new Uint8Array([0x07, 0xea, 10, 1, 4, 0, 0, 0, 0, 0x80, 0x00, 0]);
    const r = decodeRow([{ t: 'octet', v: oct }], billingTemplate(1));
    expect(r[0]).toMatchObject({ missing: false, value: T.getTime() });
  });
  it('Type 3 row decodes L2/L3 and keeps alarms aligned', () => {
    const row3: DlmsData[] = [...row1.slice(0, 7), { t: 'u16', v: 23001 }, { t: 'u16', v: 23002 }, { t: 'u16', v: 23003 }, u32(7), u32(8)];
    const r = decodeRow(row3, billingTemplate(3));
    expect(r.slice(7, 10).map((x) => x.value)).toEqual([230.01, 230.02, 230.03]);
    expect(r.slice(10).map((x) => x.raw)).toEqual([7, 8]);
  });
});

describe('verifyCapture', () => {
  const live = (obis: string[]) => obis.map((o) => ({ classId: 3, obis: o, attributeIndex: 2, dataIndex: 0 }));
  it('matches', () => {
    const cols = billingTemplate(1);
    expect(verifyCapture(cols, live(cols.map((c) => c.obis)))).toEqual({ ok: true, usedLive: false, columns: cols });
  });
  it('mismatch returns live layout (Type-3 meter given Type-1 template)', () => {
    const l = billingTemplate(3).map((c) => c.obis);
    const v = verifyCapture(billingTemplate(1), live(l));
    expect(v.ok).toBe(false);
    expect(v.usedLive).toBe(true);
    expect(v.columns.map((c) => c.obis)).toEqual(l);
    expect(v.columns[8]).toMatchObject({ kind: 'u16', scaler: -2, unit: 'V' });
  });
  it('unknown obis => u32 scaler 0', () => {
    const v = verifyCapture(billingTemplate(1), live(['0.0.1.0.0.255', '9.9.9.9.9.9']));
    expect(v.columns[1]).toMatchObject({ obis: '9.9.9.9.9.9', kind: 'u32', scaler: 0 });
  });
});
