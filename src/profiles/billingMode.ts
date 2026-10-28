import type { DlmsClient } from '../dlms/client';
import { getEntriesInUse } from '../dlms/profile';
import { appendPending, getProgress, setProgress } from '../store/db';
import { readRange } from './read';
import { billingTemplate, eventTemplate, loadTemplate, type ColumnSpec, type Reading } from './templates';

const BILLING = '1.0.98.1.0.255';
const LOAD = '1.0.99.1.0.255';
const PQ = '0.0.99.98.0.255';

const full = async (client: DlmsClient, obis: string, cols: ColumnSpec[]) =>
  readRange(client, obis, cols, 1, await getEntriesInUse(client, obis));

/** Mode A: Billing + PQ are snapshots re-read in full; Load is read as a delta since the stored marker. */
export async function readBillingMode(client: DlmsClient, mac: string, type: 1 | 3): Promise<{
  billing: Reading[][]; pq: Reading[][]; loadAdded: Reading[][]; fullReread: boolean; nothingNew: boolean;
}> {
  const billing = await full(client, BILLING, billingTemplate(type));
  const pq = await full(client, PQ, eventTemplate(type));
  const cols = loadTemplate(type);
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
  if (loadAdded.length) {
    await appendPending(mac, loadAdded, { from, to: E });
    const lastClock = loadAdded[loadAdded.length - 1][0].value;
    // an unreadable clock can't anchor the next delta check, so leave the marker alone and re-read next visit
    if (lastClock !== null) await setProgress(mac, { lastEntry: E, lastClock });
  }
  return { billing, pq, loadAdded, fullReread, nothingNew };
}
