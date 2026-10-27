import { describe, expect, it } from 'vitest';
import { decodeHdlc, encodeHdlc } from './hdlc';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

describe('hdlc', () => {
  it('encodes SNRM to the documented DLMS bytes (no info => no HCS)', () => {
    // Widely published SNRM: 7E A0 07 03 21 93 0F 01 7E
    const f = { dest: 0x03, src: 0x21, control: 0x93, segmented: false };
    expect(hex(encodeHdlc(f))).toBe('7e a0 07 03 21 93 0f 01 7e');
    expect(decodeHdlc(encodeHdlc(f))).toEqual({ ...f, info: undefined });
  });

  it('pins HCS+FCS for a frame with info (independently computed)', () => {
    const f = { dest: 0x03, src: 0x41, control: 0x10, info: Uint8Array.of(0xe6, 0xe6, 0x00, 0xc0), segmented: false };
    expect(hex(encodeHdlc(f))).toBe('7e a0 0d 03 41 10 67 0e e6 e6 00 c0 eb 11 7e');
  });

  it('round-trips an I-frame, segmented flag included', () => {
    const f = { dest: 0x03, src: 0x41, control: 0x32, info: Uint8Array.of(1, 2, 3, 0x7e), segmented: true };
    expect(decodeHdlc(encodeHdlc(f))).toEqual(f);
  });

  it('throws on a corrupted FCS', () => {
    const b = encodeHdlc({ dest: 3, src: 0x21, control: 0x93, segmented: false });
    b[b.length - 2] ^= 0xff;
    expect(() => decodeHdlc(b)).toThrow(/FCS/);
  });
});
