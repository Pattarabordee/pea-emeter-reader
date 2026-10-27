/** CRC-16/X.25 (CRC-CCITT reflected, init 0xFFFF, xorout 0xFFFF) — the DLMS HDLC HCS/FCS. */
export function crc16X25(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
  }
  return (crc ^ 0xffff) & 0xffff;
}
