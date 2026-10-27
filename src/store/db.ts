import { openDB } from 'idb';
import type { MeterEntry } from './meterList';

// DB "emeter": store `meters` (key mac; includes the imported password) and
// store `passwords` (key mac -> user override). getPassword prefers the override.
const db = () =>
  openDB('emeter', 1, {
    upgrade(d) {
      d.createObjectStore('meters', { keyPath: 'mac' });
      d.createObjectStore('passwords');
    },
  });

export async function saveMeters(meters: MeterEntry[]): Promise<void> {
  const tx = (await db()).transaction('meters', 'readwrite');
  await Promise.all([...meters.map((m) => tx.store.put(m)), tx.done]);
}

export async function listMeters(): Promise<MeterEntry[]> {
  return (await db()).getAll('meters');
}

export async function setPassword(mac: string, pw: string): Promise<void> {
  await (await db()).put('passwords', pw, mac);
}

export async function getPassword(mac: string): Promise<string | undefined> {
  const d = await db();
  return (await d.get('passwords', mac)) ?? (await d.get('meters', mac))?.password;
}
