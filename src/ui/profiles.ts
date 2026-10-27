import { getCaptureObjects, getEntriesInUse, readRowsByEntry } from '../dlms/profile';
import { decodeRow } from '../profiles/decode';
import { billingTemplate, eventTemplate, loadTemplate, verifyCapture, type ColumnSpec, type Reading } from '../profiles/templates';
import { download, toCsv, toJson } from '../export/export';
import { drawLoadChart } from './chart';
import { READ_TIMEOUT_MS, renderReadings, shared, withTimeout } from './live';

const PAGE_SIZE = 10;

/** Pure. `from` is a 1-based entry; page is clamped to [0, lastPage]; total 0 -> count 0 (caller must not read). */
export function pageRange(total: number, pageSize: number, page: number): { from: number; count: number } {
  if (total <= 0) return { from: 1, count: 0 };
  const last = Math.ceil(total / pageSize) - 1;
  const p = Math.min(Math.max(page, 0), last);
  const from = p * pageSize + 1;
  return { from, count: Math.min(pageSize, total - from + 1) };
}

const TABS = [
  { id: 'billing', label: 'Billing', obis: '1.0.98.1.0.255', tpl: billingTemplate },
  { id: 'load', label: 'Load Profile', obis: '1.0.99.1.0.255', tpl: loadTemplate },
  { id: 'event', label: 'PQ Event', obis: '0.0.99.98.0.255', tpl: eventTemplate },
] as const;

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
};

/** Glue (DLMS/BLE/Chart.js): field-verified. Uses the link opened by the Live screen (`shared`). Read-only: GET only. */
export function mountProfiles(root: HTMLElement): void {
  const tabs = h('div');
  const nav = h('div');
  const status = h('p'); status.className = 'status';
  const out = h('div');
  const canvas = h('canvas'); canvas.hidden = true;
  const csv = h('button', 'Export CSV'), json = h('button', 'Export JSON');
  const first = h('button', '«'), prev = h('button', '‹'), next = h('button', '›'), last = h('button', '»');
  const pos = h('span');
  nav.append(first, prev, pos, next, last);
  const exp = h('div');
  exp.append(csv, json);
  root.append(h('h2', 'Stored data'), tabs, status, nav, out, canvas, exp);

  let tab: (typeof TABS)[number] | undefined;
  let cols: ColumnSpec[] = [];
  let total = 0, page = 0;
  let rows: Reading[][] = [];

  const load = async (t = tab, tot = total, cs = cols, pg = page) => {
    const c = shared.client;
    if (!c || !t) return;
    const { from, count } = pageRange(tot, PAGE_SIZE, pg);
    const p = Math.floor((from - 1) / PAGE_SIZE);
    const raw = count > 0 ? await withTimeout(readRowsByEntry(c, t.obis, from, count), 'read rows', READ_TIMEOUT_MS) : [];
    rows = raw.map((r) => decodeRow(r.t === 'structure' ? r.v : [], cs));
    out.replaceChildren(...rows.map((r, i) => {
      const d = h('div');
      const b = h('div');
      renderReadings(b, r);
      d.append(h('h4', `Entry ${from + i}`), b);
      return d;
    }));
    // commit state only after the reads and decode succeeded
    tab = t; total = tot; cols = cs; page = p;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    pos.textContent = ` ${tab.label}: page ${page + 1}/${pages} (${total} entries) `;
    first.disabled = prev.disabled = page <= 0;
    next.disabled = last.disabled = page >= pages - 1;
    canvas.hidden = tab.id !== 'load' || rows.length === 0;
    if (!canvas.hidden) drawLoadChart(canvas, rows);
    status.textContent = total === 0 ? 'Profile is empty' : `Loaded ${rows.length} rows`;
  };

  // One GET at a time on the shared link (Live polling pauses while shared.busy).
  const guarded = async (fn: () => Promise<void>) => {
    if (!shared.client || shared.busy) { if (!shared.client) status.textContent = 'Connect on the Live screen first'; return; }
    shared.busy = true;
    try { await fn(); } catch (e) { status.textContent = `Error: ${(e as Error).message}`; } finally { shared.busy = false; }
  };

  const open = (t: (typeof TABS)[number]) => guarded(async () => {
    const c = shared.client!, m = shared.meter!;
    status.textContent = 'Reading…';
    const tot = await withTimeout(getEntriesInUse(c, t.obis), 'entries', READ_TIMEOUT_MS);
    const v = verifyCapture(t.tpl(m.type), await withTimeout(getCaptureObjects(c, t.obis), 'capture objects', READ_TIMEOUT_MS));
    await load(t, tot, v.columns, 0);
    if (!v.ok) status.textContent += " — WARNING: capture layout differs from template; using the meter's live layout";
  });
  const go = (p: number) => guarded(async () => { if (tab) { page = p; await load(); } });

  tabs.append(...TABS.map((t) => Object.assign(h('button', t.label), { onclick: () => void open(t) })));
  first.onclick = () => void go(0);
  prev.onclick = () => void go(page - 1);
  next.onclick = () => void go(page + 1);
  last.onclick = () => void go(Math.ceil(total / PAGE_SIZE) - 1);

  const meta = () => ({ meter: shared.meter?.name ?? '', mac: shared.meter?.mac ?? '', profile: tab?.label ?? '', obis: tab?.obis ?? '', page: page + 1, exportedAt: new Date().toISOString() });
  const fname = (ext: string) => `${tab?.id ?? 'profile'}-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
  csv.onclick = () => { if (tab && rows.length) download(fname('csv'), toCsv(rows, meta()), 'text/csv;charset=utf-8'); };
  json.onclick = () => { if (tab && rows.length) download(fname('json'), toJson({ meta: meta(), rows }), 'application/json'); };
}
