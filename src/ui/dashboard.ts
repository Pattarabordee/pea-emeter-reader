import type { Reading } from '../profiles/templates';

// FusionSolar-style live view: a circular voltage gauge (colour by status) with active power + PF in the centre,
// then KPI tiles. Replaces the plain table on the Live screen; the profile screens keep renderReadings. Pure DOM.

// Voltage (shown in the gauge) and power factor (shown under it) are not tiles.
const TILES: { key: string; label: string; icon: string }[] = [
  { key: 'current', label: 'กระแส', icon: '🔀' },
  { key: 'apparentPower', label: 'กำลังปรากฏ', icon: '🟰' },
  { key: 'voltageL1', label: 'แรงดัน L1', icon: '🔌' },
  { key: 'voltageL2', label: 'แรงดัน L2', icon: '🔌' },
  { key: 'voltageL3', label: 'แรงดัน L3', icon: '🔌' },
  { key: 'currentL2', label: 'กระแส L2', icon: '🔀' },
  { key: 'currentL3', label: 'กระแส L3', icon: '🔀' },
];

const fmtNum = (v: number): string => { const a = Math.abs(v); return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2); };

/** value + unit for a tile; W/VA/var over 1000 shown in k-. Missing reads as em dash. */
function fmt(r?: Reading): { v: string; u: string } {
  if (!r || r.missing || r.value === null) return { v: '—', u: r?.unit ?? '' };
  let v = r.value, u = r.unit;
  if ((u === 'W' || u === 'VA' || u === 'var') && Math.abs(v) >= 1000) { v /= 1000; u = 'k' + u; }
  return { v: fmtNum(v), u };
}

const read = (r?: Reading): number | null => (!r || r.missing || r.value === null ? null : r.value);

/** Active power as text in kW (import, or export when drawing back); null when unreadable. */
function powerText(by: Map<string, Reading>): string | null {
  const imp = by.get('powerImport'), exp = by.get('powerExport');
  const r = read(imp) ? imp : read(exp) ? exp : imp ?? exp;
  const v = read(r);
  if (v === null) return null;
  const u = r!.unit || 'W';
  return `${fmtNum(u === 'W' ? v / 1000 : v)} ${u === 'W' ? 'kW' : u}`;
}

// PEA LV voltage bands (nominal 230 V): green normal, amber watch, red under/over (ties to the PQ event codes).
const V_MIN = 180, V_MAX = 260;
const GREEN = '#12b76a', AMBER = '#f79009', RED = '#d92d20', TRACK = '#e6e9ee';
function voltStatus(v: number): { c: string; t: string } {
  if (v < 200 || v > 250) return { c: RED, t: 'ผิดปกติ' };
  if (v < 210 || v > 245) return { c: AMBER, t: 'เฝ้าระวัง' };
  return { c: GREEN, t: 'ปกติ' };
}

const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

/** A 270° ring (gap at the bottom) filled from V_MIN..V_MAX and coloured by status; grey when voltage is unknown. */
function gauge(v: number | null): { wrap: HTMLElement; status?: { c: string; t: string } } {
  const size = 184, sw = 14, r = (size - sw) / 2, c = size / 2, circ = 2 * Math.PI * r, arc = 0.75 * circ;
  const status = v === null ? undefined : voltStatus(v);
  const frac = v === null ? 0 : Math.max(0, Math.min(1, (v - V_MIN) / (V_MAX - V_MIN)));
  const base = { cx: c, cy: c, r, fill: 'none', 'stroke-width': sw, 'stroke-linecap': 'round', transform: `rotate(135 ${c} ${c})` };
  const s = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, class: 'gauge' });
  s.append(svgEl('circle', { ...base, stroke: TRACK, 'stroke-dasharray': `${arc} ${circ - arc}` }));
  s.append(svgEl('circle', { ...base, stroke: status ? status.c : TRACK, 'stroke-dasharray': `${frac * arc} ${circ}` }));
  const wrap = document.createElement('div'); wrap.className = 'gauge-wrap'; wrap.append(s);
  return { wrap, status };
}

const div = (cls: string, text = ''): HTMLElement => { const d = document.createElement('div'); d.className = cls; if (text) d.textContent = text; return d; };

const tile = (icon: string, label: string, v: string, u: string): HTMLElement => {
  const d = div('kpi');
  d.append(div('ic', icon), div('lb', label));
  const val = div('val', v);
  if (u) { const us = document.createElement('span'); us.className = 'u'; us.textContent = ' ' + u; val.append(us); }
  d.append(val);
  return d;
};

/** Render the live readings as a dashboard into `el`. Only the registers present (type 1 vs 3) get a tile. */
export function renderDashboard(el: HTMLElement, readings: Reading[]): void {
  const by = new Map(readings.map((r) => [r.key, r]));
  const dash = div('dash');

  const hero = div('hero');
  hero.append(div('lb', 'แรงดัน'));
  const v = read(by.get('voltage'));
  const g = gauge(v);
  const center = div('gauge-center');
  const big = div('big', v === null ? '—' : fmtNum(v));
  const bu = document.createElement('span'); bu.className = 'u'; bu.textContent = ' V'; big.append(bu);
  center.append(big);
  if (g.status) { const st = div('st', g.status.t); st.style.color = g.status.c; center.append(st); }
  const pw = powerText(by); if (pw) center.append(div('sub', '⚡ ' + pw));
  const pf = read(by.get('powerFactor')); if (pf !== null) center.append(div('sub', 'cos φ ' + fmtNum(pf)));
  g.wrap.append(center);
  hero.append(g.wrap);

  const kpis = div('kpis');
  for (const t of TILES) {
    const r = by.get(t.key);
    if (!r) continue;
    const { v: tv, u } = fmt(r);
    kpis.append(tile(t.icon, t.label, tv, u));
  }
  dash.append(hero, kpis);
  el.replaceChildren(dash);
}
