import { describe, expect, it } from 'vitest';
import { crc16X25 } from './crc';

describe('crc16X25', () => {
  it('matches the standard check vector', () => {
    expect(crc16X25(new TextEncoder().encode('123456789'))).toBe(0x906e);
  });
});
