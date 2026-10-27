import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { getPassword, listMeters, saveMeters, setPassword } from './db';

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
  it('import password is the default when no override', async () => {
    await saveMeters([{ ...m, mac: '11:11:11:11:11:11', password: 'imp' }]);
    expect(await getPassword('11:11:11:11:11:11')).toBe('imp');
  });
});
