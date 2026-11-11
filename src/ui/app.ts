import { clearFrames, exportFrames, frameCount, setCaptureEnabled } from '../debug/capture';
import { download } from '../export/export';
import { mountLive, shared } from './live';
import { mountProfiles } from './profiles';
import { mountHistory } from './history';
import { mountMap } from './map';

export function mountApp(root: HTMLElement): void {
  root.replaceChildren();
  const h1 = document.createElement('h1');
  h1.textContent = 'PEA E-Meter Reader';
  root.append(h1);
  const hasBt = 'bluetooth' in navigator;
  if (!hasBt) {
    const warn = document.createElement('p');
    warn.setAttribute('role', 'alert');
    warn.textContent = 'Web Bluetooth is not supported in this browser — use Chrome/Edge on Android or desktop.';
    root.append(warn);
  }
  const nav = document.createElement('nav');
  const live = document.createElement('section');
  const stored = document.createElement('section');
  const hist = document.createElement('section');
  const mapSec = document.createElement('section');
  root.append(nav, live, mapSec, hist, stored);
  // Without navigator.bluetooth the Connect UI is not mounted; the rest of the shell (map, saved reads) still loads.
  if (hasBt) mountLive(live);
  mountHistory(hist);
  mountProfiles(stored);
  const show = (s: HTMLElement) => { for (const x of [live, mapSec, hist, stored]) x.hidden = x !== s; };
  const showMap = mountMap(mapSec, (p) => {
    if (!shared.pick) return 'เบราว์เซอร์นี้ใช้ Bluetooth ไม่ได้ — ใช้ Chrome บน Android หรือ Windows';
    if (!shared.pick(p.mac, p.serial || p.mac)) return `${p.serial || p.mac} ไม่มีในไฟล์รายชื่อมิเตอร์ (.txt) จึงไม่มีรหัสผ่าน — โหลดไฟล์รายชื่อที่หน้า Live ก่อน`;
    show(live);
    return '';
  });
  // Billing/Load/PQ click the profile tab buttons mountProfiles renders (first div of the section), in that order.
  const profileBtns = () => stored.querySelectorAll<HTMLButtonElement>('div > button');
  const tabs: [string, HTMLElement, number?][] = [['Live', live], ['แผนที่', mapSec], ['ย้อนหลัง / SAP', hist], ['Billing', stored, 0], ['Load', stored, 1], ['PQ', stored, 2]];
  for (const [label, sec, profileTab] of tabs) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => {
      show(sec);
      if (sec === mapSec) showMap();
      if (profileTab != null) profileBtns()[profileTab]?.click();
    });
    nav.append(b);
  }
  show(live);
  const dbg = document.createElement('section');
  const label = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.addEventListener('change', () => setCaptureEnabled(cb.checked));
  label.append(cb, ' Capture raw frames (debug; AARQ includes password)');
  const dl = document.createElement('button');
  dl.textContent = 'Download frames (.jsonl)';
  dl.addEventListener('click', () => {
    if (frameCount()) download('frames.jsonl', exportFrames() + '\n','application/x-ndjson');
  });
  const clr = document.createElement('button');
  clr.textContent = 'Clear frames';
  clr.addEventListener('click', clearFrames);
  dbg.append(label, dl, clr);
  root.append(dbg);
}
