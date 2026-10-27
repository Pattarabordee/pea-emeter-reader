import { describe, it, expect } from 'vitest';
import { obisToBytes } from './obis';
import { buildGetNormal, buildGetNext, parseGetResponse } from './get';

describe('obis', () => {
  it('converts dotted code', () => {
    expect([...obisToBytes('1.0.12.7.0.255')]).toEqual([1, 0, 12, 7, 0, 255]);
  });
  it('rejects malformed codes', () => {
    expect(() => obisToBytes('1.0.12')).toThrow();
  });
});

describe('get', () => {
  it('builds GET-request-normal without access', () => {
    expect([...buildGetNormal(3, obisToBytes('1.0.12.7.0.255'), 2)]).toEqual(
      [0xc0, 0x01, 0xc1, 0x00, 0x03, 1, 0, 12, 7, 0, 255, 2, 0x00]);
  });
  it('builds by-entry selective access (selector 2)', () => {
    const a = buildGetNormal(7, obisToBytes('1.0.98.1.0.255'), 2, { kind: 'by-entry', fromEntry: 5, toEntry: 9 });
    expect([...a.subarray(12)]).toEqual([
      0x01, 0x02, 0x02, 0x04, 0x06, 0, 0, 0, 5, 0x06, 0, 0, 0, 9, 0x12, 0, 1, 0x12, 0, 0]);
  });
  it('builds GET-request-next', () => {
    expect([...buildGetNext(1)]).toEqual([0xc0, 0x02, 0xc1, 0, 0, 0, 1]);
  });
  it('parses normal data and data-blocks; throws on access error', () => {
    expect(parseGetResponse(Uint8Array.from([0xc4, 1, 0xc1, 0, 0x06, 0, 0, 0, 7]))).toEqual({
      data: Uint8Array.from([0x06, 0, 0, 0, 7]) });
    expect(parseGetResponse(Uint8Array.from([0xc4, 2, 0xc1, 0, 0, 0, 0, 2, 0, 2, 0xaa, 0xbb]))).toEqual({
      block: { last: false, blockNumber: 2, raw: Uint8Array.from([0xaa, 0xbb]) } });
    expect(() => parseGetResponse(Uint8Array.from([0xc4, 1, 0xc1, 0x01, 0x03]))).toThrow(/data-access-result 3 /);
    expect(() => parseGetResponse(Uint8Array.from([0xc4, 1, 0xc1, 7]))).toThrow(/bad Get-Data-Result tag 7/);
    expect(() => parseGetResponse(Uint8Array.from([0xc4, 2, 0xc1, 1, 0, 0, 0, 1, 1, 9]))).toThrow(/data-access-result 9 /);
  });
});
