import { describe, it, expect } from 'vitest';
import { DlmsClient, type Transport } from './client';
import { encodeHdlc, decodeHdlc } from './hdlc';

const hexb = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
const AARE_OK = hexb('6129a109060760857405080101a203020100a305a103020100be10040e0800065f1f0400007e1f04000007');
const LLC_RX = [0xe6, 0xe7, 0x00];
const PASSWORD = Uint8Array.from([0x31, 0x32, 0x33, 0x34]); // throwaway placeholder

// Fake meter: replies to each written frame from a script. Frames to the client carry the server's own Ns.
function fakeMeter(replies: (number[] | 'UA')[], sync: boolean) {
  const writes: Uint8Array[] = [];
  let cb: (b: Uint8Array) => void = () => {};
  let ns = 0;
  let i = 0;
  const t: Transport = {
    onData: (f) => { cb = f; },
    write: async (b) => {
      writes.push(b);
      const r = replies[i++];
      if (!r) return;
      const control = r === 'UA' ? 0x73 : (ns++ << 1) | 0x10; // client never sends info the meter must ack here
      const frame = encodeHdlc({ dest: 0x41, src: 0x03, control, info: r === 'UA' ? undefined : Uint8Array.from(r), segmented: false });
      if (sync) cb(frame); else setTimeout(() => cb(frame), 0);
    },
  };
  return { t, writes };
}
const info = (apdu: ArrayLike<number>) => [...LLC_RX, ...Array.from(apdu)];
const opts = { clientAddr: 32, serverAddr: 1, password: PASSWORD };

describe.each([[true], [false]])('DlmsClient (sync delivery=%s)', (sync) => {
  it('associates and GETs a single-block value; sends LLC E6E600', async () => {
    const { t, writes } = fakeMeter(['UA', info(AARE_OK), info([0xc4, 1, 0xc1, 0, 0x06, 0, 0, 0x01, 0x2c])], sync);
    const c = new DlmsClient(t, opts);
    await c.associate();
    expect(await c.get(3, '1.0.12.7.0.255', 2)).toEqual({ t: 'u32', v: 300 });
    expect([...decodeHdlc(writes[1]).info!.subarray(0, 3)]).toEqual([0xe6, 0xe6, 0x00]);
    expect([...decodeHdlc(writes[2]).info!]).toEqual([0xe6, 0xe6, 0, 0xc0, 1, 0xc1, 0, 3, 1, 0, 12, 7, 0, 255, 2, 0]);
  });

  it('reassembles a two-block response before decoding (value straddles the block boundary)', async () => {
    // array(1){ u32 0x0000012c } split mid-u32
    const b1 = [0xc4, 2, 0xc1, 0, 0, 0, 0, 1, 0, 4, 0x01, 0x01, 0x06, 0x00];
    const b2 = [0xc4, 2, 0xc1, 1, 0, 0, 0, 2, 0, 3, 0x00, 0x01, 0x2c];
    const { t, writes } = fakeMeter(['UA', info(AARE_OK), info(b1), info(b2)], sync);
    const c = new DlmsClient(t, opts);
    await c.associate();
    expect(await c.get(7, '1.0.99.1.0.255', 2)).toEqual({ t: 'array', v: [{ t: 'u32', v: 300 }] });
    expect([...decodeHdlc(writes[3]).info!.subarray(3)]).toEqual([0xc0, 2, 0xc1, 0, 0, 0, 1]);
  });

  it('throws when the AARE is rejected', async () => {
    const rej = hexb('6117a109060760857405080101a203020101a305a10302010d');
    const { t } = fakeMeter(['UA', info(rej)], sync);
    await expect(new DlmsClient(t, opts).associate()).rejects.toThrow(/authentication-failure/);
  });
});
