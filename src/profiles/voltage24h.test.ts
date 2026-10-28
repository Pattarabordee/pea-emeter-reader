import { describe, it, expect } from 'vitest';
import type { DlmsClient } from '../dlms/client';
import type { DlmsData } from '../dlms/types';
import type { SelectiveAccess } from '../dlms/get';
import { loadTemplate } from './templates';
import { read24hVoltage } from './voltage24h';

const OBIS = '1.0.99.1.0.255';
const obisBytes = (o: string): DlmsData => ({ t: 'octet', v: Uint8Array.from(o.split('.').map(Number)) });
const co = (o: string): DlmsData => ({ t: 'structure', v: [{ t: 'u16', v: 3 }, obisBytes(o), { t: 'u8', v: 2 }, { t: 'u16', v: 0 }] });
const layout = (obis: string[]) => ({ t: 'array', v: obis.map(co) }) as DlmsData;
const loadLayout = layout(loadTemplate(1).map((s) => s.obis));
const row = (n: number): DlmsData => ({ t: 'structure', v: [{ t: 'null' }, { t: 'u8', v: 0 }, { t: 'u16', v: 23000 + n }, { t: 'u32', v: n }, { t: 'u32', v: n }] });

function fake(opts: { entries: number; period?: DlmsData | Error; capture?: DlmsData }) {
  const calls: Array<{ attr: number; access?: SelectiveAccess }> = [];
  const client = {
    get: async (_c: number, _o: string, attr: number, access?: SelectiveAccess) => {
      calls.push({ attr, access });
      if (attr === 7) return { t: 'u32', v: opts.entries } as DlmsData;
      if (attr === 4) { if (opts.period instanceof Error) throw opts.period; return opts.period ?? ({ t: 'u32', v: 900 } as DlmsData); }
      if (attr === 3) return opts.capture ?? loadLayout;
      if (access?.kind !== 'by-entry') throw new Error('unexpected');
      return { t: 'array', v: Array.from({ length: access.toEntry - access.fromEntry + 1 }, (_, i) => row(access.fromEntry + i)) } as DlmsData;
    },
  } as unknown as DlmsClient;
  return { client, calls };
}

describe('read24hVoltage', () => {
  it('reads the last 96 rows keeping only clock + voltage*', async () => {
    const { client, calls } = fake({ entries: 200 });
    const r = await read24hVoltage(client, 1);
    expect(r.periodSec).toBe(900);
    expect(r.rows).toHaveLength(96);
    expect(r.rows[0].map((x) => x.key)).toEqual(['clock', 'voltageL1Avg']);
    expect(r.rows[0][1].raw).toBe(23105);
    const sel = calls.find((c) => c.access)!.access as { fromEntry: number; toEntry: number };
    expect([sel.fromEntry, sel.toEntry]).toEqual([105, 200]);
  });

  it('falls back to 900 when capture_period cannot be read', async () => {
    const { client } = fake({ entries: 200, period: new Error('data-access-result 3') });
    const r = await read24hVoltage(client, 1);
    expect(r.periodSec).toBe(900);
    expect(r.rows).toHaveLength(96);
  });

  it.each([0, -5, NaN])('capture_period %s falls back to 900, not the whole buffer', async (bad) => {
    const { client, calls } = fake({ entries: 200, period: { t: 'u32', v: bad } as DlmsData });
    const r = await read24hVoltage(client, 1);
    expect(r.periodSec).toBe(900);
    const sel = calls.find((c) => c.access)!.access as { fromEntry: number; toEntry: number };
    expect([sel.fromEntry, sel.toEntry]).toEqual([105, 200]);
  });

  it('returns no rows and no range GET when the profile is empty', async () => {
    const { client, calls } = fake({ entries: 0 });
    expect(await read24hVoltage(client, 1)).toEqual({ rows: [], periodSec: 900 });
    expect(calls.some((c) => c.access)).toBe(false);
  });

  it('throws before reading when the resolved layout has no voltage column', async () => {
    const { client, calls } = fake({ entries: 200, capture: layout(['0.0.1.0.0.255', '9.9.9.9.9.9']) });
    await expect(read24hVoltage(client, 1)).rejects.toThrow('no voltage column');
    expect(calls.some((c) => c.access)).toBe(false);
  });
});
