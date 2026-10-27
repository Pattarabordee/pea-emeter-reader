import { describe, it, expect } from 'vitest';
import { HdlcSession } from './hdlc-session';
import { encodeHdlc, decodeHdlc } from './hdlc';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
// server -> client frame: dest = client byte 0x41, src = server byte 0x03
const fromServer = (control: number, info?: number[], segmented = false) =>
  encodeHdlc({ dest: 0x41, src: 0x03, control, info: info && new Uint8Array(info), segmented });

describe('HdlcSession', () => {
  it('SNRM: dest 0x03, src 0x41, control 0x93, no info', () => {
    const b = new HdlcSession(32, 1).snrm();
    const f = decodeHdlc(b);
    expect([f.dest, f.src, f.control, f.info, f.segmented]).toEqual([0x03, 0x41, 0x93, undefined, false]);
    expect(hex(b).startsWith('7ea00703' + '4193')).toBe(true);
  });

  it('DISC uses control 0x53', () => {
    expect(decodeHdlc(new HdlcSession(32, 1).disconnect()).control).toBe(0x53);
  });

  it('UA -> {kind:ua}', () => {
    expect(new HdlcSession(32, 1).onReceive(fromServer(0x73))).toEqual({ kind: 'ua' });
  });

  it('reassembles two segmented info frames, RR after the first', () => {
    const s = new HdlcSession(32, 1);
    s.onReceive(fromServer(0x73));
    const e1 = s.onReceive(fromServer(0x10, [1, 2, 3], true)); // Ns=0
    expect(e1.kind).toBe('needMore');
    // RR: Nr=1 -> 1<<5 | 0x10 | 0x01 = 0x31
    const rr = decodeHdlc((e1 as { rr: Uint8Array }).rr);
    expect([rr.dest, rr.src, rr.control]).toEqual([0x03, 0x41, 0x31]);
    const e2 = s.onReceive(fromServer(0x12, [4, 5], false)); // Ns=1
    expect(e2).toEqual({ kind: 'info', apdu: new Uint8Array([1, 2, 3, 4, 5]) });
  });

  it('sendInfo splits oversize payload; Ns increments, seg bit on all but last', () => {
    const s = new HdlcSession(32, 1, 4);
    const payload = new Uint8Array(10).map((_, i) => i);
    const frames = s.sendInfo(payload).map(decodeHdlc);
    expect([...frames.flatMap((f) => [...f.info!])]).toEqual([...payload]);
    expect(frames.map((f) => f.control)).toEqual([0x10, 0x12, 0x14]);
    expect(frames.map((f) => f.segmented)).toEqual([true, true, false]);
    expect(frames.map((f) => f.info!.length)).toEqual([4, 4, 2]);
    expect(frames.every((f) => f.dest === 0x03 && f.src === 0x41)).toBe(true);
  });

  it('I-frame carries Nr of received frames', () => {
    const s = new HdlcSession(32, 1);
    s.onReceive(fromServer(0x10, [9])); // Ns=0 -> Nr=1
    expect(decodeHdlc(s.sendInfo(new Uint8Array([1]))[0]).control).toBe(0x30); // 1<<5|0x10|Ns0<<1
  });

  it('meter RR after segmented send -> {kind:rr}, no throw', () => {
    const s = new HdlcSession(32, 1, 4);
    s.sendInfo(new Uint8Array(10));
    expect(s.onReceive(fromServer((1 << 5) | 0x11))).toEqual({ kind: 'rr' });
  });

  it('unexpected control clears partial reassembly', () => {
    const s = new HdlcSession(32, 1);
    s.onReceive(fromServer(0x10, [1, 2], true));
    expect(() => s.onReceive(fromServer(0x05))).toThrow(); // RNR
    expect(s.onReceive(fromServer(0x12, [7]))).toEqual({ kind: 'info', apdu: new Uint8Array([7]) });
  });
});
