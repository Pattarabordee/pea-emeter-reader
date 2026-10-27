import { describe, it, expect } from 'vitest';
import { DlmsClient, type Transport } from '../dlms/client';
import { encodeHdlc, decodeHdlc } from '../dlms/hdlc';
import { getEntriesInUse, readRowsByEntry } from '../dlms/profile';
import { readLive } from '../profiles/live';
import { billingTemplate } from '../profiles/templates';
import { decodeRow } from '../profiles/decode';
import { toCsv } from '../export/export';

const hexb = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
const AARE_OK = hexb('6129a109060760857405080101a203020100a305a103020100be10040e0800065f1f0400007e1f04000007');
const PASSWORD = Uint8Array.from([0x31, 0x32, 0x33, 0x34]); // throwaway placeholder

const getOk = (data: number[]) => [0xc4, 1, 0xc1, 0, ...data];
const GET_ERR = [0xc4, 1, 0xc1, 1, 3]; // data-access-result: object-undefined
const u32 = (n: number) => [0x06, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [0x12, n >> 8, n & 255];
const DT = [0x09, 0x0c, 0x07, 0xea, 0x0a, 0x1b, 0xff, 0x0c, 0, 0, 0, 0x80, 0, 0]; // 2026-10-27 12:00:00, deviation not specified
// Billing row (type 1 template): clock, 4 kWh u32, 2 demand u32, voltageMin u16, 2 alarms u32
const ROW = [0x02, 10, ...DT, ...u32(123456), ...u32(7), ...u32(123449), ...u32(123449), ...u32(4200), ...u32(0), ...u16(21850), ...u32(0), ...u32(0)];

/** Responsive fake meter: answers SNRM/AARQ/GET by decoding what the real client wrote. Only voltage is implemented; other registers answer an access error. */
function fakeMeter() {
  const apdus: number[][] = [];
  let cb: (b: Uint8Array) => void = () => {};
  let ns = 0;
  const reply = (control: number, info?: number[]) =>
    cb(encodeHdlc({ dest: 0x41, src: 0x03, control, info: info && Uint8Array.from(info), segmented: false }));
  const t: Transport = {
    onData: (f) => { cb = f; },
    write: async (b) => {
      const f = decodeHdlc(b);
      if (f.control === 0x93) return reply(0x73);
      if (f.control & 1 || !f.info) return; // S-frames need no reply
      const apdu = Array.from(f.info.subarray(3));
      apdus.push(apdu);
      const send = (a: number[]) => reply((ns++ << 1) | 0x10, [0xe6, 0xe7, 0x00, ...a]);
      if (apdu[0] === 0x60) return send(Array.from(AARE_OK));
      const cls = (apdu[3] << 8) | apdu[4], obis = apdu.slice(5, 11).join("."), attr = apdu[11];
      if (cls === 3 && obis === '1.0.12.7.0.255') return send(getOk(attr === 3 ? [0x02, 2, 0x0f, 0xff, 0x16, 35] : u32(2301))); // scaler -1, V
      if (cls === 7 && obis === '1.0.98.1.0.255') return send(getOk(attr === 7 ? u32(1) : [0x01, 1, ...ROW]));
      return send(GET_ERR);
    },
  };
  return { t, apdus };
}

describe('end-to-end: fake meter -> associate -> live -> profile row -> CSV', () => {
  it('drives the real stack', async () => {
    const { t, apdus } = fakeMeter();
    const c = new DlmsClient(t, { clientAddr: 32, serverAddr: 1, password: PASSWORD });
    await c.associate();

    const live = await readLive(c, 1);
    const v = live.find((r) => r.key === 'voltage')!;
    expect(v).toMatchObject({ raw: 2301, scaler: -1, unit: 'V', value: 230.1, missing: false });
    expect(live.find((r) => r.key === 'current')).toMatchObject({ value: null, missing: true }); // unanswered => missing, never 0

    const obis = '1.0.98.1.0.255';
    expect(await getEntriesInUse(c, obis)).toBe(1);
    const rows = await readRowsByEntry(c, obis, 1, 1);
    expect(rows).toHaveLength(1);
    const dec = decodeRow(rows[0].t === 'structure' ? rows[0].v : [], billingTemplate(1));
    expect(dec.find((r) => r.key === 'clock')!.value).toBe(Date.UTC(2026, 9, 27, 12, 0, 0));
    expect(dec.find((r) => r.key === 'kwhImport')).toMatchObject({ raw: 123456, unit: 'kWh', missing: false });
    expect(dec.find((r) => r.key === 'voltageL1Min')).toMatchObject({ raw: 21850, value: 218.5, unit: 'V' });

    const csv = toCsv([live, dec], { meter: 'test' });
    expect(csv.length).toBeGreaterThan(0);
    expect(csv).toContain('voltage,1.0.12.7.0.255,2301,-1,V,230.1,false');
    expect(csv).toContain('kwhImport,1.0.1.8.0.255,123456,0,kWh,123456,false');

    // read-only: only AARQ (0x60) and GET-request (0xc0) were ever sent
    expect(apdus.every((a) => a[0] === 0x60 || a[0] === 0xc0)).toBe(true);
  });
});
