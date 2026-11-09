import { describe, it, expect } from 'vitest';
import { LIVE_REGISTERS, readLive } from './live';
import type { DlmsClient } from '../dlms/client';
import type { DlmsData } from '../dlms/types';

const su = (scaler: number, unit: number): DlmsData => ({ t: 'structure', v: [{ t: 'i8', v: scaler }, { t: 'enum', v: unit }] });

function fake(script: Record<string, { value?: DlmsData; su?: DlmsData; fail?: boolean }>) {
  const calls: { obis: string; attr: number }[] = [];
  const client = {
    async get(classId: number, obis: string, attr: number) {
      calls.push({ obis, attr });
      expect(classId).toBe(3);
      const s = script[obis];
      if (!s || s.fail) throw new Error('data-access-result 3');
      return (attr === 3 ? s.su : s.value) as DlmsData;
    },
  } as unknown as DlmsClient;
  return { client, calls };
}

describe('LIVE_REGISTERS', () => {
  it('type 1 has the six single-phase registers', () => {
    expect(LIVE_REGISTERS(1).map((r) => r.obis)).toEqual(['1.0.12.7.0.255', '1.0.31.7.0.255', '1.0.1.7.0.255', '1.0.2.7.0.255', '1.0.9.7.0.255', '1.0.13.7.0.255']);
  });
  it('type 3 adds per-phase V and I', () => {
    const o = LIVE_REGISTERS(3).map((r) => r.obis);
    for (const x of ['1.0.32.7.0.255', '1.0.52.7.0.255', '1.0.72.7.0.255', '1.0.51.7.0.255', '1.0.71.7.0.255']) expect(o).toContain(x);
    expect(new Set(o).size).toBe(o.length);
  });
});

describe('readLive', () => {
  it('scales by the meter-reported scaler and maps unit', async () => {
    const { client } = fake({ '1.0.12.7.0.255': { value: { t: 'u16', v: 23015 }, su: su(-2, 35) } });
    const r = (await readLive(client, 1))[0];
    expect(r).toMatchObject({ key: 'voltage', raw: 23015, scaler: -2, unit: 'V', missing: false });
    expect(r.value).toBeCloseTo(230.15, 10);
  });

  it('voltage follows the PEA app (x0.01) when the meter declares the wrong scaler', async () => {
    // Field read, GUNKUL 6600433046: raw 23437 with declared scaler -1 would be 2343.7 V.
    const { client } = fake({ '1.0.12.7.0.255': { value: { t: 'u16', v: 23437 }, su: su(-1, 35) } });
    const r = (await readLive(client, 1))[0];
    expect(r).toMatchObject({ raw: 23437, scaler: -2, unit: 'V' });
    expect(r.value).toBeCloseTo(234.37, 10);
  });

  it("voltage keeps the meter's scaler when x0.01 would be impossible but its own gives a real voltage", async () => {
    const { client } = fake({ '1.0.12.7.0.255': { value: { t: 'u16', v: 2301 }, su: su(-1, 35) } });
    const r = (await readLive(client, 1))[0];
    expect(r).toMatchObject({ raw: 2301, scaler: -1 });
    expect(r.value).toBeCloseTo(230.1, 10);
  });

  it('corrects a current scaler that is one decade off, using V and VA (field read 6600433732)', async () => {
    const { client } = fake({
      '1.0.12.7.0.255': { value: { t: 'u16', v: 22951 }, su: su(-2, 35) },
      '1.0.31.7.0.255': { value: { t: 'u32', v: 873 }, su: su(-2, 33) }, // meter says 8.73 A
      '1.0.9.7.0.255': { value: { t: 'u32', v: 20293 }, su: su(-2, 28) }, // 202.93 VA
    });
    const rs = await readLive(client, 1);
    const i = rs.find((r) => r.key === 'current')!;
    expect(i).toMatchObject({ raw: 873, scaler: -3 });
    expect(i.value).toBeCloseTo(0.873, 10);
  });

  it('leaves a current that already fits V and VA alone', async () => {
    const { client } = fake({
      '1.0.12.7.0.255': { value: { t: 'u16', v: 23000 }, su: su(-2, 35) },
      '1.0.31.7.0.255': { value: { t: 'u32', v: 500 }, su: su(-2, 33) }, // 5.00 A
      '1.0.9.7.0.255': { value: { t: 'u32', v: 115000 }, su: su(-2, 28) }, // 1150 VA
    });
    const i = (await readLive(client, 1)).find((r) => r.key === 'current')!;
    expect(i).toMatchObject({ scaler: -2, value: 5 });
  });

  it('errored register is missing (not 0) and the others still read', async () => {
    const { client } = fake({ '1.0.12.7.0.255': { fail: true }, '1.0.31.7.0.255': { value: { t: 'u32', v: 1500 }, su: su(-3, 33) } });
    const rs = await readLive(client, 1);
    expect(rs).toHaveLength(6);
    expect(rs[0]).toMatchObject({ missing: true, value: null, raw: null });
    expect(rs[1]).toMatchObject({ raw: 1500, value: 1.5, unit: 'A', missing: false });
  });

  it('reads attr 3 once per register across repeated calls', async () => {
    const { client, calls } = fake({ '1.0.12.7.0.255': { value: { t: 'u16', v: 1 }, su: su(0, 35) } });
    await readLive(client, 1);
    await readLive(client, 1);
    expect(calls.filter((c) => c.obis === '1.0.12.7.0.255' && c.attr === 3)).toHaveLength(1);
    expect(calls.filter((c) => c.obis === '1.0.12.7.0.255' && c.attr === 2)).toHaveLength(2);
  });
});
