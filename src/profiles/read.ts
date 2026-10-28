import type { DlmsClient } from '../dlms/client';
import { readRowsByEntry } from '../dlms/profile';
import { decodeRow } from './decode';
import type { ColumnSpec, Reading } from './templates';

const CHUNK = 100;

/** Reads entries fromEntry..toEntry (1-based, inclusive). Falls back once to a plain attr-2 GET + client-side slice if the meter rejects by-entry access. */
export async function readRange(
  client: DlmsClient, obis: string, cols: ColumnSpec[], fromEntry: number, toEntry: number,
  opts?: { onFallback?: () => void },
): Promise<Reading[][]> {
  if (toEntry < fromEntry) return [];
  const out: Reading[][] = [];
  try {
    for (let from = fromEntry; from <= toEntry; from += CHUNK) {
      const rows = await readRowsByEntry(client, obis, from, Math.min(CHUNK, toEntry - from + 1));
      for (const r of rows) out.push(decodeRow(r.t === 'structure' ? r.v : [], cols));
    }
    return out;
  } catch (e) {
    // Only a meter access refusal on the first chunk triggers the slow path; anything else (timeouts, desync) propagates.
    if (out.length > 0 || !/data-access-result/.test(String((e as Error).message))) throw e;
  }
  opts?.onFallback?.();
  const buf = await client.get(7, obis, 2);
  if (buf.t !== 'array') throw new Error(`profile: buffer of ${obis} is not an array (got ${buf.t})`);
  return buf.v.slice(fromEntry - 1, toEntry).map((r) => decodeRow(r.t === 'structure' ? r.v : [], cols));
}
