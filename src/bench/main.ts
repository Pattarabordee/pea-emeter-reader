// Test T1 of docs/design/2026-11-19-fast-driveby-design.md: parked, one radio head, one meter.
// Measures the advertising interval, each step of T0, the link speed B per connection interval, and whether the
// meter accepts column selection and by-range access. Read-only (GET). Dev page only: open /bench.html under `npm run dev`.
// Glue (Web Serial + a real meter): field-verified, not unit-tested. The protocol logic is tested in radioHead.test.ts.
import { DlmsClient } from '../dlms/client';
import type { SelectiveAccess } from '../dlms/get';
import { getCaptureObjects, getEntriesInUse } from '../dlms/profile';
import { RadioHead, advStats } from '../ble/radioHead';

const BILLING = '1.0.98.1.0.255';
const LOAD = '1.0.99.1.0.255';
const STEP_TIMEOUT_MS = 20000;

type Row = { pass: number; itvlMs: number; step: string; ms: number; bytes: number; note: string };
type SerialPort = { open(o: { baudRate: number }): Promise<void>; readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] =>
  Object.assign(document.createElement(tag), { textContent: text }, props);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const withTimeout = <T>(p: Promise<T>, what: string): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout: ${what}`)), STEP_TIMEOUT_MS))]);

const root = document.getElementById('app')!;
const status = h('p', 'ยังไม่ได้ต่อหัววิทยุ', { id: 'status' });
const bConnect = h('button', '1. ต่อหัววิทยุ (USB)');
const ant = h('input', '', { type: 'checkbox' });
const bScan = h('button', '2. สแกน 10 วินาที', { disabled: true });
const scanBox = h('div');
const mac = h('input', '', { placeholder: 'MAC เช่น aa:bb:cc:dd:ee:ff', size: 20 });
const addrType = h('select');
addrType.append(h('option', 'public (0)', { value: '0' }), h('option', 'random (1)', { value: '1' }));
const pw = h('input', '', { type: 'password', placeholder: 'รหัสผ่านมิเตอร์', autocomplete: 'off' });
const itvls = h('input', '', { value: '6,12,24', size: 8, title: 'connection interval หน่วย 1.25 ms' });
const repeats = h('input', '', { type: 'number', value: '3', min: '1', max: '10' });
const phy2m = h('input', '', { type: 'checkbox' });
const bRun = h('button', '3. รัน T1', { disabled: true });
const bSave = h('button', 'ดาวน์โหลดผล (JSON)', { disabled: true });
const summary = h('p');
const table = h('table');
const lab = (text: string, el: HTMLElement) => { const l = h('label', text + ' '); l.append(el); return l; };
root.append(
  status, bConnect, lab('ใช้เสานอก (u.FL)', ant),
  h('h2', 'มิเตอร์ที่ได้ยิน'), bScan, scanBox,
  h('h2', 'ตั้งค่าการทดสอบ'), mac, addrType, pw, h('br'),
  lab('interval ที่ทดสอบ (×1.25 ms)', itvls), lab('รอบต่อค่า', repeats), lab('ขอ 2M PHY', phy2m), h('br'), bRun, bSave,
  h('h2', 'ผล'), summary, table,
);

let radio: RadioHead | undefined;
let scanResult: ReturnType<typeof advStats> = [];
const rows: Row[] = [];

bConnect.onclick = async () => {
  try {
    const port = await (navigator as unknown as { serial: { requestPort(): Promise<SerialPort> } }).serial.requestPort();
    await port.open({ baudRate: 115200 });
    const w = port.writable.getWriter();
    const enc = new TextEncoder();
    const r = new RadioHead((line) => w.write(enc.encode(line + '\n')));
    void (async () => {
      const rd = port.readable.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        r.feed(value);
      }
    })();
    const ver = await r.cmd('VER', 'OK VER');
    if (ant.checked) await r.cmd('ANT 1', 'OK ANT');
    radio = r;
    status.textContent = `ต่อหัววิทยุแล้ว: ${ver.slice(1).join(' ')}`;
    bScan.disabled = bRun.disabled = false;
  } catch (e) { status.textContent = `ต่อหัววิทยุไม่ได้: ${(e as Error).message}`; }
};

bScan.onclick = async () => {
  if (!radio) return;
  bScan.disabled = true;
  status.textContent = 'กำลังสแกน…';
  try {
    scanResult = advStats(await radio.scan(10000));
    const t = h('table');
    t.append(tr(['ชื่อ', 'MAC', 'ชนิดที่อยู่', 'จำนวน advert', 'RSSI เฉลี่ย', 'ช่วง advert (ms, ค่ากลาง)'], 'th'));
    for (const s of scanResult) {
      const r = tr([s.name, s.mac, String(s.type), String(s.count), String(s.rssi), s.gapMs === null ? '-' : s.gapMs.toFixed(0)]);
      r.className = 'pick';
      r.onclick = () => { mac.value = s.mac; addrType.value = String(s.type); };
      t.append(r);
    }
    scanBox.replaceChildren(t);
    status.textContent = `ได้ยิน ${scanResult.length} เครื่อง (คลิกแถวเพื่อเลือก) ชื่ออาจว่างเพราะสแกนแบบไม่ถาม`;
  } catch (e) { status.textContent = `สแกนไม่สำเร็จ: ${(e as Error).message}`; }
  bScan.disabled = false;
};

function tr(cells: string[], tag: 'td' | 'th' = 'td'): HTMLTableRowElement {
  const r = h('tr');
  r.append(...cells.map((c) => h(tag, c)));
  return r;
}

function render(): void {
  table.replaceChildren(tr(['รอบ', 'interval (ms)', 'ขั้น', 'เวลา (ms)', 'ไบต์ที่รับ', 'หมายเหตุ'], 'th'));
  for (const r of rows) {
    const el = tr([String(r.pass), r.itvlMs.toFixed(2), r.step, r.ms.toFixed(0), String(r.bytes), r.note]);
    if (r.note.startsWith('ผิดพลาด')) el.className = 'err';
    table.append(el);
  }
  const t0 = rows.filter((r) => r.step === 'T0 รวม').map((r) => r.ms).sort((a, b) => a - b);
  const b = rows.filter((r) => r.step.startsWith('load 100 แถว') && r.ms > 0 && !r.note.startsWith('ผิดพลาด')).map((r) => (r.bytes / r.ms) * 1000);
  summary.textContent = t0.length
    ? `T0 ค่ากลาง ${(t0[t0.length >> 1] / 1000).toFixed(2)} วินาที (เกณฑ์ ≤ 1.5) · B สูงสุด ${b.length ? (Math.max(...b) / 1000).toFixed(2) : '-'} KB/วินาที`
    : '';
}

/** One connection: every step of design section 5, timed. Throws when the link or the session is no longer usable. */
async function onePass(r: RadioHead, pass: number, itvl: number, password: Uint8Array): Promise<void> {
  const add = (step: string, ms: number, bytes = 0, note = '') => { rows.push({ pass, itvlMs: itvl * 1.25, step, ms, bytes, note }); render(); };
  const c = await r.connect(mac.value.trim().toLowerCase(), Number(addrType.value), itvl, 15000);
  add('รอ advert + connect', c.connectedUs / 1000);
  add('แลก MTU + หา service', (c.discoveredUs - c.connectedUs) / 1000, 0, `MTU ${c.mtu}`);
  add('เปิด notify', (c.readyUs - c.discoveredUs) / 1000, 0, `interval ที่ได้ ${(c.itvl * 1.25).toFixed(2)} ms, write ${c.writeNoRsp ? 'ไม่รอตอบ' : 'รอตอบ'}`);
  if (phy2m.checked) await r.cmd('PHY 2', 'OK PHY');

  const client = new DlmsClient(r.transport, { clientAddr: 32, serverAddr: 1, password });
  // A meter refusing one request (data-access-result) leaves the session usable: record it and go on. Anything else aborts the pass.
  const timed = async <T>(step: string, f: () => Promise<T>, note: (v: T, bytes: number, ms: number) => string = () => ''): Promise<T | undefined> => {
    r.rxBytes = 0;
    const t = performance.now();
    try {
      const v = await withTimeout(f(), step);
      const ms = performance.now() - t;
      add(step, ms, r.rxBytes, note(v, r.rxBytes, ms));
      return v;
    } catch (e) {
      add(step, performance.now() - t, r.rxBytes, `ผิดพลาด: ${(e as Error).message}`);
      if (!/data-access-result/.test((e as Error).message)) throw e;
      return undefined;
    }
  };
  const rowsNote = (v: unknown, bytes: number, ms: number) => {
    const n = (v as { t: string; v: unknown[] }).t === 'array' ? (v as { v: unknown[] }).v.length : 0;
    return `${n} แถว, ${n ? (bytes / n).toFixed(1) : '-'} ไบต์/แถว, B = ${((bytes / ms) * 1000).toFixed(0)} ไบต์/วินาที`;
  };
  const buffer = (obis: string, access: SelectiveAccess) => () => client.get(7, obis, 2, access);

  const tA = performance.now();
  await timed('SNRM + AARQ', () => client.associate());
  add('T0 รวม', c.readyUs / 1000 + (performance.now() - tA));

  const eb = await timed('billing: จำนวนแถว', () => getEntriesInUse(client, BILLING));
  if (eb) await timed('billing: แถวล่าสุด (หน่วยรายเดือน)', buffer(BILLING, { kind: 'by-entry', fromEntry: eb, toEntry: eb, fromSelectedValue: 0, toSelectedValue: 0 }));
  const cols = await timed('load: โครงสร้างคอลัมน์', () => getCaptureObjects(client, LOAD), (v) => v.map((o) => o.obis).join(' '));
  const el = await timed('load: จำนวนแถว', () => getEntriesInUse(client, LOAD));
  if (el && cols) {
    const from = Math.max(1, el - 99);
    await timed('load 100 แถว ทุกคอลัมน์', buffer(LOAD, { kind: 'by-entry', fromEntry: from, toEntry: el, fromSelectedValue: 0, toSelectedValue: 0 }), rowsNote);
    // columns 1 and 2 are clock and status in the PEA load profile; the rest are the measurements
    await timed('load 100 แถว เฉพาะคอลัมน์ 3 ถึงสุดท้าย', buffer(LOAD, { kind: 'by-entry', fromEntry: from, toEntry: el, fromSelectedValue: 3, toSelectedValue: 0 }), rowsNote);
    const to = new Date(), day = new Date(to.getTime() - 86400000);
    await timed('load by-range 24 ชม. ทุกคอลัมน์', buffer(LOAD, { kind: 'by-range', from: day, to }), rowsNote);
    await timed('load by-range 24 ชม. เฉพาะคอลัมน์วัด', buffer(LOAD, { kind: 'by-range', from: day, to, columns: cols.slice(2) }), rowsNote);
  }
  const i = await r.info();
  add('สถานะลิงก์ตอนจบ', 0, 0, `RSSI ${i.rssi} dBm, interval ${(i.itvl * 1.25).toFixed(2)} ms, MTU ${i.mtu}`);
  await client.release();
}

bRun.onclick = async () => {
  const r = radio;
  if (!r || !mac.value.trim() || !pw.value) { status.textContent = 'ใส่ MAC และรหัสผ่านก่อน'; return; }
  bRun.disabled = true;
  const password = new TextEncoder().encode(pw.value);
  const list = itvls.value.split(',').map(Number).filter((n) => n >= 6);
  let pass = rows.reduce((m, x) => Math.max(m, x.pass), 0);
  for (const itvl of list) {
    for (let k = 0; k < Number(repeats.value); k++) {
      pass++;
      status.textContent = `รอบ ${pass}: interval ${(itvl * 1.25).toFixed(2)} ms…`;
      try { await onePass(r, pass, itvl, password); }
      catch (e) { rows.push({ pass, itvlMs: itvl * 1.25, step: 'ยกเลิกรอบ', ms: 0, bytes: 0, note: `ผิดพลาด: ${(e as Error).message}` }); render(); }
      await r.drop().catch(() => {});
      await sleep(2000); // let the meter go back to advertising
    }
  }
  status.textContent = 'เสร็จ';
  bRun.disabled = false;
  bSave.disabled = rows.length === 0;
};

bSave.onclick = () => {
  const blob = new Blob([JSON.stringify({ test: 'T1', at: new Date().toISOString(), mac: mac.value.trim(), scan: scanResult, rows }, null, 2)], { type: 'application/json' });
  const a = h('a', '', { href: URL.createObjectURL(blob), download: `t1-${Date.now()}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
};
