import { clearFrames, exportFrames, frameCount, setCaptureEnabled } from '../debug/capture';
import { download } from '../export/export';
import { mountLive } from './live';
import { mountProfiles } from './profiles';

export function mountApp(root: HTMLElement): void {
  root.replaceChildren();
  const h1 = document.createElement('h1');
  h1.textContent = 'PEA E-Meter Reader';
  const live = document.createElement('section');
  root.append(h1, live);
  mountLive(live);
  const stored = document.createElement('section');
  root.append(stored);
  mountProfiles(stored);
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
