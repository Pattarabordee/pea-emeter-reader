import { ByteReader } from './axdr';

// Selective access (Green Book): selector 2 = entry-descriptor. Task 7 builds requests with it.
export type SelectiveAccess = {
  kind: 'by-entry';
  fromEntry: number;
  toEntry: number;
  fromSelectedValue?: number; // default 1 (first column)
  toSelectedValue?: number; // default 0 (through last column)
};

const IIAP = 0xc1; // invoke-id 1, confirmed, normal priority
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function accessBytes(a?: SelectiveAccess): number[] {
  if (!a) return [0x00];
  return [
    0x01, 0x02, // access-selection present, selector 2 (by-entry)
    0x02, 0x04, // structure(4)
    0x06, ...u32(a.fromEntry),
    0x06, ...u32(a.toEntry),
    0x12, 0x00, a.fromSelectedValue ?? 1, // long-unsigned
    0x12, 0x00, a.toSelectedValue ?? 0,
  ];
}

export function buildGetNormal(classId: number, obis: Uint8Array, attr: number, access?: SelectiveAccess): Uint8Array {
  if (obis.length !== 6) throw new Error('OBIS must be 6 bytes');
  return Uint8Array.from([0xc0, 0x01, IIAP, classId >> 8, classId & 0xff, ...obis, attr, ...accessBytes(access)]);
}

export function buildGetNext(blockNumber: number): Uint8Array {
  return Uint8Array.from([0xc0, 0x02, IIAP, ...u32(blockNumber)]);
}

export type GetResponse =
  | { data: Uint8Array }
  | { block: { last: boolean; blockNumber: number; raw: Uint8Array } };

const ACCESS_ERR: Record<number, string> = {
  1: 'hardware-fault', 2: 'temporary-failure', 3: 'read-write-denied', 4: 'object-undefined',
  9: 'object-class-inconsistent', 11: 'object-unavailable', 12: 'type-unmatched',
  13: 'scope-of-access-violated', 14: 'data-block-unavailable', 250: 'other-reason',
};

// Get-Data-Result CHOICE: tag 0 = data follows; tag 1 = data-access-result, whose code is the NEXT byte.
function checkResult(r: ByteReader): void {
  const tag = r.u8();
  if (tag === 0) return;
  if (tag !== 1) throw new Error(`GET: bad Get-Data-Result tag ${tag}`);
  const code = r.u8();
  throw new Error(`GET: data-access-result ${code}${ACCESS_ERR[code] ? ` (${ACCESS_ERR[code]})` : ''}`);
}

export function parseGetResponse(apdu: Uint8Array): GetResponse {
  const r = new ByteReader(apdu);
  if (r.u8() !== 0xc4) throw new Error('GET: not a get-response');
  const type = r.u8();
  r.u8(); // invoke-id-and-priority
  if (type === 1) {
    checkResult(r);
    return { data: r.bytes(r.remaining) };
  }
  if (type === 2) {
    const last = r.u8() !== 0;
    const blockNumber = r.uN(4);
    checkResult(r);
    return { block: { last, blockNumber, raw: r.bytes(r.length()) } };
  }
  throw new Error(`GET: unsupported get-response type ${type}`);
}
