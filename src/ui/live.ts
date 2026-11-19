import { DlmsClient } from '../dlms/client';
import { connectMeter, type BleTransport } from '../ble/transport';
import { readLive } from '../profiles/live';
import type { Reading } from '../profiles/templates';
import { parseMeterList, type MeterEntry } from '../store/meterList';
import { COMMON, getPassword, listMeters, saveMeters, setPassword } from '../store/db';
import { normMac } from '../store/places';
import { readPicked } from './readFile';
import { renderDashboard } from './dashboard';

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
  pick?: (mac: string, label: string, phase?: string) => boolean; // select a meter by MAC (from the map), adding it when it isn't in the imported list
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
    void loadPw();
  };

  let meters: MeterEntry[] = [];
  // The Bluetooth chooser is narrowed to the selected meter by advertised name: the list's name, or the GIS serial
  // when it was picked on the map. A meter whose names matched nothing goes in noFilter and gets the full list next time.
  const serials = new Map<string, string>();
  const noFilter = new Set<string>();
  const current = () => meters.find((m) => m.mac === picker.value);
  const refreshList = async () => {
    meters = await listMeters();
    picker.replaceChildren(...meters.map((m) => Object.assign(h('option', `${m.name} (${m.mac}) — pick this in the Bluetooth chooser`), { value: m.mac })));
    await loadPw();
  };
  // A stored password needs no typing: the box is hidden until a connect fails (the stored one may be wrong).
  // An off-list meter has no key of its own: it gets the common password (the last one that worked).
  const loadPw = async () => {
    const m = offList.checked ? undefined : current();
    pw.value = (await getPassword(m?.mac ?? COMMON)) ?? '';
    pw.hidden = !!pw.value;
  };
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

  const why = (e: unknown) => ((e as Error).message === 'link lost'
    ? 'Bluetooth หลุดและต่อใหม่ไม่ได้: เข้าใกล้มิเตอร์แล้วกด Connect ใหม่' : `Error: ${(e as Error).message}`);
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
  shared.pick = (mac, label, phase = '') => {
    let m = meters.find((x) => normMac(x.mac) === normMac(mac));
    if (!m) { // not in the .txt list: usable for this visit, with the common password or one typed in
      m = { name: label, mac, password: '', type: phase.startsWith('3') ? 3 : 1, descriptor: 'จากแผนที่' };
      meters.push(m);
      picker.append(Object.assign(h('option', `${m.name} (${m.mac})`), { value: m.mac }));
    }
    offList.checked = false; typeRow.hidden = true; picker.hidden = false;
    picker.value = m.mac;
    serials.set(m.mac, label);
    void loadPw();
    status.textContent = `เลือก ${label} แล้ว กด Connect แล้วเลือกชื่อ ${m.name} ในหน้าต่าง Bluetooth`;
    return true;
  };
  stop.onclick = () => void end('Disconnected');

  connect.onclick = async () => {
    const listed = current();
    if (!offList.checked && !listed) { status.textContent = 'นำเข้าไฟล์รายชื่อแล้วเลือกมิเตอร์ก่อน หรือติ๊ก "มิเตอร์นอกรายชื่อ"'; return; }
    pw.value = pw.value.trim(); // a pasted password often carries a trailing space or newline
    if (!pw.value) { pw.hidden = false; status.textContent = 'ใส่รหัสผ่านมิเตอร์ก่อน'; return; }
    connect.disabled = true; stop.disabled = false;
    status.textContent = 'กำลังเชื่อมต่อ… เลือกมิเตอร์ในหน้าต่าง Bluetooth';
    try {
      const names = listed && !offList.checked && !noFilter.has(listed.mac)
        ? [...new Set([listed.name, serials.get(listed.mac)].filter((s): s is string => !!s))] : [];
      const { transport, name, reopen } = await connectMeter(undefined, names).catch((e) => { // first await after the click keeps the user gesture
        if (!names.length || (e as Error).name !== 'NotFoundError') throw e;
        noFilter.add(listed!.mac);
        throw new Error(`ไม่ได้เลือก ${names.join(' / ')}: ถ้ารายการว่าง กด Connect อีกครั้งเพื่อแสดงมิเตอร์ทั้งหมด`);
      });
      // Off-list meter has no MAC (Web Bluetooth hides it); label it by the advertised name and don't persist the password.
      const m: MeterEntry = listed && !offList.checked ? listed
        : { name: name || 'มิเตอร์นอกรายชื่อ', mac: '', password: pw.value, type: Number(typeSel.value) as 1 | 3, descriptor: 'นอกรายชื่อ (สแกน)' };
      // When the link drops mid-read the client reconnects through this (no chooser) and asks again; every screen
      // shares this client, so Billing/Load/PQ reads recover the same way. Not after Stop: end() clears `session`.
      const client: DlmsClient = new DlmsClient(transport, {
        clientAddr: 32, serverAddr: 1, password: new TextEncoder().encode(pw.value),
        reopen: async () => {
          if (session?.client !== client) throw new Error('stopped');
          status.textContent = 'Bluetooth หลุด กำลังต่อใหม่…';
          const t = await reopen();
          if (session?.client !== client) { t.disconnect(); throw new Error('stopped'); }
          session.transport = t;
          return t;
        },
      });
      session = { transport, client };
      await withTimeout(client.associate(), 'associate');
      shared.client = client; shared.meter = m;
      if (m.mac) await setPassword(m.mac, pw.value); // only a password that worked is persisted; off-list has no stable key
      await setPassword(COMMON, pw.value);
      pw.hidden = true; // it worked: nothing to retype (an earlier failed try may have shown the box)
      const tick = async () => {
        if (shared.busy || !session) return;
        shared.busy = true;
        try {
          renderDashboard(out, await withTimeout(readLive(client, m.type), 'read', READ_TIMEOUT_MS));
          status.textContent = `${m.name} · อัปเดต ${new Date().toLocaleTimeString()}`;
        } catch (e) {
          await end(why(e));
        } finally { shared.busy = false; }
      };
      await tick();
      if (session) timer = setInterval(() => void tick(), INTERVAL_MS);
    } catch (e) {
      if (!session && (e as Error).message === 'link lost') return; // our own Stop cut the link: keep its message
      pw.hidden = false;
      await end(why(e));
    }
  };

  refreshList().catch((e) => { status.textContent = `Import failed: ${(e as Error).message}`; });
}
