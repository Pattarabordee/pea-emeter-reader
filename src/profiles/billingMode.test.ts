import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import type { DlmsClient } from '../dlms/client';
import type { DlmsData } from '../dlms/types';
import type { SelectiveAccess } from '../dlms/get';
import * as db from '../store/db';
import { readBillingMode } from './billingMode';
import { billingTemplate, eventTemplate, loadTemplate } from './templates';

const obisBytes = (o: string): DlmsData => ({ t: 'octet', v: Uint8Array.from(o.split('.').map(Number)) });
const co = (o: string): DlmsData => ({ t: 'structure', v: [{ t: 'u16', v: 3 }, obisBytes(o), { t: 'u8', v: 2 }, { t: 'u16', v: 0 }] });
const layout = (obis: string[]) => ({ t: 'array', v: obis.map(co) }) as DlmsData;
const tplOf = (obis: string) => (obis === BILLING ? billingTemplate(1) : obis === PQ ? eventTemplate(1) : loadTemplate(1));

const BILLING = '1.0.98.1.0.255', LOAD = '1.0.99.1.0.255', PQ = '0.0.99.98.0.255';
const T0 = Date.UTC(2026, 0, 1);
const clockAt = (n: number) => T0 + n * 900000;
const row = (n: number): DlmsData => ({ t: 'structure', v: [{ t: 'datetime', v: { date: new Date(clockAt(n)), missing: false } }] });

function fake(counts: Record<string, number>, clockOf: (n: number) => number = clockAt, capture?: (obis: string) => DlmsData) {
  const calls: Array<{ obis: string; attr: number; access?: SelectiveAccess }> = [];
  const mk = (obis: string, n: number): DlmsData =>
    ({ t: 'structure', v: [{ t: 'datetime', v: { date: new Date(clockOf(n)), missing: false } }] });
  const client = {
    get: async (_c: number, obis: string, attr: number, access?: SelectiveAccess) => {
      calls.push({ obis, attr, access });
      if (attr === 3) return (capture ?? ((o: string) => layout(tplOf(o).map((c) => c.obis))))(obis);
      if (attr === 7) return { t: 'u32', v: counts[obis] } as DlmsData;
      if (access?.kind !== 'by-entry') throw new Error('unexpected access');
      const rows: DlmsData[] = [];
      for (let i = access.fromEntry; i <= access.toEntry; i++) rows.push(obis === LOAD ? mk(obis, i) : row(i));
      return { t: 'array', v: rows } as DlmsData;
    },
  } as unknown as DlmsClient;
  const loadGets = () => calls.filter((c) => c.obis === LOAD && c.attr === 2).map((c) => c.access as Extract<SelectiveAccess, { kind: 'by-entry' }>);
  return { client, calls, loadGets };
}

describe('readBillingMode', () => {
  it('first visit reads billing+pq in full and all load, then sets progress', async () => {
    const mac = 'M-first';
    const { client, loadGets } = fake({ [BILLING]: 3, [PQ]: 2, [LOAD]: 5 });
    const r = await readBillingMode(client, mac, 1);
    expect([r.billing.length, r.pq.length, r.loadAdded.length]).toEqual([3, 2, 5]);
    expect(r.fullReread || r.nothingNew).toBe(false);
    expect(loadGets().map((a) => [a.fromEntry, a.toEntry])).toEqual([[1, 5]]);
    expect(await db.getProgress(mac)).toEqual({ lastEntry: 5, lastClock: clockAt(5) });
    expect((await db.getPending(mac))?.rows).toHaveLength(5);
    expect(await db.getPending(mac)).toMatchObject({ from: 1, to: 5 });
  });

  it('second visit reads only the 3 new load entries; billing+pq still full', async () => {
    const mac = 'M-delta';
    await db.setProgress(mac, { lastEntry: 5, lastClock: clockAt(5) });
    const { client, calls, loadGets } = fake({ [BILLING]: 3, [PQ]: 2, [LOAD]: 8 });
    const r = await readBillingMode(client, mac, 1);
    expect(r.loadAdded).toHaveLength(3);
    expect(r.fullReread || r.nothingNew).toBe(false);
    expect(loadGets().map((a) => [a.fromEntry, a.toEntry])).toEqual([[5, 5], [6, 8]]);
    expect(calls.filter((c) => c.obis === BILLING && c.attr === 2)).toHaveLength(1);
    expect(calls.filter((c) => c.obis === PQ && c.attr === 2)).toHaveLength(1);
    expect(await db.getProgress(mac)).toEqual({ lastEntry: 8, lastClock: clockAt(8) });
  });

  it('E === lastEntry with matching clock -> nothingNew, no load data GET beyond the clock check', async () => {
    const mac = 'M-nothing';
    await db.setProgress(mac, { lastEntry: 5, lastClock: clockAt(5) });
    const { client, loadGets } = fake({ [BILLING]: 1, [PQ]: 1, [LOAD]: 5 });
    const r = await readBillingMode(client, mac, 1);
    expect(r).toMatchObject({ nothingNew: true, fullReread: false, loadAdded: [] });
    expect(r.billing).toHaveLength(1);
    expect(loadGets().map((a) => [a.fromEntry, a.toEntry])).toEqual([[5, 5]]);
  });

  it('mismatched lastClock -> full re-read from entry 1', async () => {
    const mac = 'M-mismatch';
    await db.setProgress(mac, { lastEntry: 5, lastClock: 12345 });
    const { client, loadGets } = fake({ [BILLING]: 1, [PQ]: 1, [LOAD]: 6 });
    const r = await readBillingMode(client, mac, 1);
    expect(r.fullReread).toBe(true);
    expect(r.loadAdded).toHaveLength(6);
    expect(loadGets().map((a) => [a.fromEntry, a.toEntry])).toEqual([[5, 5], [1, 6]]);
    expect(await db.getProgress(mac)).toEqual({ lastEntry: 6, lastClock: clockAt(6) });
  });

  it('E < lastEntry -> full re-read without reading a nonexistent entry', async () => {
    const mac = 'M-shrunk';
    await db.setProgress(mac, { lastEntry: 9, lastClock: clockAt(9) });
    const { client, loadGets } = fake({ [BILLING]: 1, [PQ]: 1, [LOAD]: 4 });
    const r = await readBillingMode(client, mac, 1);
    expect(r.fullReread).toBe(true);
    expect(loadGets().map((a) => [a.fromEntry, a.toEntry])).toEqual([[1, 4]]);
  });

  it('layoutWarning false when live layouts match the templates', async () => {
    const r = await readBillingMode(fake({ [BILLING]: 1, [PQ]: 1, [LOAD]: 1 }).client, 'M-lay-ok', 1);
    expect(r.layoutWarning).toBe(false);
  });

  it('layoutWarning true when any live layout differs', async () => {
    const odd = (o: string) => layout(o === PQ ? ['0.0.1.0.0.255', '9.9.9.9.9.9'] : tplOf(o).map((c) => c.obis));
    const r = await readBillingMode(fake({ [BILLING]: 1, [PQ]: 1, [LOAD]: 1 }, clockAt, odd).client, 'M-lay-bad', 1);
    expect(r.layoutWarning).toBe(true);
  });

  it('writes progress only after pending resolves', async () => {
    const mac = 'M-order';
    const order: string[] = [];
    const ap = vi.spyOn(db, 'appendPending').mockImplementation(async () => { await new Promise((r) => setTimeout(r, 20)); order.push('pending'); });
    const sp = vi.spyOn(db, 'setProgress').mockImplementation(async () => { order.push('progress'); });
    try {
      await readBillingMode(fake({ [BILLING]: 1, [PQ]: 1, [LOAD]: 2 }).client, mac, 1);
    } finally { ap.mockRestore(); sp.mockRestore(); }
    expect(order).toEqual(['pending', 'progress']);
  });

  it('full re-read drops stale pending entries above the new E', async () => {
    const mac = 'M-stale';
    const old = (n: number) => row(n).t === 'structure' ? [{ key: 'clock', obis: '0.0.1.0.0.255', raw: n, scaler: 0, unit: '', value: n, missing: false }] : [];
    await db.appendPending(mac, Array.from({ length: 9 }, (_, i) => old(i + 1)), { from: 1, to: 9 });
    await db.setProgress(mac, { lastEntry: 9, lastClock: 12345 });
    const r = await readBillingMode(fake({ [BILLING]: 1, [PQ]: 1, [LOAD]: 4 }).client, mac, 1);
    expect(r.fullReread).toBe(true);
    const pend = await db.getPending(mac);
    expect(pend).toMatchObject({ from: 1, to: 4 });
    expect(pend?.rows).toHaveLength(4);
    expect(pend?.rows[0][0].value).toBe(clockAt(1));
  });

  it('does not advance progress when appendPending rejects', async () => {
    const mac = 'M-fail';
    const ap = vi.spyOn(db, 'appendPending').mockRejectedValue(new Error('quota'));
    const sp = vi.spyOn(db, 'setProgress');
    try {
      await expect(readBillingMode(fake({ [BILLING]: 1, [PQ]: 1, [LOAD]: 2 }).client, mac, 1)).rejects.toThrow('quota');
      expect(sp).not.toHaveBeenCalled();
    } finally { ap.mockRestore(); sp.mockRestore(); }
    expect(await db.getProgress(mac)).toBeUndefined();
  });
});
