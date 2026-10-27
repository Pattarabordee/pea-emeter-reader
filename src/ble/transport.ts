import type { Transport } from '../dlms/client';
import { SERVICE_UUIDS } from './uuids';

const FLAG = 0x7e;

/** Split into ordered pieces of at most `mtu` bytes (last may be shorter). */
export function chunk(bytes: Uint8Array, mtu: number): Uint8Array<ArrayBuffer>[] {
  if (!(mtu > 0)) throw new Error('mtu must be > 0');
  const out: Uint8Array<ArrayBuffer>[] = [];
  for (let i = 0; i < bytes.length; i += mtu) out.push(bytes.slice(i, i + mtu));
  return out;
}

/**
 * Reassembles 0x7E..0x7E HDLC frames from arbitrary notification boundaries.
 * State: `buf` is null when idle (garbage before a flag is dropped), else the open frame.
 * A flag right after another flag (empty body) just restarts the frame; a flag that closes
 * a non-empty frame emits it and stays open, so a flag shared between two frames still works.
 */
export class FrameReassembler {
  private buf: number[] | null = null;

  feed(bytes: Uint8Array): Uint8Array[] {
    const out: Uint8Array<ArrayBuffer>[] = [];
    for (const b of bytes) {
      if (b === FLAG) {
        if (this.buf && this.buf.length > 1) {
          this.buf.push(FLAG);
          out.push(Uint8Array.from(this.buf));
        }
        this.buf = [FLAG];
      } else if (this.buf) this.buf.push(b);
    }
    return out;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class BleTransport implements Transport {
  private cb: (b: Uint8Array) => void = () => {};
  private readonly re = new FrameReassembler();

  /**
   * chunkSize: Web Bluetooth has no requestMtu; the browser negotiates the ATT MTU itself.
   * 20 is the guaranteed minimum payload (safe default); the field test may raise it.
   */
  constructor(
    private readonly server: BluetoothRemoteGATTServer,
    private readonly writeChar: BluetoothRemoteGATTCharacteristic,
    notifyChar: BluetoothRemoteGATTCharacteristic,
    private readonly chunkSize = 20,
    private readonly delayMs = 10,
  ) {
    notifyChar.addEventListener('characteristicvaluechanged', (ev) => {
      const dv = (ev.target as BluetoothRemoteGATTCharacteristic).value;
      if (!dv) return;
      for (const f of this.re.feed(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength))) this.cb(f);
    });
  }

  onData(cb: (b: Uint8Array) => void): void {
    this.cb = cb;
  }

  async write(b: Uint8Array): Promise<void> {
    const noResp = this.writeChar.properties.writeWithoutResponse;
    for (const p of chunk(b, this.chunkSize)) {
      if (noResp) {
        await this.writeChar.writeValueWithoutResponse(p);
        await sleep(this.delayMs);
      } else await this.writeChar.writeValueWithResponse(p);
    }
  }

  disconnect(): void {
    if (this.server.connected) this.server.disconnect();
  }
}

/** Chooser-based connect (cannot target a MAC). Glue: field-verified, not run in CI. */
export async function connectMeter(chunkSize?: number): Promise<BleTransport> {
  const device = await navigator.bluetooth.requestDevice({
    filters: SERVICE_UUIDS.map((s) => ({ services: [s] })),
    optionalServices: SERVICE_UUIDS,
  });
  if (!device.gatt) throw new Error('device has no GATT');
  const server = await device.gatt.connect();
  let chars: BluetoothRemoteGATTCharacteristic[] = [];
  for (const s of SERVICE_UUIDS) {
    try {
      chars = await (await server.getPrimaryService(s)).getCharacteristics();
      break;
    } catch {
      /* service not present on this device, try next */
    }
  }
  // Select by property, like the PEA app's displayGattServices.
  const writeChar = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
  const notifyChar = chars.find((c) => c.properties.notify);
  if (!writeChar || !notifyChar) {
    server.disconnect();
    throw new Error('write/notify characteristics not found');
  }
  await notifyChar.startNotifications();
  return new BleTransport(server, writeChar, notifyChar, chunkSize);
}
