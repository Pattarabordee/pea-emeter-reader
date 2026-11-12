import type { Reading } from '../profiles/templates';

// FusionSolar-style live view: one hero figure (active power) + KPI tiles. Replaces the plain table on the Live
// screen; the profile screens keep renderReadings. Pure DOM, no network.

const TILES: { key: string; label: string; icon: string }[] = [
  { key: 'voltage', label: 'แรงดัน', icon: '🔌' },
  { key: 'current', label: 'กระแส', icon: '🔀' },
  { key: 'powerFactor', label: 'เพาเวอร์แฟกเตอร์', icon: '📐' },
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

/** Active power as the hero, always in kW (import, or export when drawing back). */
function heroPower(by: Map<string, Reading>): { v: string; u: string } {
  const imp = by.get('powerImport'), exp = by.get('powerExport');
  const r = imp && !imp.missing && imp.value ? imp : exp && !exp.missing && exp.value ? exp : imp ?? exp;
  if (!r || r.missing || r.value === null) return { v: '—', u: 'kW' };
  const u = r.unit || 'W';
  return { v: fmtNum(u === 'W' ? r.value / 1000 : r.value), u: u === 'W' ? 'kW' : u };
}

const tile = (icon: string, label: string, v: string, u: string): HTMLElement => {
  const d = document.createElement('div'); d.className = 'kpi';
  const i = document.createElement('div'); i.className = 'ic'; i.textContent = icon;
  const l = document.createElement('div'); l.className = 'lb'; l.textContent = label;
  const val = document.createElement('div'); val.className = 'val'; val.textContent = v;
  if (u) { const us = document.createElement('span'); us.className = 'u'; us.textContent = ' ' + u; val.append(us); }
  d.append(i, l, val);
  return d;
};

/** Render the live readings as a dashboard into `el`. Only the registers present (type 1 vs 3) get a tile. */
export function renderDashboard(el: HTMLElement, readings: Reading[]): void {
  const by = new Map(readings.map((r) => [r.key, r]));
  const dash = document.createElement('div'); dash.className = 'dash';

  const hero = document.createElement('div'); hero.className = 'hero';
  const hl = document.createElement('div'); hl.className = 'lb'; hl.textContent = 'กำลังไฟฟ้า';
  const hb = document.createElement('div'); hb.className = 'big';
  const hp = heroPower(by);
  hb.textContent = hp.v;
  const hu = document.createElement('span'); hu.className = 'u'; hu.textContent = ' ' + hp.u; hb.append(hu);
  hero.append(hl, hb);

  const kpis = document.createElement('div'); kpis.className = 'kpis';
  for (const t of TILES) {
    const r = by.get(t.key);
    if (!r) continue;
    const { v, u } = fmt(r);
    kpis.append(tile(t.icon, t.label, v, u));
  }
  dash.append(hero, kpis);
  el.replaceChildren(dash);
}
