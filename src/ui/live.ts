import { DlmsClient } from '../dlms/client';
import { connectMeter, type BleTransport } from '../ble/transport';
import { readLive } from '../profiles/live';
import type { Reading } from '../profiles/templates';
import { parseMeterList, type MeterEntry } from '../store/meterList';
import { getPassword, listMeters, saveMeters, setPassword } from '../store/db';

const TIMEOUT_MS = 10_000;
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
const withTimeout = <T>(p: Promise<T>, what: string): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what}: no response in ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS))]);

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
};

/** Glue (Web Bluetooth + interval): field-verified, not unit-tested. */
export function mountLive(root: HTMLElement): void {
  const picker = h('select');
  const file = h('input'); file.type = 'file'; file.accept = '.txt';
  const pw = h('input'); pw.type = 'password'; pw.placeholder = 'password (from list; edit if needed)'; pw.autocomplete = 'off';
  const connect = h('button', 'Connect');
  const stop = h('button', 'Stop / Disconnect'); stop.disabled = true;
  const status = h('p'); status.className = 'status';
  const out = h('div');
  root.append(h('h2', 'Live'), file, picker, pw, connect, stop, status, out);

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
    await saveMeters(parseMeterList(await f.text()));
    await refreshList();
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  let session: { transport: BleTransport; client: DlmsClient } | undefined;
  let busy = false;

  const end = async (msg: string) => {
    clearInterval(timer);
    timer = undefined;
    const s = session;
    session = undefined;
    if (s) {
      try { await withTimeout(s.client.release(), 'release'); } catch { /* link may already be gone */ }
      s.transport.disconnect();
    }
    connect.disabled = false; stop.disabled = true;
    status.textContent = msg;
  };

  stop.onclick = () => void end('Disconnected');

  connect.onclick = async () => {
    const m = current();
    if (!m) { status.textContent = 'Import a meter list and pick a meter first'; return; }
    connect.disabled = true; stop.disabled = false;
    status.textContent = 'Connecting…';
    try {
      const transport = await connectMeter(); // first await after the click keeps the user gesture
      await setPassword(m.mac, pw.value);
      const client = new DlmsClient(transport, { clientAddr: 32, serverAddr: 1, password: new TextEncoder().encode(pw.value) });
      session = { transport, client };
      await withTimeout(client.associate(), 'associate');
      const tick = async () => {
        if (busy || !session) return;
        busy = true;
        try {
          renderReadings(out, await withTimeout(readLive(client, m.type), 'read'));
          status.textContent = `Updated ${new Date().toLocaleTimeString()}`;
        } catch (e) {
          await end(`Error: ${(e as Error).message}`);
        } finally { busy = false; }
      };
      await tick();
      if (session) timer = setInterval(() => void tick(), INTERVAL_MS);
    } catch (e) {
      await end(`Error: ${(e as Error).message}`);
    }
  };

  void refreshList();
}
