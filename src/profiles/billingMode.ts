import type { DlmsClient } from '../dlms/client';
import { getCaptureObjects, getEntriesInUse } from '../dlms/profile';
import { appendPending, clearPending, getProgress, setProgress } from '../store/db';
import { readRange } from './read';
import { billingTemplate, eventTemplate, loadTemplate, verifyCapture, type ColumnSpec, type Reading } from './templates';

const BILLING = '1.0.98.1.0.255';
const LOAD = '1.0.99.1.0.255';
const PQ = '0.0.99.98.0.255';

const resolve = async (client: DlmsClient, obis: string, tpl: ColumnSpec[]) =>
  verifyCapture(tpl, await getCaptureObjects(client, obis));
const full = async (client: DlmsClient, obis: string, cols: ColumnSpec[]) =>
  readRange(client, obis, cols, 1, await getEntriesInUse(client, obis));

/** Mode A: Billing + PQ are snapshots re-read in full; Load is read as a delta since the stored marker. */
export async function readBillingMode(client: DlmsClient, mac: string, type: 1 | 3): Promise<{
  billing: Reading[][]; pq: Reading[][]; loadAdded: Reading[][]; fullReread: boolean; nothingNew: boolean; layoutWarning: boolean;
}> {
  const vb = await resolve(client, BILLING, billingTemplate(type));
  const vp = await resolve(client, PQ, eventTemplate(type));
  const vl = await resolve(client, LOAD, loadTemplate(type));
  const layoutWarning = !vb.ok || !vp.ok || !vl.ok; // same rule as the legacy tabs
  const billing = await full(client, BILLING, vb.columns);
  const pq = await full(client, PQ, vp.columns);
  const cols = vl.columns;
  const E = await getEntriesInUse(client, LOAD);
  const p = await getProgress(mac);
  let from = 1, fullReread = false, nothingNew = false;
  if (p) {
    const [row] = p.lastEntry <= E ? await readRange(client, LOAD, cols, p.lastEntry, p.lastEntry) : [];
    if (!row || row[0].value !== p.lastClock) fullReread = true;
    else if (E === p.lastEntry) nothingNew = true;
    else from = p.lastEntry + 1;
  }
  const loadAdded = nothingNew ? [] : await readRange(client, LOAD, cols, from, E);
  // stale higher-index entries from a pre-reset buffer must not survive the index-merge in appendPending
  if (fullReread) await clearPending(mac);
  if (loadAdded.length) {
    await appendPending(mac, loadAdded, { from, to: E });
    const lastClock = loadAdded[loadAdded.length - 1][0].value;
    // an unreadable clock can't anchor the next delta check, so leave the marker alone and re-read next visit
    if (lastClock !== null) await setProgress(mac, { lastEntry: E, lastClock });
  }
  return { billing, pq, loadAdded, fullReread, nothingNew, layoutWarning };
}
