import { describe, it, expect } from 'vitest';
import type { DlmsClient } from '../dlms/client';
import type { DlmsData } from '../dlms/types';
import type { SelectiveAccess } from '../dlms/get';
import type { ColumnSpec } from './templates';
import { readRange } from './read';

const OBIS = '1.0.99.1.0.255';
const cols: ColumnSpec[] = [{ key: 'n', obis: '1.0.1.8.0.255', kind: 'u32', scaler: 0, unit: '' }];
const row = (n: number): DlmsData => ({ t: 'structure', v: [{ t: 'u32', v: n }] });
const all = (total: number) => Array.from({ length: total }, (_, i) => row(i + 1));

function fake(total: number, rejectSelective = false) {
  const calls: Array<{ attr: number; access?: SelectiveAccess }> = [];
  const client = {
    get: async (_c: number, _o: string, attr: number, access?: SelectiveAccess) => {
      calls.push({ attr, access });
      if (!access) return { t: 'array', v: all(total) } as DlmsData;
      if (rejectSelective) throw new Error('GET: data-access-result 4 (read-write-denied)');
      if (access.kind !== 'by-entry') throw new Error('unexpected access');
      return { t: 'array', v: all(total).slice(access.fromEntry - 1, access.toEntry) } as DlmsData;
    },
  } as unknown as DlmsClient;
  return { client, calls };
}
const vals = (r: Awaited<ReturnType<typeof readRange>>) => r.map((x) => x[0].value);

describe('readRange', () => {
  it('reads 250 rows in 3 GETs of 100/100/50', async () => {
    const { client, calls } = fake(250);
    const r = await readRange(client, OBIS, cols, 1, 250);
    expect(r).toHaveLength(250);
    expect(vals(r)[249]).toBe(250);
    expect(calls.map((c) => c.access && c.access.kind === 'by-entry' ? c.access.toEntry - c.access.fromEntry + 1 : -1)).toEqual([100, 100, 50]);
  });

  it('returns [] with no GET when toEntry < fromEntry', async () => {
    const { client, calls } = fake(10);
    expect(await readRange(client, OBIS, cols, 5, 4)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('falls back to a plain attr-2 GET + client-side slice when by-entry is rejected', async () => {
    const { client, calls } = fake(20, true);
    let fired = 0;
    const r = await readRange(client, OBIS, cols, 5, 8, { onFallback: () => fired++ });
    expect(vals(r)).toEqual([5, 6, 7, 8]);
    expect(fired).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ attr: 2, access: undefined });
  });

  it('does not swallow non-access errors', async () => {
    const client = { get: async () => { throw new Error('timeout'); } } as unknown as DlmsClient;
    await expect(readRange(client, OBIS, cols, 1, 5)).rejects.toThrow('timeout');
  });
});
