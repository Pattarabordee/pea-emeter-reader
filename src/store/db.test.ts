import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { deleteRead, getPassword, listMeters, listPlaces, listReads, saveMeters, savePlaces, saveRead, setPassword } from './db';

const m = { name: 'A B', mac: 'AA:BB:CC:DD:EE:FF', password: '00000000', type: 1 as const, descriptor: 'd' };

describe('db', () => {
  it('round-trips meters (upsert)', async () => {
    await saveMeters([m]);
    await saveMeters([{ ...m, descriptor: 'd2' }]);
    expect(await listMeters()).toEqual([{ ...m, descriptor: 'd2' }]);
  });
  it('password override and unknown mac', async () => {
    expect(await getPassword('00:00:00:00:00:00')).toBeUndefined();
    await setPassword(m.mac, 'fake-override');
    expect(await getPassword(m.mac)).toBe('fake-override');
  });
  it('saves, lists newest first, and deletes history reads', async () => {
    const p = { kind: 'event' as const, obis: '0.0.99.98.0.255', periodSec: 0, entries: 1, columns: [], rows: [[1, 202]] };
    const a = await saveRead({ at: 1, mac: m.mac, name: 'A', profile: p });
    const b = await saveRead({ at: 2, mac: m.mac, name: 'B', profile: p });
    expect((await listReads()).map((r) => r.name)).toEqual(['B', 'A']);
    await deleteRead(a);
    expect((await listReads()).map((r) => r.id)).toEqual([b]);
  });
  it('a new GIS file replaces all stored places', async () => {
    const p = { mac: 'AA:BB:CC:DD:EE:01', serial: '1', maker: 'X', phase: '1', office: 'pkn', lat: 17, lon: 103 };
    await savePlaces([p, { ...p, mac: 'AA:BB:CC:DD:EE:02' }]);
    await savePlaces([{ ...p, serial: '2' }]);
    expect(await listPlaces()).toEqual([{ ...p, serial: '2' }]);
  });
  it('import password is the default when no override', async () => {
    await saveMeters([{ ...m, mac: '11:11:11:11:11:11', password: 'imp' }]);
    expect(await getPassword('11:11:11:11:11:11')).toBe('imp');
  });
});
