import { describe, it, expect } from 'vitest';
import type { DlmsClient } from './client';
import type { DlmsData } from './types';
import { getCapturePeriod } from './profile';

const LP = '1.0.99.1.0.255';

function fake(result: DlmsData | Error) {
  const calls: Array<{ classId: number; obis: string; attr: number }> = [];
  const client = {
    get: async (classId: number, obis: string, attr: number) => {
      calls.push({ classId, obis, attr });
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as DlmsClient;
  return { client, calls };
}

describe('getCapturePeriod', () => {
  it('reads class 7 attr 4 and returns seconds', async () => {
    const { client, calls } = fake({ t: 'u32', v: 900 });
    expect(await getCapturePeriod(client, LP)).toBe(900);
    expect(calls[0]).toEqual({ classId: 7, obis: LP, attr: 4 });
  });

  it('rejects on a DLMS error', async () => {
    await expect(getCapturePeriod(fake(new Error('get: data-access-result 3')).client, LP)).rejects.toThrow();
  });
});
