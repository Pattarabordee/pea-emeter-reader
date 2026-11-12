import { clearFrames, exportFrames, frameCount, setCaptureEnabled } from '../debug/capture';
import { download } from '../export/export';
import { mountLive, shared } from './live';
import { mountProfiles } from './profiles';
import { mountHistory } from './history';
import { mountMap } from './map';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export function mountApp(root: HTMLElement): void {
  root.replaceChildren();
  const appbar = el('header', 'appbar');
  const sub = el('div', 'sub');
  appbar.append(el('h1', '', 'PEA E-Meter Reader'), sub);
  const main = el('main');
  const nav = el('nav', 'tabbar');
  root.append(appbar, main, nav);

  const hasBt = 'bluetooth' in navigator;
  if (!hasBt) {
    const warn = el('p', '', 'Web Bluetooth ใช้ไม่ได้ในเบราว์เซอร์นี้ — ใช้ Chrome/Edge บน Android หรือ Windows (iPhone ใช้แอป Bluefy)');
    warn.setAttribute('role', 'alert');
    main.append(warn);
  }
  const live = el('section');
  const mapSec = el('section');
  const hist = el('section');
  const stored = el('section');
  main.append(live, mapSec, hist, stored);
  // Without navigator.bluetooth the Connect UI is not mounted; the rest of the shell (map, saved reads) still loads.
  if (hasBt) mountLive(live);
  mountHistory(hist);
  mountProfiles(stored);
  const show = (s: HTMLElement) => { for (const x of [live, mapSec, hist, stored]) x.hidden = x !== s; };
  const showMap = mountMap(mapSec, (p) => {
    if (!shared.pick) return 'เบราว์เซอร์นี้ใช้ Bluetooth ไม่ได้ — ใช้ Chrome บน Android หรือ Windows';
    if (!shared.pick(p.mac, p.serial || p.mac)) return `${p.serial || p.mac} ไม่มีในไฟล์รายชื่อมิเตอร์ (.txt) จึงไม่มีรหัสผ่าน — โหลดไฟล์รายชื่อที่หน้า Live ก่อน`;
    selectTab(0);
    return '';
  });

  // debug controls tucked into a disclosure at the bottom of the Live screen
  const adv = el('details', 'adv');
  const cbLabel = el('label');
  const cb = el('input'); cb.type = 'checkbox';
  cb.addEventListener('change', () => setCaptureEnabled(cb.checked));
  cbLabel.append(cb, ' เก็บ raw frames (debug; AARQ มีรหัสผ่าน)');
  const dl = el('button', '', 'ดาวน์โหลด frames (.jsonl)');
  dl.addEventListener('click', () => { if (frameCount()) download('frames.jsonl', exportFrames() + '\n', 'application/x-ndjson'); });
  const clr = el('button', '', 'ล้าง frames');
  clr.addEventListener('click', clearFrames);
  adv.append(el('summary', '', 'ขั้นสูง (debug)'), cbLabel, dl, clr);
  live.append(adv);

  // Billing/Load/PQ click the profile tab buttons mountProfiles renders (first div of the section), in that order.
  const profileBtns = () => stored.querySelectorAll<HTMLButtonElement>('div > button');
  const tabs: { icon: string; label: string; title: string; sec: HTMLElement; profileTab?: number }[] = [
    { icon: '⚡', label: 'สด', title: 'อ่านค่าสด', sec: live },
    { icon: '🗺️', label: 'แผนที่', title: 'แผนที่มิเตอร์', sec: mapSec },
    { icon: '📊', label: 'ย้อนหลัง', title: 'ย้อนหลัง / ไฟล์ SAP', sec: hist },
    { icon: '🧾', label: 'บิล', title: 'Billing profile', sec: stored, profileTab: 0 },
    { icon: '📈', label: 'โหลด', title: 'Load profile', sec: stored, profileTab: 1 },
    { icon: '⚠️', label: 'PQ', title: 'Power Quality event', sec: stored, profileTab: 2 },
  ];
  const selectTab = (i: number): void => {
    const t = tabs[i];
    show(t.sec);
    buttons.forEach((b, j) => b.classList.toggle('active', tabs[j].sec === t.sec && tabs[j].profileTab === t.profileTab));
    sub.textContent = t.title;
    if (t.sec === mapSec) showMap();
    if (t.profileTab != null) profileBtns()[t.profileTab]?.click();
  };
  const buttons = tabs.map((t, i) => {
    const b = el('button');
    b.append(el('span', 'ic', t.icon), el('span', 'lb', t.label));
    b.addEventListener('click', () => selectTab(i));
    nav.append(b);
    return b;
  });
  selectTab(0);
}
