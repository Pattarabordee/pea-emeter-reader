import { describe, it, expect } from 'vitest';
import { RadioHead, advStats } from './radioHead';

/** A radio whose replies are scripted per command word. */
function rig(replies: Record<string, string>) {
  const sent: string[] = [];
  const r: RadioHead = new RadioHead(async (line) => {
    sent.push(line);
    const reply = replies[line.split(' ')[0]];
    if (reply) queueMicrotask(() => r.feed(reply));
  });
  return { r, sent };
}

describe('RadioHead', () => {
  it('collects every advert of a scan, across split serial chunks', async () => {
    const { r, sent } = rig({});
    const p = r.scan(100);
    await Promise.resolve();
    r.feed('ADV aa:bb:cc:dd:ee:01 0 -60 1000 PEA 123\nADV aa:bb:cc:dd');
    r.feed(':ee:01 0 -62 101000 \nSCANEND\n');
    const advs = await p;
    expect(sent).toEqual(['SCAN 100']);
    expect(advs).toHaveLength(2);
    expect(advs[0]).toEqual({ mac: 'aa:bb:cc:dd:ee:01', type: 0, rssi: -60, us: 1000, name: 'PEA 123' });
    expect(advStats(advs)).toEqual([{ mac: 'aa:bb:cc:dd:ee:01', type: 0, name: 'PEA 123', count: 2, rssi: -61, gapMs: 100 }]);
  });

  it('returns the step times of a connect', async () => {
    const { r, sent } = rig({ CONN: 'EVT CONNECTED 250000\nEVT MTU 280000 247\nEVT DISCOVERED 600000 18 21\nEVT READY 650000 247 6 1\n' });
    expect(await r.connect('aa:bb:cc:dd:ee:01', 0, 6, 8000)).toEqual({
      connectedUs: 250000, mtuUs: 280000, discoveredUs: 600000, readyUs: 650000, mtu: 247, itvl: 6, writeNoRsp: true });
    expect(sent).toEqual(['CONN aa:bb:cc:dd:ee:01 0 6 8000']);
  });

  it('rejects on ERR for the pending command and on a lost link', async () => {
    await expect(rig({ CONN: 'ERR CONN connect 13\n' }).r.connect('aa:bb:cc:dd:ee:01', 0)).rejects.toThrow('ERR CONN connect 13');
    const { r } = rig({ TX: 'EVT DISC 520\n' });
    let reason = 0;
    r.onDisc = (n) => { reason = n; };
    await expect(r.transport.write(Uint8Array.of(1))).rejects.toThrow('EVT DISC 520');
    expect(reason).toBe(520);
  });

  it('is a Transport: hex out, whole HDLC frames in, bytes counted', async () => {
    const { r, sent } = rig({ TX: 'OK TX\n' });
    const frames: number[][] = [];
    r.transport.onData((b) => frames.push([...b]));
    await r.transport.write(Uint8Array.of(0x7e, 0xa0, 0x0f));
    expect(sent).toEqual(['TX 7ea00f']);
    // one 9-byte frame (len field 7) split over two notifications
    r.feed('RX 7ea0070321\nRX 93aabb7e\n');
    expect(frames).toEqual([[0x7e, 0xa0, 0x07, 0x03, 0x21, 0x93, 0xaa, 0xbb, 0x7e]]);
    expect(r.rxBytes).toBe(9);
  });

  it('runs commands one at a time', async () => {
    const { r, sent } = rig({ INFO: 'OK INFO 247 6 -70\n', DROP: 'OK DROP\n' });
    const [i] = await Promise.all([r.info(), r.drop()]);
    expect(i).toEqual({ mtu: 247, itvl: 6, rssi: -70 });
    expect(sent).toEqual(['INFO', 'DROP']);
  });
});
