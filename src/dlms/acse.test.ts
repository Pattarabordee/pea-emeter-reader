import { describe, expect, it } from 'vitest';
import { buildAarq, parseAare } from './acse';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (s: string) => Uint8Array.from(s.match(/../g)!.map((x) => parseInt(x, 16)));

describe('acse', () => {
  it('builds LN + LLS AARQ with placeholder password', () => {
    // Hand-assembled per Green Book: 60 36 | A1 09 06 07 <LN ctx OID> | 8A 02 07 80 | 8B 07 <LLS OID>
    // | AC 0A 80 08 "12345678" | BE 10 04 0E <InitiateRequest v6, conf 007E1F, maxPDU FFFF>
    const pw = new TextEncoder().encode('12345678');
    expect(hex(buildAarq(pw))).toBe(
      '6036' + 'a109060760857405080101' + '8a020780' + '8b0760857405080201' +
        'ac0a80083132333435363738' + 'be10040e01000000065f1f0400007e1fffff',
    );
  });

  it('parses accepted AARE', () => {
    const aare = fromHex('6129a109060760857405080101a203020100a305a103020100be10040e0800065f1f0400007e1f04000007');
    expect(parseAare(aare)).toEqual({ accepted: true, diagnostic: 'accepted: null' });
  });

  it('parses rejected AARE with authentication-failure', () => {
    const aare = fromHex('6117a109060760857405080101a203020101a305a10302010d');
    const r = parseAare(aare);
    expect(r.accepted).toBe(false);
    expect(r.diagnostic).toContain('authentication-failure');
  });

  it('maps application-context-name-not-supported and garbage', () => {
    const aare = fromHex('6117a109060760857405080101a203020101a305a103020102');
    expect(parseAare(aare).diagnostic).toContain('application-context-name-not-supported');
    expect(parseAare(Uint8Array.from([1, 2, 3])).accepted).toBe(false);
  });
});
