import { loadRowsPerDay, readProfile, type ProfileData } from '../profiles/history';
import { EVENT_CODE, isEventCodeObis, OVER_V, UNDER_V } from '../profiles/events';
import { profileCsv, sapText } from '../export/profileFiles';
import { bangkokIso } from '../export/format';
import { download } from '../export/export';
import { deleteRead, listReads, saveRead, type SavedRead } from '../store/db';
import { drawProfileChart } from './chart';
import { shared } from './live';

const STALL_MS = 60_000; // no new rows for this long = the meter stopped answering
const EVENTS_PER_DAY = 60; // generous; the newest N entries are read, so a quiet meter just returns fewer
const MAX_EVENTS = 2000;

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
};
const btn = (text: string, onclick: () => void) => Object.assign(h('button', text), { onclick });
const time = (ms: number | null | undefined) => (ms == null ? '—' : bangkokIso(ms).slice(0, 16).replace('T', ' '));
const kindName = (p: ProfileData) => (p.kind === 'event' ? 'log เหตุการณ์' : 'Load profile');

/** Glue (Web Bluetooth link from the Live screen + IndexedDB): event log, voltage history, SAP file. GETs only.
 *  Every read is saved in this browser as soon as it ends (also a partial one), so nothing read in the field is lost. */
export function mountHistory(root: HTMLElement): void {
  const days = h('select');
  for (const d of [1, 3, 7, 15, 30]) days.append(Object.assign(h('option', `${d} วัน`), { value: String(d) }));
  days.value = '7';
  const evBtn = btn('log แรงดันตก', () => void run('event'));
  const loadBtn = btn('กราฟแรงดัน + ไฟล์ SAP', () => void run('load'));
  const status = h('p'); status.className = 'status';
  const view = h('div');
  const list = h('div');
  const pick = h('div'); pick.className = 'row';
  pick.append(h('span', 'ย้อนหลัง'), days, evBtn, loadBtn);
  root.append(h('h2', 'ย้อนหลัง'), h('p', 'เชื่อมต่อมิเตอร์ที่หน้า Live ก่อน แล้วเลือกจำนวนวัน'), pick, status, view,
    h('h3', 'ข้อมูลที่บันทึกไว้ในเครื่องนี้'), list);

  const show = (r: SavedRead) => {
    const p = r.profile;
    const base = `${p.kind}-${r.name}-${bangkokIso(r.at).slice(0, 16).replace(/[-:T]/g, '')}`;
    const actions = h('div'); actions.className = 'row';
    actions.append(btn('ดาวน์โหลด CSV', () => download(`${base}.csv`, profileCsv(p), 'text/csv;charset=utf-8')));
    if (p.kind === 'load') actions.append(btn('ดาวน์โหลดไฟล์ SAP', () => {
      const pea = /^\d{10}$/.test(r.name) ? r.name : prompt('เลข PEA ของมิเตอร์ (10 หลัก)', r.name)?.trim();
      if (!pea) return;
      const text = sapText(pea, p);
      if (!text) { alert('ข้อมูลนี้ไม่มีคอลัมน์ demand kW (1.0.1.27) จึงทำไฟล์ SAP ไม่ได้'); return; }
      download(`LP_${pea}_${bangkokIso(r.at).slice(0, 10).replace(/-/g, '')}.txt`, text, 'text/plain');
    }));
    const parts: HTMLElement[] = [h('h3', `${r.name} · ${kindName(p)} · อ่านเมื่อ ${time(r.at)} · ${p.rows.length} แถว`)];
    if (p.error) parts.push(h('p', `อ่านไม่ครบ (${p.error}) แต่เก็บ ${p.rows.length} แถวที่อ่านได้ไว้แล้ว`));
    parts.push(actions);
    view.replaceChildren(...parts, ...(p.kind === 'event' ? eventView(p) : loadView(p)));
  };

  const refreshList = async () => {
    const all = await listReads();
    list.replaceChildren(...(all.length ? all.map((r) => {
      const d = h('div'); d.className = 'row';
      d.append(h('span', `${time(r.at)} · ${r.name} · ${kindName(r.profile)} ${r.profile.rows.length} แถว${r.profile.error ? ' (ไม่ครบ)' : ''}`),
        btn('ดู', () => show(r)),
        btn('ลบ', () => { if (r.id != null && confirm('ลบข้อมูลนี้ออกจากเครื่อง?')) void deleteRead(r.id).then(refreshList); }));
      return d;
    }) : [h('p', 'ยังไม่มี')]));
  };

  const keep = async (p: ProfileData, mac: string, name: string) => {
    if (!p.rows.length) return;
    const rec: SavedRead = { at: Date.now(), mac, name, profile: structuredClone(p) }; // clone: a timed-out read may still be filling `p`
    rec.id = await saveRead(rec);
    show(rec);
    await refreshList();
  };

  const run = async (kind: 'event' | 'load') => {
    const c = shared.client, m = shared.meter;
    if (!c || !m) { status.textContent = 'เชื่อมต่อมิเตอร์ที่หน้า Live ก่อน'; return; }
    if (shared.busy) { status.textContent = 'กำลังอ่านอยู่ รอสักครู่แล้วกดใหม่'; return; }
    shared.busy = true; evBtn.disabled = loadBtn.disabled = true;
    const n = Number(days.value), t0 = Date.now(), unit = kind === 'event' ? 'เหตุการณ์' : 'แถว';
    let partial: ProfileData | undefined, last = Date.now(), stall: ReturnType<typeof setInterval> | undefined;
    try {
      status.textContent = 'กำลังเตรียมอ่าน…';
      const watchdog = new Promise<never>((_, rej) => {
        stall = setInterval(() => { if (Date.now() - last > STALL_MS) rej(new Error(`มิเตอร์ไม่ตอบเกิน ${STALL_MS / 1000} วินาที`)); }, 2000);
      });
      const work = (async () => {
        const max = kind === 'event' ? Math.min(MAX_EVENTS, n * EVENTS_PER_DAY) : n * (await loadRowsPerDay(c));
        last = Date.now();
        return readProfile(c, kind, m.type, max, '', (got, total, p) => {
          partial = p; last = Date.now();
          status.textContent = `อ่านแล้ว ${got}/${total} ${unit} (${Math.round((Date.now() - t0) / 1000)} วินาที)`;
        });
      })();
      const p = await Promise.race([work, watchdog]);
      await keep(p, m.mac, m.name);
      if (p.error) throw new Error(p.error);
      status.textContent = p.rows.length ? `เสร็จ ${p.rows.length} ${unit} ใน ${Math.round((Date.now() - t0) / 1000)} วินาที บันทึกแล้ว` : 'ไม่มีข้อมูลในช่วงนี้';
    } catch (e) {
      // The link may now be out of step (a late reply would match the next GET), so drop it, after keeping what was read.
      if (partial && !partial.error) await keep({ ...partial, error: (e as Error).message }, m.mac, m.name).catch(() => {});
      const msg = `อ่านไม่สำเร็จ (${(e as Error).message}) ตัดการเชื่อมต่อแล้ว กด Connect ที่หน้า Live ใหม่${partial?.rows.length ? ' — ส่วนที่อ่านได้บันทึกไว้แล้ว' : ''}`;
      try { await shared.end?.(msg); } finally { status.textContent = msg; }
    } finally {
      clearInterval(stall);
      shared.busy = false; evBtn.disabled = loadBtn.disabled = false;
    }
  };

  refreshList().catch((e) => { list.textContent = `เปิดข้อมูลที่บันทึกไว้ไม่ได้ (${(e as Error).message})`; });
}

/** Events newest first, with the PEA meaning of each code and the voltages captured with it. */
function eventView(p: ProfileData): HTMLElement[] {
  const ci = p.columns.findIndex((c) => isEventCodeObis(c.obis));
  const code = (r: (number | null)[]) => (ci < 0 ? null : r[ci + 1]);
  const under = p.rows.filter((r) => UNDER_V.has(code(r) ?? -1)).length;
  const over = p.rows.filter((r) => OVER_V.has(code(r) ?? -1)).length;
  const others = p.columns.flatMap((c, i) => (i === ci ? [] : [{ c, i }]));
  const table = h('table');
  const head = table.insertRow();
  for (const t of ['เวลา', 'เหตุการณ์', ...others.map(({ c }) => `${c.key}${c.unit ? ` (${c.unit})` : ''}`)]) head.append(h('th', t));
  for (const r of [...p.rows].reverse()) {
    const tr = table.insertRow();
    const k = code(r);
    if (UNDER_V.has(k ?? -1) || OVER_V.has(k ?? -1)) tr.className = 'warn';
    for (const t of [time(r[0]), k == null ? '—' : `${k} ${EVENT_CODE[k] ?? ''}`, ...others.map(({ i }) => (r[i + 1] == null ? '—' : String(r[i + 1])))]) tr.insertCell().textContent = t;
  }
  const wrap = h('div'); wrap.className = 'scroll'; wrap.append(table);
  return [h('p', `แรงดันตก ${under} ครั้ง · แรงดันเกิน ${over} ครั้ง (จาก ${p.rows.length} เหตุการณ์)`), wrap];
}

/** Voltage chart plus the lowest and highest value of each voltage column, with when it happened. */
function loadView(p: ProfileData): HTMLElement[] {
  const volts = p.columns.flatMap((c, i) => (c.unit === 'V' ? [{ c, i }] : []));
  if (!volts.length) return [h('p', 'ข้อมูลนี้ไม่มีคอลัมน์แรงดัน')];
  const lines = volts.map(({ c, i }) => {
    let lo: (number | null)[] | undefined, hi: (number | null)[] | undefined;
    for (const r of p.rows) {
      const v = r[i + 1];
      if (v == null) continue;
      if (!lo || v < (lo[i + 1] as number)) lo = r;
      if (!hi || v > (hi[i + 1] as number)) hi = r;
    }
    return lo && hi ? h('p', `${c.key}: ต่ำสุด ${lo[i + 1]} V (${time(lo[0])}) · สูงสุด ${hi[i + 1]} V (${time(hi[0])})`) : h('p', `${c.key}: ไม่มีค่า`);
  });
  const box = h('div'); box.className = 'chartbox';
  const canvas = h('canvas'); box.append(canvas);
  queueMicrotask(() => drawProfileChart(canvas, p, (c) => c.unit === 'V', 'V'));
  return [...lines, box];
}
