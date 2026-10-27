import { HdlcSession, type HdlcEvent } from './hdlc-session';
import { buildAarq, parseAare } from './acse';
import { ByteReader, decodeData } from './axdr';
import { buildGetNormal, buildGetNext, parseGetResponse, type SelectiveAccess } from './get';
import { obisToBytes } from './obis';
import type { DlmsData } from './types';

export interface Transport {
  write(b: Uint8Array): Promise<void>;
  onData(cb: (b: Uint8Array) => void): void;
}

const LLC_TX = [0xe6, 0xe6, 0x00]; // client -> meter
const LLC_RX = [0xe6, 0xe7, 0x00]; // meter -> client

export class DlmsClient {
  private readonly session: HdlcSession;
  private readonly queue: Array<HdlcEvent | Error> = [];
  private waiter?: { resolve: (e: HdlcEvent) => void; reject: (e: Error) => void };

  constructor(private readonly t: Transport, private readonly o: { clientAddr: number; serverAddr: number; password: Uint8Array }) {
    this.session = new HdlcSession(o.clientAddr, o.serverAddr);
    t.onData((b) => this.handleFrame(b));
  }

  // Events are queued, so a transport that delivers synchronously inside write() works too.
  private push(e: HdlcEvent | Error): void {
    const w = this.waiter;
    if (w) {
      this.waiter = undefined;
      if (e instanceof Error) w.reject(e); else w.resolve(e);
    } else this.queue.push(e);
  }

  private handleFrame(b: Uint8Array): void {
    try {
      const ev = this.session.onReceive(b);
      if (ev.kind === 'needMore') this.t.write(ev.rr).catch((e) => this.push(e as Error));
      else this.push(ev);
    } catch (e) {
      this.push(e as Error);
    }
  }

  private next(): Promise<HdlcEvent> {
    const e = this.queue.shift();
    if (e) return e instanceof Error ? Promise.reject(e) : Promise.resolve(e);
    return new Promise((resolve, reject) => { this.waiter = { resolve, reject }; });
  }

  private async expect<K extends HdlcEvent['kind']>(kind: K): Promise<Extract<HdlcEvent, { kind: K }>> {
    const e = await this.next();
    if (e.kind !== kind) throw new Error(`HDLC: expected ${kind}, got ${e.kind}`);
    return e as Extract<HdlcEvent, { kind: K }>;
  }

  /** Send one APDU (LLC-prefixed), pacing segments on the meter's RR, and return the response APDU without LLC. */
  private async request(apdu: Uint8Array): Promise<Uint8Array> {
    const llc = new Uint8Array([...LLC_TX, ...apdu]);
    const frames = this.session.sendInfo(llc);
    for (let i = 0; i < frames.length; i++) {
      await this.t.write(frames[i]);
      if (i < frames.length - 1) await this.expect('rr');
    }
    const { apdu: resp } = await this.expect('info');
    if (LLC_RX.some((v, i) => resp[i] !== v)) throw new Error('DLMS: bad LLC header in response');
    return resp.subarray(3);
  }

  async associate(): Promise<void> {
    await this.t.write(this.session.snrm());
    await this.expect('ua');
    const aare = parseAare(await this.request(buildAarq(this.o.password)));
    if (!aare.accepted) throw new Error(`AARE rejected: ${aare.diagnostic}`);
  }

  async get(classId: number, obis: string, attr: number, access?: SelectiveAccess): Promise<DlmsData> {
    let resp = parseGetResponse(await this.request(buildGetNormal(classId, obisToBytes(obis), attr, access)));
    if ('data' in resp) return decodeData(new ByteReader(resp.data));
    // Block transfer: concatenate every block's raw bytes, decode once at the end.
    const parts: Uint8Array[] = [];
    for (;;) {
      if (!('block' in resp)) throw new Error('GET: unexpected non-block response mid-transfer');
      parts.push(resp.block.raw);
      if (resp.block.last) break;
      resp = parseGetResponse(await this.request(buildGetNext(resp.block.blockNumber)));
    }
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let p = 0;
    for (const part of parts) { all.set(part, p); p += part.length; }
    return decodeData(new ByteReader(all));
  }

  async release(): Promise<void> {
    await this.t.write(this.session.disconnect()); // DISC; the UA reply is not awaited
  }
}
