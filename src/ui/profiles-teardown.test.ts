/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../dlms/profile', () => ({
  getEntriesInUse: vi.fn(async () => { throw new Error('boom'); }),
  getCaptureObjects: vi.fn(), readRowsByEntry: vi.fn(),
}));
import { mountProfiles } from './profiles';
import { shared } from './live';

describe('profile read failure', () => {
  it('tears down the session and clears busy', async () => {
    const end = vi.fn(async () => { shared.client = undefined; });
    shared.client = {} as never; shared.meter = { name: 'm', mac: 'AA', type: 1 } as never; shared.end = end;
    const root = document.createElement('div');
    mountProfiles(root);
    root.querySelector('button')!.click();
    await vi.waitFor(() => expect(end).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(shared.busy).toBe(false));
    expect(root.querySelector('.status')!.textContent).toContain('reconnect');
  });
});
