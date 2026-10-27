import { describe, expect, it } from 'vitest';
import { ByteReader, decodeData } from './axdr';

const dec = (...b: number[]) => decodeData(new ByteReader(Uint8Array.from(b)));

describe('decodeData', () => {
  it('pins tag bytes for scalar types', () => {
    expect(dec(0x00)).toEqual({ t: 'null' });
    expect(dec(0x05, 0xff, 0xff, 0xff, 0xfe)).toEqual({ t: 'i32', v: -2 });
    expect(dec(0x06, 0, 1, 0, 0)).toEqual({ t: 'u32', v: 65536 });
    expect(dec(0x0f, 0xfe)).toEqual({ t: 'i8', v: -2 });
    expect(dec(0x10, 0xff, 0x38)).toEqual({ t: 'i16', v: -200 });
    expect(dec(0x11, 0xff)).toEqual({ t: 'u8', v: 255 });
    expect(dec(0x12, 0x59, 0xda)).toEqual({ t: 'u16', v: 23002 });
    expect(dec(0x16, 0x05)).toEqual({ t: 'enum', v: 5 });
  });

  it('u32 above 2^31 stays unsigned', () => {
    expect(dec(0x06, 0xff, 0xff, 0xff, 0xff)).toEqual({ t: 'u32', v: 4294967295 });
  });

  it('decodes octet-string', () => {
    expect(dec(0x09, 0x03, 0xaa, 0xbb, 0xcc)).toEqual({ t: 'octet', v: Uint8Array.from([0xaa, 0xbb, 0xcc]) });
  });

  it('decodes structure of [u32,u16] and nested array', () => {
    expect(dec(0x02, 0x02, 0x06, 0, 0, 0, 7, 0x12, 0, 9)).toEqual({
      t: 'structure',
      v: [{ t: 'u32', v: 7 }, { t: 'u16', v: 9 }],
    });
    expect(dec(0x01, 0x01, 0x02, 0x01, 0x11, 1)).toEqual({
      t: 'array',
      v: [{ t: 'structure', v: [{ t: 'u8', v: 1 }] }],
    });
  });

  it('supports long-form A-XDR length (0x81 n)', () => {
    const body = new Array(130).fill(0x00);
    const r = dec(0x01, 0x81, 130, ...body);
    expect(r.t === 'array' && r.v.length).toBe(130);
  });

  it('throws on unknown tag and truncated data', () => {
    expect(() => dec(0x63)).toThrow();
    expect(() => dec(0x12, 0x59)).toThrow();
  });
});

describe('datetime (tag 0x19, 12 bytes)', () => {
  // 2026-10-27 (Tue=2) 14:30:15.00, deviation 0 -> UTC
  const dt = (...b: number[]) => dec(0x19, ...b);

  it('decodes a fully specified timestamp', () => {
    const r = dt(0x07, 0xea, 10, 27, 2, 14, 30, 15, 0, 0x00, 0x00, 0x00);
    expect(r).toEqual({ t: 'datetime', v: { date: new Date('2026-10-27T14:30:15.000Z'), missing: false } });
  });

  it('applies deviation: UTC = local + deviation minutes', () => {
    // Bangkok local 14:30, deviation -420 (0xFE5C) -> 07:30Z
    const r = dt(0x07, 0xea, 10, 27, 2, 14, 30, 15, 0, 0xfe, 0x5c, 0x00);
    expect(r.t === 'datetime' && r.v.date?.toISOString()).toBe('2026-10-27T07:30:15.000Z');
  });

  it('deviation 0x8000 (not specified) keeps wall-clock as-is, still valid', () => {
    const r = dt(0x07, 0xea, 10, 27, 0xff, 14, 30, 15, 0xff, 0x80, 0x00, 0xff);
    expect(r).toEqual({ t: 'datetime', v: { date: new Date('2026-10-27T14:30:15.000Z'), missing: false } });
  });

  it('year 0xFFFF -> missing, no date', () => {
    const r = dt(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x80, 0x00, 0xff);
    expect(r).toEqual({ t: 'datetime', v: { date: null, missing: true } });
  });

  it('any unspecified month/day/hour/minute -> missing', () => {
    for (const i of [2, 3, 5, 6]) {
      const b = [0x07, 0xea, 10, 27, 2, 14, 30, 15, 0, 0, 0, 0];
      b[i] = 0xff;
      expect(dt(...b)).toEqual({ t: 'datetime', v: { date: null, missing: true } });
    }
  });

  it('out-of-range fields (month 13) -> missing, not rolled over', () => {
    const r = dt(0x07, 0xea, 13, 27, 2, 14, 30, 15, 0, 0, 0, 0);
    expect(r).toEqual({ t: 'datetime', v: { date: null, missing: true } });
    const r2 = dt(0x07, 0xea, 2, 30, 2, 14, 30, 15, 0, 0, 0, 0); // Feb 30
    expect(r2).toEqual({ t: 'datetime', v: { date: null, missing: true } });
  });
});
