import { openDB } from 'idb';
import type { Reading } from '../profiles/templates';
import type { MeterEntry } from './meterList';

// DB "emeter": store `meters` (key mac; includes the imported password) and
// store `passwords` (key mac -> user override). getPassword prefers the override.
// v2 adds `loadProgress` (mac -> Progress) and `pending` (mac -> PendingRec).
const db = () =>
  openDB('emeter', 2, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore('meters', { keyPath: 'mac' });
        d.createObjectStore('passwords');
      }
      if (oldVersion < 2) {
        d.createObjectStore('loadProgress');
        d.createObjectStore('pending');
      }
    },
  });

export type Progress = { lastEntry: number; lastClock: number };
// Rows tagged with their entry index so overlapping appends replace by index.
type PendingRec = { entries: [number, Reading[]][] };

export async function getProgress(mac: string): Promise<Progress | undefined> {
  return (await db()).get('loadProgress', mac);
}

export async function setProgress(mac: string, p: Progress): Promise<void> {
  await (await db()).put('loadProgress', p, mac);
}

export async function clearProgress(mac: string): Promise<void> {
  await (await db()).delete('loadProgress', mac);
}

export async function appendPending(mac: string, rows: Reading[][], meta: { from: number; to: number }): Promise<void> {
  const tx = (await db()).transaction('pending', 'readwrite');
  const cur: PendingRec | undefined = await tx.store.get(mac);
  const byIdx = new Map(cur?.entries);
  rows.forEach((row, i) => byIdx.set(meta.from + i, row));
  await Promise.all([tx.store.put({ entries: [...byIdx] }, mac), tx.done]);
}

export async function getPending(mac: string): Promise<{ rows: Reading[][]; from: number; to: number } | undefined> {
  const cur: PendingRec | undefined = await (await db()).get('pending', mac);
  if (!cur?.entries.length) return undefined;
  const sorted = [...cur.entries].sort((a, b) => a[0] - b[0]);
  return { rows: sorted.map((e) => e[1]), from: sorted[0][0], to: sorted[sorted.length - 1][0] };
}

export async function clearPending(mac: string): Promise<void> {
  await (await db()).delete('pending', mac);
}

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
