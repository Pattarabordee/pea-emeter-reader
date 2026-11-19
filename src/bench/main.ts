// Test T1 of docs/design/2026-11-19-fast-driveby-design.md: parked, one meter, over a radio head (USB) or the
// phone's own Bluetooth (Web Bluetooth: Chrome/Edge, or Bluefy on iPhone).
// Measures each step of T0, the link speed B, and whether the meter accepts column selection and by-range access.
// The radio head also gives the advertising interval and lets the connection interval be chosen. Read-only (GET).
// Glue (Web Serial / Web Bluetooth + a real meter): field-verified, not unit-tested. The protocol logic is tested in radioHead.test.ts.
import { DlmsClient, type Transport } from '../dlms/client';
import type { SelectiveAccess } from '../dlms/get';
import { getCaptureObjects, getEntriesInUse } from '../dlms/profile';
import { RadioHead, advStats } from '../ble/radioHead';
import { BleTransport } from '../ble/transport';
import { SERVICE_UUIDS } from '../ble/uuids';
import { getPassword, listMeters } from '../store/db';
import { normMac } from '../store/places';
import { mountMap } from '../ui/map';

const BILLING = '1.0.98.1.0.255';
const LOAD = '1.0.99.1.0.255';
const STEP_TIMEOUT_MS = 20000;

type Row = { pass: number; cfg: string; step: string; ms: number; bytes: number; note: string };
type Add = (step: string, ms: number, bytes?: number, note?: string) => void;
type Link = { transport: Transport; rx(): number; reset(): void };
type SerialPort = { open(o: { baudRate: number }): Promise<void>; readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] =>
  Object.assign(document.createElement(tag), { textContent: text }, props);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const withTimeout = <T>(p: Promise<T>, what: string): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout: ${what}`)), STEP_TIMEOUT_MS))]);

const root = document.getElementById('app')!;
const status = h('p', 'ใส่รหัสผ่านมิเตอร์ แล้วเลือกวิธีทดสอบ', { id: 'status' });
const pw = h('input', '', { type: 'password', placeholder: 'รหัสผ่านมิเตอร์', autocomplete: 'off' });
const repeats = h('input', '', { type: 'number', value: '3', min: '1', max: '10' });
const chunks = h('input', '', { value: '20,180', size: 8, title: 'จำนวนไบต์ต่อการเขียนหนึ่งครั้ง' });
const bPhone = h('button', 'เลือกมิเตอร์แล้วรัน T1 จากโทรศัพท์');
const bConnect = h('button', '1. ต่อหัววิทยุ (USB)');
const ant = h('input', '', { type: 'checkbox' });
const bScan = h('button', '2. สแกน 10 วินาที', { disabled: true });
const scanBox = h('div');
const mac = h('input', '', { placeholder: 'MAC เช่น aa:bb:cc:dd:ee:ff', size: 20 });
const addrType = h('select');
addrType.append(h('option', 'public (0)', { value: '0' }), h('option', 'random (1)', { value: '1' }));
const itvls = h('input', '', { value: '6,12,24', size: 8, title: 'connection interval หน่วย 1.25 ms' });
const phy2m = h('input', '', { type: 'checkbox' });
const bRun = h('button', '3. รัน T1', { disabled: true });
const bSave = h('button', 'ดาวน์โหลดผล (JSON)', { disabled: true });
const summary = h('p');
const table = h('table');
const lab = (text: string, el: HTMLElement) => { const l = h('label', text + ' '); l.append(el); return l; };
// The map and the stored meter list are the main app's (same origin, same IndexedDB): tapping a meter fills the
// password, and the MAC for the radio head. Web Bluetooth still shows its own chooser; it cannot be given a MAC.
const mapSec = h('details');
const mapBody = h('div');
mapSec.append(h('summary', 'เลือกมิเตอร์จากแผนที่ (เติมรหัสผ่านให้เอง)'), mapBody);
let wantNames: string[] = []; // names of the meter picked on the map: the Bluetooth chooser is narrowed to them
const showMap = mountMap(mapBody, (p) => {
  const label = p.serial || p.mac;
  void (async () => {
    const m = (await listMeters()).find((x) => normMac(x.mac) === normMac(p.mac));
    mac.value = normMac(p.mac).toLowerCase().match(/../g)!.join(':');
    pw.value = (await getPassword(m?.mac ?? p.mac)) ?? ''; // falls back to the common password
    pw.hidden = !!pw.value; // filled from the stored list: nothing to type
    // The meter advertises its name; the list's name and the GIS serial are the two candidates for it.
    wantNames = [...new Set([m?.name, p.serial].filter((s): s is string => !!s))];
    status.textContent = pw.value
      ? `เลือก ${label} แล้ว เติมรหัสผ่านให้แล้ว กดปุ่มรัน แล้วเลือกชื่อ ${m?.name ?? label} ในหน้าต่าง Bluetooth`
      : `เลือก ${label} แล้ว ยังไม่มีรหัสผ่านในเครื่องนี้: วางรหัสผ่านในช่องด้านล่าง`;
    mapSec.open = false;
    status.scrollIntoView();
  })().catch((e) => { status.textContent = `เปิดรายชื่อมิเตอร์ไม่ได้: ${(e as Error).message}`; });
  return '';
});
mapSec.ontoggle = () => { if (mapSec.open) showMap(); };
// A phone has no Web Serial, so the radio-head section (the only one that needs a MAC) is not shown there.
const radioSec = h('div', '', { hidden: !('serial' in navigator) });
radioSec.append(
  h('h2', 'ข. ผ่านหัววิทยุ XIAO (USB)'), bConnect, lab('ใช้เสานอก (u.FL)', ant), h('br'), bScan, scanBox,
  mac, addrType, h('br'),
  lab('interval ที่ทดสอบ (×1.25 ms)', itvls), lab('ขอ 2M PHY', phy2m), h('br'), bRun,
);
root.append(
  status, mapSec, pw, lab('รอบต่อค่า', repeats),
  h('h2', 'ก. จากโทรศัพท์หรือคอมพิวเตอร์โดยตรง (ไม่ใช้หัววิทยุ)'),
  lab('ขนาดก้อนเขียนที่ทดสอบ (ไบต์)', chunks), bPhone,
  radioSec,
  h('h2', 'ผล'), bSave, summary, table,
);

let radio: RadioHead | undefined;
let scanResult: ReturnType<typeof advStats> = [];
let meter = '';
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
  table.replaceChildren(tr(['รอบ', 'ค่าที่ตั้ง', 'ขั้น', 'เวลา (ms)', 'ไบต์ที่รับ', 'หมายเหตุ'], 'th'));
  for (const r of rows) {
    const el = tr([String(r.pass), r.cfg, r.step, r.ms.toFixed(0), String(r.bytes), r.note]);
    if (r.note.startsWith('ผิดพลาด')) el.className = 'err';
    table.append(el);
  }
  const t0 = rows.filter((r) => r.step === 'T0 รวม').map((r) => r.ms).sort((a, b) => a - b);
  const b = rows.filter((r) => r.step.startsWith('load 100 แถว') && r.ms > 0 && !r.note.startsWith('ผิดพลาด')).map((r) => (r.bytes / r.ms) * 1000);
  summary.textContent = t0.length
    ? `T0 ค่ากลาง ${(t0[t0.length >> 1] / 1000).toFixed(2)} วินาที (เกณฑ์ ≤ 1.5) · B สูงสุด ${b.length ? (Math.max(...b) / 1000).toFixed(2) : '-'} KB/วินาที`
    : '';
}

/** The DLMS part of a pass (design section 5), the same over either link. preMs = link setup time already spent.
 *  Throws when the link or the session is no longer usable. */
async function dlmsSteps(link: Link, add: Add, password: Uint8Array, preMs: number): Promise<void> {
  const client = new DlmsClient(link.transport, { clientAddr: 32, serverAddr: 1, password });
  // A meter refusing one request (data-access-result) leaves the session usable: record it and go on. Anything else aborts the pass.
  const timed = async <T>(step: string, f: () => Promise<T>, note: (v: T, bytes: number, ms: number) => string = () => ''): Promise<T | undefined> => {
    link.reset();
    const t = performance.now();
    try {
      const v = await withTimeout(f(), step);
      const ms = performance.now() - t;
      add(step, ms, link.rx(), note(v, link.rx(), ms));
      return v;
    } catch (e) {
      add(step, performance.now() - t, link.rx(), `ผิดพลาด: ${(e as Error).message}`);
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
  add('T0 รวม', preMs + (performance.now() - tA));

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
  await client.release();
}

async function radioPass(r: RadioHead, add: Add, itvl: number, password: Uint8Array): Promise<void> {
  const c = await r.connect(mac.value.trim().toLowerCase(), Number(addrType.value), itvl, 15000);
  add('รอ advert + connect', c.connectedUs / 1000);
  add('แลก MTU + หา service', (c.discoveredUs - c.connectedUs) / 1000, 0, `MTU ${c.mtu}`);
  add('เปิด notify', (c.readyUs - c.discoveredUs) / 1000, 0, `interval ที่ได้ ${(c.itvl * 1.25).toFixed(2)} ms, write ${c.writeNoRsp ? 'ไม่รอตอบ' : 'รอตอบ'}`);
  if (phy2m.checked) await r.cmd('PHY 2', 'OK PHY');
  await dlmsSteps({ transport: r.transport, rx: () => r.rxBytes, reset: () => { r.rxBytes = 0; } }, add, password, c.readyUs / 1000);
  const i = await r.info();
  add('สถานะลิงก์ตอนจบ', 0, 0, `RSSI ${i.rssi} dBm, interval ${(i.itvl * 1.25).toFixed(2)} ms, MTU ${i.mtu}`);
}

/** Web Bluetooth cannot set the connection interval, MTU or PHY, nor report RSSI: the write chunk size is the one knob. */
async function phonePass(dev: BluetoothDevice, add: Add, chunkSize: number, password: Uint8Array): Promise<void> {
  const t0 = performance.now();
  const server = await withTimeout(dev.gatt!.connect(), 'connect');
  const t1 = performance.now();
  add('รอ advert + connect', t1 - t0);
  let chars: BluetoothRemoteGATTCharacteristic[] = [];
  for (const s of SERVICE_UUIDS) {
    try { chars = await (await server.getPrimaryService(s)).getCharacteristics(); break; } catch { /* not on this meter, try the next */ }
  }
  const wr = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
  const nt = chars.find((c) => c.properties.notify);
  if (!wr || !nt) throw new Error('write/notify characteristics not found');
  const t2 = performance.now();
  add('หา service', t2 - t1, 0, `write ${wr.properties.writeWithoutResponse ? 'ไม่รอตอบ' : 'รอตอบ'}`);
  await nt.startNotifications();
  const t3 = performance.now();
  add('เปิด notify', t3 - t2);
  // shortcut: if the browser hands back the same characteristic object on reconnect, earlier passes' listeners stay
  // attached (their clients ignore the frames); remove listeners here if a pass ever sees doubled data.
  const t = new BleTransport(server, wr, nt, chunkSize);
  let n = 0; // counts whole HDLC frames, not raw notifications
  const transport: Transport = { write: (b) => t.write(b), onData: (cb) => t.onData((b) => { n += b.length; cb(b); }) };
  await dlmsSteps({ transport, rx: () => n, reset: () => { n = 0; } }, add, password, t3 - t0);
}

async function runPasses(btn: HTMLButtonElement, list: number[], cfg: (n: number) => string, one: (add: Add, n: number) => Promise<void>, drop: () => unknown): Promise<void> {
  btn.disabled = true;
  let pass = rows.reduce((m, x) => Math.max(m, x.pass), 0);
  for (const n of list) {
    for (let k = 0; k < Number(repeats.value); k++) {
      const p = ++pass;
      const add: Add = (step, ms, bytes = 0, note = '') => { rows.push({ pass: p, cfg: cfg(n), step, ms, bytes, note }); render(); };
      status.textContent = `รอบ ${p}: ${cfg(n)}…`;
      try { await one(add, n); }
      catch (e) { add('ยกเลิกรอบ', 0, 0, `ผิดพลาด: ${(e as Error).message}`); pw.hidden = false; } // the stored password may be wrong: let it be retyped
      try { await drop(); } catch { /* already gone */ }
      await sleep(2000); // let the meter go back to advertising
    }
  }
  status.textContent = 'เสร็จ';
  btn.disabled = false;
  bSave.disabled = rows.length === 0;
}

bRun.onclick = () => {
  const r = radio;
  pw.value = pw.value.trim();
  if (!r || !mac.value.trim() || !pw.value) { status.textContent = 'ใส่ MAC และรหัสผ่านก่อน'; return; }
  const password = new TextEncoder().encode(pw.value);
  meter = mac.value.trim();
  void runPasses(bRun, itvls.value.split(',').map(Number).filter((n) => n >= 6), (n) => `interval ${(n * 1.25).toFixed(2)} ms`,
    (add, n) => radioPass(r, add, n, password), () => r.drop());
};

bPhone.onclick = async () => {
  pw.value = pw.value.trim(); // a pasted password often carries a trailing space or newline
  if (!pw.value) { pw.hidden = false; status.textContent = 'ใส่รหัสผ่านก่อน'; return; }
  if (!('bluetooth' in navigator)) { status.textContent = 'เบราว์เซอร์นี้ไม่มี Web Bluetooth: บน iPhone ให้เปิดหน้านี้ในแอป Bluefy'; return; }
  try {
    const names = wantNames;
    wantNames = []; // one try only: if the name does not match what the meter advertises, the next press lists every meter
    let dev: BluetoothDevice;
    try {
      dev = await navigator.bluetooth.requestDevice({
        filters: names.length ? names.map((name) => ({ name })) : SERVICE_UUIDS.map((s) => ({ services: [s] })),
        optionalServices: SERVICE_UUIDS,
      });
    } catch (e) {
      if (!names.length) throw e;
      status.textContent = `ไม่ได้เลือก ${names.join(' / ')}: ถ้ารายการว่าง กดปุ่มอีกครั้งเพื่อแสดงมิเตอร์ทั้งหมด`;
      return;
    }
    if (!dev.gatt) throw new Error('device has no GATT');
    const password = new TextEncoder().encode(pw.value);
    meter = dev.name ?? '';
    await runPasses(bPhone, chunks.value.split(',').map(Number).filter((n) => n >= 1), (n) => `ก้อนเขียน ${n} ไบต์`,
      (add, n) => phonePass(dev, add, n, password), () => dev.gatt!.disconnect());
  } catch (e) { status.textContent = `เลือกมิเตอร์ไม่สำเร็จ: ${(e as Error).message}`; }
};

bSave.onclick = () => {
  const blob = new Blob([JSON.stringify({ test: 'T1', at: new Date().toISOString(), meter, agent: navigator.userAgent, scan: scanResult, rows }, null, 2)], { type: 'application/json' });
  const a = h('a', '', { href: URL.createObjectURL(blob), download: `t1-${Date.now()}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
};
