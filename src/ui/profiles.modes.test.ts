/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  readBillingMode: vi.fn(), read24hVoltage: vi.fn(), getPending: vi.fn(), clearPending: vi.fn(async (_mac: string) => {}),
  clearProgress: vi.fn(async (_mac: string) => {}), download: vi.fn(), drawLoadChart: vi.fn(),
}));
vi.mock('../profiles/billingMode', () => ({ readBillingMode: m.readBillingMode }));
vi.mock('../profiles/voltage24h', () => ({ read24hVoltage: m.read24hVoltage }));
vi.mock('../store/db', () => ({ getPending: m.getPending, clearPending: m.clearPending, clearProgress: m.clearProgress }));
vi.mock('../export/export', async (o) => ({ ...(await o<object>()), download: m.download }));
vi.mock('./chart', () => ({ drawLoadChart: m.drawLoadChart }));
import { mountProfiles } from './profiles';
import { shared } from './live';

const rd = (key: string, value: number | null, missing = false) => ({ key, obis: '', raw: value, scaler: 0, unit: '', value, missing });
const btn = (root: HTMLElement, t: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === t)!;
let root: HTMLElement;
beforeEach(() => {
  Object.values(m).forEach((f) => f.mockClear());
  shared.client = {} as never; shared.busy = false; shared.end = vi.fn(async () => {});
  shared.meter = { name: 'M', mac: 'AA:BB', type: 1, descriptor: 'd', password: 'secret' } as never;
  root = document.createElement('div'); mountProfiles(root);
});

describe('fast read modes', () => {
  it('จดบิล shows counts + pending; Export downloads then clears pending', async () => {
    m.readBillingMode.mockResolvedValue({ billing: [[]], pq: [[], []], loadAdded: [[], [], []], fullReread: false, nothingNew: false, layoutWarning: false });
    m.getPending.mockResolvedValue({ rows: [[], [], [], []], from: 1, to: 4 });
    btn(root, 'จดบิล (เร็ว)').click();
    await vi.waitFor(() => expect(root.textContent).toContain('Load added 3'));
    expect(root.textContent).toContain('Pending backlog: 4 rows');
    const order: string[] = [];
    m.download.mockImplementation(() => order.push('download'));
    m.clearPending.mockImplementation(async () => { order.push('clear'); });
    btn(root, 'Export').click();
    await vi.waitFor(() => expect(order).toEqual(['download', 'clear']));
    expect(m.download.mock.calls[0][0]).toMatch(/^AA-BB_billing_\d{4}-\d\d-\d\d\.json$/);
    expect(m.download.mock.calls[0][1]).not.toContain('secret');
    expect(root.querySelector('.status')!.textContent).not.toContain('WARNING');
  });

  it('จดบิล shows the layout warning when the live layout differs', async () => {
    m.readBillingMode.mockResolvedValue({ billing: [], pq: [], loadAdded: [], fullReread: false, nothingNew: true, layoutWarning: true });
    m.getPending.mockResolvedValue(undefined);
    btn(root, 'จดบิล (เร็ว)').click();
    await vi.waitFor(() => expect(root.querySelector('.status')!.textContent).toContain('WARNING: capture layout differs'));
  });

  it('แรงดัน 24 ชม. draws rows and exports wide CSV with missing never 0', async () => {
    m.read24hVoltage.mockResolvedValue({ periodSec: 900, rows: [[rd('clock', 1_700_000_000_000), rd('voltageL1', 230)], [rd('clock', null, true), rd('voltageL1', null, true)]] });
    btn(root, 'แรงดัน 24 ชม.').click();
    await vi.waitFor(() => expect(m.drawLoadChart).toHaveBeenCalledTimes(1));
    btn(root, 'Export').click();
    const csv = m.download.mock.calls[0][1] as string;
    expect(csv).toContain('timestamp_bangkok,voltageL1');
    expect(csv).toContain('+07:00,230');
    expect(csv).toContain('missing,missing');
    expect(csv).toContain('periodSec');
  });

  it('no voltage column shows the error, no chart, link kept', async () => {
    m.read24hVoltage.mockRejectedValue(new Error('no voltage column'));
    btn(root, 'แรงดัน 24 ชม.').click();
    await vi.waitFor(() => expect(root.querySelector('.status')!.textContent).toBe('no voltage column'));
    expect(m.drawLoadChart).not.toHaveBeenCalled();
    expect(shared.end).not.toHaveBeenCalled();
  });

  it('อ่านใหม่ทั้งหมด clears progress and pending', async () => {
    btn(root, 'อ่านใหม่ทั้งหมด').click();
    await vi.waitFor(() => expect(m.clearProgress).toHaveBeenCalledWith('AA:BB'));
    expect(m.clearPending).toHaveBeenCalledWith('AA:BB');
  });

  it('อ่านใหม่ทั้งหมด while busy does nothing and says busy', () => {
    shared.busy = true;
    btn(root, 'อ่านใหม่ทั้งหมด').click();
    expect(m.clearProgress).not.toHaveBeenCalled();
    expect(m.clearPending).not.toHaveBeenCalled();
    expect(root.querySelector('.status')!.textContent).toContain('Busy');
  });

  it('อ่านใหม่ทั้งหมด reports a storage failure in the status', async () => {
    m.clearProgress.mockRejectedValueOnce(new Error('idb down'));
    btn(root, 'อ่านใหม่ทั้งหมด').click();
    await vi.waitFor(() => expect(root.querySelector('.status')!.textContent).toContain('Reset failed (idb down)'));
  });
});
