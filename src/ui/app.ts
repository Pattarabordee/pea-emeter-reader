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
}
