import { describe, it, expect } from 'vitest';
import type { DlmsClient } from './client';
import type { DlmsData } from './types';
import type { SelectiveAccess } from './get';
import { buildGetNormal } from './get';
import { obisToBytes } from './obis';
import { getEntriesInUse, readRowsByEntry, getCaptureObjects, bytesToObis } from './profile';

function fake(result: DlmsData) {
  const calls: Array<{ classId: number; obis: string; attr: number; access?: SelectiveAccess }> = [];
  const client = { get: async (classId: number, obis: string, attr: number, access?: SelectiveAccess) => { calls.push({ classId, obis, attr, access }); return result; } } as unknown as DlmsClient;
  return { client, calls };
}
const BILLING = '1.0.98.1.0.255';

describe('profile', () => {
  it('getEntriesInUse reads class 7 attr 7', async () => {
    const { client, calls } = fake({ t: 'u32', v: 42 });
    expect(await getEntriesInUse(client, BILLING)).toBe(42);
    expect(calls[0]).toEqual({ classId: 7, obis: BILLING, attr: 7, access: undefined });
  });

  it('getEntriesInUse throws on a non-number', async () => {
    await expect(getEntriesInUse(fake({ t: 'null' }).client, BILLING)).rejects.toThrow();
  });

  it('readRowsByEntry(1,3) uses by-entry access 1..3, all columns, and returns the rows', async () => {
    const rows: DlmsData[] = [{ t: 'structure', v: [{ t: 'u32', v: 1 }] }, { t: 'structure', v: [{ t: 'u32', v: 2 }] }];
    const { client, calls } = fake({ t: 'array', v: rows });
    expect(await readRowsByEntry(client, BILLING, 1, 3)).toEqual(rows);
    expect(calls[0].classId).toBe(7);
    expect(calls[0].attr).toBe(2);
    expect(calls[0].access).toEqual({ kind: 'by-entry', fromEntry: 1, toEntry: 3, fromSelectedValue: 0, toSelectedValue: 0 });
    // pin the encoded request: GET-normal, class 7, obis, attr 2, selector 2, structure{1,3,0,0}
    expect(Array.from(buildGetNormal(7, obisToBytes(BILLING), 2, calls[0].access))).toEqual([
      0xc0, 0x01, 0xc1, 0x00, 0x07, 1, 0, 98, 1, 0, 255, 0x02,
      0x01, 0x02, 0x02, 0x04, 0x06, 0, 0, 0, 1, 0x06, 0, 0, 0, 3, 0x12, 0, 0, 0x12, 0, 0,
    ]);
  });

  it('readRowsByEntry rejects non-array buffers and bad arguments', async () => {
    await expect(readRowsByEntry(fake({ t: 'u8', v: 1 }).client, BILLING, 1, 1)).rejects.toThrow(/not an array/);
    await expect(readRowsByEntry(fake({ t: 'array', v: [] }).client, BILLING, 0, 1)).rejects.toThrow(/fromEntry/);
    await expect(readRowsByEntry(fake({ t: 'array', v: [] }).client, BILLING, 1, 0)).rejects.toThrow(/count/);
  });

  it('getCaptureObjects maps structures to CaptureObject', async () => {
    const co = (cls: number, ln: number[], a: number, d: number): DlmsData => ({
      t: 'structure', v: [{ t: 'u16', v: cls }, { t: 'octet', v: Uint8Array.from(ln) }, { t: 'i8', v: a }, { t: 'u16', v: d }],
    });
    const { client, calls } = fake({ t: 'array', v: [co(8, [0, 0, 1, 0, 0, 255], 2, 0), co(3, [1, 0, 1, 8, 0, 255], 2, 0)] });
    expect(await getCaptureObjects(client, BILLING)).toEqual([
      { classId: 8, obis: '0.0.1.0.0.255', attributeIndex: 2, dataIndex: 0 },
      { classId: 3, obis: '1.0.1.8.0.255', attributeIndex: 2, dataIndex: 0 },
    ]);
    expect(calls[0].attr).toBe(3);
  });

  it('getCaptureObjects rejects a malformed entry; bytesToObis rejects bad length', async () => {
    await expect(getCaptureObjects(fake({ t: 'array', v: [{ t: 'u8', v: 1 }] }).client, BILLING)).rejects.toThrow();
    expect(() => bytesToObis(Uint8Array.from([1, 2]))).toThrow();
  });
});
