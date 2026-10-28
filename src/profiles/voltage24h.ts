import type { DlmsClient } from '../dlms/client';
import { getCapturePeriod, getCaptureObjects, getEntriesInUse } from '../dlms/profile';
import { readRange } from './read';
import { loadTemplate, verifyCapture, type Reading } from './templates';

/** Mode B: last 24 h of the load profile, reduced to clock + voltage columns. */
export async function read24hVoltage(
  client: DlmsClient, type: 1 | 3, obis = '1.0.99.1.0.255',
): Promise<{ rows: Reading[][]; periodSec: number }> {
  const got = await getCapturePeriod(client, obis).catch(() => 900);
  // a meter may answer 0/NaN/negative: ceil(86400/0)=Infinity would read the whole buffer
  const periodSec = Number.isFinite(got) && got > 0 ? got : 900;
  const cols = verifyCapture(loadTemplate(type), await getCaptureObjects(client, obis)).columns;
  if (!cols.some((c) => c.key.startsWith('voltage'))) throw new Error('no voltage column');
  const E = await getEntriesInUse(client, obis);
  if (E === 0) return { rows: [], periodSec };
  const n = Math.ceil(86400 / periodSec);
  const rows = await readRange(client, obis, cols, Math.max(1, E - n + 1), E);
  const clockKey = loadTemplate(type)[0].key;
  return { rows: rows.map((r) => r.filter((x) => x.key === clockKey || x.key.startsWith('voltage'))), periodSec };
}
