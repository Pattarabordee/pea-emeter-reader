// Raw HDLC frame capture for building golden vectors. Observe-only; off by default.
// JSONL line: {"dir":"tx"|"rx","ts":<epoch ms>,"hex":"<lowercase, no separators>"}
// NOTE: captured AARQ frames contain the LLS password bytes.
interface Frame { dir: 'tx' | 'rx'; ts: number; hex: string }

let enabled = false;
let frames: Frame[] = [];

export function setCaptureEnabled(on: boolean): void { enabled = on; }
export function isCaptureEnabled(): boolean { return enabled; }
export function clearFrames(): void { frames = []; }
export function frameCount(): number { return frames.length; }

export function recordFrame(dir: 'tx' | 'rx', bytes: Uint8Array): void {
  if (!enabled) return;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  frames.push({ dir, ts: Date.now(), hex });
}

export function exportFrames(): string {
  return frames.map((f) => JSON.stringify(f)).join('\n');
}
