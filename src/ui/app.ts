import { clearFrames, exportFrames, frameCount, setCaptureEnabled } from '../debug/capture';
import { download } from '../export/export';
import { mountLive } from './live';
import { mountProfiles } from './profiles';

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
  root.append(nav, live, stored);
  // Without navigator.bluetooth the Connect UI is not mounted; the rest of the shell still loads.
  if (hasBt) mountLive(live);
  mountProfiles(stored);
  const show = (isLive: boolean) => { live.hidden = !isLive; stored.hidden = isLive; };
  // Billing/Load/PQ click the profile tab buttons mountProfiles renders (first div of the section), in that order.
  const profileBtns = () => stored.querySelectorAll<HTMLButtonElement>('div > button');
  ['Live', 'Billing', 'Load', 'PQ'].forEach((label, i) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => { show(i === 0); if (i) profileBtns()[i - 1]?.click(); });
    nav.append(b);
  });
  show(true);
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
