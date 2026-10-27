export type MeterEntry = { name: string; mac: string; password: string; type: 1 | 3; descriptor: string };

/** Parse the PEA meter-list .txt. Only commas separate fields (names may contain spaces);
 *  everything after the 4th comma is the descriptor, so descriptors may contain commas.
 *  Header ('#...'), blank, short, and bad-type (not 1/3) lines are skipped. */
export function parseMeterList(text: string): MeterEntry[] {
  const out: MeterEntry[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const f = line.split(',');
    if (f.length < 5) continue;
    const type = Number(f[3].trim());
    if (type !== 1 && type !== 3) continue;
    const [name, mac, password] = f.map((s) => s.trim());
    out.push({ name, mac, password, type, descriptor: f.slice(4).join(',').trim() });
  }
  return out;
}
