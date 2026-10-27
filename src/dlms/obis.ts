/** "1.0.12.7.0.255" -> [1,0,12,7,0,255] */
export function obisToBytes(code: string): Uint8Array {
  const parts = code.split('.').map(Number);
  if (parts.length !== 6 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`bad OBIS code: ${code}`);
  }
  return Uint8Array.from(parts);
}
