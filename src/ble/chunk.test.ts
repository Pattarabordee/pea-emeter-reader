import { describe, it, expect } from 'vitest';
import { encodeHdlc, decodeHdlc } from '../dlms/hdlc';
import { chunk, FrameReassembler } from './transport';

const u = (...n: number[]) => new Uint8Array(n);

describe('chunk', () => {
  it('splits into ordered <=mtu pieces with a short tail', () => {
    const b = Uint8Array.from({ length: 45 }, (_, i) => i);
    const parts = chunk(b, 20);
    expect(parts.map((p) => p.length)).toEqual([20, 20, 5]);
    expect(parts.every((p) => p.length <= 20)).toBe(true);
    expect(Array.from(parts.flatMap((p) => Array.from(p)))).toEqual(Array.from(b));
  });
  it('exact multiple has no empty tail; small input is one piece', () => {
    expect(chunk(new Uint8Array(40), 20).map((p) => p.length)).toEqual([20, 20]);
    expect(chunk(u(1, 2, 3), 20)).toEqual([u(1, 2, 3)]);
  });
  it('empty input gives []', () => expect(chunk(new Uint8Array(0), 20)).toEqual([]));
  it('rejects non-positive or fractional mtu', () => {
    expect(() => chunk(u(1), 0)).toThrow();
    expect(() => chunk(u(1, 2, 3), 20.5)).toThrow();
  });
});

describe('FrameReassembler', () => {
  it('emits one frame from notifications split mid-frame', () => {
    const r = new FrameReassembler();
    expect(r.feed(u(0x7e, 1, 2))).toEqual([]);
    expect(r.feed(u(3, 4))).toEqual([]);
    expect(r.feed(u(5, 0x7e))).toEqual([u(0x7e, 1, 2, 3, 4, 5, 0x7e)]);
  });
  it('emits two frames from one notification', () => {
    const r = new FrameReassembler();
    expect(r.feed(u(0x7e, 1, 0x7e, 0x7e, 2, 3, 0x7e))).toEqual([u(0x7e, 1, 0x7e), u(0x7e, 2, 3, 0x7e)]);
  });
  it('shared flag between frames also works', () => {
    const r = new FrameReassembler();
    expect(r.feed(u(0x7e, 1, 0x7e, 2, 0x7e))).toEqual([u(0x7e, 1, 0x7e), u(0x7e, 2, 0x7e)]);
  });
  it('holds a partial trailing frame until completed; drops leading garbage', () => {
    const r = new FrameReassembler();
    expect(r.feed(u(9, 9, 0x7e, 1, 0x7e, 0x7e, 7))).toEqual([u(0x7e, 1, 0x7e)]);
    expect(r.feed(u(8, 0x7e))).toEqual([u(0x7e, 7, 8, 0x7e)]);
  });
  it('does not split a frame whose body contains 0x7E', () => {
    const f = encodeHdlc({ dest: 0x03, src: 0x21, control: 0x10, info: u(1, 0x7e, 2, 0x7e, 3), segmented: false });
    const r = new FrameReassembler();
    const got = [...r.feed(f.slice(0, 7)), ...r.feed(f.slice(7))];
    expect(got).toEqual([f]);
    expect(decodeHdlc(got[0]).info).toEqual(u(1, 0x7e, 2, 0x7e, 3));
    expect(r.feed(f)).toEqual([f]);
  });
  it('lone flag emits nothing', () => expect(new FrameReassembler().feed(u(0x7e))).toEqual([]));
});
