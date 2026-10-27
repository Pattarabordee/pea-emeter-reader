import { crc16X25 } from './crc';

export type HdlcFrame = {
  dest: number; // raw address byte (already HDLC-encoded by the caller)
  src: number;
  control: number;
  info?: Uint8Array;
  segmented: boolean;
};

const FLAG = 0x7e;

/** Type-3 frame, 1-byte addresses. Length field counts everything between the flags. */
export function encodeHdlc(f: HdlcFrame): Uint8Array {
  const n = f.info?.length ?? 0;
  const len = 2 + 3 + (n ? 2 + n : 0) + 2;
  if (len > 0x7ff) throw new Error('HDLC frame too long');
  const out = new Uint8Array(len + 2);
  out[0] = FLAG;
  out[1] = 0xa0 | (f.segmented ? 0x08 : 0) | (len >> 8);
  out[2] = len & 0xff;
  out[3] = f.dest;
  out[4] = f.src;
  out[5] = f.control;
  let p = 6;
  if (n) {
    const hcs = crc16X25(out.subarray(1, 6));
    out[p++] = hcs & 0xff;
    out[p++] = hcs >> 8;
    out.set(f.info!, p);
    p += n;
  }
  const fcs = crc16X25(out.subarray(1, p));
  out[p++] = fcs & 0xff;
  out[p++] = fcs >> 8;
  out[p] = FLAG;
  return out;
}

export function decodeHdlc(b: Uint8Array): HdlcFrame {
  if (b.length < 9 || b[0] !== FLAG || b[b.length - 1] !== FLAG) throw new Error('HDLC: bad flags/length');
  if ((b[1] & 0xf0) !== 0xa0) throw new Error('HDLC: not a type-3 frame');
  const len = ((b[1] & 0x07) << 8) | b[2];
  if (len !== b.length - 2) throw new Error('HDLC: length mismatch');
  const fcsAt = b.length - 3;
  if (crc16X25(b.subarray(1, fcsAt)) !== (b[fcsAt] | (b[fcsAt + 1] << 8))) throw new Error('HDLC: bad FCS');
  let info: Uint8Array | undefined;
  if (fcsAt > 6) {
    if (crc16X25(b.subarray(1, 6)) !== (b[6] | (b[7] << 8))) throw new Error('HDLC: bad HCS');
    info = b.slice(8, fcsAt);
  }
  return { dest: b[3], src: b[4], control: b[5], info, segmented: (b[1] & 0x08) !== 0 };
}
