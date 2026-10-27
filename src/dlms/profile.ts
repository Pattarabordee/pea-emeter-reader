import type { DlmsClient } from './client';
import type { CaptureObject, DlmsData } from './types';

const PROFILE_GENERIC = 7;
const ATTR_BUFFER = 2;
const ATTR_CAPTURE_OBJECTS = 3;
const ATTR_ENTRIES_IN_USE = 7;

/** [1,0,98,1,0,255] -> "1.0.98.1.0.255" (inverse of obisToBytes) */
export function bytesToObis(b: Uint8Array): string {
  if (b.length !== 6) throw new Error(`OBIS must be 6 bytes, got ${b.length}`);
  return Array.from(b).join('.');
}

const num = (d: DlmsData | undefined, what: string): number => {
  if (d && (d.t === 'u8' || d.t === 'u16' || d.t === 'u32' || d.t === 'i8' || d.t === 'i16' || d.t === 'i32' || d.t === 'enum')) return d.v;
  throw new Error(`profile: ${what} is not a number`);
};

export async function getEntriesInUse(client: DlmsClient, obis: string): Promise<number> {
  return num(await client.get(PROFILE_GENERIC, obis, ATTR_ENTRIES_IN_USE), 'entries_in_use');
}

/** fromEntry is 1-based (DLMS entries start at 1). Selected values 0/0 = all columns. */
export async function readRowsByEntry(client: DlmsClient, obis: string, fromEntry: number, count: number): Promise<DlmsData[]> {
  if (!Number.isInteger(fromEntry) || fromEntry < 1) throw new Error(`profile: fromEntry must be >= 1, got ${fromEntry}`);
  if (!Number.isInteger(count) || count < 1) throw new Error(`profile: count must be >= 1, got ${count}`);
  const buf = await client.get(PROFILE_GENERIC, obis, ATTR_BUFFER, {
    kind: 'by-entry', fromEntry, toEntry: fromEntry + count - 1, fromSelectedValue: 0, toSelectedValue: 0,
  });
  if (buf.t !== 'array') throw new Error(`profile: buffer of ${obis} is not an array (got ${buf.t})`);
  return buf.v;
}

export async function getCaptureObjects(client: DlmsClient, obis: string): Promise<CaptureObject[]> {
  const arr = await client.get(PROFILE_GENERIC, obis, ATTR_CAPTURE_OBJECTS);
  if (arr.t !== 'array') throw new Error(`profile: capture_objects of ${obis} is not an array (got ${arr.t})`);
  return arr.v.map((s, i) => {
    if (s.t !== 'structure' || s.v.length !== 4) throw new Error(`profile: capture object ${i} is not a 4-field structure`);
    const [cls, ln, attr, data] = s.v;
    if (ln.t !== 'octet') throw new Error(`profile: capture object ${i} logical_name is not an octet string`);
    return { classId: num(cls, 'class_id'), obis: bytesToObis(ln.v), attributeIndex: num(attr, 'attribute_index'), dataIndex: num(data, 'data_index') };
  });
}
