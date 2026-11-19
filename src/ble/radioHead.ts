import type { Transport } from '../dlms/client';
import { FrameReassembler } from './transport';

// Host side of the radio-head line protocol (firmware/radio-head/src/main.cpp has the command table).
// Pure: bytes in via feed(), lines out via the `send` given to the constructor, so it runs over Web Serial or a test.
// Frames are NOT sent to debug capture: an AARQ carries the meter password.

export type Adv = { mac: string; type: number; rssi: number; us: number; name: string };
export type ConnTiming = { connectedUs: number; mtuUs?: number; discoveredUs: number; readyUs: number; mtu: number; itvl: number; writeNoRsp: boolean };

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (p) => parseInt(p, 16));

export class RadioHead {
  rxBytes = 0; // payload bytes notified by the meter since the caller last zeroed it
  onDisc: (reason: number) => void = () => {};
  private partial = '';
  private advs: Adv[] = [];
  private evt: Record<string, number[]> = {};
  private waiter?: { cmd: string; until: string; resolve: (a: string[]) => void; reject: (e: Error) => void };
  private chain: Promise<unknown> = Promise.resolve();
  private cb: (b: Uint8Array) => void = () => {};
  private readonly re = new FrameReassembler();

  readonly transport: Transport = {
    write: async (b) => { await this.cmd(`TX ${hex(b)}`, 'OK TX'); },
    onData: (cb) => { this.cb = cb; },
  };

  constructor(private readonly send: (line: string) => Promise<void>) {}

  feed(text: string): void {
    const lines = (this.partial + text).split('\n');
    this.partial = lines.pop() ?? '';
    for (const l of lines) if (l.trim()) this.handle(l.trim());
  }

  private handle(line: string): void {
    const [tag, ...a] = line.split(' ');
    if (tag === 'RX') {
      const b = unhex(a[0] ?? '');
      this.rxBytes += b.length;
      for (const f of this.re.feed(b)) this.cb(f);
      return;
    }
    if (tag === 'ADV') {
      this.advs.push({ mac: a[0], type: +a[1], rssi: +a[2], us: +a[3], name: a.slice(4).join(' ') });
      return;
    }
    if (tag === 'EVT') this.evt[a[0]] = a.slice(1).map(Number);
    const w = this.waiter;
    const lost = tag === 'EVT' && a[0] === 'DISC';
    if (lost) this.onDisc(+a[1]);
    if (!w) return;
    if (line.startsWith(w.until)) { this.waiter = undefined; w.resolve(a); }
    else if ((tag === 'ERR' && a[0] === w.cmd) || (lost && w.cmd !== 'DROP')) { this.waiter = undefined; w.reject(new Error(`radio: ${line}`)); }
  }

  /** Send one command and wait for the line starting with `until`. Commands run one at a time, in call order. */
  cmd(line: string, until: string, timeoutMs = 5000): Promise<string[]> {
    const run = () => new Promise<string[]>((resolve, reject) => {
      const t = setTimeout(() => { this.waiter = undefined; reject(new Error(`radio: no "${until}" within ${timeoutMs} ms`)); }, timeoutMs);
      this.waiter = {
        cmd: line.split(' ')[0], until,
        resolve: (a) => { clearTimeout(t); resolve(a); },
        reject: (e) => { clearTimeout(t); reject(e); },
      };
      this.send(line).catch((e) => { clearTimeout(t); this.waiter = undefined; reject(e as Error); });
    });
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  /** Listen for `ms`; every advert is returned (duplicates kept, so gaps between them give the advertising interval). */
  async scan(ms: number, active = false): Promise<Adv[]> {
    this.advs = [];
    await this.cmd(`SCAN ${ms}${active ? ' A' : ''}`, 'SCANEND', ms + 3000);
    return this.advs;
  }

  /** Connect, discover the UART characteristics and subscribe. itvl in 1.25 ms units (6 = 7.5 ms). Times are firmware microseconds. */
  async connect(mac: string, addrType: number, itvl = 6, timeoutMs = 10000): Promise<ConnTiming> {
    this.evt = {};
    const a = await this.cmd(`CONN ${mac} ${addrType} ${itvl} ${timeoutMs}`, 'EVT READY', timeoutMs + 5000);
    return {
      connectedUs: this.evt.CONNECTED?.[0] ?? NaN, mtuUs: this.evt.MTU?.[0], discoveredUs: this.evt.DISCOVERED?.[0] ?? NaN,
      readyUs: +a[1], mtu: +a[2], itvl: +a[3], writeNoRsp: a[4] === '1',
    };
  }

  async info(): Promise<{ mtu: number; itvl: number; rssi: number }> {
    const a = await this.cmd('INFO', 'OK INFO');
    return { mtu: +a[1], itvl: +a[2], rssi: +a[3] };
  }

  async drop(): Promise<void> { await this.cmd('DROP', 'OK DROP'); }
}

/** Per meter: how many adverts, mean RSSI, and the median gap between consecutive adverts in ms (null with fewer than 2). */
export function advStats(advs: Adv[]): { mac: string; type: number; name: string; count: number; rssi: number; gapMs: number | null }[] {
  const by = new Map<string, Adv[]>();
  for (const a of advs) by.set(a.mac, [...(by.get(a.mac) ?? []), a]);
  return [...by.values()].map((l) => {
    // micros() is 32-bit on the radio: >>> 0 keeps a gap correct across the wrap
    const gaps = l.slice(1).map((a, i) => ((a.us - l[i].us) >>> 0) / 1000).sort((x, y) => x - y);
    return {
      mac: l[0].mac, type: l[0].type, name: l.find((a) => a.name)?.name ?? '', count: l.length,
      rssi: Math.round(l.reduce((s, a) => s + a.rssi, 0) / l.length),
      gapMs: gaps.length ? gaps[gaps.length >> 1] : null,
    };
  }).sort((x, y) => y.rssi - x.rssi);
}
