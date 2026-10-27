import type { DlmsData, DlmsDateTime } from './types';

export class ByteReader {
  pos = 0;
  constructor(private readonly buf: Uint8Array) {}
  get remaining(): number {
    return this.buf.length - this.pos;
  }
  bytes(n: number): Uint8Array {
    if (n < 0 || this.remaining < n) throw new Error(`A-XDR: need ${n} bytes, have ${this.remaining}`);
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  u8(): number {
    return this.bytes(1)[0];
  }
  /** Big-endian unsigned of n bytes (n <= 4). */
  uN(n: number): number {
    let v = 0;
    for (const b of this.bytes(n)) v = v * 256 + b;
    return v;
  }
  /** A-XDR length: <0x80 literal; else low 7 bits = count of following length bytes. */
  length(): number {
    const b = this.u8();
    if (b < 0x80) return b;
    const n = b & 0x7f;
    if (n < 1 || n > 4) throw new Error(`A-XDR: unsupported length-of-length ${n}`);
    return this.uN(n);
  }
}

const signed = (v: number, bits: number) => (v >= 2 ** (bits - 1) ? v - 2 ** bits : v);

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

const MISSING: DlmsDateTime = { date: null, missing: true };

/**
 * 12-byte COSEM date-time. Any unspecified/out-of-range year, month, day, hour or
 * minute => missing (never epoch). Seconds 0xFF => 0 (only the minute matters).
 * Deviation = minutes, UTC = local + deviation (Blue Book). 0x8000 = not specified:
 * the wall-clock fields are taken as-is and labelled UTC (valid instant, zone unknown).
 */
export function decodeDateTime(r: ByteReader): DlmsDateTime {
  const year = r.uN(2), month = r.u8(), day = r.u8();
  r.u8(); // day-of-week: derived from the date, ignored
  const hour = r.u8(), min = r.u8(), secRaw = r.u8(), hund = r.u8();
  const dev = r.uN(2);
  r.u8(); // clock status
  const sec = secRaw === 0xff ? 0 : secRaw;
  const ms = hund === 0xff ? 0 : hund * 10;
  if (year < 2000 || // pre-2000 is not a real meter time; Date.UTC would also map 0-99 to 1900s
    year === 0xffff || month < 1 || month > 12 || hour > 23 || min > 59 || sec > 59 || hund > 99 && hund !== 0xff) return MISSING;
  if (day < 1 || day > DAYS[month - 1] + (month === 2 && isLeap(year) ? 1 : 0)) return MISSING;
  const wall = Date.UTC(year, month - 1, day, hour, min, sec, ms);
  const offsetMin = dev === 0x8000 ? 0 : signed(dev, 16);
  return { date: new Date(wall + offsetMin * 60000), missing: false, tzKnown: dev !== 0x8000 };
}

export function decodeData(r: ByteReader): DlmsData {
  const tag = r.u8();
  switch (tag) {
    case 0x00: return { t: 'null' };
    case 0x01: case 0x02: {
      const n = r.length();
      const v: DlmsData[] = [];
      for (let i = 0; i < n; i++) v.push(decodeData(r));
      return { t: tag === 0x01 ? 'array' : 'structure', v };
    }
    case 0x05: return { t: 'i32', v: signed(r.uN(4), 32) };
    case 0x06: return { t: 'u32', v: r.uN(4) };
    case 0x09: return { t: 'octet', v: r.bytes(r.length()).slice() };
    case 0x0f: return { t: 'i8', v: signed(r.u8(), 8) };
    case 0x10: return { t: 'i16', v: signed(r.uN(2), 16) };
    case 0x11: return { t: 'u8', v: r.u8() };
    case 0x12: return { t: 'u16', v: r.uN(2) };
    case 0x16: return { t: 'enum', v: r.u8() };
    case 0x19: return { t: 'datetime', v: decodeDateTime(r) };
    default: throw new Error(`A-XDR: unsupported data tag 0x${tag.toString(16)}`);
  }
}
