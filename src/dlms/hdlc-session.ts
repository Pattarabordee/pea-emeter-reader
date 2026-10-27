import { encodeHdlc, decodeHdlc } from './hdlc';

// rr is set on needMore: the RR frame the transport must send to request the next segment.
export type HdlcEvent =
  | { kind: 'ua' }
  | { kind: 'rr' }
  | { kind: 'info'; apdu: Uint8Array }
  | { kind: 'needMore'; rr: Uint8Array };

const SNRM = 0x93, DISC = 0x53, UA = 0x73;

export class HdlcSession {
  private ns = 0; // next send sequence
  private nr = 0; // next expected receive sequence
  private buf: Uint8Array[] = [];
  private readonly dest: number;
  private readonly src: number;

  /** Raw DLMS addresses; HDLC-encoded here as (addr<<1)|1. maxInfo = max info bytes per I-frame (DLMS default 128). */
  constructor(clientAddr: number, serverAddr: number, private readonly maxInfo = 128) {
    this.dest = (serverAddr << 1) | 1;
    this.src = (clientAddr << 1) | 1;
  }

  private frame(control: number, info?: Uint8Array, segmented = false): Uint8Array {
    return encodeHdlc({ dest: this.dest, src: this.src, control, info, segmented });
  }

  snrm(): Uint8Array {
    return this.frame(SNRM);
  }

  disconnect(): Uint8Array {
    return this.frame(DISC);
  }

  sendInfo(llc: Uint8Array): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (let p = 0; p === 0 || p < llc.length; p += this.maxInfo) {
      const last = p + this.maxInfo >= llc.length;
      const control = (this.nr << 5) | 0x10 | (this.ns << 1);
      this.ns = (this.ns + 1) & 7;
      out.push(this.frame(control, llc.subarray(p, p + this.maxInfo), !last));
    }
    return out;
  }

  onReceive(bytes: Uint8Array): HdlcEvent {
    const f = decodeHdlc(bytes);
    if (f.control === UA) {
      this.ns = this.nr = 0;
      this.buf = [];
      return { kind: 'ua' };
    }
    if ((f.control & 0x0f) === 0x01) return { kind: 'rr' }; // meter acks our segment; our Ns is already advanced
    if ((f.control & 1) !== 0) {
      this.buf = [];
      throw new Error(`HDLC: unexpected control 0x${f.control.toString(16)}`);
    }
    if (((f.control >> 1) & 7) !== this.nr) throw new Error('HDLC: out-of-sequence I-frame');
    this.nr = (this.nr + 1) & 7;
    if (f.info) this.buf.push(f.info);
    if (f.segmented) return { kind: 'needMore', rr: this.frame((this.nr << 5) | 0x11) };
    const total = this.buf.reduce((n, b) => n + b.length, 0);
    const apdu = new Uint8Array(total);
    let p = 0;
    for (const b of this.buf) { apdu.set(b, p); p += b.length; }
    this.buf = [];
    return { kind: 'info', apdu };
  }
}
