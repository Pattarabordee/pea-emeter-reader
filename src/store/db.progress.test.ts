import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import type { Reading } from '../profiles/templates';
import { appendPending, clearPending, getPending, getProgress, listMeters, setProgress } from './db';

const r = (n: number): Reading[] => [{ key: 'k', obis: '1.0.1.8.0.255', raw: n, scaler: 0, unit: '', value: n, missing: false }];
const MAC = 'AA:BB:CC:00:00:01';

describe('progress + pending stores', () => {
  // must run first: needs the file's fresh fake-indexeddb with no v2 connection open
  it('upgrades a v1 db to v2 keeping meters', async () => {
    const v1 = await openDB('emeter', 1, {
      upgrade(d) {
        d.createObjectStore('meters', { keyPath: 'mac' });
        d.createObjectStore('passwords');
      },
    });
    await v1.put('meters', { name: 'x', mac: 'M1', password: 'p', type: 1, descriptor: 'd' });
    v1.close();
    expect((await listMeters()).map((m) => m.mac)).toEqual(['M1']);
    await setProgress('M1', { lastEntry: 1, lastClock: 2 });
    expect(await getProgress('M1')).toEqual({ lastEntry: 1, lastClock: 2 });
  });

  it('progress round-trips', async () => {
    expect(await getProgress(MAC)).toBeUndefined();
    await setProgress(MAC, { lastEntry: 5, lastClock: 123 });
    expect(await getProgress(MAC)).toEqual({ lastEntry: 5, lastClock: 123 });
  });

  it('appendPending/getPending/clearPending', async () => {
    const mac = 'AA:BB:CC:00:00:02';
    await appendPending(mac, [r(1), r(2), r(3)], { from: 1, to: 3 });
    expect(await getPending(mac)).toEqual({ rows: [r(1), r(2), r(3)], from: 1, to: 3 });
    await clearPending(mac);
    expect(await getPending(mac)).toBeUndefined();
  });

  it('overlapping range replaces, never duplicates', async () => {
    const mac = 'AA:BB:CC:00:00:03';
    await appendPending(mac, [r(1), r(2), r(3)], { from: 1, to: 3 });
    await appendPending(mac, [r(20), r(30), r(4)], { from: 2, to: 4 });
    expect(await getPending(mac)).toEqual({ rows: [r(1), r(20), r(30), r(4)], from: 1, to: 4 });
  });
});
