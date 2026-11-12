import { DlmsClient } from '../dlms/client';
import { connectMeter, type BleTransport } from '../ble/transport';
import { readLive } from '../profiles/live';
import type { Reading } from '../profiles/templates';
import { parseMeterList, type MeterEntry } from '../store/meterList';
import { getPassword, listMeters, saveMeters, setPassword } from '../store/db';
import { normMac } from '../store/places';
import { readPicked } from './readFile';

const TIMEOUT_MS = 10_000;
export const READ_TIMEOUT_MS = 30_000; // whole readLive batch (6-15 sequential GETs over 20-byte BLE chunks); field test tunes it
const INTERVAL_MS = 2_000;

/** Pure: value+unit, OBIS and raw per row. A missing reading shows "—", never 0. */
export function renderReadings(el: HTMLElement, readings: Reading[]): void {
  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>Name</th><th>Value</th><th>OBIS</th><th>Raw</th></tr></thead>';
  const body = document.createElement('tbody');
  for (const r of readings) {
    const tr = document.createElement('tr');
    if (r.missing) tr.className = 'missing';
    const val = r.missing || r.value === null ? '—' : `${r.value}${r.unit ? ' ' + r.unit : ''}`;
    const raw = r.missing || r.raw === null ? '—' : String(r.raw);
    for (const t of [r.key, val, r.obis, raw]) tr.appendChild(document.createElement('td')).textContent = t;
    body.appendChild(tr);
  }
  table.appendChild(body);
  el.replaceChildren(table);
}

// The DLMS codec is timer-free; the response timeout lives here.
export async function withTimeout<T>(p: Promise<T>, what: string, ms = TIMEOUT_MS): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`${what}: no response in ${ms / 1000}s`)), ms); })]);
  } finally { clearTimeout(t); }
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
};

/** The one connected link, shared with the stored-data screens. `busy` serialises GETs: the Live poll skips a tick while a profile read runs. */
export const shared: {
  client?: DlmsClient; meter?: MeterEntry; busy: boolean; end?: (msg: string) => Promise<void>;
  pick?: (mac: string, label: string) => boolean; // select a meter by MAC (from the map); false when it isn't in the imported list
} = { busy: false };

/** Glue (Web Bluetooth + interval): field-verified, not unit-tested. */
export function mountLive(root: HTMLElement): void {
  const picker = h('select');
  const file = h('input'); file.type = 'file'; file.accept = '.txt';
  const pw = h('input'); pw.type = 'password'; pw.placeholder = 'รหัสผ่านมิเตอร์'; pw.autocomplete = 'off';
  const connect = h('button', 'Connect');
  const stop = h('button', 'Stop / Disconnect'); stop.disabled = true;
  const status = h('p'); status.className = 'status';
  const out = h('div');
  // Off-list mode: connect to a meter not in the .txt list by scanning. Web Bluetooth has no MAC, so the user
  // picks the device in the chooser (by advertised name) and supplies the password + phase here.
  const offList = h('input'); offList.type = 'checkbox';
  const offLabel = h('label'); offLabel.append(offList, ' มิเตอร์นอกรายชื่อ (สแกนเอง)');
  const typeSel = h('select');
  typeSel.append(Object.assign(h('option', '1 เฟส'), { value: '1' }), Object.assign(h('option', '3 เฟส'), { value: '3' }));
  const typeRow = h('div'); typeRow.className = 'row'; typeRow.hidden = true;
  typeRow.append(h('span', 'ชนิดมิเตอร์'), typeSel);
  root.append(h('h2', 'Live'), file, picker, offLabel, typeRow, pw, connect, stop, status, out);
  offList.onchange = () => {
    typeRow.hidden = !offList.checked;
    picker.hidden = offList.checked;
    if (offList.checked) pw.value = '';
    else void loadPw();
  };

  let meters: MeterEntry[] = [];
  const current = () => meters.find((m) => m.mac === picker.value);
  const refreshList = async () => {
    meters = await listMeters();
    picker.replaceChildren(...meters.map((m) => Object.assign(h('option', `${m.name} (${m.mac}) — pick this in the Bluetooth chooser`), { value: m.mac })));
    await loadPw();
  };
  const loadPw = async () => { const m = current(); pw.value = m ? ((await getPassword(m.mac)) ?? '') : ''; };
  picker.onchange = () => void loadPw();
  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      const text = await readPicked(f);
      const list = parseMeterList(text);
      if (!list.length) {
        status.textContent = /(^|,)\s*lat\s*,/im.test(text.split(/\r?\n/, 1)[0])
          ? 'นี่คือไฟล์พิกัด (.csv) ให้โหลดที่แท็บ "แผนที่" ช่องนี้ใช้ไฟล์รายชื่อมิเตอร์ (.txt) ที่มีรหัสผ่าน'
          : 'ไม่พบมิเตอร์ในไฟล์นี้ ต้องเป็นไฟล์รายชื่อมิเตอร์ (.txt): ชื่อ,MAC,รหัสผ่าน,ชนิด 1/3,คำอธิบาย';
        return;
      }
      await saveMeters(list);
      await refreshList();
      status.textContent = `โหลดรายชื่อ ${list.length} มิเตอร์แล้ว`;
    } catch (e) { status.textContent = `Import failed: ${(e as Error).message}`; }
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  let session: { transport: BleTransport; client: DlmsClient } | undefined;

  const end = async (msg: string) => {
    clearInterval(timer);
    timer = undefined;
    const s = session;
    session = undefined;
    shared.client = undefined; shared.meter = undefined;
    if (s) {
      try { await withTimeout(s.client.release(), 'release'); } catch { /* link may already be gone */ }
      s.transport.disconnect();
    }
    connect.disabled = false; stop.disabled = true;
    status.textContent = msg;
  };

  shared.end = end; // lets other screens drop a possibly desynced session
  shared.pick = (mac, label) => {
    const m = meters.find((x) => normMac(x.mac) === normMac(mac));
    if (!m) return false;
    picker.value = m.mac;
    void loadPw();
    status.textContent = `เลือก ${label} แล้ว กด Connect แล้วเลือกชื่อ ${m.name} ในหน้าต่าง Bluetooth`;
    return true;
  };
  stop.onclick = () => void end('Disconnected');

  connect.onclick = async () => {
    const listed = current();
    if (!offList.checked && !listed) { status.textContent = 'นำเข้าไฟล์รายชื่อแล้วเลือกมิเตอร์ก่อน หรือติ๊ก "มิเตอร์นอกรายชื่อ"'; return; }
    if (offList.checked && !pw.value) { status.textContent = 'ใส่รหัสผ่านมิเตอร์ก่อน'; return; }
    connect.disabled = true; stop.disabled = false;
    status.textContent = 'กำลังเชื่อมต่อ… เลือกมิเตอร์ในหน้าต่าง Bluetooth';
    try {
      const { transport, name } = await connectMeter(); // first await after the click keeps the user gesture
      // Off-list meter has no MAC (Web Bluetooth hides it); label it by the advertised name and don't persist the password.
      const m: MeterEntry = listed && !offList.checked ? listed
        : { name: name || 'มิเตอร์นอกรายชื่อ', mac: '', password: pw.value, type: Number(typeSel.value) as 1 | 3, descriptor: 'นอกรายชื่อ (สแกน)' };
      const client = new DlmsClient(transport, { clientAddr: 32, serverAddr: 1, password: new TextEncoder().encode(pw.value) });
      session = { transport, client };
      await withTimeout(client.associate(), 'associate');
      shared.client = client; shared.meter = m;
      if (m.mac) await setPassword(m.mac, pw.value); // only a password that worked is persisted; off-list has no stable key
      const tick = async () => {
        if (shared.busy || !session) return;
        shared.busy = true;
        try {
          renderReadings(out, await withTimeout(readLive(client, m.type), 'read', READ_TIMEOUT_MS));
          status.textContent = `${m.name} · อัปเดต ${new Date().toLocaleTimeString()}`;
        } catch (e) {
          await end(`Error: ${(e as Error).message}`);
        } finally { shared.busy = false; }
      };
      await tick();
      if (session) timer = setInterval(() => void tick(), INTERVAL_MS);
    } catch (e) {
      await end(`Error: ${(e as Error).message}`);
    }
  };

  refreshList().catch((e) => { status.textContent = `Import failed: ${(e as Error).message}`; });
}
